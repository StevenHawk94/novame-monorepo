import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBrief } from '@/lib/connection-brief'
import { rateLimit } from '@/lib/rate-limit'

// Node runtime: this is a batch job, not a latency-sensitive edge route.
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/cron/insights-rollup — the daily 00:00 consolidation run
 * (vercel.json cron). For every pairing whose Writer shared reflects
 * YESTERDAY, pre-generate today's Connection Brief for the Reader so the
 * 2nd/3rd entries of yesterday are folded in and the dashboard is warm at
 * day start. Counts against the same 2-generations/day cap as the live
 * route (this run is normally #1 of the new day).
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` when the
 * env var is set. Fail-closed: no secret configured -> route disabled.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  // Writers who shared anything yesterday.
  const { data: writers, error: wErr } = await supabase
    .from('reflects')
    .select('user_id')
    .eq('shared_to_friends', true)
    .eq('local_date', yesterday)
  if (wErr) {
    console.error('[insights-rollup] writers query failed:', wErr.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  const writerIds = [...new Set((writers || []).map((r) => r.user_id))]
  if (writerIds.length === 0) return NextResponse.json({ ok: true, generated: 0 })

  // Their pairings → the Reader on the other side gets a fresh brief.
  const { data: pairs } = await supabase
    .from('pairings')
    .select('user_id, partner_user_id')
    .in('partner_user_id', writerIds)

  let generated = 0
  const BATCH_CAP = 500 // safety valve for a single cron invocation
  for (const p of (pairs || []).slice(0, BATCH_CAP)) {
    const forUser = p.user_id           // the Reader
    const partnerId = p.partner_user_id // the Writer
    const [ua, ub] = forUser < partnerId ? [forUser, partnerId] : [partnerId, forUser]
    try {
      const gate = await rateLimit(supabase, `insights-gen:${ua}:${ub}:${forUser}`, 2, 86400)
      if (!gate.allowed) continue
      const res = await generateBrief(supabase, { ua, ub, forUser, partnerId, date: today })
      if (res.ok) generated++
    } catch (e) {
      console.warn('[insights-rollup] pair failed:', forUser, e && e.message)
    }
  }

  return NextResponse.json({ ok: true, writers: writerIds.length, generated })
}
