import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'

const FEED_DAYS = 7
const MAX_ROWS = 400

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const ranged = /^\d{4}-\d{2}-\d{2}$/.test(start || '') && /^\d{4}-\d{2}-\d{2}$/.test(end || '')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = serviceClient()
    const { data: pairing } = await supabase.from('pairings').select('partner_user_id')
      .eq('user_id', userId).maybeSingle()
    if (!pairing?.partner_user_id) return NextResponse.json({ success: true, feed: [] })
    const friendId = pairing.partner_user_id
    const [{ data: profile }, { data: reads }] = await Promise.all([
      supabase.from('profiles')
        .select('display_name, share_memory_details, memory_details_mode, avatar_url, is_default_avatar')
        .eq('id', friendId).maybeSingle(),
      supabase.from('friend_feed_reads').select('last_read_at')
        .eq('user_id', userId).eq('friend_user_id', friendId).maybeSingle(),
    ])

    let reflectQuery = supabase.from('reflects')
      .select('id, local_date, created_at, shared_to_friends')
      .eq('user_id', friendId)
      .order('created_at', { ascending: false })
      .limit(180)
    if (ranged) {
      reflectQuery = reflectQuery.gte('local_date', start).lte('local_date', end)
    } else {
      reflectQuery = reflectQuery.gte('created_at', new Date(Date.now() - FEED_DAYS * 86400000).toISOString())
    }
    const { data: reflects } = await reflectQuery
    if (!reflects?.length) return NextResponse.json({ success: true, feed: [] })
    const reflectById = new Map(reflects.map((reflect) => [reflect.id, reflect]))
    const reflectIds = reflects.map((reflect) => reflect.id)

    const { data: matched } = await supabase.from('reflect_items')
      .select('reflect_id, item_id, position, created_at')
      .eq('user_id', friendId)
      .eq('visible_to_paired', true)
      .in('reflect_id', reflectIds)
      .order('created_at', { ascending: false })
      .order('position', { ascending: true })
      .limit(MAX_ROWS)
    if (!matched?.length) return NextResponse.json({ success: true, feed: [] })

    const { data: memories } = await supabase.from('item_memories')
      .select('reflect_id, item_id, description, refined_desc, raw_excerpt')
      .eq('user_id', friendId)
      .in('reflect_id', [...new Set(matched.map((row) => row.reflect_id))])
    const memoryByKey = new Map((memories || []).map((memory) => [
      `${memory.reflect_id}:${memory.item_id}`,
      memory.description || memory.refined_desc || memory.raw_excerpt,
    ]))

    const mode = profile?.memory_details_mode
      || (profile?.share_memory_details === false ? 'none' : 'custom')
    const entries = new Map()
    for (const row of matched) {
      const reflect = reflectById.get(row.reflect_id)
      if (!reflect) continue
      const detailAllowed = mode === 'all'
        || (mode === 'custom' && reflect.shared_to_friends !== false)
      let entry = entries.get(row.reflect_id)
      if (!entry) {
        entry = {
          friendUserId: friendId,
          friendName: profile?.display_name || 'Friend',
          friendAvatarUrl: profile?.avatar_url || '',
          friendIsDefaultAvatar: profile?.is_default_avatar !== false,
          reflectId: row.reflect_id,
          createdAt: reflect.created_at || row.created_at,
          localDate: reflect.local_date,
          itemIds: [],
          details: detailAllowed ? [] : null,
          sharesDetails: mode !== 'none',
          unread: (reflect.created_at || row.created_at) > (reads?.last_read_at || '1970-01-01T00:00:00Z'),
        }
        entries.set(row.reflect_id, entry)
      }
      entry.itemIds.push(row.item_id)
      const text = memoryByKey.get(`${row.reflect_id}:${row.item_id}`)
      if (entry.details && text) entry.details.push({ itemId: row.item_id, text })
    }
    return NextResponse.json({
      success: true,
      // Preserve the established UX: unread reflections first, then newest.
      feed: [...entries.values()].sort((a, b) => (
        a.unread === b.unread
          ? b.createdAt.localeCompare(a.createdAt)
          : a.unread ? -1 : 1
      )),
    })
  } catch (error) {
    console.error('[friends/feed] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
