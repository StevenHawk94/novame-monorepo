import { NextResponse } from 'next/server'
import { EXPIRABLE_STATUSES, courtServiceClient, processCourtVerdictJob } from '@/lib/bunny-court'

export const runtime = 'edge'

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = courtServiceClient()
  const now = new Date().toISOString()
  await supabase.from('court_sessions').update({ status: 'expired', updated_at: now })
    .in('status', EXPIRABLE_STATUSES).lt('expires_at', now)
  await supabase.from('court_verdict_jobs').update({
    status: 'retry', locked_at: null, next_attempt_at: now, last_error: 'stale_claim_recovered', updated_at: now,
  }).eq('status', 'processing').lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
  const { data: jobs, error } = await supabase.from('court_verdict_jobs').select('session_id')
    .in('status', ['pending', 'retry']).lte('next_attempt_at', now).order('created_at').limit(10)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const results = []
  for (const job of jobs || []) {
    try { results.push({ sessionId: job.session_id, ok: Boolean(await processCourtVerdictJob(supabase, job.session_id)) }) }
    catch (jobError) { results.push({ sessionId: job.session_id, ok: false, error: String(jobError?.message || jobError) }) }
  }
  return NextResponse.json({ success: true, processed: results.length, results })
}
