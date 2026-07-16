import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { CLOVERS_PER_TASK, COMPLETION_BONUS, PLAN_DAYS } from '@novame/domain'

export const runtime = 'nodejs'

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

    const { data: plan, error } = await supabase
      .from('quest_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()
    if (error || !plan) return NextResponse.json({ error: 'no_active_plan' }, { status: 400 })

    const today = localDate || new Date().toISOString().slice(0, 10)

    // One check-off per calendar day.
    if (plan.last_check_date === today) {
      return NextResponse.json({ error: 'already_checked_today' }, { status: 409 })
    }

    const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
    if (taskIndex >= tasks.length) return NextResponse.json({ error: 'bad_index' }, { status: 400 })
    if (tasks[taskIndex].done) return NextResponse.json({ error: 'already_done' }, { status: 409 })

    // Mark done.
    tasks[taskIndex] = { ...tasks[taskIndex], done: true, done_date: today }
    const checkedCount = tasks.filter((t) => t.done).length
    const allDone = checkedCount === tasks.length
    const reward = Number(tasks[taskIndex].reward) || CLOVERS_PER_TASK

    // Update the plan.
    const patch = {
      tasks,
      last_check_date: today,
      checked_count: checkedCount,
    }
    let bonus = 0
    if (allDone && !plan.bonus_paid) {
      patch.status = 'completed'
      patch.bonus_paid = true
      bonus = COMPLETION_BONUS
    }
    const { error: upErr } = await supabase.from('quest_plans').update(patch).eq('id', plan.id)
    if (upErr) {
      console.error('[quests/check] update error:', upErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    // Pay clovers (reward + any completion bonus) into companions.xp.
    const totalClovers = reward + bonus
    const { data: comp } = await supabase
      .from('companions')
      .select('xp')
      .eq('user_id', userId)
      .maybeSingle()
    if (comp) {
      const newXp = (Number(comp.xp) || 0) + totalClovers
      await supabase.from('companions').update({ xp: newXp }).eq('user_id', userId)
    }

    return NextResponse.json({
      success: true,
      reward,
      bonus,
      checkedCount,
      allDone,
      cloversEarned: totalClovers,
    })
  } catch (err) {
    console.error('[quests/check] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
