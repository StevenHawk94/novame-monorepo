import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { matchItems, ITEM_DICTIONARY } from '@novame/engine'

export const runtime = 'edge'

const MAX_TEXT = 3000

function pairOf(a, b) {
  return a < b ? [a, b] : [b, a]
}

async function requireAcceptedFriendship(supabase, userId, friendId) {
  const [a, b] = pairOf(userId, friendId)
  const { data } = await supabase
    .from('friendships')
    .select('id')
    .eq('user_a', a).eq('user_b', b).eq('status', 'accepted')
    .maybeSingle()
  return !!data
}

/**
 * The shared memory box (PRD 6.3) — one box per friend pair.
 *
 * GET  ?userId=&friendUserId=      → the pair's items, newest first
 * POST { userId, friendUserId, text } → Create flow: the free text runs
 *      through the ITEM rule matcher (same engine as Reflect) and every hit
 *      lands in the box with its excerpt as the description. Both members
 *      can add; only accepted friends have a box at all (server-checked —
 *      a forged pair id reads as not_friends, never as an empty box).
 *
 * Plus's AI-refined descriptions arrive in a later pass; the rule-matched
 * excerpt is the baseline for every tier (PRD: 非 Plus 也匹配物品).
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const friendUserId = searchParams.get('friendUserId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId) return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    if (!(await requireAcceptedFriendship(supabase, userId, friendUserId))) {
      return NextResponse.json({ error: 'not_friends' }, { status: 403 })
    }

    const [a, b] = pairOf(userId, friendUserId)
    const [{ data }, { data: cursor }] = await Promise.all([
      supabase.from('shared_memory_items')
        .select('id, author_user_id, item_id, description, source, created_at')
        .eq('user_a', a).eq('user_b', b)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('shared_memory_reads').select('read_at')
        .eq('user_id', userId).eq('partner_user_id', friendUserId).maybeSingle(),
    ])
    const readAt = cursor?.read_at ? Date.parse(cursor.read_at) : 0
    const hasUnreadFromPartner = (data || []).some((item) =>
      item.author_user_id === friendUserId && Date.parse(item.created_at) > readAt)
    const readThrough = (data || []).reduce((latest, item) =>
      Date.parse(item.created_at) > Date.parse(latest) ? item.created_at : latest,
    cursor?.read_at || '1970-01-01T00:00:00.000Z')
    return NextResponse.json({ success: true, items: data || [], hasUnreadFromPartner, readThrough })
  } catch (err) {
    console.error('[friends/box] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, friendUserId, text, action, readThrough } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId) return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    if (!(await requireAcceptedFriendship(supabase, userId, friendUserId))) {
      return NextResponse.json({ error: 'not_friends' }, { status: 403 })
    }

    if (action === 'read') {
      const requested = typeof readThrough === 'string' && Number.isFinite(Date.parse(readThrough))
        ? readThrough : new Date().toISOString()
      const { data: current } = await supabase.from('shared_memory_reads').select('read_at')
        .eq('user_id', userId).eq('partner_user_id', friendUserId).maybeSingle()
      const effective = current?.read_at && Date.parse(current.read_at) > Date.parse(requested)
        ? current.read_at : requested
      const { error } = await supabase.from('shared_memory_reads').upsert({
        user_id: userId, partner_user_id: friendUserId, read_at: effective,
      }, { onConflict: 'user_id,partner_user_id' })
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'empty_text' }, { status: 400 })
    }

    const matches = matchItems(text.trim().slice(0, MAX_TEXT), ITEM_DICTIONARY)
    if (matches.length === 0) {
      return NextResponse.json({ success: true, created: [] })
    }

    const [a, b] = pairOf(userId, friendUserId)
    const rows = matches.map((m) => ({
      user_a: a,
      user_b: b,
      author_user_id: userId,
      item_id: m.itemId,
      description: m.label,
      source: 'manual',
    }))
    const { data: inserted, error } = await supabase
      .from('shared_memory_items')
      .insert(rows)
      .select('id, item_id, description, created_at')
    if (error) {
      console.error('[friends/box] insert error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, created: inserted || [] })
  } catch (err) {
    console.error('[friends/box] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
