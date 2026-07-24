import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/reflect/visibility { userId, reflectId, visible }
 *
 * The result page's bottom toggle (2026-07-24 design): whether the paired
 * partner (and friends) can see this reflect's memory DETAILS. Item icons
 * stay visible either way — the flag only gates excerpts/details on the
 * friend surfaces (feed details, reflect detail). Defaults to true at submit;
 * this flips it after the fact.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, reflectId, visible } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!reflectId || typeof visible !== 'boolean') {
      return NextResponse.json({ error: 'Missing reflectId or visible' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { error, count } = await supabase
      .from('reflects')
      .update({ shared_to_friends: visible }, { count: 'exact' })
      .eq('id', reflectId)
      .eq('user_id', userId)
    if (error) {
      console.error('[reflect/visibility] update error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true, visible })
  } catch (err) {
    console.error('[reflect/visibility] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
