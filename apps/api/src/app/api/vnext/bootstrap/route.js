import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus } from '@/lib/app-major-update'
import { unpairedBurrowBootstrap } from '@/lib/burrow-unpaired-bootstrap.mjs'
import { readRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
import { readBurrowAttention } from '@/lib/burrow-attention.mjs'
import { settleBootstrapAdventure } from '@/lib/adventure-bootstrap.mjs'
import { projectFriendVisitBootstrap } from '@/lib/burrow-friend-visits.mjs'
import { readShopGiftCatalog } from '@/lib/burrow-shop-gifts.mjs'
import { projectShopCatalog } from '@/lib/shop-catalog-release.mjs'
import {personalRooms} from '@/lib/personal-room-contract.mjs'
import {projectEconomicCalendar} from '@/lib/economic-calendar-contract.mjs'
import {readCharacterState} from '@/lib/bunny-adventure-contract.mjs'

// Regional Fluid compute reuses the Node runtime/JWKS and outbound connections
// instead of fanning this database-heavy read across global edge isolates.
export const runtime = 'nodejs'
// Supabase lives in us-west-2. Run the database-heavy Home read beside it,
// not beside each visitor (which multiplied trans-Pacific round trips).
export const preferredRegion = 'pdx1'

let requestCount = 0
// Request-local numeric diagnostics only: no identity, token, SQL or content.
// "first" means first invocation of this module, not a measured cold-start.
function requestTiming() {
  const start = Date.now(), samples = [], first = ++requestCount === 1
  return {
    async read(name, work) {
      const before = Date.now()
      try { return await work() } finally { samples.push(`${name};dur=${Date.now() - before}`) }
    },
    headers() {
      return { 'Cache-Control': 'no-store', 'Server-Timing': [
        ...samples, `app;dur=${Date.now() - start}`, `invocation;desc="${first ? 'first' : 'warm'}"`,
      ].join(', ') }
    },
  }
}

// Only display supplements are optional. The authenticated, pair-scoped core
// (including catalogue, entitlement and wallet) must still succeed atomically.
// Bound the wait even when a transport ignores AbortSignal; late reads never
// mutate the returned snapshot or perform financial writes.
async function supplement(read) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => read(controller.signal)).then(result => {
        if (result?.error) return undefined
        return result
      }).catch(() => undefined),
      new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 1200) }),
    ])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
const boundedQuery = (query, signal) => typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query

