import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/** A short, shareable invite code: 6 chars, no ambiguous 0/O/1/I/L. */
function makeCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}

/**
 * GET /api/friends/status?userId=xxx
 *
 * The Friends tab's data. Ensures the user has a stable invite_code (generated
 * once, lazily, then fixed -- it's their social handle, shared repeatedly), and
 * returns it alongside the accepted friends and the pending requests waiting for
 * this user to accept. Friends see each other's item emoji, not reflections, so
 * this returns identity + today's collected item ids per friend (the emoji is
 * resolved client-side from the dictionary).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const localDate = searchParams.get('localDate')
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

    // Ensure a stable invite code (generate once if missing).
    const { data: me } = await supabase
      .from('profiles')
      .select('invite_code, display_name')
      .eq('id', userId)
      .maybeSingle()
    let inviteCode = me?.invite_code
    if (!inviteCode) {
      // Try a few times to avoid a rare collision.
      for (let attempt = 0; attempt < 5 && !inviteCode; attempt++) {
        const candidate = makeCode()
        const { error: upErr } = await supabase
          .from('profiles')
          .update({ invite_code: candidate })
          .eq('id', userId)
          .is('invite_code', null)
        if (!upErr) {
          const { data: check } = await supabase
            .from('profiles').select('invite_code').eq('id', userId).maybeSingle()
          inviteCode = check?.invite_code
        }
      }
    }

    // Friendships involving me.
    const { data: rows } = await supabase
      .from('friendships')
      .select('id, user_a, user_b, status, requested_by, created_at, relationship')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)

    const { data: pairing } = await supabase
      .from('pairings')
      .select('partner_user_id')
      .eq('user_id', userId)
      .maybeSingle()
    const activePartnerId = pairing?.partner_user_id || null
    const acceptedIds = activePartnerId ? [activePartnerId] : []
    const pending = [] // requests waiting for ME to accept
    const sentRaw = [] // requests I sent, still unanswered (Add Friends page)
    for (const r of rows || []) {
      const other = r.user_a === userId ? r.user_b : r.user_a
      if (r.status === 'pending' && r.requested_by !== userId) {
        pending.push({ friendshipId: r.id, userId: other, relationship: r.relationship ?? null })
      } else if (r.status === 'pending' && r.requested_by === userId) {
        sentRaw.push({ friendshipId: r.id, userId: other, createdAt: r.created_at, relationship: r.relationship ?? null })
      }
    }

    // Friend identities + today's collected item ids (emoji resolved on client).
    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const friends = []
    if (acceptedIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles').select('id, display_name, avatar_url, is_default_avatar').in('id', acceptedIds)
      const profById = Object.fromEntries((profs || []).map((p) => [p.id, p]))

      // Today = the friend's reflect local_date. Item icons are ALWAYS
      // visible to friends (2026-07-24: the per-reflect toggle only gates
      // details, which this endpoint never carries) — one query, all friends.
      const { data: todaysReflects } = await supabase
        .from('reflects')
        .select('id, user_id')
        .in('user_id', acceptedIds)
        .eq('local_date', dateStr)
      const reflectIdsByFriend = new Map()
      for (const r of todaysReflects || []) {
        if (!reflectIdsByFriend.has(r.user_id)) reflectIdsByFriend.set(r.user_id, [])
        reflectIdsByFriend.get(r.user_id).push(r.id)
      }

      for (const fid of acceptedIds) {
        const rids = reflectIdsByFriend.get(fid) || []
        let items = []
        if (rids.length > 0) {
          const { data } = await supabase
            .from('reflect_items')
            .select('item_id, created_at, position')
            .eq('user_id', fid)
            .eq('visible_to_paired', true)
            .in('reflect_id', rids)
            .order('created_at', { ascending: true })
            .order('position', { ascending: true })
          items = data || []
        }
        friends.push({
          userId: fid,
          displayName: profById[fid]?.display_name || 'Friend',
          avatarUrl: profById[fid]?.avatar_url || '',
          isDefaultAvatar: profById[fid]?.is_default_avatar !== false,
          todayItemIds: items.map((i) => i.item_id),
        })
      }
    }

    // Pending requesters' names.
    const pendingOut = []
    if (pending.length > 0) {
      const ids = pending.map((p) => p.userId)
      const { data: profs } = await supabase.from('profiles').select('id, display_name, avatar_url, is_default_avatar').in('id', ids)
      const profById = Object.fromEntries((profs || []).map((p) => [p.id, p]))
      for (const p of pending) {
        pendingOut.push({
          friendshipId: p.friendshipId,
          userId: p.userId,
          displayName: profById[p.userId]?.display_name || 'Someone',
          avatarUrl: profById[p.userId]?.avatar_url || '',
          isDefaultAvatar: profById[p.userId]?.is_default_avatar !== false,
          relationship: p.relationship ?? null,
        })
      }
    }

    // Outgoing requests' names (the mock's "Sent 2h ago / Pending" rows).
    const sent = []
    if (sentRaw.length > 0) {
      const ids = sentRaw.map((p) => p.userId)
      const { data: profs } = await supabase.from('profiles').select('id, display_name, avatar_url, is_default_avatar').in('id', ids)
      const profById = Object.fromEntries((profs || []).map((p) => [p.id, p]))
      for (const p of sentRaw) {
        sent.push({
          friendshipId: p.friendshipId,
          userId: p.userId,
          displayName: profById[p.userId]?.display_name || 'Someone',
          avatarUrl: profById[p.userId]?.avatar_url || '',
          isDefaultAvatar: profById[p.userId]?.is_default_avatar !== false,
          createdAt: p.createdAt,
        })
      }
    }

    return NextResponse.json({ success: true, inviteCode, friends, pending: pendingOut, sent })
  } catch (err) {
    console.error('[friends/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
