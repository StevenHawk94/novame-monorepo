import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export const runtime = 'edge'

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const timezone = typeof body.timezone === 'string' && body.timezone.length <= 100
      ? body.timezone : null
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    await supabase.from('profiles').update({
      last_active_at: new Date().toISOString(),
      ...(timezone ? { timezone_name: timezone } : {}),
    }).eq('id', verified.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.warn('[activity] failed:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

