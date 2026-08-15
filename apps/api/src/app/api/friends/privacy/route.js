import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET/POST /api/friends/privacy
 *
 * The single privacy switch behind the Friends page gear (PRD 6.2 / visual
 * spec): whether MY memory details (excerpts/refined descriptions) are
 * visible to my accepted friends. Default true (2026-08-10 ruling) — the
 * per-reflect toggle on the reward screen is the opt-out surface.
 * GET reads it; POST { userId, share } sets it.
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data } = await supabase
      .from('profiles').select('share_memory_details, memory_details_mode').eq('id', userId).maybeSingle()
    const mode = data?.memory_details_mode || (data?.share_memory_details === false ? 'none' : 'custom')
    return NextResponse.json({ success: true, share: mode !== 'none', mode })
  } catch (err) {
    console.error('[friends/privacy] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, share, mode: requestedMode } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const mode = ['all', 'none', 'custom'].includes(requestedMode)
      ? requestedMode
      : share === false ? 'none' : 'custom'
    const { error } = await supabase
      .from('profiles')
      .update({ share_memory_details: mode !== 'none', memory_details_mode: mode })
      .eq('id', userId)
    if (error) {
      console.error('[friends/privacy] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    // A changed visibility policy must not leave an AI brief generated from
    // now-hidden reflections in either person's daily cache.
    await supabase.from('connection_insights').delete()
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    return NextResponse.json({ success: true, share: mode !== 'none', mode })
  } catch (err) {
    console.error('[friends/privacy] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
