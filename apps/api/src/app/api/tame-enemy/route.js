import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import {
  XP_RULES, TAME_POINTS_PER_COMPLETION,
  BATTLE_MILESTONE_BASE, BATTLE_MILESTONE_REWARD, MONSTERS,
} from '@novame/engine'
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
 * POST /api/tame-enemy
 *
 * Body: { userId, monsterId, skillsUsed: string[], hits: number, localDate }
 *
 * Records one tame. PRD v2.0 economy:
 *   - pays XP_RULES.tameEnemy.award (+30 Clover)
 *   - banks a fixed +50 Tame History points toward milestone rewards
 *   - at most two distinct monsters per local day for every account
 * The database repeats these checks under its user lock so concurrent requests
 * cannot exceed the limit. The battle resolves entirely client-side.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, monsterId, skillsUsed, hits } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!monsterId || !MONSTERS.some((monster) => monster.id === monsterId)) {
      return NextResponse.json({ error: 'Invalid monsterId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = await resolveUserLocalDate(supabase, userId)
    const weekStr = isoWeek(dateStr)
    const usedIds = Array.isArray(skillsUsed) ? skillsUsed : []

    const { data: priorRows } = await supabase
      .from('kit_completions')
      .select('payload, local_date')
      .eq('user_id', userId)
      .eq('kit', 'tame_enemy')
      .eq('local_date', dateStr)
    const todayRows = priorRows || []
    if (todayRows.length >= 2) {
      return NextResponse.json({ error: 'daily_limit_reached', tamesToday: todayRows.length, dailyLimit: 2 }, { status: 409 })
    }
    if (todayRows.some((row) => row.payload?.monster_id === monsterId)) {
      return NextResponse.json({ error: 'already_done', tamesToday: todayRows.length, dailyLimit: 2 }, { status: 409 })
    }
    const periodKey = `${dateStr}:${monsterId}`

    const battlePoints = TAME_POINTS_PER_COMPLETION

    // Completion, Clover XP, fixed history points and milestone Clover are one
    // database transaction. A transient failure cannot leave a successful
    // tame without its 50 pts (or make a retry double-pay).
    const { data: result, error: rpcErr } = await supabase.rpc('submit_tame_enemy', {
      p_user_id: userId,
      p_period_key: periodKey,
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: XP_RULES.tameEnemy.award,
      p_payload: { monster_id: monsterId, skills_used: usedIds, hits: hits ?? 0 },
      p_battle_points: battlePoints,
      p_base: BATTLE_MILESTONE_BASE,
      p_reward: BATTLE_MILESTONE_REWARD,
    })
    if (rpcErr) {
      console.error('[tame-enemy] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }
    // An API deploy may briefly overlap the database migration. Only forward
    // a returned total when the RPC explicitly confirms it is monster-scoped;
    // an older RPC's shared user total must never be painted onto one enemy.
    const battleTotalPoints = result?.progress_scope === 'monster'
      ? (result?.battle_total_points ?? null)
      : null

    return NextResponse.json({
      success: true,
      ...result,
      battlePoints,
      milestoneBonus: result?.milestone_bonus ?? 0,
      battleTotalPoints,
      tamesToday: result?.tames_today ?? todayRows.length + 1,
      dailyLimit: result?.daily_limit ?? 2,
    })
  } catch (err) {
    console.error('[tame-enemy] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
