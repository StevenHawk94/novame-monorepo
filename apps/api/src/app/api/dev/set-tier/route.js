import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/dev/set-tier   [TEST TOOLING -- fail-closed in production]
 *
 * Flips the caller's own subscription_tier so paid/free branches (Reflect's AI
 * analysis, Visit Master, extra scenes, paid skins) can be tested. Scoped to
 * the authenticated user only -- you can change your own tier, no one else's.
 *
 * SECURITY: this used to be an open paywall hole (any logged-in user could
 * self-upgrade). It is now gated behind the DEV_TIER_TESTER_IDS env var
 * (comma-separated UUID allowlist, may also include ADMIN_USER_IDS members).
 * In production the env var is simply not set, so the route rejects everyone
 * (fail-closed) -- equivalent to deletion, but local/dev deployments keep the
 * [DEV] tier-toggle button working by listing tester UUIDs in .env.local.
 *
 * 'plus' stands in for "paid" (the isPaid test is tier !== 'free'); the tier
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

    // Fail-closed gate, two ways in (unset envs => nobody can use this route):
    //  1. x-dev-tier-secret header matching DEV_TIER_SECRET — survives the
    //     anonymous-account UUID churn (every reinstall mints a new user id),
    //     so the [DEV] tier button keeps working without env updates.
    //  2. UUID allowlist (DEV_TIER_TESTER_IDS / ADMIN_USER_IDS).
    const secret = (process.env.DEV_TIER_SECRET || '').trim()
    const secretOk = !!secret && (request.headers.get('x-dev-tier-secret') || '').trim() === secret
    const testerIds = [
      ...(process.env.DEV_TIER_TESTER_IDS || '').split(','),
      ...(process.env.ADMIN_USER_IDS || '').split(','),
    ].map(s => s.trim()).filter(Boolean)
    if (!secretOk && !testerIds.includes(verified.id)) {
      console.warn('[dev/set-tier] rejected: user', verified.id, 'no valid secret and not in DEV_TIER_TESTER_IDS/ADMIN_USER_IDS')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (tier !== 'free' && tier !== 'plus') {
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
