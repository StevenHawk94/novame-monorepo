import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const TRUE_NORTH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * GET /api/kit/true-north/status?userId=xxx
 *
 * The state the Home entry and the reveal need: whether the latest completion
 * is still inside its rolling seven-day cooldown, when it becomes available,
 * and the two most recent rankings.
 *
 * Returns { doneThisWeek, thisWeekRanking, lastRanking, nextAvailableAt }.
 * The legacy field names remain for mobile-cache compatibility.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
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

    // The two most recent true_north completions, newest first.
    const { data: rows, error } = await supabase
      .from('kit_completions')
      .select('period_key, payload, created_at')
      .eq('user_id', userId)
      .eq('kit', 'true_north')
      .order('created_at', { ascending: false })
      .limit(2)
    if (error) {
      console.error('[true-north/status] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const list = rows || []
    const latest = list[0] || null
    const latestCompletedAtMs = latest?.created_at ? new Date(latest.created_at).getTime() : 0
    const nextAvailableAtMs = latestCompletedAtMs + TRUE_NORTH_COOLDOWN_MS
    const doneThisWeek = !!latest && Number.isFinite(nextAvailableAtMs) && nextAvailableAtMs > Date.now()
    const thisWeekRanking = doneThisWeek ? latest?.payload?.ranking ?? null : null
    const lastRanking = doneThisWeek
      ? list[1]?.payload?.ranking ?? null
      : latest?.payload?.ranking ?? null

    return NextResponse.json({
      success: true,
      weekKey: latest?.period_key ?? '',
      doneThisWeek,
      thisWeekRanking,
      lastRanking,
      nextAvailableAt: doneThisWeek ? new Date(nextAvailableAtMs).toISOString() : null,
    })
  } catch (err) {
    console.error('[true-north/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
