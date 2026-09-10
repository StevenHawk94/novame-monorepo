import { NextResponse } from 'next/server'
import { serviceClient } from '@/lib/reflect-draft'
import { processReflectAnalysisJobs } from '@/lib/reflect-analysis-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const results = await processReflectAnalysisJobs({ supabase: serviceClient() })
  return NextResponse.json({
    ok: true,
    processed: results.length,
    completed: results.filter((row) => ['completed', 'no_update', 'skipped'].includes(row.status)).length,
    failed: results.filter((row) => row.status === 'failed').length,
  })
}
