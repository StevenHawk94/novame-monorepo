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
 * POST /api/friends/add
 *
 * Body: { userId, code, preview?, relationship?, relationshipSince? }
 *
 * preview: true resolves the code to { targetName } WITHOUT creating anything
 * (the Add Friends search-result card, 2026-07-24 mock). A real add carries
 * the proposed relationship (Lover / Best Friend / ... / Others) and its
 * start date; both ride on the friendship row and are copied onto the
 * pairing at accept time. Rejects self-add, an unknown code, or a pair that
 * already has a row (friends or pending).
 */
const RELATIONSHIPS = ['Lover', 'Best Friend', 'Mom and Daughter', 'Siblings', 'Someone Special', 'Others']

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, code, preview, relationship, relationshipSince } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Resolve the code to a user.
    const normalized = code.trim().toUpperCase()
    const { data: target } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_default_avatar')
      .eq('invite_code', normalized)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: 'code_not_found' }, { status: 404 })
    }
    if (target.id === userId) {
      return NextResponse.json({ error: 'cannot_add_self' }, { status: 400 })
    }

    // Search-result preview: name only, nothing written, nothing enumerable
    // (still exact-code matching — no fuzzy lookup surface).
    if (preview === true) {
      return NextResponse.json({
        success: true,
        preview: true,
        targetName: target.display_name || 'Friend',
        targetUserId: target.id,
        targetAvatarUrl: target.avatar_url || '',
        targetIsDefaultAvatar: target.is_default_avatar !== false,
      })
    }

    const rel = RELATIONSHIPS.includes(relationship) ? relationship : null
    const since = typeof relationshipSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(relationshipSince)
      ? relationshipSince
      : null

    // Friend quota (both sides — a request that could never be accepted is
    // clearer rejected now than pending forever).
    if ((await acceptedCount(supabase, userId)) >= (await friendLimitOf(supabase, userId))) {
      return NextResponse.json({ error: 'friend_limit_reached' }, { status: 403 })
    }
    if ((await acceptedCount(supabase, target.id)) >= (await friendLimitOf(supabase, target.id))) {
      return NextResponse.json({ error: 'target_friend_limit_reached' }, { status: 403 })
    }

    // Canonical order.
    const [ua, ub] = userId < target.id ? [userId, target.id] : [target.id, userId]

    // Already a row for this pair?
    const { data: existing } = await supabase
      .from('friendships')
      .select('id, status')
      .eq('user_a', ua)
      .eq('user_b', ub)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: existing.status === 'accepted' ? 'already_friends' : 'already_pending' }, { status: 409 })
    }

    const { error: insErr } = await supabase.from('friendships').insert({
      user_a: ua, user_b: ub, status: 'pending', requested_by: userId,
      relationship: rel, relationship_since: since,
    })
    if (insErr) {
      console.error('[friends/add] insert error:', insErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, requestedTo: target.display_name || 'Friend' })
  } catch (err) {
    console.error('[friends/add] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
