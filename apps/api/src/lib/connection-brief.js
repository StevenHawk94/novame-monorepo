import {
  runConnectionRouter,
  runConnectionWriter,
  missingQualifiedSignalIds,
  CONNECTION_ROUTER_VERSION,
  CONNECTION_WRITER_VERSION,
} from './connection-ai'
import { recordAIUsage } from './ai-usage'
import { applyConnectionUpdates, loadReflectAnalyzerContext } from './reflect-analysis-store'
import { compactConnectionEvidence, CONNECTION_RETENTION_DAYS } from './connection-evidence'
import { readConnectionFamilies, readConnectionTemplates } from './connection-template-store'

const RETENTION_MS = CONNECTION_RETENTION_DAYS * 24 * 60 * 60 * 1000

async function finishResume(supabase, { forUser, partnerId, pairedSince, through }) {
  let query = supabase.from('reflect_ai_analyses')
    .update({ connection_mode: 'caught_up' })
    .eq('user_id', partnerId).eq('connection_mode', 'inactive')
    .lte('created_at', through)
  if (pairedSince) query = query.gte('created_at', pairedSince)
  const [analysisResult, profileResult] = await Promise.all([
    query,
    supabase.from('profiles').update({ connection_resume_required: false }).eq('id', forUser),
  ])
  if (analysisResult.error) throw analysisResult.error
  if (profileResult.error) throw profileResult.error
}

