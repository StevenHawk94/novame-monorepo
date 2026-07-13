import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/master/visit?userId=xxx&id=yyy
 *
 * A single past consultation in full: the question and the six-module response.
 * Owner-only (RLS also enforces this). Backs the history detail screen.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const id = searchParams.get('id')
    if (!userId || !id) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

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

    const { data: visit } = await supabase
      .from('master_visits')
      .select('id, question, response, created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!visit) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({
      success: true,
      visit: {
        id: visit.id,
        question: visit.question,
        response: visit.response,
        createdAt: visit.created_at,
      },
    })
  } catch (err) {
    console.error('[master/visit] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
