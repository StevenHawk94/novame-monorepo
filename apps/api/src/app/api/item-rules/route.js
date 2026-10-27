import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
export const runtime = 'nodejs'
/** Compatibility tombstone: no rules, journals or database client. */
export async function GET(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!await verifyToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ error: 'keyword_matching_retired' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } })
}
