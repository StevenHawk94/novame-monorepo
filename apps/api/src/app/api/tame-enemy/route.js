import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

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
 * POST /api/tame-enemy
 *
 * Body: { userId, monsterId, skillsUsed: string[], hits: number, localDate }
 *
 * Records one tame: a flat +20 xp, no gems, once a day across all monsters.
 * submit_kit's once-per-day gate (period = local date) enforces the single
 * daily tame -- a second attempt returns already_done_this_period. The payload
 * keeps which monster and which skills were used (Skills-tab "Used in N battles"
 * reads this later). The battle resolves entirely client-side against the shared
 * engine; this endpoint only credits the completion.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, monsterId, skillsUsed, hits, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!monsterId) {
      return NextResponse.json({ error: 'Missing monsterId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)
    const usedIds = Array.isArray(skillsUsed) ? skillsUsed : []

    const { data: result, error: rpcErr } = await supabase.rpc('submit_kit', {
      p_user_id: userId,
      p_kit: 'tame_enemy',
      p_source: 'tame_enemy',
      p_period_key: dateStr, // daily kit: period is the local date
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 20,
      p_gem_hits: [],
      p_payload: { monster_id: monsterId, skills_used: usedIds, hits: hits ?? 0 },
    })
    if (rpcErr) {
      console.error('[tame-enemy] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[tame-enemy] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
