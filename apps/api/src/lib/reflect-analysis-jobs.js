import { recordAIUsage } from './ai-usage'
import {
  runConnectionRouter, runConnectionWriter, missingQualifiedSignalIds,
  CONNECTION_ROUTER_VERSION, CONNECTION_WRITER_VERSION,
} from './connection-ai'
import { readConnectionFamilies, readConnectionTemplates } from './connection-template-store'
import { serviceClient } from './reflect-draft'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from './reflect-analysis-store'

function errorText(error) {
  return String(error?.message || error || 'analysis_failed').slice(0, 500)
}

function hasCards(updates) {
  return !!updates && Object.values(updates).some((module) => (
    module?.hasUpdate === true && Array.isArray(module.cards) && module.cards.length > 0
  ))
}

export async function enqueueReflectAnalysisJob(supabase, {
  reflectId, userId, localDate, journalKind, reset = false,
}) {
  const row = {
    reflect_id: reflectId,
    user_id: userId,
    local_date: localDate,
    journal_kind: journalKind || 'write_freely',
    status: journalKind === 'remember_together' ? 'skipped' : 'pending',
    error: null,
    next_attempt_at: new Date().toISOString(),
    processed_at: journalKind === 'remember_together' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  if (reset) {
    Object.assign(row, { attempts: 0, stage_one_result: null, stage_one_usage: null, claimed_at: null })
    const { error } = await supabase.from('connection_analysis_jobs')
      .upsert(row, { onConflict: 'reflect_id' })
    if (error) throw error
    return row.status !== 'skipped'
  }
  const { error } = await supabase.from('connection_analysis_jobs')
    .upsert(row, { onConflict: 'reflect_id', ignoreDuplicates: true })
  if (error) throw error
  return row.status !== 'skipped'
}

async function claimJob(supabase, reflectId) {
  const { data, error } = await supabase.rpc('claim_connection_analysis_job', {
    p_reflect_id: reflectId || null,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

async function updateJob(supabase, reflectId, patch) {
  const { error } = await supabase.from('connection_analysis_jobs').update({
    ...patch, updated_at: new Date().toISOString(),
  }).eq('reflect_id', reflectId)
  if (error) throw error
}

async function enqueueItemLearning(supabase, reflectId, concepts, matchedItems) {
  if (!concepts.length) return
  const { error } = await supabase.from('item_learning_jobs').upsert({
    reflect_id: reflectId,
    concepts,
    matched_item_ids: matchedItems.map((item) => item.itemId),
    status: 'pending',
    attempts: 0,
    error: null,
    processed_at: null,
    evidence_version: 2,
  }, { onConflict: 'reflect_id', ignoreDuplicates: true })
  if (error) console.warn('[reflect-analysis] item learning enqueue failed:', error.message)
}

async function recordResultUsage(supabase, { userId, feature, promptVersion, result, latencyMs, refId }) {
  try {
    await recordAIUsage(supabase, { userId, feature, promptVersion, result, latencyMs, refId })
  } catch (error) {
    console.warn('[reflect-analysis] usage record failed:', errorText(error))
  }
}

async function analyzeClaimedJob(supabase, job) {
  const reflectId = job.reflect_id
  const [reflectResult, profileResult, itemResult] = await Promise.all([
    supabase.from('reflects')
      .select('id,user_id,body,local_date,shared_to_friends,journal_kind')
      .eq('id', reflectId).maybeSingle(),
    supabase.from('profiles')
      .select('subscription_tier,ai_consent_at').eq('id', job.user_id).maybeSingle(),
    supabase.from('reflect_items')
      .select('item_id,match_label,source_excerpt,items(display_name,rarity)')
      .eq('reflect_id', reflectId).order('position', { ascending: true }),
  ])
  const sourceError = reflectResult.error || profileResult.error || itemResult.error
  if (sourceError) throw sourceError
  const reflect = reflectResult.data
  const profile = profileResult.data
  if (!reflect) throw new Error('reflect_not_found')
  const journalKind = reflect.journal_kind || job.journal_kind || 'write_freely'
  if (journalKind === 'remember_together') {
    await updateJob(supabase, reflectId, { status: 'skipped', processed_at: new Date().toISOString() })
    return { status: 'skipped' }
  }
  if ((profile?.subscription_tier || 'free') === 'free' || !profile?.ai_consent_at || !reflect.body?.trim()) {
    await updateJob(supabase, reflectId, { status: 'skipped', processed_at: new Date().toISOString() })
    return { status: 'skipped' }
  }

  const matchedItems = (itemResult.data || []).map((row) => {
    const item = Array.isArray(row.items) ? row.items[0] : row.items
    return {
      itemId: row.item_id,
      displayName: item?.display_name || row.match_label || row.item_id,
      sourceExcerpt: row.source_excerpt || '',
    }
  })
  const context = await loadReflectAnalyzerContext(supabase, {
    userId: reflect.user_id,
    visibleToFriend: reflect.shared_to_friends !== false,
    localDate: reflect.local_date,
    excludeReflectIds: [reflectId],
  })

  let stageOne = job.stage_one_result?.data ? job.stage_one_result : null
  if (!stageOne) {
    const families = context.connectionEligible ? await readConnectionFamilies(supabase) : []
    const generated = await runConnectionRouter({
      reflectId,
      journal: reflect.body,
      matchedIcons: matchedItems.map((item) => ({ id: item.itemId, name: item.displayName })),
      connectionEnabled: context.connectionEligible,
      familyCatalog: families,
      currentConnectionBoard: context.connectionEligible ? context.currentBoard : null,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    })
    stageOne = generated
    await updateJob(supabase, reflectId, {
      stage_one_result: { data: generated.data },
      stage_one_usage: generated.result.usage || null,
    })
    await Promise.all([
      enqueueItemLearning(supabase, reflectId, generated.data.visualConcepts, matchedItems),
      recordResultUsage(supabase, {
        userId: reflect.user_id,
        feature: 'connection_router',
        promptVersion: CONNECTION_ROUTER_VERSION,
        result: generated.result,
        latencyMs: generated.latencyMs,
        refId: reflectId,
      }),
    ])
  }

  const baseAnalyzer = {
    result: stageOne.result || { provider: null, model: null, usage: job.stage_one_usage || null },
    promptVersion: CONNECTION_ROUTER_VERSION,
    data: {
      visualConcepts: stageOne.data.visualConcepts || [],
      connectionSignals: stageOne.data.connectionSignals || [],
      connectionUpdates: null,
    },
    connectionStageOne: stageOne.data,
    writerVersion: CONNECTION_WRITER_VERSION,
    templateLibraryVersion: 'v2',
  }
  // Persist compact evidence before stage two. A later writer outage cannot
  // erase useful history or force the router to spend tokens again.
  await persistReflectAnalyzerResult(supabase, {
    reflectId,
    userId: reflect.user_id,
    localDate: reflect.local_date,
    reflectsToday: 1,
    analyzer: baseAnalyzer,
    context,
    matchedItems,
  })

  const eligibleSignals = (stageOne.data.eligibleSignals || stageOne.data.connectionSignals || [])
    .filter((signal) => signal.cardEligible === true).slice(0, 3)
  if (!context.connectionEnabled || eligibleSignals.length === 0) {
    await updateJob(supabase, reflectId, {
      status: eligibleSignals.length === 0 ? 'no_update' : 'completed',
      processed_at: new Date().toISOString(),
    })
    return { status: eligibleSignals.length === 0 ? 'no_update' : 'completed' }
  }

  const templates = await readConnectionTemplates(supabase, eligibleSignals.map((signal) => signal.familyKey))
  const writer = await runConnectionWriter({
    reflectId,
    journal: reflect.body,
    selectedSignals: eligibleSignals,
    scenarioTemplates: templates,
    currentConnectionBoard: context.currentBoard,
    writerRecentEvidence: context.writerRecentEvidence,
    readerRecentEvidence: context.readerRecentEvidence,
  })
  const missingQualified = missingQualifiedSignalIds(writer.signalResults, writer.data)
  if (missingQualified.length > 0) {
    // A formatter/guard rejection is repairable output failure, not evidence
    // that the qualified signal had no value. Let the durable job retry.
    throw new Error('connection_writer_missing_qualified_card')
  }
  await persistReflectAnalyzerResult(supabase, {
    reflectId,
    userId: reflect.user_id,
    localDate: reflect.local_date,
    reflectsToday: 1,
    analyzer: {
      ...baseAnalyzer,
      result: writer.result,
      results: writer.results,
      data: { ...baseAnalyzer.data, connectionUpdates: writer.data },
      signalResults: writer.signalResults,
    },
    context,
    matchedItems,
  })
  await Promise.all(writer.results.map((result, index) => recordResultUsage(supabase, {
    userId: reflect.user_id,
    feature: index === 0 ? 'connection_writer' : 'connection_writer_repair',
    promptVersion: CONNECTION_WRITER_VERSION,
    result,
    latencyMs: index === 0 ? writer.latencyMs : null,
    refId: reflectId,
  })))
  const status = hasCards(writer.data) ? 'completed' : 'no_update'
  await updateJob(supabase, reflectId, { status, processed_at: new Date().toISOString() })
  return { status }
}

export async function processReflectAnalysisJobs({ supabase = serviceClient(), reflectId = null } = {}) {
  const jobs = await claimJob(supabase, reflectId)
  const results = []
  for (const job of jobs) {
    try {
      results.push({ reflectId: job.reflect_id, ...(await analyzeClaimedJob(supabase, job)) })
    } catch (error) {
      const message = errorText(error)
      const exhausted = Number(job.attempts || 0) >= 3
      const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, Number(job.attempts || 1) - 1))
      await updateJob(supabase, job.reflect_id, {
        status: 'failed',
        error: message,
        next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
        ...(exhausted ? { processed_at: new Date().toISOString() } : {}),
      })
      console.warn('[reflect-analysis] job failed:', { reflectId: job.reflect_id, attempts: job.attempts, error: message })
      results.push({ reflectId: job.reflect_id, status: 'failed', error: message })
    }
  }
  return results
}
