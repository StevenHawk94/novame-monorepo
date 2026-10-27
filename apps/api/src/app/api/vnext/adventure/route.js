import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus } from '@/lib/app-major-update'
import { readAdventureDisplay } from '@/lib/adventure-bootstrap.mjs'
import { teamCapable } from '@/lib/bunny-adventure-contract.mjs'
import { securityRateLimit, securityFailure } from '@/lib/security-boundary'

export const runtime = 'edge'
export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (request.nextUrl.searchParams.get('coordination') === '1') {
      if (!teamCapable(request)) return NextResponse.json({ error: 'client_upgrade_required' }, { status: 426 })
      const db = appMajorUpdateServiceClient()
      await securityRateLimit(db, request, userId, 'adventure-coordination', 30, 60)
      // Same service-only eligibility snapshot as Bootstrap: no log, private
      // story, inventory, wallet, settlement or new Start side effects.
      const { data, error } = await db.rpc('adventure_team_snapshot_v1', { p_user: userId })
      if (error || data?.userId !== userId) throw new Error('coordination_unavailable')
      return NextResponse.json({ success: true, serverNow: new Date().toISOString(), adventureTeam: data }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    const id = request.nextUrl.searchParams.get('adventureId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''))
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const display = await readAdventureDisplay(appMajorUpdateServiceClient(), userId, id)
    if (!display) return NextResponse.json({ error: 'display_unavailable' }, { status: 503 })
    return NextResponse.json(display.error ? display : { success: true, ...display }, {
      status: commandStatus(display.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    // Preserve the existing display endpoint's 500 contract; typed limiter /
    // authentication failures retain their explicit safe status and headers.
    if (error?.status) return securityFailure(error)
    console.error('[adventure/display]', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
