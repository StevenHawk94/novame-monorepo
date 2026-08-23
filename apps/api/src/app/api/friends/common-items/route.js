import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'
const WINDOW_DAYS = 7
const MAX_ITEMS = 8
const SCAN_ROWS = 400

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = new URL(request.url).searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = serviceClient()
    const { data: pairing } = await supabase.from('pairings').select('partner_user_id')
      .eq('user_id', userId).maybeSingle()
    if (!pairing) return NextResponse.json({ success: true, paired: false, items: [] })
    const partnerId = pairing.partner_user_id
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
    const fetchSide = (uid, partner = false) => {
      let query = supabase.from('reflect_items')
        .select('item_id, reflect_id, match_label, created_at')
        .eq('user_id', uid).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(SCAN_ROWS)
      if (partner) query = query.eq('visible_to_paired', true)
      return query
    }
    const [{ data: mine }, { data: theirs }, { data: partnerProfile }] = await Promise.all([
      fetchSide(userId), fetchSide(partnerId, true),
      supabase.from('profiles').select('share_memory_details, memory_details_mode')
        .eq('id', partnerId).maybeSingle(),
    ])
    const latestBy = (rows) => {
      const map = new Map()
      for (const row of rows || []) if (!map.has(row.item_id)) map.set(row.item_id, row)
      return map
    }
    const myLatest = latestBy(mine)
    const theirLatest = latestBy(theirs)
    const common = [...theirLatest.keys()].filter((id) => myLatest.has(id)).slice(0, MAX_ITEMS)
    if (common.length === 0) return NextResponse.json({ success: true, paired: true, items: [] })

    const reflectIds = [...new Set(common.flatMap((id) => [
      myLatest.get(id).reflect_id, theirLatest.get(id).reflect_id,
    ]))]
    const [{ data: memories }, { data: reflectVisibility }] = await Promise.all([
      supabase.from('item_memories')
        .select('user_id, item_id, reflect_id, description, refined_desc, raw_excerpt')
        .in('user_id', [userId, partnerId]).in('reflect_id', reflectIds),
      supabase.from('reflects').select('id, shared_to_friends').in('id', reflectIds),
    ])
    const memoryByKey = new Map((memories || []).map((row) => [
      `${row.user_id}:${row.reflect_id}:${row.item_id}`,
      row.description || row.refined_desc || row.raw_excerpt,
    ]))
    const visibilityByReflect = new Map((reflectVisibility || []).map((row) => [row.id, row.shared_to_friends !== false]))
    const partnerMode = partnerProfile?.memory_details_mode
      || (partnerProfile?.share_memory_details === false ? 'none' : 'custom')

    const items = common.map((itemId) => {
      const me = myLatest.get(itemId)
      const them = theirLatest.get(itemId)
      const partnerDetailAllowed = partnerMode === 'all'
        || (partnerMode === 'custom' && visibilityByReflect.get(them.reflect_id) !== false)
      return {
        itemId,
        mine: {
          text: memoryByKey.get(`${userId}:${me.reflect_id}:${itemId}`) || me.match_label || '',
          reflectId: me.reflect_id,
          createdAt: me.created_at,
        },
        partner: {
          text: partnerDetailAllowed
            ? memoryByKey.get(`${partnerId}:${them.reflect_id}:${itemId}`) || null
            : null,
          createdAt: them.created_at,
        },
      }
    })
    return NextResponse.json({ success: true, paired: true, items })
  } catch (error) {
    console.error('[friends/common-items] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
