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
    const now = new Date()
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('last_active_at, connection_resume_required')
      .eq('id', verified.id).maybeSingle()
    if (profileError) throw profileError
    const previousActiveAt = profile?.last_active_at
      ? new Date(profile.last_active_at).getTime()
      : 0
    const returnedAfterLongAbsence = previousActiveAt > 0
      && previousActiveAt < now.getTime() - 48 * 60 * 60 * 1000
    const { error: updateError } = await supabase.from('profiles').update({
      last_active_at: now.toISOString(),
      connection_resume_required:
        profile?.connection_resume_required === true || returnedAfterLongAbsence,
      ...(timezone ? { timezone_name: timezone } : {}),
    }).eq('id', verified.id)
    if (updateError) throw updateError
    return NextResponse.json({ success: true })
  } catch (err) {
    console.warn('[activity] failed:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
