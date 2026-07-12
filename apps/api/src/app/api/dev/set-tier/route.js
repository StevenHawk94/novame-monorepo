import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/dev/set-tier   [TEST ONLY -- remove in C6-later]
 *
 * Flips the caller's own subscription_tier so paid/free branches (Reflect's AI
 * analysis, Visit Master, extra scenes, paid skins) can be tested before real
 * IAP is wired up. Scoped to the authenticated user only -- you can change your
 * own tier, no one else's. It is a paywall hole by design; it exists only
 * because there are no real users yet and paid unlocks nothing that costs money
 * at this stage. Delete this route when the seat-model IAP ships (C6-later).
 *
 * 'pro' stands in for "paid" (the isPaid test is tier !== 'free'); the tier
 * vocabulary regularizes to free/paid with the seat model later.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, tier } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (tier !== 'free' && tier !== 'pro') {
      return NextResponse.json({ error: 'tier must be free or pro' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { error } = await supabase
      .from('profiles')
      .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) {
      console.error('[dev/set-tier] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, tier })
  } catch (err) {
    console.error('[dev/set-tier] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
