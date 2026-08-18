import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { CLOVERS_PER_TASK, COMPLETION_BONUS } from '@novame/domain'

export const runtime = 'nodejs'

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
 * POST /api/quests/check
 *
 * Body: { userId, taskIndex, localDate }
 *
 * Check off one task on the active plan. Server is the authority for the
 * one-per-day rule: rejects if the plan already has a check-off dated today.
 * Pays CLOVERS_PER_TASK into clovers (companions.xp) and, when all tasks are
 * done, pays COMPLETION_BONUS once and marks the plan completed.
 *
 * Clovers are earned by bumping companions.xp (lifetime earned); balance
 * elsewhere is xp - clovers_spent, so earning raises the balance.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, taskIndex, localDate } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (typeof taskIndex !== 'number' || taskIndex < 0) {
      return NextResponse.json({ error: 'bad_index' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const today = localDate || new Date().toISOString().slice(0, 10)
    const { data: result, error: rpcError } = await supabase.rpc('check_quest_task', {
      p_user_id: userId,
      p_task_index: taskIndex,
      p_local_date: today,
      p_iso_week: isoWeek(today),
      p_default_reward: CLOVERS_PER_TASK,
      p_completion_bonus: COMPLETION_BONUS,
    })
    if (rpcError) {
      console.error('[quests/check] rpc error:', rpcError.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (result?.error) {
      const status = result.error === 'bad_index' || result.error === 'no_active_plan' ? 400 : 409
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({
      success: true,
      reward: result?.reward ?? 0,
      bonus: result?.bonus ?? 0,
      checkedCount: result?.checked_count ?? 0,
      allDone: !!result?.all_done,
      cloversEarned: result?.clovers_earned ?? 0,
      balance: result?.clover_balance ?? 0,
    })
  } catch (err) {
    console.error('[quests/check] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
