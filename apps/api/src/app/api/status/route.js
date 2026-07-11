import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { DIMENSION_IDS } from '@novame/domain'

export const runtime = 'edge'

/**
 * GET /api/status?userId=xxx
 *
 * The Status tab's data: the user's gem total per dimension. Returns the
 * authoritative numbers only -- stage is a pure function of these, computed
 * client-side with the shared engine (gemStage), so it can never drift and
 * doesn't need a round-trip.
 *
 * Always returns all eight dimensions. user_gems only has a row once a
 * dimension has been credited, so the missing ones are filled with 0 here --
 * the screen renders a complete eight-item grid regardless.
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

    const { data: rows, error } = await supabase
      .from('user_gems')
      .select('dimension, total')
      .eq('user_id', userId)
    if (error) {
      console.error('[status] user_gems error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const byDimension = {}
    for (const id of DIMENSION_IDS) byDimension[id] = 0
    for (const row of rows || []) {
      if (row.dimension in byDimension) {
        byDimension[row.dimension] = Number(row.total) || 0
      }
    }

    return NextResponse.json({ success: true, dimensions: byDimension })
  } catch (err) {
    console.error('[status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
