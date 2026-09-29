import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus } from '@/lib/app-major-update'
import { unpairedBurrowBootstrap } from '@/lib/burrow-unpaired-bootstrap.mjs'

export const runtime = 'edge'

export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Hold the reciprocal pairing lock throughout the snapshot. Service-role
    // queries must never assemble stale, partly unpaired private data.
    const db = appMajorUpdateServiceClient()
    const { data, error } = await db
      .rpc('burrow_bootstrap_v1', { p_user_id: userId })
    if (error) throw error
    const snapshot = data?.error === 'not_paired' ? await unpairedBurrowBootstrap(db, userId) : data
    return NextResponse.json(snapshot?.error ? snapshot : { success: true, ...snapshot }, {
      status: commandStatus(snapshot?.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[vnext/bootstrap] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