export async function GET(request) {
  const timing = requestTiming()
  try {
    const userId = await timing.read('auth', () => authenticatedUserId(request))
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: timing.headers() })
    // The core RPC owns the reciprocal pairing lock and authorization. Optional
    // reads must not substitute for that core or grant transaction permissions.
    const db = appMajorUpdateServiceClient()
    const { data, error } = await timing.read('core', () => db
      .rpc(personalRooms(request)?'burrow_bootstrap_v2':'burrow_bootstrap_v1', { p_user_id: userId }))
    if (error) throw error
    let snapshot = data?.error === 'not_paired' ? await timing.read('solo', () => unpairedBurrowBootstrap(db, userId)) : data
    if(snapshot&&!snapshot.error&&personalRooms(request))snapshot={...snapshot,roomModel:'personal-v2'}
    snapshot = projectFriendVisitBootstrap(snapshot, request.nextUrl?.searchParams?.get('friendVisits') === '2')
    // A personal adventure can still be running when someone connects. Keep
    // that journey visible and claimable; a new pair does not transfer it to
    // the partner or silently discard the saved record.
    if (snapshot && !snapshot.error && snapshot.partner && !snapshot.activeAdventure) {
      const solo = await timing.read('personal_adventure', () => db.from('adventures').select('*').eq('user_id', userId).eq('partner_id', userId)
        .in('status', ['in_progress', 'result_ready', 'interaction_required'])
        .order('created_at', { ascending: false }).limit(1))
      if (solo.error) throw solo.error
      if (solo.data?.[0]) {
        const activeAdventure = solo.data[0]
        const result = await db.from('adventure_results').select('*').eq('adventure_id', activeAdventure.id).maybeSingle()
        if (result.error) throw result.error
        snapshot = { ...snapshot, activeAdventure, adventureResult: result.data || null, dailyAdventureUsed: true }
      }
    }
    // Repair a planned journey previously settled by the nested legacy Home
    // bootstrap, and settle due solo journeys before showing the completion UI.
    // No click performs catalogue selection or fetches the missing dialogue.
    snapshot = await timing.read('settlement', () => settleBootstrapAdventure(db, userId, snapshot))
    // Run optional counters alongside the existing supplementary reads, not
    // after them. Keep one bounded supplementary window after the core read.
    const attentionRead = snapshot && !snapshot.error ? supplement(signal => readBurrowAttention(db, userId, snapshot, signal,request.headers?.get?.('x-burrow-journal')==='2')) : Promise.resolve(null)
    if (snapshot && !snapshot.error) {
      // Independent supplementary reads share ONE round trip window. Care
      // used to block bonus/collection/wallet/photo reads from even starting.
      const [bonus, collection, coinState, photoUsage, care, giftCatalog, character] = await timing.read('supplements', () => Promise.all([
        supplement(signal => boundedQuery(db.rpc('daily_plus_bonus_state_v1', { p_user_id: userId }), signal)),
        supplement(signal => boundedQuery(db.rpc('adventure_collection_v2', { p_user_id: userId }), signal)),
        supplement(signal => readRewardWallet(db, userId, signal)),
        supplement(signal => boundedQuery(db.rpc('burrow_photo_usage_v1', { p_user: userId }), signal)),
        // Separate from the capped activity feed: busy couples can have more
        // than 50 moments within twelve hours.
        supplement(signal => Promise.all(['food', 'water'].map(need => boundedQuery(db.from('moment_events')
          .select('created_at').eq('target_id', userId).eq('event_type', 'room_need_refilled')
          .contains('payload', { need }).order('created_at', { ascending: false }).limit(1), signal))).then(results =>
            results.some(result => result.error) ? undefined : results)),
        supplement(signal => readShopGiftCatalog(db, snapshot, signal)),
        supplement(() => readCharacterState(db,userId,snapshot,request)),
      ]))
      if (care) snapshot = { ...snapshot, lastCareAt: { food: care[0].data?.[0]?.created_at || null,
        water: care[1].data?.[0]?.created_at || null } }
      // Missing metadata stays missing, never a fabricated Free/zero/unlimited
      // state. Clients may retain same-day, same-pair confirmed display values;
      // every claim, upload and purchase is still checked by its writer RPC.
      if (bonus?.data && !bonus.data.error) snapshot = { ...snapshot, dailyPlusBonus: bonus.data }
      if (collection?.data && !collection.data.error) snapshot = { ...snapshot, adventureCollection: collection.data }
      if (coinState) snapshot = { ...snapshot, wallet: coinState.wallet, coinState }
      if (photoUsage?.data && !photoUsage.data.error) snapshot = { ...snapshot, photoUsage: photoUsage.data }
      if (giftCatalog) snapshot = { ...snapshot, giftCatalog }
      if(character){
        snapshot={...snapshot,...character}
        // A join may commit between the core read and this small supplement.
        // Keep arrival scheduling and the UI on the SAME authoritative deadline.
        const party=character.adventureTeam
        if(party?.team&&party.adventureId===snapshot.activeAdventure?.id)
          snapshot={...snapshot,activeAdventure:{...snapshot.activeAdventure,ends_at:party.team.endsAt}}
      }
      const attention = await attentionRead
      if (attention) snapshot = { ...snapshot, attention }
    }
    snapshot = await timing.read('shop_catalog', () => projectShopCatalog(db, snapshot, request))
    snapshot = projectEconomicCalendar(snapshot, request)
    return NextResponse.json(snapshot?.error ? snapshot : { success: true, ...snapshot }, {
      status: commandStatus(snapshot?.error), headers: timing.headers(),
    })
  } catch (error) {
    console.error('[vnext/bootstrap] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: timing.headers() })
  }
}
