import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/skills?userId=xxx
 *
 * The Skills tab's data: the lessons the user has collected, newest first, with
 * their dimension and rarity. source 'self' are the user's own ("learned");
 * 'friend' are taught by friends (a separate count in the UI). Both are returned
 * here; the client splits them.
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

    const { data, error } = await supabase
      .from('skills')
      .select('id, dimension, title, body, rarity, source, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[skills] error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const skills = (data || []).map((s) => ({
      skillId: s.id,
      dimension: s.dimension,
      title: s.title,
      body: s.body,
      rarity: s.rarity,
      source: s.source,
      createdAt: s.created_at,
    }))

    return NextResponse.json({ success: true, skills })
  } catch (err) {
    console.error('[skills] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
