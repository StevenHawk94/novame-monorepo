import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { resolveUserLocalDate } from '@/lib/user-local-date'

export const runtime = 'edge'

/**
 * GET /api/quests/status?userId=xxx&localDate=YYYY-MM-DD
 *
 * The user's active quest plan (or none). Computes the current day from
 * started_on vs the client's local date, whether today's check-off is still
 * available (one per day), and expires a plan that's run past 7 days. The client
 * renders the theme picker (image 1) when there's no active plan, or the daily
 * checklist (image 2) when there is.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const localDate = searchParams.get('localDate') // YYYY-MM-DD
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    if (error) {
      console.error('[quests/status] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    if (!plan) return NextResponse.json({ success: true, active: false })

    // Day number from started_on to localDate (1-based).
    const today = await resolveUserLocalDate(supabase, userId)
    const start = new Date(plan.started_on + 'T00:00:00Z')
    const now = new Date(today + 'T00:00:00Z')
    const dayNum = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1

    // Past 7 days -> expire it (client will show the picker again).
    if (dayNum > 7) {
      await supabase.from('quest_plans').update({ status: 'expired' }).eq('id', plan.id)
      return NextResponse.json({ success: true, active: false })
    }

    const checkedToday = plan.last_check_date === today

    return NextResponse.json({
      success: true,
      active: true,
      plan: {
        id: plan.id,
        themeKey: plan.theme_key,
        title: plan.title,
        scope: plan.scope,
        tasks: plan.tasks,
        day: Math.max(1, dayNum),
        checkedCount: plan.checked_count,
        checkedToday,
        bonusPaid: plan.bonus_paid,
      },
    })
  } catch (err) {
    console.error('[quests/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
