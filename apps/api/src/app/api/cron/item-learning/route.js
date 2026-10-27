import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
/** Stale invocations cannot claim or change historical jobs. */
export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ error: 'keyword_matching_retired' }, { status: 410 })
}
