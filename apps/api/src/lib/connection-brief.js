import { runConnectionRefresh, CONNECTION_REFRESH_VERSION } from './reflect-ai'
import { recordAIUsage } from './ai-usage'
import { applyConnectionUpdates, loadReflectAnalyzerContext } from './reflect-analysis-store'

async function finishResume(supabase, { forUser, partnerId, pairedSince, through }) {
  let query = supabase.from('reflect_ai_analyses')
    .update({ connection_mode: 'caught_up' })
    .eq('user_id', partnerId).eq('connection_mode', 'inactive')
    .lte('created_at', through)
  if (pairedSince) query = query.gte('created_at', pairedSince)
  await Promise.all([
    query,
    supabase.from('profiles').update({ connection_resume_required: false }).eq('id', forUser),
  ])
}

/**
 * Resume after a reader was away for 48h. Deliberately analyzes only the most
 * recent skipped reflection; older skipped rows are consumed without replay.
 */
export async function generateBrief(supabase, {
  forUser, partnerId, date, cachedPayload = null, pairedSince = null,
}) {
  let latestQuery = supabase.from('reflect_ai_analyses')
    .select('reflect_id, local_date, created_at')
    .eq('user_id', partnerId).eq('status', 'completed').eq('connection_mode', 'inactive')
    .order('created_at', { ascending: false }).limit(1)
  if (pairedSince) latestQuery = latestQuery.gte('created_at', pairedSince)
  const { data: latestRows, error } = await latestQuery
  const latest = latestRows?.[0]
  if (error) return { ok: false, reason: 'query_failed' }
  if (!latest) {
    await supabase.from('profiles').update({ connection_resume_required: false }).eq('id', forUser)
    return { ok: true, insights: cachedPayload, refreshed: false }
  }

  const [{ data: reflect }, { data: itemRows }] = await Promise.all([
    supabase.from('reflects').select('id, body, local_date, created_at')
      .eq('id', latest.reflect_id).eq('user_id', partnerId).maybeSingle(),
    supabase.from('reflect_items').select('item_id, match_label')
      .eq('reflect_id', latest.reflect_id).eq('visible_to_paired', true)
      .order('position', { ascending: true }),
  ])

  if (!reflect?.body?.trim()) {
    await finishResume(supabase, {
      forUser, partnerId, pairedSince, through: latest.created_at,
    })
    return { ok: true, insights: cachedPayload, refreshed: false }
  }

  try {
    const context = await loadReflectAnalyzerContext(supabase, {
      userId: partnerId, visibleToFriend: true, localDate: reflect.local_date || date,
    })
    const generated = await runConnectionRefresh({
      reflectId: reflect.id,
      journal: reflect.body,
      matchedIcons: (itemRows || []).map((item) => ({ id: item.item_id, name: item.match_label })),
      currentConnectionBoard: context.currentBoard || cachedPayload,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    })
    const applied = await applyConnectionUpdates(supabase, {
      pair: context.pair,
      updates: generated.data,
      reflectId: reflect.id,
      localDate: reflect.local_date || date,
    })
    await Promise.all([
      finishResume(supabase, {
        forUser, partnerId, pairedSince, through: latest.created_at,
      }),
      recordAIUsage(supabase, {
        userId: partnerId,
        feature: 'connection_catchup',
        promptVersion: CONNECTION_REFRESH_VERSION,
        result: generated.result,
        latencyMs: generated.latencyMs,
        refId: reflect.id,
      }),
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
      promptVersion: CONNECTION_REFRESH_VERSION,
      success: false,
      refId: reflect.id,
      error: String(err?.message || err),
    })
    return { ok: false, reason: 'ai_unavailable' }
  }
}
