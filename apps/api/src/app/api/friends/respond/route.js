import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { autoGrantDuoBothWays } from '@/lib/duo-auto'

export const runtime = 'edge'

/**
 * POST /api/friends/respond
 *
 * Body: { userId, friendshipId, action: 'accept' | 'decline' }
 *
 * Responds to a pending request. Only the user who did NOT request it can
 * accept/decline (they're user_a or user_b but not requested_by). The current
 * UI exposes Accept only. Accept is one atomic database operation: establish
 * the exclusive pair and ignore every other pending request involving either
 * member. Decline remains for backwards compatibility with older clients.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, friendshipId, action } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!friendshipId || (action !== 'accept' && action !== 'decline')) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: fr } = await supabase
      .from('friendships')
      .select('id, user_a, user_b, status, requested_by, relationship, relationship_since, accepted_at')
      .eq('id', friendshipId)
      .maybeSingle()
    if (!fr) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    // Must be a party to it, and NOT the requester.
    const isParty = fr.user_a === userId || fr.user_b === userId
    if (!isParty || fr.requested_by === userId || fr.status !== 'pending') {
      return NextResponse.json({ error: 'not_allowed' }, { status: 403 })
    }

    if (action === 'accept') {
      const other = fr.user_a === userId ? fr.user_b : fr.user_a
      const { data: pairRes, error: pairErr } = await supabase.rpc('accept_pairing_invitation', {
        p_user_id: userId,
        p_friendship_id: friendshipId,
      })
      if (pairErr || pairRes?.error) {
        const reason = pairRes?.error || 'pairing_failed'
        console.warn('[friends/respond] accept pairing failed:', pairErr?.message || reason)
        return NextResponse.json({ error: reason }, { status: 409 })
      }
      await autoGrantDuoBothWays(supabase, userId, other)
      return NextResponse.json({
        success: true, action, paired: true,
        ignoredCount: Number(pairRes?.ignored_count || 0),
      })
    } else {
      // A re-invite reuses an old accepted row. Declining that new invitation
      // restores the historical relationship marker rather than deleting it.
      const query = fr.accepted_at
        ? supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
        : supabase.from('friendships').delete().eq('id', friendshipId)
      const { error } = await query
      if (error) {
        console.error('[friends/respond] decline error:', error.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, action })
  } catch (err) {
    console.error('[friends/respond] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