async function latestUntrackedReflect(supabase, { partnerId, pairedSince }) {
  let query = supabase.from('reflects')
    .select('id, local_date, created_at')
    .eq('user_id', partnerId)
    .gte('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  if (pairedSince) query = query.gte('created_at', pairedSince)
  const { data: rows, error } = await query
  if (error) throw error
  const candidate = rows?.[0]
  if (!candidate) return null

  const { data: analysis, error: analysisError } = await supabase
    .from('reflect_ai_analyses')
    .select('status')
    .eq('reflect_id', candidate.id)
    .maybeSingle()
  if (analysisError) throw analysisError
  if (analysis?.status === 'completed') return null
  return {
    reflect_id: candidate.id,
    local_date: candidate.local_date,
    created_at: candidate.created_at,
    recovery: true,
  }
}

async function saveRecoveredAnalysis(supabase, {
  latest, partnerId, generated, updates, connectionEligible, stageOne = null,
}) {
  if (!latest?.recovery) return
  const { error } = await supabase.from('reflect_ai_analyses').upsert({
    reflect_id: latest.reflect_id,
    user_id: partnerId,
    local_date: latest.local_date,
    prompt_version: stageOne ? CONNECTION_ROUTER_VERSION : CONNECTION_WRITER_VERSION,
    weekly_eligible: false,
    weekly_evidence: null,
    visual_concepts: [],
    connection_eligible: connectionEligible,
    connection_updates: updates,
    connection_stage_one: stageOne?.data || null,
    connection_signal_results: generated.signalResults || null,
    connection_writer_version: CONNECTION_WRITER_VERSION,
    template_library_version: 'v2',
    connection_mode: 'caught_up',
    provider: generated.result.provider,
    model: generated.result.model,
    usage: generated.result.usage || null,
    status: 'completed',
    error: null,
    completed_at: new Date().toISOString(),
  }, { onConflict: 'reflect_id' })
  if (error) throw error
}

/**
 * Resume after a reader was away for 48h. Compare all retained privacy-safe
 * unprocessed signals together and publish only the three most valuable,
 * distinct updates. Legacy rows without retained signals keep the former
 * single-latest-reflection fallback instead of widening raw journal access.
 */
export async function generateBrief(supabase, {
  forUser, partnerId, date, cachedPayload = null, pairedSince = null,
}) {
  let latestQuery = supabase.from('reflect_ai_analyses')
    .select('reflect_id, local_date, created_at, connection_signals, connection_updates')
    .eq('user_id', partnerId).eq('status', 'completed').eq('connection_eligible', true)
    .eq('connection_mode', 'inactive')
    .gte('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(120)
  if (pairedSince) latestQuery = latestQuery.gte('created_at', pairedSince)
  const { data: latestRows, error } = await latestQuery
  let latest = latestRows?.[0]
  if (error) return { ok: false, reason: 'query_failed' }
  // Some deployments received Connection v2 without the prerequisite
  // analyzer tables. Recover only the newest post-pairing reflection that has
  // no completed analysis, never a backlog.
  if (!latest) {
    try {
      latest = await latestUntrackedReflect(supabase, { partnerId, pairedSince })
    } catch {
      return { ok: false, reason: 'query_failed' }
    }
  }
  if (!latest) {
    const { error: clearError } = await supabase.from('profiles')
      .update({ connection_resume_required: false }).eq('id', forUser)
    if (clearError) return { ok: false, reason: 'query_failed' }
    return { ok: true, insights: cachedPayload, refreshed: false }
  }

  const unprocessedSignals = compactConnectionEvidence(latestRows, {
    recentLimit: 18,
    backgroundLimit: 12,
    retainBackgroundOneOff: true,
  }).map((signal) => ({
    ...signal,
    isNewest: Date.parse(signal.lastSeenAt) >= Date.parse(latest.created_at) - 1000,
  }))

  let reflect = null
  let itemRows = []
  if (unprocessedSignals.length === 0) {
    const [reflectResult, itemRowsResult] = await Promise.all([
      supabase.from('reflects').select('id, body, local_date, created_at')
        .eq('id', latest.reflect_id).eq('user_id', partnerId).maybeSingle(),
      supabase.from('reflect_items').select('item_id, match_label')
        .eq('reflect_id', latest.reflect_id).eq('visible_to_paired', true)
        .order('position', { ascending: true }),
    ])
    if (reflectResult.error || itemRowsResult.error) {
      return { ok: false, reason: 'query_failed' }
    }
    reflect = reflectResult.data
    itemRows = itemRowsResult.data || []
  }

  if (unprocessedSignals.length === 0 && !reflect?.body?.trim()) {
    await finishResume(supabase, {
      forUser, partnerId, pairedSince, through: latest.created_at,
    })
    return { ok: true, insights: cachedPayload, refreshed: false }
  }

  try {
    const context = await loadReflectAnalyzerContext(supabase, {
      userId: partnerId, visibleToFriend: true, localDate: latest.local_date || date,
      excludeReflectIds: (latestRows || []).map((row) => row.reflect_id),
    })
    let stageOne = null
    let selectedSignals = unprocessedSignals
      .filter((signal) => signal.cardEligible !== false)
      .sort((left, right) => Number(right.isNewest) - Number(left.isNewest))
      .slice(0, 3)
    if (selectedSignals.length === 0 && reflect?.body?.trim()) {
      const families = await readConnectionFamilies(supabase)
      stageOne = await runConnectionRouter({
        reflectId: latest.reflect_id,
        journal: reflect.body,
        matchedIcons: itemRows.map((item) => ({ id: item.item_id, name: item.match_label })),
        connectionEnabled: true,
        familyCatalog: families,
        currentConnectionBoard: context.currentBoard || cachedPayload,
        writerRecentEvidence: context.writerRecentEvidence,
        readerRecentEvidence: context.readerRecentEvidence,
      })
      selectedSignals = stageOne.data.eligibleSignals.slice(0, 3)
    }
    if (selectedSignals.length === 0) {
      await finishResume(supabase, {
        forUser, partnerId, pairedSince, through: latest.created_at,
      })
      return { ok: true, insights: cachedPayload, refreshed: false }
    }
    const templates = await readConnectionTemplates(
      supabase,
      selectedSignals.map((signal) => signal.familyKey),
    )
    const generated = await runConnectionWriter({
      reflectId: latest.reflect_id,
      journal: reflect?.body || '',
      selectedSignals,
      scenarioTemplates: templates,
      currentConnectionBoard: context.currentBoard || cachedPayload,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    })
    if (missingQualifiedSignalIds(generated.signalResults, generated.data).length > 0) {
      throw new Error('connection_writer_missing_qualified_card')
    }
    const applied = await applyConnectionUpdates(supabase, {
      pair: context.pair,
      updates: generated.data,
      reflectId: latest.reflect_id,
      localDate: latest.local_date || date,
    })
    await Promise.all([
      saveRecoveredAnalysis(supabase, {
        latest,
        partnerId,
        generated,
        updates: generated.data,
        connectionEligible: context.connectionEligible,
        stageOne,
      }),
      finishResume(supabase, {
        forUser, partnerId, pairedSince, through: latest.created_at,
      }),
      ...(stageOne ? [recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup_router',
        promptVersion: CONNECTION_ROUTER_VERSION,
        result: stageOne.result,
        latencyMs: stageOne.latencyMs,
        refId: latest.reflect_id,
      })] : []),
      ...generated.results.map((result) => recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup',
        promptVersion: CONNECTION_WRITER_VERSION,
        result,
        latencyMs: generated.latencyMs,
        refId: latest.reflect_id,
      })),
    ])
    return {
      ok: true,
      insights: applied.payload || context.currentBoard || cachedPayload,
      refreshed: true,
    }
  } catch (err) {
    await recordAIUsage(supabase, {
      userId: partnerId,
      feature: 'connection_catchup',
      promptVersion: CONNECTION_WRITER_VERSION,
      success: false,
      refId: latest.reflect_id,
      error: String(err?.message || err),
    })
    return { ok: false, reason: 'ai_unavailable' }
  }
}
