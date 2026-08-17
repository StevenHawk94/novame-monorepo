import { runConnectionRefresh, CONNECTION_REFRESH_VERSION } from './reflect-ai'
import { recordAIUsage } from './ai-usage'

const HOURS_48 = 48 * 60 * 60 * 1000

export async function generateBrief(supabase, {
  ua, ub, forUser, partnerId, date, cachedPayload = null, markCaughtUp = false,
}) {
  const since = new Date(Date.now() - HOURS_48).toISOString()
  const { data: rows, error } = await supabase
    .from('reflect_ai_analyses')
    .select('reflect_id, local_date, weekly_evidence, connection_updates, connection_mode, created_at')
    .eq('user_id', partnerId).eq('status', 'completed').gte('created_at', since)
    .order('created_at', { ascending: true }).limit(20)
  if (error || !rows?.length) return { ok: false, reason: 'no_input' }

  const evidence = rows.map((row) => ({
    localDate: row.local_date,
    evidence: row.weekly_evidence,
    updates: row.connection_updates,
  })).filter((row) => row.evidence || row.updates)
  if (!evidence.length) return { ok: false, reason: 'no_input' }

  try {
    const generated = await runConnectionRefresh({ currentBoard: cachedPayload, evidence })
    const insights = {}
    for (const key of ['emotion', 'topic', 'careTips', 'boundaries', 'hangoutIdeas']) {
      insights[key] = generated.data[key] ?? cachedPayload?.[key] ?? null
    }
    await Promise.all([
      supabase.from('connection_insights').upsert({
        user_a: ua, user_b: ub, for_date: date, for_user: forUser,
        payload: insights, created_at: new Date().toISOString(),
      }, { onConflict: 'user_a,user_b,for_date,for_user' }),
      recordAIUsage(supabase, {
        userId: partnerId, feature: 'connection_catchup',
        promptVersion: CONNECTION_REFRESH_VERSION, result: generated.result,
        latencyMs: generated.latencyMs,
      }),
    ])
    if (markCaughtUp) {
      const ids = rows.filter((row) => row.connection_mode === 'inactive').map((row) => row.reflect_id)
      if (ids.length) await supabase.from('reflect_ai_analyses').update({ connection_mode: 'caught_up' }).in('reflect_id', ids)
    }
    return { ok: true, insights }
  } catch (err) {
    await recordAIUsage(supabase, {
      userId: partnerId, feature: 'connection_catchup', promptVersion: CONNECTION_REFRESH_VERSION,
      success: false, error: String(err?.message || err),
    })
    return { ok: false, reason: 'ai_unavailable' }
  }
}
