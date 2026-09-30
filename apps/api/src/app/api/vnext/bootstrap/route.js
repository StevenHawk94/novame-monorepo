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
    let snapshot = data?.error === 'not_paired' ? await unpairedBurrowBootstrap(db, userId) : data
    // A personal adventure can still be running when someone connects. Keep
    // that journey visible and claimable; a new pair does not transfer it to
    // the partner or silently discard the saved record.
    if (snapshot && !snapshot.error && snapshot.partner && !snapshot.activeAdventure) {
      const solo = await db.from('adventures').select('*').eq('user_id', userId).eq('partner_id', userId)
        .in('status', ['in_progress', 'result_ready', 'interaction_required'])
        .order('created_at', { ascending: false }).limit(1)
      if (solo.error) throw solo.error
      if (solo.data?.[0]) {
        const activeAdventure = solo.data[0]
        const result = await db.from('adventure_results').select('*').eq('adventure_id', activeAdventure.id).maybeSingle()
        if (result.error) throw result.error
        snapshot = { ...snapshot, activeAdventure, adventureResult: result.data || null, dailyAdventureUsed: true }
      }
    }
    return NextResponse.json(snapshot?.error ? snapshot : { success: true, ...snapshot }, {
      status: commandStatus(snapshot?.error), headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[vnext/bootstrap] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
