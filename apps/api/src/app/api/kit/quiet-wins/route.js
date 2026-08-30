import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { XP_RULES } from '@novame/engine'
import { resolveUserLocalDate } from '@/lib/user-local-date'

export const runtime = 'edge'

/** ISO week like 2026-W28, from a YYYY-MM-DD date string. */
function isoWeek(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * POST /api/kit/quiet-wins
 *
 * Body: { userId, checkedIds: string[], localDate }
 *
 * Records one Quiet Wins run: a flat +20 clovers, no gems, once a day. The checked
 * items are stored in the completion payload; the layered feedback shown to the
 * user is computed client-side from them (a pure display mapping), so this
 * endpoint just credits clovers and returns the snapshot. Zero checks is allowed --
 * the run still counts and still pays, matching the "no pressure" framing.
 *
 * The award is a flat 20; submit_kit's once-per-day gate (not this endpoint) enforces
 * the daily limit, so a successful call is always the first of the day.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, checkedIds, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (checkedIds != null && !Array.isArray(checkedIds)) {
      return NextResponse.json({ error: 'Invalid checkedIds' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = await resolveUserLocalDate(supabase, userId)
    const weekStr = isoWeek(dateStr)
    const ids = Array.isArray(checkedIds) ? checkedIds : []

    const { data: result, error: rpcErr } = await supabase.rpc('submit_kit', {
      p_user_id: userId,
      p_kit: 'quiet_wins',
      p_source: 'quiet_wins',
      p_period_key: dateStr, // daily kit: period is the local date
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: XP_RULES.quietWins.award,
      // Small Wins is intentionally dimension-free. Keep this explicit at the
      // server boundary so checklist selections can never become gem events.
      p_gem_hits: [],
      p_payload: { checkedIds: ids },
    })
    if (rpcErr) {
      console.error('[quiet-wins] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      // already_done_this_period / companion_not_initialized
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[quiet-wins] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
