import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/bags?userId=xxx&scope=mine|their
 *
 * The Bags tab's data: the items a user has collected (user_items). Display
 * info (name, rarity, emoji/sprite) is NOT here:
 * it's derived client-side from the shared dictionary by item_id, so the emoji
 * placeholder swaps to sprite art with no API change.
 *
 * Returns one cursor-paginated page (100 rows maximum). Supplying itemId reads
 * one cursor-paginated memory-detail page on demand. This keeps opening the
 * collection independent from the size of its complete memory history.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const scope = searchParams.get('scope') === 'their' ? 'their' : 'mine'
    const requestedLimit = Number(searchParams.get('limit') || 100)
    const pageSize = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100))
    const requestedBefore = searchParams.get('beforeFirstSeenAt')
    const beforeFirstSeenAt = requestedBefore && Number.isFinite(Date.parse(requestedBefore))
      ? requestedBefore
      : null
    const beforeItemId = searchParams.get('beforeItemId')
    const detailItemId = searchParams.get('itemId')
    const requestedMemoryLimit = Number(searchParams.get('memoryLimit') || 50)
    const memoryPageSize = Math.max(1, Math.min(100, Number.isFinite(requestedMemoryLimit)
      ? Math.floor(requestedMemoryLimit)
      : 50))
    const requestedMemoryBefore = searchParams.get('beforeCreatedAt')
    const beforeCreatedAt = requestedMemoryBefore && Number.isFinite(Date.parse(requestedMemoryBefore))
      ? requestedMemoryBefore
      : null
    const beforeMemoryId = searchParams.get('beforeMemoryId')
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

    // Resolve ownership server-side. The client can choose Mine or Their but
    // can never supply an arbitrary target user id (or accidentally ask for
    // its own collection while painting the Their tab).
    const readingPartner = scope === 'their'
    let targetUserId = userId
    if (readingPartner) {
      const { data: pairing } = await supabase
        .from('pairings')
        .select('partner_user_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (!pairing) {
        return NextResponse.json({
          success: true,
          ownerUserId: null,
          items: [],
          hasMore: false,
          nextBeforeFirstSeenAt: null,
          nextBeforeItemId: null,
        })
      }
      targetUserId = pairing.partner_user_id
    }

    // Item details are loaded only after the user opens a tile. The raw page
    // is keyset-paginated before privacy filtering, so one request always has
    // bounded database and response cost even after years of reflections.
    if (detailItemId) {
      let detailMode = 'all'
      if (readingPartner) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('share_memory_details, memory_details_mode')
          .eq('id', targetUserId)
          .maybeSingle()
        detailMode = profile?.memory_details_mode
          || (profile?.share_memory_details === false ? 'none' : 'custom')
      }

      if (detailMode === 'none') {
        return NextResponse.json({
          success: true,
          ownerUserId: targetUserId,
          itemId: detailItemId,
          memories: [],
          hasMore: false,
          nextBeforeCreatedAt: null,
          nextBeforeMemoryId: null,
        })
      }

      let memoryQuery = supabase
        .from('item_memories')
        .select('id, item_id, reflect_id, raw_excerpt, refined_desc, created_at')
        .eq('user_id', targetUserId)
        .eq('item_id', detailItemId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(memoryPageSize + 1)
      if (beforeCreatedAt && beforeMemoryId) {
        memoryQuery = memoryQuery.or(
          `created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeMemoryId})`,
        )
      } else if (beforeCreatedAt) {
        memoryQuery = memoryQuery.lt('created_at', beforeCreatedAt)
      }

      const { data: rawRows, error: memoryError } = await memoryQuery
      if (memoryError) {
        console.error('[bags] item details error:', memoryError.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      const hasMore = (rawRows || []).length > memoryPageSize
      const pageRows = (rawRows || []).slice(0, memoryPageSize)
      let visibleRows = pageRows

      if (detailMode === 'custom') {
        const reflectIds = [...new Set(pageRows.map((row) => row.reflect_id).filter(Boolean))]
        if (reflectIds.length > 0) {
          const { data: visible } = await supabase
            .from('reflects')
            .select('id')
            .in('id', reflectIds)
            .or('shared_to_friends.neq.false,shared_to_friends.is.null')
          const visibleIds = new Set((visible || []).map((row) => row.id))
          visibleRows = pageRows.filter((row) => visibleIds.has(row.reflect_id))
        } else {
          visibleRows = []
        }
      }

      return NextResponse.json({
        success: true,
        ownerUserId: targetUserId,
        itemId: detailItemId,
        memories: visibleRows.map((row) => ({
          excerpt: row.refined_desc || row.raw_excerpt,
          rawExcerpt: row.raw_excerpt,
          // A partner may expose the memory description, never a route/key to
          // their private reflection detail. The mobile UI also hides Details
          // for Their, making this privacy boundary defense-in-depth.
          ...(readingPartner ? {} : { reflectId: row.reflect_id }),
          createdAt: row.created_at,
        })),
        hasMore,
        nextBeforeCreatedAt: hasMore && pageRows.length > 0
          ? pageRows[pageRows.length - 1].created_at
          : null,
        nextBeforeMemoryId: hasMore && pageRows.length > 0
          ? pageRows[pageRows.length - 1].id
          : null,
      })
    }

    let ownedQuery = supabase
      .from('user_items')
      .select('item_id, count, first_seen_at')
      .eq('user_id', targetUserId)
      .order('first_seen_at', { ascending: false })
      .order('item_id', { ascending: false })
      .limit(pageSize + 1)
    if (beforeFirstSeenAt && beforeItemId) {
      ownedQuery = ownedQuery.or(
        `first_seen_at.lt.${beforeFirstSeenAt},and(first_seen_at.eq.${beforeFirstSeenAt},item_id.lt.${beforeItemId})`,
      )
    } else if (beforeFirstSeenAt) {
      // Backward compatibility for clients that still send the old timestamp-
      // only cursor. New clients always send both parts of the stable keyset.
      ownedQuery = ownedQuery.lt('first_seen_at', beforeFirstSeenAt)
    }

    const { data: ownedRaw, error: e1 } = await ownedQuery
    if (e1) {
      console.error('[bags] user_items error:', e1.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const hasMore = (ownedRaw || []).length > pageSize
    const owned = (ownedRaw || []).slice(0, pageSize)
    const items = owned.map((it) => ({
      itemId: it.item_id,
      count: it.count,
      firstSeenAt: it.first_seen_at,
      memories: [],
    }))

    return NextResponse.json({
      success: true,
      ownerUserId: targetUserId,
      items,
      hasMore,
      nextBeforeFirstSeenAt: hasMore && owned.length > 0
        ? owned[owned.length - 1].first_seen_at
        : null,
      nextBeforeItemId: hasMore && owned.length > 0
        ? owned[owned.length - 1].item_id
        : null,
    })
  } catch (err) {
    console.error('[bags] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
