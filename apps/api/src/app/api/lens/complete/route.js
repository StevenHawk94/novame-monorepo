import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { DIMENSION_IDS } from '@novame/domain'

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
 * POST /api/lens/complete
 *
 * Body: { userId, theme, cardId, cardOrder, response, localDate }
 *
 * Completes today's New Lens: +20 xp, advances the theme cursor, records the
 * run -- all atomically in submit_lens. response is 'resonates' or 'different';
 * both pay the same and spend the day. 'different' additionally tells the
 * client to route the user into Reflect (handled client-side).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, theme, cardId, cardOrder, response, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!DIMENSION_IDS.includes(theme)) {
      return NextResponse.json({ error: 'Invalid theme' }, { status: 400 })
    }
    if (response !== 'resonates' && response !== 'different') {
      return NextResponse.json({ error: 'Invalid response' }, { status: 400 })
    }
    if (!Number.isInteger(cardOrder)) {
      return NextResponse.json({ error: 'Invalid cardOrder' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)

    const { data: result, error: rpcErr } = await supabase.rpc('submit_lens', {
      p_user_id: userId,
      p_theme: theme,
      p_card_id: cardId,
      p_card_order: cardOrder,
      p_response: response,
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 20,
    })
    if (rpcErr) {
      console.error('[lens/complete] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[lens/complete] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
