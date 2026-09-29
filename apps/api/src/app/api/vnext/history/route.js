import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus } from '@/lib/app-major-update'
export const runtime = 'edge'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const q = new URL(request.url).searchParams
    const kind = q.get('kind'), partner = q.get('partner'), at = q.get('before'), id = q.get('id'), date = q.get('date')
    if (!['moments', 'memories'].includes(kind) || !uuid.test(partner || '')
      || !!at !== !!id || (id && !uuid.test(id))
      || (at && (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at))))
      || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date))) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    const { data, error } = await appMajorUpdateServiceClient().rpc('burrow_history_v1', {
      p_user_id: userId, p_partner_id: partner, p_kind: kind, p_before: at, p_before_id: id, p_date: date,
    })
    if (error) throw error
    return NextResponse.json(data?.error ? data : { success: true, ...data }, {
      status: commandStatus(data?.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch { return NextResponse.json({ error: 'history_unavailable' }, { status: 503 }) }
}
