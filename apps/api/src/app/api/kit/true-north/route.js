import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { DIMENSION_IDS, trueNorthGemHits } from '@novame/domain'

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
 * POST /api/kit/true-north
 *
 * Body: { userId, ranking: DimensionId[8], localDate }
 *
 * Completes this week's True North: the engine turns the ranking into gem hits
 * (top three get +50/+30/+10, via trueNorthGemHits) and submit_kit writes them
 * atomically -- +50 xp, the gems, the completion with the ranking in its
 * payload, once per week. True North is the only Kit besides Reflect that bears
 * gems, which is exactly what submit_kit's gem path is for.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, ranking, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Ranking must be a permutation of all eight dimensions.
    if (
      !Array.isArray(ranking) ||
      ranking.length !== DIMENSION_IDS.length ||
      new Set(ranking).size !== DIMENSION_IDS.length ||
      !ranking.every((d) => DIMENSION_IDS.includes(d))
    ) {
      return NextResponse.json({ error: 'Invalid ranking' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)
    const gemHits = trueNorthGemHits(ranking)

    const { data: result, error: rpcErr } = await supabase.rpc('submit_kit', {
      p_user_id: userId,
      p_kit: 'true_north',
      p_source: 'true_north',
      p_period_key: weekStr, // weekly kit: period is the ISO week
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 50,
      p_gem_hits: gemHits,
      p_payload: { ranking },
    })
    if (rpcErr) {
      console.error('[true-north] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[true-north] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
