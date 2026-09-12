import { recordAIUsage } from './ai-usage'
import {
  runConnectionRouter, runConnectionMatcher, runConnectionWriter,
  mergeConnectionUpdates, missingQualifiedSignalIds,
  CONNECTION_ROUTER_VERSION, CONNECTION_MATCHER_VERSION, CONNECTION_WRITER_VERSION,
} from './connection-ai'
import {
  readConnectionFamilies, readConnectionScenarioIndex, readConnectionTemplatesByScenarioKeys,
} from './connection-template-store'
import { serviceClient } from './reflect-draft'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from './reflect-analysis-store'

function errorText(error) {
  return String(error?.message || error || 'analysis_failed').slice(0, 500)
}

async function atStage(name, operation) {
  try {
    return await operation()
  } catch (error) {
    if (!error.pipelineStage) error.pipelineStage = name
    throw error
  }
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
    failure_stage: null,
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

async function markReaderRecoveryRequired(supabase, writerId) {
  const { data: pairing, error: pairingError } = await supabase.from('pairings')
    .select('partner_user_id').eq('user_id', writerId).maybeSingle()
  if (pairingError) throw pairingError
  if (!pairing?.partner_user_id) return
  const { error } = await supabase.from('profiles')
    .update({ connection_resume_required: true }).eq('id', pairing.partner_user_id)
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
  const [reflectResult, profileResult, itemResult] = await atStage('source_load', () => Promise.all([
    supabase.from('reflects')
      .select('id,user_id,body,local_date,shared_to_friends,journal_kind')
      .eq('id', reflectId).maybeSingle(),
    supabase.from('profiles')
      .select('subscription_tier,ai_consent_at').eq('id', job.user_id).maybeSingle(),
    supabase.from('reflect_items')
      .select('item_id,match_label,source_excerpt,items(display_name,rarity)')
      .eq('reflect_id', reflectId).order('position', { ascending: true }),
  ]))
  const sourceError = reflectResult.error || profileResult.error || itemResult.error
  if (sourceError) throw sourceError
  const reflect = reflectResult.data
  const profile = profileResult.data
  if (!reflect) throw new Error('reflect_not_found')
  const journalKind = reflect.journal_kind || job.journal_kind || 'write_freely'
  if (journalKind === 'remember_together') {
    await updateJob(supabase, reflectId, {
      status: 'skipped', error: null, failure_stage: null, processed_at: new Date().toISOString(),
    })
    return { status: 'skipped' }
  }
  if ((profile?.subscription_tier || 'free') === 'free' || !profile?.ai_consent_at || !reflect.body?.trim()) {
    await updateJob(supabase, reflectId, {
      status: 'skipped', error: null, failure_stage: null, processed_at: new Date().toISOString(),
    })
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
  const context = await atStage('context_load', () => loadReflectAnalyzerContext(supabase, {
    userId: reflect.user_id,
    visibleToFriend: reflect.shared_to_friends !== false,
    localDate: reflect.local_date,
    excludeReflectIds: [reflectId],
  }))

  let stageOne = job.stage_one_result?.data ? job.stage_one_result : null
  if (!stageOne) {
    const families = context.connectionEligible
      ? await atStage('family_index', () => readConnectionFamilies(supabase)) : []
    const generated = await atStage('connection_router', () => runConnectionRouter({
      reflectId,
      journal: reflect.body,
      matchedIcons: matchedItems.map((item) => ({ id: item.itemId, name: item.displayName })),
      connectionEnabled: context.connectionEligible,
      familyCatalog: families,
      currentConnectionBoard: context.connectionEligible ? context.currentBoard : null,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    }))
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
  await atStage('router_persist', () => persistReflectAnalyzerResult(supabase, {
    reflectId,
    userId: reflect.user_id,
    localDate: reflect.local_date,
    reflectsToday: 1,
    analyzer: baseAnalyzer,
    context,
    matchedItems,
    pipelineStatus: 'router_completed',
  }))

  const eligibleSignals = (stageOne.data.eligibleSignals || stageOne.data.connectionSignals || [])
    .filter((signal) => signal.cardEligible === true).slice(0, 3)
  if (!context.connectionEnabled || eligibleSignals.length === 0) {
    const pipelineStatus = eligibleSignals.length === 0 ? 'no_update' : 'deferred'
    const { error: pipelineError } = await supabase.from('reflect_ai_analyses').update({
      connection_pipeline_status: pipelineStatus,
      error: null,
    }).eq('reflect_id', reflectId)
    if (pipelineError) throw pipelineError
    await updateJob(supabase, reflectId, {
      status: eligibleSignals.length === 0 ? 'no_update' : 'completed',
      error: null,
      failure_stage: null,
      processed_at: new Date().toISOString(),
    })
    return { status: eligibleSignals.length === 0 ? 'no_update' : 'completed' }
  }

  const scenarioIndex = await atStage('scenario_index', () => readConnectionScenarioIndex(
    supabase, eligibleSignals.map((signal) => signal.familyKey),
  ))
  const matcher = await atStage('scenario_matcher', () => runConnectionMatcher({
    reflectId,
    journal: reflect.body,
    selectedSignals: eligibleSignals,
    scenarioIndex,
    currentConnectionBoard: context.currentBoard,
    writerRecentEvidence: context.writerRecentEvidence,
    readerRecentEvidence: context.readerRecentEvidence,
  }))
  await recordResultUsage(supabase, {
    userId: reflect.user_id,
    feature: 'connection_matcher',
    promptVersion: CONNECTION_MATCHER_VERSION,
    result: matcher.result,
    latencyMs: matcher.latencyMs,
    refId: reflectId,
  })

  const persistMatcherPartial = async (failure) => {
    if (!hasCards(matcher.data)) return
    await atStage('connection_partial_persist', () => persistReflectAnalyzerResult(supabase, {
      reflectId,
      userId: reflect.user_id,
      localDate: reflect.local_date,
      reflectsToday: 1,
      analyzer: {
        ...baseAnalyzer,
        result: matcher.result,
        results: [matcher.result],
        data: { ...baseAnalyzer.data, connectionUpdates: matcher.data },
        signalResults: matcher.signalResults,
      },
      context,
      matchedItems,
      pipelineStatus: 'partial',
      error: errorText(failure),
    }))
    failure.partial = true
  }

  const resolvedIds = new Set(matcher.signalResults.map((row) => row.signalId))
  const missingResolution = eligibleSignals
    .map((signal) => signal.signalId).filter((signalId) => !resolvedIds.has(signalId))
  if (missingResolution.length > 0) {
    const error = new Error('connection_matcher_missing_signal_result')
    error.pipelineStage = 'scenario_matcher_validation'
    await persistMatcherPartial(error)
    throw error
  }

  const matchedResults = matcher.signalResults.filter((row) => row.outcome === 'matched')
  const missingCustom = new Set(missingQualifiedSignalIds(
    matcher.signalResults.filter((row) => row.outcome === 'custom'), matcher.data,
    { currentBoard: context.currentBoard, reflectId },
  ))
  const generationResults = matcher.signalResults.filter((row) => (
    row.outcome === 'matched' || (row.outcome === 'custom' && missingCustom.has(row.signalId))
  ))
  const generationIds = new Set(generationResults.map((row) => row.signalId))
  const generationSignals = eligibleSignals.filter((signal) => generationIds.has(signal.signalId))

  let writer = null
  if (matchedResults.length > 0 || generationSignals.length > 0) {
    let templates
    try {
      templates = await atStage('template_load', () => readConnectionTemplatesByScenarioKeys(
        supabase, matchedResults.map((row) => row.scenarioKey),
      ))
    } catch (error) {
      await persistMatcherPartial(error)
      throw error
    }
    const templateByScenario = new Map(templates.map((template) => [template.scenarioKey, template]))
    const generationRequests = generationResults.map((row) => ({
      signal: generationSignals.find((signal) => signal.signalId === row.signalId),
      outcome: row.outcome,
      scenarioKey: row.scenarioKey,
      scenarioTemplate: row.outcome === 'matched' ? templateByScenario.get(row.scenarioKey) || null : null,
    }))
    if (generationRequests.some((request) => request.outcome === 'matched' && !request.scenarioTemplate)) {
      const error = new Error('connection_template_not_found')
      error.pipelineStage = 'template_load'
      await persistMatcherPartial(error)
      throw error
    }
    try {
      writer = await atStage('template_writer', () => runConnectionWriter({
        reflectId,
        journal: reflect.body,
        selectedSignals: generationSignals,
        signalResults: generationResults,
        generationRequests,
        currentConnectionBoard: context.currentBoard,
        writerRecentEvidence: context.writerRecentEvidence,
        readerRecentEvidence: context.readerRecentEvidence,
      }))
    } catch (error) {
      // A matched template request must not delay valid original cards that
      // the matcher already completed in the same Journal analysis.
      await persistMatcherPartial(error)
      throw error
    }
    await recordResultUsage(supabase, {
      userId: reflect.user_id,
      feature: 'connection_writer',
      promptVersion: CONNECTION_WRITER_VERSION,
      result: writer.result,
      latencyMs: writer.latencyMs,
      refId: reflectId,
    })
  }

  const finalUpdates = mergeConnectionUpdates(
    [matcher.data, writer?.data], reflectId, {
      allowSharedRhythm: (context.readerRecentEvidence || []).length > 0,
      maxTotal: 3,
      currentBoard: context.currentBoard,
    },
  )
  const missingQualified = missingQualifiedSignalIds(matcher.signalResults, finalUpdates, {
    currentBoard: context.currentBoard, reflectId,
  })
  await atStage('connection_persist', () => persistReflectAnalyzerResult(supabase, {
    reflectId,
    userId: reflect.user_id,
    localDate: reflect.local_date,
    reflectsToday: 1,
    analyzer: {
      ...baseAnalyzer,
      result: writer?.result || matcher.result,
      results: [matcher.result, ...(writer?.results || [])],
      data: { ...baseAnalyzer.data, connectionUpdates: finalUpdates },
      signalResults: matcher.signalResults,
    },
    context,
    matchedItems,
    pipelineStatus: missingQualified.length > 0 ? 'partial' : 'completed',
    error: missingQualified.length > 0 ? 'connection_writer_missing_qualified_card' : null,
  }))
  if (missingQualified.length > 0) {
    const error = new Error('connection_writer_missing_qualified_card')
    error.pipelineStage = 'writer_validation'
    error.partial = hasCards(finalUpdates)
    throw error
  }
  const status = hasCards(finalUpdates) ? 'completed' : 'no_update'
  await updateJob(supabase, reflectId, {
    status, error: null, failure_stage: null, processed_at: new Date().toISOString(),
  })
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
        failure_stage: error.pipelineStage || 'unknown',
        next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
        ...(exhausted ? { processed_at: new Date().toISOString() } : {}),
      })
      const { error: analysisStatusError } = await supabase.from('reflect_ai_analyses').update({
        connection_pipeline_status: error.partial ? 'partial' : exhausted ? 'failed' : 'retrying',
        error: message,
      }).eq('reflect_id', job.reflect_id)
      if (analysisStatusError) {
        console.warn('[reflect-analysis] analysis status update failed:', analysisStatusError.message)
      }
      if (exhausted || error.partial) {
        try {
          await markReaderRecoveryRequired(supabase, job.user_id)
        } catch (recoveryError) {
          console.warn('[reflect-analysis] recovery flag failed:', errorText(recoveryError))
        }
      }
      console.warn('[reflect-analysis] job failed:', { reflectId: job.reflect_id, attempts: job.attempts, error: message })
      results.push({ reflectId: job.reflect_id, status: 'failed', error: message })
    }
  }
  return results
}
