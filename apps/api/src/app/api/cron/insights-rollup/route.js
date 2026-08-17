import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mergeConnectionCandidatePayload } from '@/lib/reflect-analysis-store'

export const runtime = 'nodejs'
export const maxDuration = 300

function localDate(timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
  catch { return new Date().toISOString().slice(0, 10) }
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: candidates, error } = await supabase.from('connection_update_candidates').select('*')
    .eq('status', 'pending').order('created_at', { ascending: true }).limit(500)
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  const groups = new Map()
  for (const row of candidates || []) {
    const key = `${row.writer_user_id}:${row.for_user}:${row.writer_local_date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  let applied = 0
  for (const rows of groups.values()) {
    const first = rows[0]
    const { data: writer } = await supabase.from('profiles').select('timezone_name').eq('id', first.writer_user_id).maybeSingle()
    if (first.writer_local_date >= localDate(writer?.timezone_name)) continue
    const [ua, ub] = first.writer_user_id < first.for_user
      ? [first.writer_user_id, first.for_user] : [first.for_user, first.writer_user_id]
    const { data: prior } = await supabase.from('connection_insights').select('payload')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', first.for_user)
      .order('for_date', { ascending: false }).limit(1).maybeSingle()
    let payload = prior?.payload || {}
    payload = mergeConnectionCandidatePayload(payload, rows)
    await supabase.from('connection_insights').upsert({
      user_a: ua, user_b: ub, for_user: first.for_user,
      for_date: localDate(), payload, created_at: new Date().toISOString(),
    }, { onConflict: 'user_a,user_b,for_date,for_user' })
    await supabase.from('connection_update_candidates').update({ status: 'applied', applied_at: new Date().toISOString() })
      .in('id', rows.map((row) => row.id))
    applied += rows.length
  }
  return NextResponse.json({ ok: true, applied })
}
