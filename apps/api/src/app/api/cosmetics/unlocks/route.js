import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/cosmetics/unlocks?userId=xxx
 *
 * The user's Clovers balance (companions.xp lifetime earned minus clovers_spent)
 * and the cosmetics they've unlocked. The client renders the skin/scene pickers
 * from this: an item is owned if it's in `unlocks`, affordable if balance >= its
 * price.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
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

    const { data: comp, error: compErr } = await supabase
      .from('companions')
      .select('xp, clovers_spent')
      .eq('user_id', userId)
      .maybeSingle()
    if (compErr) {
      console.error('[cosmetics/unlocks] companion error:', compErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const earned = Number(comp?.xp) || 0
    const spent = Number(comp?.clovers_spent) || 0
    const balance = Math.max(0, earned - spent)

    const { data: rows, error: unlockErr } = await supabase
      .from('cosmetic_unlocks')
      .select('cosmetic_type, cosmetic_id')
      .eq('user_id', userId)
    if (unlockErr) {
      console.error('[cosmetics/unlocks] unlocks error:', unlockErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      balance,
      unlocks: (rows || []).map((r) => ({ type: r.cosmetic_type, id: r.cosmetic_id })),
    })
  } catch (err) {
    console.error('[cosmetics/unlocks] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
