import { NextResponse } from 'next/server'
import { majorUpdateEnabled } from '@/lib/app-major-update'
import { serviceClient } from '@/lib/reflect-draft'
import { processReflectAnalysisJobs } from '@/lib/reflect-analysis-jobs'
import { sendPendingConnectionOutputAlert } from '@/lib/connection-output-monitor'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  if (await majorUpdateEnabled(supabase)) return NextResponse.json({ ok: true, paused: true, processed: 0, originalityAlertSent: false })
  const results = await processReflectAnalysisJobs({ supabase })
  const alert = await sendPendingConnectionOutputAlert(supabase)
  return NextResponse.json({
    ok: true,
    processed: results.length,
    completed: results.filter((row) => ['completed', 'no_update', 'skipped'].includes(row.status)).length,
    failed: results.filter((row) => row.status === 'failed').length,
    originalityAlertSent: alert.sent === true,
  })
}
