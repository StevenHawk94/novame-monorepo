import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const FEED_DAYS = 7
const MAX_ROWS = 400

/**
 * GET /api/friends/feed?userId=...
 *
 * The Paired list: the current partner's recent item memories, grouped per
 * reflect, newest first, with unread markers. Historical friendship rows are
 * deliberately ignored after unpairing.
 *
 * PRIVACY IS SERVER-ENFORCED: memory excerpts ride along ONLY when that
 * friend opted in (profiles.share_memory_details, default false). Otherwise
 * the entry carries item ids alone — the emoji-peek principle. Client-side
 * hiding is not a privacy model.
 *
 * Unread: entries newer than friend_feed_reads.last_read_at for that friend.
 * POST /api/friends/read moves the cursor.
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(start || '') && /^\d{4}-\d{2}-\d{2}$/.test(end || '')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: pairing } = await supabase
      .from('pairings')
      .select('partner_user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (!pairing?.partner_user_id) return NextResponse.json({ success: true, feed: [] })
    const friendIds = [pairing.partner_user_id]

    // Names + per-friend privacy in one query.
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, share_memory_details, memory_details_mode, avatar_url, is_default_avatar')
      .in('id', friendIds)
    const profileById = new Map((profiles || []).map((p) => [p.id, p]))

    // A calendar range follows each reflection's device-local day, rather
    // than UTC created_at (otherwise late-night entries can land a day off).
    const detailsHidden = new Set()
    const reflectDate = new Map()
    let rangedReflectIds = []
    if (hasRange) {
      const { data: rangedReflects } = await supabase.from('reflects')
        .select('id, shared_to_friends, local_date')
        .in('user_id', friendIds)
        .gte('local_date', start)
        .lte('local_date', end)
        .limit(2000)
      rangedReflectIds = (rangedReflects || []).map((r) => r.id)
      for (const r of rangedReflects || []) {
        if (r.shared_to_friends === false) detailsHidden.add(r.id)
        reflectDate.set(r.id, r.local_date)
      }
      if (rangedReflectIds.length === 0) return NextResponse.json({ success: true, feed: [] })
    }

    // Recent memories across all friends.
    let memoryQuery = supabase
      .from('item_memories')
      .select('user_id, item_id, reflect_id, raw_excerpt, refined_desc, created_at')
      .in('user_id', friendIds)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
    if (hasRange) {
      memoryQuery = memoryQuery.in('reflect_id', rangedReflectIds)
    } else {
      memoryQuery = memoryQuery.gte('created_at', new Date(Date.now() - FEED_DAYS * 86400000).toISOString())
    }
    const { data: memoriesRaw } = await memoryQuery

    // Per-reflect visibility (2026-07-24 result-page toggle): item ICONS are
    // always visible to friends; the toggle only gates the memory DETAILS.
    // A detail therefore requires BOTH the owner's global opt-in AND this
    // reflect's toggle — enforced here, server-side.
    const memories = memoriesRaw || []
    const reflectIds = [...new Set(memories.map((m) => m.reflect_id))]
    if (!hasRange && reflectIds.length > 0) {
      const { data: vis } = await supabase
        .from('reflects')
        .select('id, shared_to_friends, local_date')
        .in('id', reflectIds)
      for (const r of vis || []) {
        if (r.shared_to_friends === false) detailsHidden.add(r.id)
        reflectDate.set(r.id, r.local_date)
      }
    }

    // Read cursors.
    const { data: reads } = await supabase
      .from('friend_feed_reads')
      .select('friend_user_id, last_read_at')
      .eq('user_id', userId)
    const readAt = new Map((reads || []).map((r) => [r.friend_user_id, r.last_read_at]))

    // Group per (friend, reflect): one Messages entry per reflect.
    const entryByKey = new Map()
    for (const m of memories) {
      const profile = profileById.get(m.user_id)
      const mode = profile?.memory_details_mode || (profile?.share_memory_details === false ? 'none' : 'custom')
      const share = mode === 'all' || (mode === 'custom' && !detailsHidden.has(m.reflect_id))
      const key = `${m.user_id}:${m.reflect_id}`
      let e = entryByKey.get(key)
      if (!e) {
        e = {
          friendUserId: m.user_id,
          reflectId: m.reflect_id,
          createdAt: m.created_at,
          localDate: reflectDate.get(m.reflect_id) || m.created_at.slice(0, 10),
          itemIds: [],
          // Excerpts only with the owner's opt-in — never leak by shape.
          details: share ? [] : null,
        }
        entryByKey.set(key, e)
      }
      e.itemIds.push(m.item_id)
      if (e.details) {
        e.details.push({ itemId: m.item_id, text: m.refined_desc || m.raw_excerpt })
      }
      if (m.created_at > e.createdAt) e.createdAt = m.created_at
    }

    const feed = [...entryByKey.values()]
      .map((e) => ({
        ...e,
        friendName: profileById.get(e.friendUserId)?.display_name || 'Friend',
        friendAvatarUrl: profileById.get(e.friendUserId)?.avatar_url || '',
        friendIsDefaultAvatar: profileById.get(e.friendUserId)?.is_default_avatar !== false,
        sharesDetails: (profileById.get(e.friendUserId)?.memory_details_mode || 'custom') !== 'none',
        unread: e.createdAt > (readAt.get(e.friendUserId) ?? '1970-01-01T00:00:00Z'),
      }))
      // Unread first, then newest — the design's ordering.
      .sort((a, b) => (a.unread === b.unread ? (a.createdAt < b.createdAt ? 1 : -1) : a.unread ? -1 : 1))

    return NextResponse.json({ success: true, feed })
  } catch (err) {
    console.error('[friends/feed] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
