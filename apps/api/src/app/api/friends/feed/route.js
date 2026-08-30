import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'

const PAGE_SIZE = 6
const REFLECT_SCAN_SIZE = 24
const DB_PAGE_SIZE = 1000

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
const validTimestamp = (value) => value && Number.isFinite(Date.parse(value)) ? value : null
const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')
  ? value : null

async function allVisibleItems(supabase, friendId, reflectIds) {
  const rows = []
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase.from('reflect_items')
      .select('reflect_id, item_id, position, created_at')
      .eq('user_id', friendId).eq('visible_to_paired', true).in('reflect_id', reflectIds)
      .order('reflect_id', { ascending: true }).order('position', { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < DB_PAGE_SIZE) return rows
  }
}

async function allMemories(supabase, friendId, reflectIds) {
  const rows = []
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase.from('item_memories')
      .select('reflect_id, item_id, description, refined_desc, raw_excerpt')
      .eq('user_id', friendId).in('reflect_id', reflectIds)
      .order('reflect_id', { ascending: true }).order('item_id', { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < DB_PAGE_SIZE) return rows
  }
}

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const start = validDate(searchParams.get('start'))
    const end = validDate(searchParams.get('end'))
    const requestedStart = searchParams.get('start')
    const requestedEnd = searchParams.get('end')
    const beforeCreatedAt = validTimestamp(searchParams.get('beforeCreatedAt'))
    const requestedBeforeId = searchParams.get('beforeId')
    const beforeId = validUuid(requestedBeforeId)
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((requestedStart && !start) || (requestedEnd && !end) || (start && end && start > end)) {
      return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 })
    }
    if (searchParams.get('beforeCreatedAt') && !beforeCreatedAt) {
      return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 })
    }
    if (requestedBeforeId && !beforeId) {
      return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: pairing, error: pairingError } = await supabase.from('pairings').select('partner_user_id')
      .eq('user_id', userId).maybeSingle()
    if (pairingError) throw pairingError
    if (!pairing?.partner_user_id) return NextResponse.json({ success: true, feed: [], hasMore: false })
    const friendId = pairing.partner_user_id
    const [{ data: profile, error: profileError }, { data: reads, error: readsError }] = await Promise.all([
      supabase.from('profiles')
        .select('display_name, share_memory_details, memory_details_mode, avatar_url, is_default_avatar')
        .eq('id', friendId).maybeSingle(),
      supabase.from('friend_feed_reads').select('last_read_at')
        .eq('user_id', userId).eq('friend_user_id', friendId).maybeSingle(),
    ])
    if (profileError || readsError) throw profileError || readsError

    // Scan until seven visible reflections are found (six plus a hasMore
    // sentinel). Fully-hidden rows are skipped, but history itself has no cap.
    // Once a page is selected, every visible item for each reflect is returned.
    const visible = []
    let cursorCreatedAt = beforeCreatedAt
    let cursorId = beforeId
    let exhausted = false
    while (visible.length < PAGE_SIZE + 1 && !exhausted) {
      let reflectQuery = supabase.from('reflects')
        .select('id, local_date, created_at, shared_to_friends')
        .eq('user_id', friendId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(REFLECT_SCAN_SIZE)
      if (start) reflectQuery = reflectQuery.gte('local_date', start)
      if (end) reflectQuery = reflectQuery.lte('local_date', end)
      if (cursorCreatedAt && cursorId) {
        reflectQuery = reflectQuery.or(
          `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`,
        )
      } else if (cursorCreatedAt) {
        reflectQuery = reflectQuery.lt('created_at', cursorCreatedAt)
      }
      const { data: reflects, error: reflectsError } = await reflectQuery
      if (reflectsError) throw reflectsError
      if (!reflects?.length) break
      exhausted = reflects.length < REFLECT_SCAN_SIZE
      const last = reflects[reflects.length - 1]
      cursorCreatedAt = last.created_at
      cursorId = last.id
      const reflectIds = reflects.map((reflect) => reflect.id)
      const matched = await allVisibleItems(supabase, friendId, reflectIds)
      const itemsByReflect = new Map()
      for (const row of matched || []) {
        const rows = itemsByReflect.get(row.reflect_id) || []
        rows.push(row)
        itemsByReflect.set(row.reflect_id, rows)
      }
      for (const reflect of reflects) {
        const items = itemsByReflect.get(reflect.id)
        if (items?.length) visible.push({ reflect, items })
        if (visible.length >= PAGE_SIZE + 1) break
      }
    }
    const hasMore = visible.length > PAGE_SIZE
    const page = visible.slice(0, PAGE_SIZE)
    if (!page.length) return NextResponse.json({ success: true, feed: [], hasMore: false })
    const pageReflectIds = page.map(({ reflect }) => reflect.id)
    const memories = await allMemories(supabase, friendId, pageReflectIds)
    const memoryByKey = new Map((memories || []).map((memory) => [
      `${memory.reflect_id}:${memory.item_id}`,
      memory.description || memory.refined_desc || memory.raw_excerpt,
    ]))

    const mode = profile?.memory_details_mode
      || (profile?.share_memory_details === false ? 'none' : 'custom')
    const feed = page.map(({ reflect, items }) => {
      const detailAllowed = mode === 'all'
        || (mode === 'custom' && reflect.shared_to_friends !== false)
      const details = detailAllowed ? items.flatMap((item) => {
        const text = memoryByKey.get(`${reflect.id}:${item.item_id}`)
        return text ? [{ itemId: item.item_id, text }] : []
      }) : null
      return {
        friendUserId: friendId,
        friendName: profile?.display_name || 'Friend',
        friendAvatarUrl: profile?.avatar_url || '',
        friendIsDefaultAvatar: profile?.is_default_avatar !== false,
        reflectId: reflect.id,
        createdAt: reflect.created_at || items[0]?.created_at,
        localDate: reflect.local_date,
        itemIds: items.map((item) => item.item_id),
        details,
        sharesDetails: mode !== 'none',
        unread: (reflect.created_at || items[0]?.created_at) > (reads?.last_read_at || '1970-01-01T00:00:00Z'),
      }
    })
    const lastPageReflect = page[page.length - 1]?.reflect
    return NextResponse.json({
      success: true,
      feed,
      hasMore,
      nextBeforeCreatedAt: hasMore ? lastPageReflect?.created_at || null : null,
      nextBeforeId: hasMore ? lastPageReflect?.id || null : null,
    })
  } catch (error) {
    console.error('[friends/feed] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
