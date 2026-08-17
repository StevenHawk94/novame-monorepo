import { REFLECT_ANALYZER_VERSION, CONNECTION_DIMENSIONS } from './reflect-ai'

const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000

function detailsMode(profile) {
  return profile?.memory_details_mode
    || (profile?.share_memory_details === false ? 'none' : 'custom')
}

function mergeUpdates(prior, updates) {
  const next = { ...(prior || {}) }
  for (const key of CONNECTION_DIMENSIONS) {
    const row = updates?.[key]
    if (row?.hasUpdate && row.text) next[key] = row.text
    else if (!(key in next)) next[key] = null
  }
  return next
}

export async function loadReflectAnalyzerContext(supabase, {
  userId, visibleToFriend, localDate,
}) {
  const [{ data: pairing }, { data: writerProfile }] = await Promise.all([
    supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles')
      .select('share_memory_details, memory_details_mode')
      .eq('id', userId).maybeSingle(),
  ])
  if (!pairing?.partner_user_id) {
    return { connectionEligible: false, connectionEnabled: false, currentBoard: null, pair: null }
  }
  const partnerId = pairing.partner_user_id
  const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
  const [{ data: reader }, { data: cached }] = await Promise.all([
    supabase.from('profiles').select('last_active_at').eq('id', partnerId).maybeSingle(),
    supabase.from('connection_insights').select('payload')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', partnerId)
      .order('for_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  const privacyAllows = detailsMode(writerProfile) !== 'none' && visibleToFriend !== false
  const activeAt = reader?.last_active_at ? new Date(reader.last_active_at).getTime() : 0
  const readerActive = activeAt >= Date.now() - ACTIVE_WINDOW_MS
  return {
    connectionEligible: privacyAllows,
    connectionEnabled: privacyAllows && readerActive,
    currentBoard: cached?.payload || null,
    pair: { ua, ub, writerId: userId, readerId: partnerId, localDate },
  }
}

export async function persistReflectAnalyzerResult(supabase, {
  reflectId, userId, localDate, reflectsToday, analyzer, context, matchedItems,
}) {
  const updates = analyzer.data.connectionUpdates
  let connectionMode = !context.connectionEligible
    ? 'disabled'
    : !context.connectionEnabled
      ? 'inactive'
      : reflectsToday <= 1
        ? 'immediate'
        : 'deferred'

  const analysisRow = {
    reflect_id: reflectId,
    user_id: userId,
    local_date: localDate,
    prompt_version: REFLECT_ANALYZER_VERSION,
    weekly_eligible: !!analyzer.data.weeklyEvidence,
    weekly_evidence: analyzer.data.weeklyEvidence,
    visual_concepts: analyzer.data.visualConcepts,
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
  await supabase.from('reflect_ai_analyses').upsert(analysisRow, { onConflict: 'reflect_id' })

  if (analyzer.data.visualConcepts.length > 0) {
    await supabase.from('item_learning_jobs').upsert({
      reflect_id: reflectId,
      concepts: analyzer.data.visualConcepts,
      matched_item_ids: (matchedItems || []).map((item) => item.itemId),
      status: 'pending',
      attempts: 0,
      error: null,
      processed_at: null,
    }, { onConflict: 'reflect_id' })
  }

  if (!context.pair || !updates) return
  const hasAnyUpdate = CONNECTION_DIMENSIONS.some((key) => updates[key]?.hasUpdate && updates[key]?.text)
  if (!hasAnyUpdate) return
  const { ua, ub, writerId, readerId } = context.pair

  if (connectionMode === 'immediate') {
    const payload = mergeUpdates(context.currentBoard, updates)
    await supabase.from('connection_insights').upsert({
      user_a: ua,
      user_b: ub,
      for_date: localDate,
      for_user: readerId,
      payload,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_a,user_b,for_date,for_user' })
  } else if (connectionMode === 'deferred') {
    await supabase.from('connection_update_candidates').upsert({
      reflect_id: reflectId,
      writer_user_id: writerId,
      for_user: readerId,
      user_a: ua,
      user_b: ub,
      writer_local_date: localDate,
      updates,
      status: 'pending',
    }, { onConflict: 'reflect_id,for_user' })
  }
}

export function mergeConnectionCandidatePayload(prior, candidateRows) {
  const best = {}
  for (const row of candidateRows || []) {
    for (const key of CONNECTION_DIMENSIONS) {
      const update = row.updates?.[key]
      if (!update?.hasUpdate || !update.text) continue
      const existing = best[key]
      if (!existing
        || Number(update.confidence || 0) > Number(existing.update.confidence || 0)
        || (Number(update.confidence || 0) === Number(existing.update.confidence || 0)
          && new Date(row.created_at) > new Date(existing.createdAt))) {
        best[key] = { update, createdAt: row.created_at }
      }
    }
  }
  const next = { ...(prior || {}) }
  for (const key of CONNECTION_DIMENSIONS) {
    if (best[key]) next[key] = best[key].update.text
    else if (!(key in next)) next[key] = null
  }
  return next
}

