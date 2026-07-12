import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/companion?userId=xxx
 *
 * The companion's state for Home and the interaction sheet: which pet, its
 * accumulated xp, stage, active skin, and name. Level and progress are derived
 * from xp client-side with the shared engine (levelFromXp) -- the server
 * returns only the authoritative xp, like gems and stage elsewhere.
 *
 * Returns { found:false } if the user has no companion row yet (shouldn't
 * happen post-onboarding, but Home must render regardless).
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

    const { data, error } = await supabase
      .from('companions')
      .select('companion_id, name, stage, xp, active_skin')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[companion] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ success: true, found: false })
    }

    return NextResponse.json({
      success: true,
      found: true,
      companion: {
        companionId: data.companion_id,
        name: data.name,
        stage: data.stage,
        xp: Number(data.xp) || 0,
        activeSkin: data.active_skin,
      },
    })
  } catch (err) {
    console.error('[companion] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
