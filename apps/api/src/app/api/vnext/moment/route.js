import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus } from '@/lib/app-major-update'
export const runtime = 'edge'
export async function GET(request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    const id = new URL(request.url).searchParams.get('id')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''))
      return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    const { data, error } = await appMajorUpdateServiceClient().rpc('burrow_moment_detail_v1', { p_user_id: userId, p_event_id: id })
    if (error) throw error
    return NextResponse.json(data?.error ? data : { success: true, ...data }, { status: commandStatus(data?.error), headers })
  } catch { return NextResponse.json({ error: 'moment_unavailable' }, { status: 503, headers }) }
}
