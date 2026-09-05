import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')
const memoryText = (row) => [row.description, row.refined_desc, row.raw_excerpt]
  .find((value) => typeof value === 'string' && value.trim())?.trim() || ''

/**
 * GET /api/bags?userId=xxx&scope=mine|their
 *
 * The Bags tab's data: Mine comes from user_items; Theirs is the partner's
 * non-empty Memory items after sharing filters. Display info is NOT here:
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
    const requestedBeforeMemoryId = searchParams.get('beforeMemoryId')
    const beforeMemoryId = requestedBeforeMemoryId && validUuid(requestedBeforeMemoryId)
      ? requestedBeforeMemoryId
      : null
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }
    if (requestedBeforeMemoryId && !beforeMemoryId) {
      return NextResponse.json({ error: 'Invalid memory cursor' }, { status: 400 })
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

    let detailMode = 'all'
    if (readingPartner) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('share_memory_details, memory_details_mode')
        .eq('id', targetUserId)
        .maybeSingle()
      if (profileError) {
        console.error('[bags] partner privacy error:', profileError.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      detailMode = profile?.memory_details_mode
        || (profile?.share_memory_details === false ? 'none' : 'custom')
    }

    // Item details are loaded only after the user opens a tile. Partner pages
    // are filtered inside Postgres before keyset pagination, so hidden or
    // blank rows cannot create empty pages or leak through page cursors.
    if (detailItemId) {
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

      let rawRows
      let memoryError
      if (readingPartner) {
        const result = await supabase.rpc('get_visible_partner_item_memories', {
          p_owner_user_id: targetUserId,
          p_item_id: detailItemId,
          p_require_reflect_share: detailMode === 'custom',
          p_limit: memoryPageSize + 1,
          p_before_created_at: beforeCreatedAt,
          p_before_memory_id: beforeMemoryId,
        })
        rawRows = result.data
        memoryError = result.error
      } else {
        const result = await supabase.rpc('get_personal_item_memories', {
          p_owner_user_id: targetUserId,
          p_item_id: detailItemId,
          p_limit: memoryPageSize + 1,
          p_before_created_at: beforeCreatedAt,
          p_before_memory_id: beforeMemoryId,
        })
        rawRows = result.data
        memoryError = result.error
      }
      if (memoryError) {
        console.error('[bags] item details error:', memoryError.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      const hasMore = (rawRows || []).length > memoryPageSize
      const pageRows = (rawRows || []).slice(0, memoryPageSize)

      return NextResponse.json({
        success: true,
        ownerUserId: targetUserId,
        itemId: detailItemId,
        memories: pageRows.flatMap((row) => {
          const text = memoryText(row)
          if (!text) return []
          return [{
            excerpt: text,
            rawExcerpt: text,
            // A partner may expose the memory description, never a route/key
            // to their private reflection detail. The mobile UI also hides
            // Details for Their, making this boundary defense-in-depth.
            ...(readingPartner ? {} : { reflectId: row.reflect_id }),
            createdAt: row.created_at,
          }]
        }),
        hasMore,
        nextBeforeCreatedAt: hasMore && pageRows.length > 0
          ? pageRows[pageRows.length - 1].created_at
          : null,
        nextBeforeMemoryId: hasMore && pageRows.length > 0
          ? pageRows[pageRows.length - 1].id
          : null,
      })
    }

    if (readingPartner && detailMode === 'none') {
      return NextResponse.json({
        success: true,
        ownerUserId: targetUserId,
        items: [],
        hasMore: false,
        nextBeforeFirstSeenAt: null,
        nextBeforeItemId: null,
      })
    }

    let ownedRaw
    let e1
    if (readingPartner) {
      const result = await supabase.rpc('get_visible_partner_memory_items', {
        p_owner_user_id: targetUserId,
        p_require_reflect_share: detailMode === 'custom',
        p_limit: pageSize + 1,
        p_before_first_seen_at: beforeFirstSeenAt,
        p_before_item_id: beforeItemId,
      })
      ownedRaw = result.data
      e1 = result.error
    } else {
      const result = await supabase.rpc('get_personal_memory_items', {
        p_owner_user_id: targetUserId,
        p_limit: pageSize + 1,
        p_before_first_seen_at: beforeFirstSeenAt,
        p_before_item_id: beforeItemId,
      })
      ownedRaw = result.data
      e1 = result.error
    }
    if (e1) {
      console.error('[bags] collection query error:', e1.message)
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
