import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { DIMENSION_IDS } from '@novame/domain'

export const runtime = 'edge'

/**
 * GET /api/status?userId=xxx
 *
 * Retired Growth Gems compatibility endpoint. Current clients no longer call
 * it; returning a stable zero map prevents an installed older client from
 * failing while avoiding any dependency on the removed gem tables.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const byDimension = {}
    for (const id of DIMENSION_IDS) byDimension[id] = 0

    return NextResponse.json({ success: true, dimensions: byDimension })
  } catch (err) {
    console.error('[status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
