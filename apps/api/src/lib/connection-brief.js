import {
  runConnectionRouter, runConnectionMatcher, runConnectionWriter,
  mergeConnectionUpdates,
  missingQualifiedSignalIds,
  CONNECTION_ROUTER_VERSION, CONNECTION_MATCHER_VERSION, CONNECTION_WRITER_VERSION,
} from './connection-ai'
import { recordAIUsage } from './ai-usage'
import { applyConnectionUpdates, loadReflectAnalyzerContext } from './reflect-analysis-store'
import { compactConnectionEvidence, CONNECTION_RETENTION_DAYS } from './connection-evidence'
import {
  readConnectionFamilies, readConnectionScenarioIndex, readConnectionTemplatesByScenarioKeys,
} from './connection-template-store'

const RETENTION_MS = CONNECTION_RETENTION_DAYS * 24 * 60 * 60 * 1000

function hasCards(updates) {
  return !!updates && Object.values(updates).some((module) => (
    module?.hasUpdate === true && Array.isArray(module.cards) && module.cards.length > 0
  ))
}

async function markResumeRequired(supabase, forUser) {
  const { error } = await supabase.from('profiles')
    .update({ connection_resume_required: true }).eq('id', forUser)
  if (error) throw error
}

async function finishResume(supabase, { forUser, partnerId, pairedSince, through }) {
  let query = supabase.from('reflect_ai_analyses')
    .update({ connection_mode: 'caught_up' })
    .eq('user_id', partnerId).eq('connection_mode', 'inactive')
    .lte('created_at', through)
  if (pairedSince) query = query.gte('created_at', pairedSince)
  const analysisResult = await query
  if (analysisResult.error) throw analysisResult.error

  let pendingQuery = supabase.from('reflect_ai_analyses')
    .select('reflect_id', { count: 'exact', head: true })
    .eq('user_id', partnerId)
    .in('connection_pipeline_status', ['failed', 'partial'])
    .gte('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
  if (pairedSince) pendingQuery = pendingQuery.gte('created_at', pairedSince)
  const pendingResult = await pendingQuery
  if (pendingResult.error) throw pendingResult.error
  const profileResult = await supabase.from('profiles').update({
    connection_resume_required: Number(pendingResult.count || 0) > 0,
  }).eq('id', forUser)
  if (profileResult.error) throw profileResult.error
}

async function latestUntrackedReflect(supabase, { partnerId, pairedSince }) {
  let failedQuery = supabase.from('reflect_ai_analyses')
    .select('reflect_id, local_date, created_at, connection_stage_one')
    .eq('user_id', partnerId)
    .in('connection_pipeline_status', ['failed', 'partial'])
    .gte('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  if (pairedSince) failedQuery = failedQuery.gte('created_at', pairedSince)
  const { data: failedRows, error: failedError } = await failedQuery
  if (failedError) throw failedError
  if (failedRows?.[0]) {
    return {
      ...failedRows[0],
      saved_stage_one: failedRows[0].connection_stage_one || null,
      recovery: true,
    }
  }

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
    .select('status, connection_pipeline_status, connection_stage_one')
    .eq('reflect_id', candidate.id)
    .maybeSingle()
  if (analysisError) throw analysisError
  const pipelineStatus = analysis?.connection_pipeline_status || 'completed'
  if (analysis?.status === 'completed' && !['failed', 'partial'].includes(pipelineStatus)) return null
  return {
    reflect_id: candidate.id,
    local_date: candidate.local_date,
    created_at: candidate.created_at,
    saved_stage_one: analysis?.connection_stage_one || null,
    recovery: true,
  }
}

async function saveRecoveredAnalysis(supabase, {
  latest, partnerId, generated, updates, connectionEligible, stageOne = null,
  pipelineStatus = 'completed', errorText = null,
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
    connection_pipeline_status: pipelineStatus,
    connection_mode: pipelineStatus === 'completed' ? 'caught_up' : 'immediate',
    provider: generated.result.provider,
    model: generated.result.model,
    usage: generated.result.usage || null,
    status: 'completed',
    error: errorText,
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
  try {
    const recovery = await latestUntrackedReflect(supabase, { partnerId, pairedSince })
    if (recovery && (!latest || Date.parse(recovery.created_at) >= Date.parse(latest.created_at))) {
      latest = recovery
    }
  } catch {
    return { ok: false, reason: 'query_failed' }
  }
  if (!latest) {
    const { error: clearError } = await supabase.from('profiles')
      .update({ connection_resume_required: false }).eq('id', forUser)
    if (clearError) return { ok: false, reason: 'query_failed' }
    return { ok: true, insights: cachedPayload, refreshed: false }
  }

  const evidenceRows = latest.recovery ? [] : latestRows
  const unprocessedSignals = compactConnectionEvidence(evidenceRows, {
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
      excludeReflectIds: latest.recovery
        ? [latest.reflect_id]
        : (latestRows || []).map((row) => row.reflect_id),
    })
    let stageOne = latest.saved_stage_one ? { data: latest.saved_stage_one, result: null, latencyMs: null } : null
    let selectedSignals = unprocessedSignals
      .filter((signal) => signal.cardEligible !== false)
      .sort((left, right) => Number(right.isNewest) - Number(left.isNewest))
      .slice(0, 3)
    if (selectedSignals.length === 0 && stageOne?.data) {
      selectedSignals = (stageOne.data.eligibleSignals || stageOne.data.connectionSignals || [])
        .filter((signal) => signal.cardEligible === true).slice(0, 3)
    }
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
    const scenarioIndex = await readConnectionScenarioIndex(
      supabase, selectedSignals.map((signal) => signal.familyKey),
    )
    const matcher = await runConnectionMatcher({
      reflectId: latest.reflect_id,
      journal: reflect?.body || '',
      selectedSignals,
      scenarioIndex,
      currentConnectionBoard: context.currentBoard || cachedPayload,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    })
    const persistMatcherPartial = async (failure) => {
      if (!hasCards(matcher.data)) return
      await Promise.all([
        applyConnectionUpdates(supabase, {
          pair: context.pair,
          updates: matcher.data,
          reflectId: latest.reflect_id,
          localDate: latest.local_date || date,
        }),
        saveRecoveredAnalysis(supabase, {
          latest,
          partnerId,
          generated: {
            result: matcher.result,
            signalResults: matcher.signalResults,
          },
          updates: matcher.data,
          connectionEligible: context.connectionEligible,
          stageOne,
          pipelineStatus: 'partial',
          errorText: String(failure?.message || failure),
        }),
        markResumeRequired(supabase, forUser),
      ])
    }
    const resolvedIds = new Set(matcher.signalResults.map((row) => row.signalId))
    if (selectedSignals.some((signal) => !resolvedIds.has(signal.signalId))) {
      const error = new Error('connection_matcher_missing_signal_result')
      await persistMatcherPartial(error)
      throw error
    }
    const matchedResults = matcher.signalResults.filter((row) => row.outcome === 'matched')
    const missingCustom = new Set(missingQualifiedSignalIds(
      matcher.signalResults.filter((row) => row.outcome === 'custom'), matcher.data,
      { currentBoard: context.currentBoard || cachedPayload, reflectId: latest.reflect_id },
    ))
    const generationResults = matcher.signalResults.filter((row) => (
      row.outcome === 'matched' || (row.outcome === 'custom' && missingCustom.has(row.signalId))
    ))
    const generationIds = new Set(generationResults.map((row) => row.signalId))
    const generationSignals = selectedSignals.filter((signal) => generationIds.has(signal.signalId))
    let writer = null
    if (generationSignals.length > 0) {
      let templates
      try {
        templates = await readConnectionTemplatesByScenarioKeys(
          supabase, matchedResults.map((row) => row.scenarioKey),
        )
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
        await persistMatcherPartial(error)
        throw error
      }
      try {
        writer = await runConnectionWriter({
          reflectId: latest.reflect_id,
          journal: reflect?.body || '',
          selectedSignals: generationSignals,
          signalResults: generationResults,
          generationRequests,
          currentConnectionBoard: context.currentBoard || cachedPayload,
          writerRecentEvidence: context.writerRecentEvidence,
          readerRecentEvidence: context.readerRecentEvidence,
        })
      } catch (writerError) {
        await persistMatcherPartial(writerError)
        throw writerError
      }
    }
    const finalUpdates = mergeConnectionUpdates(
      [matcher.data, writer?.data], latest.reflect_id, {
        allowSharedRhythm: (context.readerRecentEvidence || []).length > 0,
        maxTotal: 3,
        currentBoard: context.currentBoard || cachedPayload,
      },
    )
    const generated = {
      result: writer?.result || matcher.result,
      results: [matcher.result, ...(writer?.results || [])],
      latencyMs: matcher.latencyMs + (writer?.latencyMs || 0),
      signalResults: matcher.signalResults,
      data: finalUpdates,
    }
    const missingQualified = missingQualifiedSignalIds(matcher.signalResults, finalUpdates, {
      currentBoard: context.currentBoard || cachedPayload,
      reflectId: latest.reflect_id,
    })
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
        pipelineStatus: missingQualified.length > 0 ? 'partial' : 'completed',
        errorText: missingQualified.length > 0 ? 'connection_writer_missing_qualified_card' : null,
      }),
      ...(missingQualified.length > 0
        ? [markResumeRequired(supabase, forUser)]
        : []),
      ...(stageOne?.result ? [recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup_router',
        promptVersion: CONNECTION_ROUTER_VERSION,
        result: stageOne.result,
        latencyMs: stageOne.latencyMs,
        refId: latest.reflect_id,
      })] : []),
      recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup_matcher',
        promptVersion: CONNECTION_MATCHER_VERSION,
        result: matcher.result,
        latencyMs: matcher.latencyMs,
        refId: latest.reflect_id,
      }),
      ...(writer?.results || []).map((result) => recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup',
        promptVersion: CONNECTION_WRITER_VERSION,
        result,
        latencyMs: generated.latencyMs,
        refId: latest.reflect_id,
      })),
    ])
    if (missingQualified.length > 0) {
      throw new Error('connection_writer_missing_qualified_card')
    }
    await finishResume(supabase, {
      forUser, partnerId, pairedSince, through: latest.created_at,
    })
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
