import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { expirePairingInvitations } from '@/lib/pairing-invitations'

export const runtime = 'edge'

async function activePairing(supabase, uid) {
  const { data, error } = await supabase
    .from('pairings')
    .select('partner_user_id')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return data
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
 * pairing at accept time. Historical accepted rows are retained and reused
 * when former partners invite each other again.
 */
const RELATIONSHIPS = [
  'Partner', 'Best Friend', 'Families', 'Someone Special', 'Others',
  // Keep accepting labels stored by older app versions.
  'Lover', 'Mom and Daughter', 'Siblings',
]

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

    const [userRate, ipRate] = await Promise.all([
      rateLimit(supabase, `friend-code:${preview === true ? 'preview' : 'send'}:u:${userId}`, preview === true ? 30 : 10, 3600),
      rateLimit(supabase, `friend-code:ip:${clientIp(request)}`, 80, 3600),
    ])
    if (!userRate.allowed || !ipRate.allowed) {
      return NextResponse.json({ error: 'rate_limited' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.max(userRate.resetIn, ipRate.resetIn, 1)) },
      })
    }

    // Resolve the code to a user.
    const normalized = code.trim().toUpperCase()
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_default_avatar')
      .eq('invite_code', normalized)
      .maybeSingle()
    if (targetError) throw targetError
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

    // An invitation occupies the requester's only outgoing slot for 48 hours.
    // Expire the old lease before checking that slot so the user can start a
    // fresh invitation immediately after the deadline.
    await expirePairingInvitations(supabase, userId)

    // Pairings, not historical friendship rows, are the source of truth for
    // the single active relationship. Unpairing intentionally preserves all
    // friendship and memory data, so old accepted rows must not consume a
    // future pairing slot.
    const [mine, theirs] = await Promise.all([
      activePairing(supabase, userId),
      activePairing(supabase, target.id),
    ])
    if (mine) return NextResponse.json({ error: 'already_paired' }, { status: 409 })
    if (theirs) return NextResponse.json({ error: 'target_already_paired' }, { status: 409 })

    const { data: outgoing, error: outgoingError } = await supabase
      .from('friendships')
      .select('id')
      .eq('status', 'pending')
      .eq('requested_by', userId)
      .limit(1)
      .maybeSingle()
    if (outgoingError) throw outgoingError
    if (outgoing) {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 })
    }

    // Canonical order.
    const [ua, ub] = userId < target.id ? [userId, target.id] : [target.id, userId]

    // Already a row for this pair?
    const { data: existing, error: existingError } = await supabase
      .from('friendships')
      .select('id, status')
      .eq('user_a', ua)
      .eq('user_b', ub)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing?.status === 'pending') {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 })
    }
    if (existing?.status === 'accepted') {
      // Re-inviting a former pairing reuses its relationship row instead of
      // deleting history. The recipient still has to accept the new pairing.
      const { error: updateErr } = await supabase.from('friendships').update({
        status: 'pending', requested_by: userId,
        relationship: rel, relationship_since: since,
        created_at: new Date().toISOString(),
      }).eq('id', existing.id)
      if (updateErr) {
        if (updateErr.code === '23505') {
          return NextResponse.json({ error: 'already_pending' }, { status: 409 })
        }
        console.error('[friends/add] reinvite error:', updateErr.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      return NextResponse.json({ success: true, requestedTo: target.display_name || 'Friend' })
    }

    const { error: insErr } = await supabase.from('friendships').insert({
      user_a: ua, user_b: ub, status: 'pending', requested_by: userId,
      relationship: rel, relationship_since: since,
    })
    if (insErr) {
      if (insErr.code === '23505') {
        return NextResponse.json({ error: 'already_pending' }, { status: 409 })
      }
      console.error('[friends/add] insert error:', insErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, requestedTo: target.display_name || 'Friend' })
  } catch (err) {
    console.error('[friends/add] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
