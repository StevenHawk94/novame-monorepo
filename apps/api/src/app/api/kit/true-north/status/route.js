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
 * GET /api/kit/true-north/status?userId=xxx&localDate=YYYY-MM-DD
 *
 * The state the Home entry and the reveal need: whether True North was done
 * this week (the entry stays visible either way, but a done week shows last
 * result instead of re-ranking), and the two most recent rankings -- this
 * week's if done, and the prior one for the week-over-week comparison.
 *
 * Returns { doneThisWeek, thisWeekRanking, lastRanking } where rankings are
 * arrays of dimension ids best-first, or null.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const localDate = searchParams.get('localDate')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

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

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const thisWeek = isoWeek(dateStr)

    // The two most recent true_north completions, newest first.
    const { data: rows, error } = await supabase
      .from('kit_completions')
      .select('period_key, payload')
      .eq('user_id', userId)
      .eq('kit', 'true_north')
      .order('created_at', { ascending: false })
      .limit(2)
    if (error) {
      console.error('[true-north/status] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const list = rows || []
    const doneThisWeek = list.some((r) => r.period_key === thisWeek)

    // This week's ranking (if done) and the prior ranking (for comparison).
    let thisWeekRanking = null
    let lastRanking = null
    if (doneThisWeek) {
      const thisRow = list.find((r) => r.period_key === thisWeek)
      thisWeekRanking = thisRow?.payload?.ranking ?? null
      const prior = list.find((r) => r.period_key !== thisWeek)
      lastRanking = prior?.payload?.ranking ?? null
    } else {
      // Not done this week: the most recent is the "last" for comparison.
      lastRanking = list[0]?.payload?.ranking ?? null
    }

    return NextResponse.json({
      success: true,
      weekKey: thisWeek,
      doneThisWeek,
      thisWeekRanking,
      lastRanking,
    })
  } catch (err) {
    console.error('[true-north/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
