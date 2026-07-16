import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { CLOVERS_PER_TASK, PLAN_DAYS } from '@novame/domain'

export const runtime = 'nodejs'

/**
 * POST /api/quests/start
 *
 * Body: { userId, themeKey, title, tasks: string[], localDate }
 *
 * Commit to a 7-day plan. Rejects if the user already has an active plan.
 * `tasks` is the chosen list (7 for a standard/write-own plan, or the AI's list
 * for custom); each becomes { text, reward, done:false, done_date:null }. Day 1
 * is localDate. One plan active at a time (DB partial unique index also guards).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, themeKey, title, tasks, localDate } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!themeKey || !title) return NextResponse.json({ error: 'bad_theme' }, { status: 400 })
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json({ error: 'no_tasks' }, { status: 400 })
    }
    // Cap tasks to the plan length; each task is one day's check-off.
    const clean = tasks
      .filter((t) => typeof t === 'string' && t.trim().length > 0)
      .slice(0, PLAN_DAYS)
      .map((t) => ({ text: t.trim(), reward: CLOVERS_PER_TASK, done: false, done_date: null }))
    if (clean.length === 0) return NextResponse.json({ error: 'no_tasks' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Already has an active plan?
    const { data: existing } = await supabase
      .from('quest_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()
    if (existing) return NextResponse.json({ error: 'already_active' }, { status: 409 })

    const today = localDate || new Date().toISOString().slice(0, 10)
    const { data: plan, error } = await supabase
      .from('quest_plans')
      .insert({
        user_id: userId,
        theme_key: themeKey,
        title,
        scope: 'self',
        status: 'active',
        tasks: clean,
        started_on: today,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[quests/start] insert error:', error.message)
      // Unique index race -> treat as already active.
      if (error.code === '23505') return NextResponse.json({ error: 'already_active' }, { status: 409 })
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, planId: plan.id })
  } catch (err) {
    console.error('[quests/start] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
