import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const FEED_DAYS = 14
const MAX_ROWS = 400 // hard bound; 99 friends x heavy writers stays sane

/**
 * GET /api/friends/feed?userId=...
 *
 * The Messages list (PRD 6.2): every accepted friend's recent item memories,
 * grouped per reflect, newest first, with unread markers.
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
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Accepted friends only.
    const { data: rows } = await supabase
      .from('friendships')
      .select('user_a, user_b')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('status', 'accepted')
    const friendIds = (rows || []).map((r) => (r.user_a === userId ? r.user_b : r.user_a))
    if (friendIds.length === 0) return NextResponse.json({ success: true, feed: [] })

    // Names + per-friend privacy in one query.
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, share_memory_details')
      .in('id', friendIds)
    const profileById = new Map((profiles || []).map((p) => [p.id, p]))

    // Recent memories across all friends.
    const since = new Date(Date.now() - FEED_DAYS * 86400000).toISOString()
    const { data: memories } = await supabase
      .from('item_memories')
      .select('user_id, item_id, reflect_id, raw_excerpt, refined_desc, created_at')
      .in('user_id', friendIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)

    // Read cursors.
    const { data: reads } = await supabase
      .from('friend_feed_reads')
      .select('friend_user_id, last_read_at')
      .eq('user_id', userId)
    const readAt = new Map((reads || []).map((r) => [r.friend_user_id, r.last_read_at]))

    // Group per (friend, reflect): one Messages entry per reflect.
    const entryByKey = new Map()
    for (const m of memories || []) {
      const share = !!profileById.get(m.user_id)?.share_memory_details
      const key = `${m.user_id}:${m.reflect_id}`
      let e = entryByKey.get(key)
      if (!e) {
        e = {
          friendUserId: m.user_id,
          reflectId: m.reflect_id,
          createdAt: m.created_at,
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
        sharesDetails: !!profileById.get(e.friendUserId)?.share_memory_details,
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
