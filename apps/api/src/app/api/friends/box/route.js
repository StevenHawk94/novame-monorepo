import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function pairOf(a, b) {
  return a < b ? [a, b] : [b, a]
}

async function requireActivePairing(supabase, userId, friendId) {
  const { data } = await supabase
    .from('pairings')
    .select('partner_user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.partner_user_id === friendId
}

/**
 * The shared memory box (PRD 6.3) — one box per friend pair.
 *
 * GET  ?userId=&friendUserId=      → the pair's items, newest first
 * POST action=read updates the unread cursor. Creation intentionally goes
 * through /api/reflect so shared memories obey the same daily limit, rewards,
 * consent, and tier rules as every other Reflect path.
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
    if (!(await requireActivePairing(supabase, userId, friendUserId))) {
      return NextResponse.json({ error: 'not_paired' }, { status: 403 })
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
    const { userId, friendUserId, action, readThrough } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId) return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    if (!(await requireActivePairing(supabase, userId, friendUserId))) {
      return NextResponse.json({ error: 'not_paired' }, { status: 403 })
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

    return NextResponse.json({ error: 'unsupported_action' }, { status: 400 })
  } catch (err) {
    console.error('[friends/box] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
