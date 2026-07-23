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
    const { data } = await supabase
      .from('shared_memory_items')
      .select('id, author_user_id, item_id, description, source, created_at')
      .eq('user_a', a).eq('user_b', b)
      .order('created_at', { ascending: false })
      .limit(200)
    return NextResponse.json({ success: true, items: data || [] })
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
    const { userId, friendUserId, text } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId) return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'empty_text' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    if (!(await requireAcceptedFriendship(supabase, userId, friendUserId))) {
      return NextResponse.json({ error: 'not_friends' }, { status: 403 })
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
