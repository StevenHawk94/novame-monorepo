import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/friends/read   Body: { userId, friendUserId }
 *
 * Moves the unread cursor for one friend to now (the user opened that
 * friend's entry). Idempotent upsert; no reward attached, so no gating.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, friendUserId } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId) return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { error } = await supabase
      .from('friend_feed_reads')
      .upsert(
        { user_id: userId, friend_user_id: friendUserId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,friend_user_id' },
      )
    if (error) {
      console.error('[friends/read] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[friends/read] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
