import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/reflect-feed?userId=xxx
 *
 * The user's OWN Reflect Feed (Bags' second view): their reflections grouped by
 * day, each day with the items collected that day. This is private -- friends
 * never see it; they only see the emoji glimpse (that's the whole social-
 * distance design). Returns the most recent ~30 days.
 *
 * Each day: the reflect bodies (the user's own words, shown only to them) and
 * the item ids collected, so the client can render the day's summary + emoji
 * row. Grouping is by reflects.local_date (the device-local day the reflection
 * belongs to).
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

    const { data: reflects } = await supabase
      .from('reflects')
      .select('id, body, local_date, created_at, shared_to_friends')
      .eq('user_id', userId)
      .order('local_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(90)

    // All matched/selected items belong in the private log, even when the
    // user deliberately left their memory description blank.
    const reflectIds = (reflects || []).map((r) => r.id)
    const itemsByReflect = {}
    if (reflectIds.length > 0) {
      const { data: mems } = await supabase
        .from('reflect_items')
        .select('reflect_id, item_id, position')
        .eq('user_id', userId)
        .in('reflect_id', reflectIds)
        .order('position', { ascending: true })
      for (const m of mems || []) {
        if (!itemsByReflect[m.reflect_id]) itemsByReflect[m.reflect_id] = []
        itemsByReflect[m.reflect_id].push(m.item_id)
      }
    }

    // Group by local_date.
    const byDay = new Map()
    for (const r of reflects || []) {
      if (!byDay.has(r.local_date)) {
        byDay.set(r.local_date, { date: r.local_date, reflects: [], itemIds: [] })
      }
      const day = byDay.get(r.local_date)
      const reflectionItemIds = itemsByReflect[r.id] || []
      day.reflects.push({
        id: r.id,
        body: r.body,
        sharedToFriends: r.shared_to_friends !== false,
        itemIds: reflectionItemIds,
      })
      for (const itemId of reflectionItemIds) day.itemIds.push(itemId)
    }

    const days = [...byDay.values()].slice(0, 30)
    return NextResponse.json({ success: true, days })
  } catch (err) {
    console.error('[reflect-feed] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
