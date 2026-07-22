import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

// PRD benefits matrix: free users hold 1 accepted friend, paid 99. Counted
// server-side at request time (add) AND accept time (respond) — the pair
// could fill either side's quota between the two moments.
async function acceptedCount(supabase, uid) {
  const { count } = await supabase
    .from('friendships')
    .select('id', { count: 'exact', head: true })
    .or(`user_a.eq.${uid},user_b.eq.${uid}`)
    .eq('status', 'accepted')
  return count ?? 0
}

async function friendLimitOf(supabase, uid) {
  const { data } = await supabase
    .from('profiles').select('subscription_tier').eq('id', uid).maybeSingle()
  return (data?.subscription_tier ?? 'free') === 'free' ? 1 : 99
}


/**
 * POST /api/friends/respond
 *
 * Body: { userId, friendshipId, action: 'accept' | 'decline' }
 *
 * Responds to a pending request. Only the user who did NOT request it can
 * accept/decline (they're user_a or user_b but not requested_by). Accept sets
 * status accepted + accepted_at; decline deletes the row so the pair can try
 * again later.
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
      .select('id, user_a, user_b, status, requested_by')
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
      // Quota re-check at accept time (either side may have filled up since
      // the request was sent).
      const other = fr.user_a === userId ? fr.user_b : fr.user_a
      if ((await acceptedCount(supabase, userId)) >= (await friendLimitOf(supabase, userId))) {
        return NextResponse.json({ error: 'friend_limit_reached' }, { status: 403 })
      }
      if ((await acceptedCount(supabase, other)) >= (await friendLimitOf(supabase, other))) {
        return NextResponse.json({ error: 'requester_friend_limit_reached' }, { status: 403 })
      }

      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', friendshipId)
      if (error) {
        console.error('[friends/respond] accept error:', error.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
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
