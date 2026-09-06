import { REFLECT_ANALYZER_VERSION, CONNECTION_DIMENSIONS } from './reflect-ai'
import {
  compactConnectionEvidence, CONNECTION_RETENTION_DAYS,
} from './connection-evidence'

const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000
const BASELINE_WINDOW_MS = CONNECTION_RETENTION_DAYS * 24 * 60 * 60 * 1000

function detailsMode(profile) {
  return profile?.memory_details_mode
    || (profile?.share_memory_details === false ? 'none' : 'custom')
}

export async function loadReflectAnalyzerContext(supabase, {
  userId, visibleToFriend, localDate, excludeReflectIds = [],
}) {
  const [pairingResult, writerProfileResult] = await Promise.all([
    supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles')
      .select('share_memory_details, memory_details_mode')
      .eq('id', userId).maybeSingle(),
  ])
  if (pairingResult.error) throw pairingResult.error
  if (writerProfileResult.error) throw writerProfileResult.error
  const pairing = pairingResult.data
  const writerProfile = writerProfileResult.data
  if (!pairing?.partner_user_id) {
    return { connectionEligible: false, connectionEnabled: false, currentBoard: null, pair: null }
  }
  const partnerId = pairing.partner_user_id
  const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
  const baselineSince = new Date(Date.now() - BASELINE_WINDOW_MS).toISOString()
  const [readerResult, cachedResult, writerEvidenceResult, readerEvidenceResult] = await Promise.all([
    supabase.from('profiles').select('last_active_at').eq('id', partnerId).maybeSingle(),
    supabase.from('connection_insights').select('payload')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', partnerId)
      .order('for_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('reflect_ai_analyses')
      .select('reflect_id, local_date, connection_signals, connection_updates, created_at')
      .eq('user_id', userId).eq('status', 'completed').eq('connection_eligible', true)
      .gte('created_at', baselineSince)
      .order('created_at', { ascending: false }).limit(60),
    supabase.from('reflect_ai_analyses')
      .select('reflect_id, local_date, connection_signals, connection_updates, created_at')
      .eq('user_id', partnerId).eq('status', 'completed').eq('connection_eligible', true)
      .gte('created_at', baselineSince)
      .order('created_at', { ascending: false }).limit(60),
  ])
  for (const result of [readerResult, cachedResult, writerEvidenceResult, readerEvidenceResult]) {
    if (result.error) throw result.error
  }
  const reader = readerResult.data
  const cached = cachedResult.data
  const writerEvidence = writerEvidenceResult.data
  const readerEvidence = readerEvidenceResult.data
  const privacyAllows = detailsMode(writerProfile) !== 'none' && visibleToFriend !== false
  const activeAt = reader?.last_active_at ? new Date(reader.last_active_at).getTime() : 0
  const readerActive = activeAt >= Date.now() - ACTIVE_WINDOW_MS
  return {
    connectionEligible: privacyAllows,
    connectionEnabled: privacyAllows && readerActive,
    currentBoard: cached?.payload || null,
    writerRecentEvidence: compactConnectionEvidence(writerEvidence, { excludeReflectIds }),
    readerRecentEvidence: compactConnectionEvidence(readerEvidence, { excludeReflectIds }),
    pair: { ua, ub, writerId: userId, readerId: partnerId, localDate },
  }
}

export async function applyConnectionUpdates(supabase, {
  pair, updates, reflectId, localDate,
}) {
  if (!pair || !updates) return { changed: false, payload: null }
  const hasAnyUpdate = CONNECTION_DIMENSIONS.some((key) => (
    updates[key]?.hasUpdate && (
      updates[key]?.clearExisting === true
      || (Array.isArray(updates[key]?.cards) && updates[key].cards.length > 0)
    )
  ))
  if (!hasAnyUpdate) return { changed: false, payload: null }
  const writeForUser = (forUser, nextUpdates) => supabase.rpc('apply_connection_insight_updates_v2', {
    p_user_a: pair.ua, p_user_b: pair.ub, p_for_user: forUser,
    p_for_date: localDate, p_reflect_id: reflectId, p_updates: nextUpdates,
  })
  const shared = updates.shared_rhythm
  const mirrorShared = shared?.hasUpdate === true && (
    shared.clearExisting === true || (Array.isArray(shared.cards) && shared.cards.length > 0)
  )
  const writes = [writeForUser(pair.readerId, updates)]
  if (mirrorShared && pair.writerId && pair.writerId !== pair.readerId) {
    const sharedOnly = Object.fromEntries(CONNECTION_DIMENSIONS.map((key) => [key, key === 'shared_rhythm'
      ? shared
      : { hasUpdate: false, clearExisting: false, cards: [] }]))
    // Between You Lately describes the pair, so both people receive the exact
    // same accepted card rather than separately generated paraphrases.
    writes.push(writeForUser(pair.writerId, sharedOnly))
  }
  const [readerResult, ...mirrorResults] = await Promise.all(writes)
  if (readerResult.error) throw readerResult.error
  for (const result of mirrorResults) if (result.error) throw result.error
  return {
    changed: readerResult.data?.changed === true,
    payload: readerResult.data?.payload || null,
  }
}

export async function persistReflectAnalyzerResult(supabase, {
  reflectId, userId, localDate, reflectsToday, analyzer, context, matchedItems,
}) {
  const updates = analyzer.data.connectionUpdates
  const connectionMode = !context.connectionEligible
    ? 'disabled'
    : !context.connectionEnabled
      ? 'inactive'
      : 'immediate'

  const analysisRow = {
    reflect_id: reflectId,
    user_id: userId,
    local_date: localDate,
    prompt_version: REFLECT_ANALYZER_VERSION,
    weekly_eligible: false,
    weekly_evidence: null,
    visual_concepts: analyzer.data.visualConcepts,
    connection_signals: analyzer.data.connectionSignals || [],
    connection_eligible: context.connectionEligible,
    connection_updates: updates,
    connection_mode: connectionMode,
    provider: analyzer.result.provider,
    model: analyzer.result.model,
    usage: analyzer.result.usage || null,
    status: 'completed',
    error: null,
    completed_at: new Date().toISOString(),
  }
  const { error: analysisError } = await supabase.from('reflect_ai_analyses')
    .upsert(analysisRow, { onConflict: 'reflect_id' })
  if (analysisError) throw analysisError

  if (analyzer.data.visualConcepts.length > 0) {
    const { error: learningError } = await supabase.from('item_learning_jobs').upsert({
      reflect_id: reflectId,
      concepts: analyzer.data.visualConcepts,
      matched_item_ids: (matchedItems || []).map((item) => item.itemId),
      status: 'pending',
      attempts: 0,
      error: null,
      processed_at: null,
      evidence_version: 2,
    }, { onConflict: 'reflect_id', ignoreDuplicates: true })
    if (learningError) {
      // This admin-only learning queue must never block a user's Connection
      // update after the durable analysis row has already been saved.
      console.warn('[reflect-analysis] item learning enqueue failed:', learningError.message)
    }
  }

  if (!context.pair || !updates) return
  if (connectionMode === 'immediate') {
    await applyConnectionUpdates(supabase, {
      pair: context.pair, updates, reflectId, localDate,
    })
  }
}

export function mergeConnectionCandidatePayload(prior, candidateRows) {
  // Kept for the legacy rollup route until the old candidate table is retired.
  // v2 writes every active reflection immediately and never queues candidates.
  return prior || null
}
