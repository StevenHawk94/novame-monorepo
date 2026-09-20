import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const status = new URL(request.url).searchParams.get('status') || 'pending'
  if (!['pending', 'covered', 'ignored', 'all'].includes(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }
  let query = db().from('connection_unmatched_events').select('*')
    .order('occurrence_count', { ascending: false }).order('last_seen_at', { ascending: false }).limit(300)
  if (status !== 'all') query = query.eq('status', status)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, events: data || [] }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const input = await request.json()
  if (!input?.id || !['pending', 'covered', 'ignored'].includes(input?.status)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const { error } = await db().from('connection_unmatched_events')
    .update({ status: input.status }).eq('id', input.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
