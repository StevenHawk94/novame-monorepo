import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/duo/join
 *
 * Body: { userId, code }
 *
 * The member claims a duo seat with the owner's one-time code. Irreversible:
 * once claimed, the seat is taken and can't be released (per the product rule).
 * Guards:
 *   - the member must currently be free (an existing Plus user can't take a
 *     seat -- they already have the tier)
 *   - the code must exist and be unclaimed (status pending)
 *   - the member can't claim their own code
 *   - the owner's duo subscription must still be active
 * On success the member's profiles.subscription_tier becomes 'plus'; it follows
 * the owner's subscription from then on (owner cancels -> member lapses at the
 * owner's period end, handled by the renewal webhook).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, code } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Member must currently be free.
    const { data: me } = await supabase
      .from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    if (me?.subscription_tier === 'plus') {
      return NextResponse.json({ error: 'already_plus' }, { status: 409 })
    }

    // Resolve the code.
    const normalized = code.trim().toUpperCase()
    const { data: duo } = await supabase
      .from('duo_memberships')
      .select('id, owner_id, member_id, status')
      .eq('invite_code', normalized)
      .maybeSingle()
    if (!duo) return NextResponse.json({ error: 'code_not_found' }, { status: 404 })
    if (duo.owner_id === userId) return NextResponse.json({ error: 'cannot_claim_own' }, { status: 400 })
    if (duo.status === 'claimed' || duo.member_id) {
      return NextResponse.json({ error: 'seat_taken' }, { status: 409 })
    }

    // Owner's duo subscription must still be active.
    const { data: ownerSub } = await supabase
      .from('subscriptions')
      .select('plan, plan_type, status')
      .eq('user_id', duo.owner_id)
      .maybeSingle()
    if (!ownerSub || ownerSub.plan !== 'plus' || ownerSub.plan_type !== 'duo' || ownerSub.status !== 'active') {
      return NextResponse.json({ error: 'owner_inactive' }, { status: 409 })
    }

    // Claim the seat (guarded on still-pending to avoid a race double-claim).
    const { data: claimed, error: claimErr } = await supabase
      .from('duo_memberships')
      .update({ member_id: userId, status: 'claimed', claimed_at: new Date().toISOString() })
      .eq('id', duo.id)
      .eq('status', 'pending')
      .is('member_id', null)
      .select('id')
      .maybeSingle()
    if (claimErr || !claimed) {
      return NextResponse.json({ error: 'seat_taken' }, { status: 409 })
    }

    // Grant the member Plus (follows the owner's subscription from here).
    const { error: grantErr } = await supabase
      .from('profiles')
      .update({ subscription_tier: 'plus', updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (grantErr) {
      console.error('[duo/join] grant tier error:', grantErr.message)
      // The seat is claimed but the tier grant failed. Surface the error so the
      // client retries; the claim update above is idempotent on this member.
      return NextResponse.json({ error: 'grant_failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[duo/join] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
