import { NextResponse } from 'next/server'
import {
  appMajorUpdateServiceClient,
  authenticatedUserId,
  commandStatus,
  majorUpdateEnabled,
} from '@/lib/app-major-update'

export const runtime = 'edge'

const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const params = new URL(request.url).searchParams
    const before = params.get('before'), page = params.get('page')
    if ((before && !validDate(before)) || (page && !uuid(page))) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
    const { data, error } = await db.rpc(page ? 'read_couple_journal_page_v1' : 'couple_journal_snapshot_v1', {
      p_user_id: userId, ...(page ? { p_page_id: page } : { p_before_date: before || null }),
    })
    if (error) throw error
    return NextResponse.json(data?.error ? data : { success: true, ...data }, {
      status: commandStatus(data?.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[vnext/couple-journal:get] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const raw = await request.text()
    if (raw.length > 5000) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    let body
    try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }
    if (!uuid(body?.pageId) || !uuid(body?.idempotencyKey)
      || typeof body?.body !== 'string' || body.body.trim().length < 1 || body.body.trim().length > 1500
      || (body.expectedUpdatedAt != null
        && (typeof body.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(body.expectedUpdatedAt)))))
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
    const { data, error } = await db.rpc('save_couple_journal_answer_v1', {
      p_user_id: userId, p_page_id: body.pageId, p_body: body.body.trim(),
      p_expected_updated_at: body.expectedUpdatedAt || null, p_key: body.idempotencyKey,
    })
    if (error) throw error
    return NextResponse.json(data?.error ? data : { success: true, ...data }, {
      status: commandStatus(data?.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[vnext/couple-journal:post] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
