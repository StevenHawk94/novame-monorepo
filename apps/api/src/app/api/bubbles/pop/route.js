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
 * POST /api/bubbles/pop
 *
 * Body: { userId, friendUserId, itemId, localDate }
 *
 * Pays the +5 bubble reward (PRD 3.5) through the pop_bubble RPC, which owns
 * every rule server-side: the popper and friend must be accepted friends, one
 * pay per (friend, item, day), and at most XP_RULES.bubble.cap pops a day.
 * The client's popped-state is a display shadow — replaying a pop just
 * returns already_popped and pays nothing.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, friendUserId, itemId, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!friendUserId || !itemId) {
      return NextResponse.json({ error: 'Missing friendUserId or itemId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = await resolveUserLocalDate(supabase, userId)
    const { data: result, error: rpcErr } = await supabase.rpc('pop_bubble', {
      p_user_id: userId,
      p_friend_user_id: friendUserId,
      p_item_id: String(itemId).slice(0, 120),
      p_local_date: dateStr,
      p_iso_week: isoWeek(dateStr),
      p_amount: XP_RULES.bubble.award,
      p_daily_cap: XP_RULES.bubble.cap,
    })
    if (rpcErr) {
      console.error('[bubbles/pop] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      // Idempotent replays and cap hits are expected, not failures worth 500s.
      return NextResponse.json({ error: result.error }, { status: 409 })
    }
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[bubbles/pop] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
