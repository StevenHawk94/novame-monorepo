import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/bags?userId=xxx
 *
 * The Bags tab's data: the items a user has collected (user_items) and, for
 * each, its memories (item_memories -- one per match, with the excerpt and the
 * reflect it came from). Display info (name, rarity, emoji/sprite) is NOT here:
 * it's derived client-side from the shared dictionary by item_id, so the emoji
 * placeholder swaps to sprite art with no API change.
 *
 * Returns { items: [{ itemId, count, firstSeenAt, memories: [{ excerpt,
 * reflectId, createdAt }] }] }, newest memory first.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
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

    const { data: owned, error: e1 } = await supabase
      .from('user_items')
      .select('item_id, count, first_seen_at')
      .eq('user_id', userId)
      .order('first_seen_at', { ascending: false })
    if (e1) {
      console.error('[bags] user_items error:', e1.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const { data: memories, error: e2 } = await supabase
      .from('item_memories')
      .select('item_id, reflect_id, raw_excerpt, refined_desc, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (e2) {
      console.error('[bags] memories error:', e2.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    // Group memories by item.
    const byItem = new Map()
    for (const m of memories || []) {
      if (!byItem.has(m.item_id)) byItem.set(m.item_id, [])
      byItem.get(m.item_id).push({
        excerpt: m.refined_desc || m.raw_excerpt,
        rawExcerpt: m.raw_excerpt,
        reflectId: m.reflect_id,
        createdAt: m.created_at,
      })
    }

    const items = (owned || []).map((it) => ({
      itemId: it.item_id,
      count: it.count,
      firstSeenAt: it.first_seen_at,
      memories: byItem.get(it.item_id) || [],
    }))

    return NextResponse.json({ success: true, items })
  } catch (err) {
    console.error('[bags] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
