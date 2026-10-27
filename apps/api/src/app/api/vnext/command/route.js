import { after,NextResponse } from 'next/server'
import {drainPushNotificationOutbox} from '@/lib/push-notifications'
import { readAdventureDisplay } from '@/lib/adventure-bootstrap.mjs'
import { withRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
import { shopClientRelease, shopItemSupported, shopClientCanUseLegacy } from '@/lib/shop-catalog-release.mjs'
import {personalRooms,roomMutationNeedsUpgrade} from '@/lib/personal-room-contract.mjs'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
import {teamCapable} from '@/lib/bunny-adventure-contract.mjs'
import {
  appMajorUpdateServiceClient,
  authenticatedUserId,
  commandStatus,
  majorUpdateEnabled,
} from '@/lib/app-major-update'

export const runtime = 'edge'

const uuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null

function requiredText(value, maxLength = 200) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength
    ? value.trim()
    : null
}

export async function POST(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const raw = await request.text()
    if (raw.length > 24000) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    let body
    try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }
    if (!body || Array.isArray(body) || typeof body !== 'object') return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const action = requiredText(body?.action, 80)
    if(roomMutationNeedsUpgrade(request,body)) return NextResponse.json({error:'client_upgrade_required'},{status:426})
    // Old bundles keep their legacy protocol; they can never write the v2
    // personal model. New bundles cannot call retired shared/full writers.
    const supabase = appMajorUpdateServiceClient()
    await securityRateLimit(supabase,request,userId,'burrow-command',180,60)
    if (!await majorUpdateEnabled(supabase)) return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
    for (const field of ['ownerId', 'adventureId', 'recordId', 'recipientId', 'giftId', 'assignmentId', 'entryId', 'visitId']) {
      if (body[field] != null && !uuid(body[field])) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    let rpc = null
    let args = null

    if (action === 'prepare_adventure_encounters') {
      rpc = 'prepare_adventure_encounters_v2'
      args = { p_user_id: userId }
    } else if (action === 'select_adventure_gift') {
      if (body.itemId !== null && !requiredText(body.itemId, 160)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'select_adventure_gift_v2'
      args = { p_user_id: userId, p_item_id: body.itemId }
    } else if (action === 'set_record_sharing') {
      if (!uuid(body.recordId) || !uuid(body.partnerId) || !/^[a-f0-9]{32}$/.test(body.pairVersion ?? '')
        || typeof body.shared !== 'boolean' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0
        || !uuid(body.idempotencyKey)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'set_burrow_record_sharing_v2'
      args = { p_user_id: userId, p_partner_id: body.partnerId, p_pair_version: body.pairVersion,
        p_record_id: body.recordId, p_shared: body.shared, p_expected_version: body.expectedVersion, p_key: body.idempotencyKey }
    } else if (action === 'save_memory_durable') {
      if (body.actorId !== userId || !uuid(body.partnerId) || !/^[a-f0-9]{32}$/.test(body.pairVersion ?? '') || !requiredText(body.body,5000) || !uuid(body.idempotencyKey)
        || (body.entryId && (typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))))
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'save_memory_room_versioned_v1'
      args = { p_user_id: userId, p_partner_id: body.partnerId, p_pair_version: body.pairVersion, p_entry_id: body.entryId || null, p_body: body.body,
        p_prompt_id: requiredText(body.promptId) || null, p_key: body.idempotencyKey, p_expected_updated_at: body.entryId ? body.expectedUpdatedAt : null }
    } else if (action === 'select_room_music') {
      if (body.trackId !== null && !requiredText(body.trackId, 160)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'select_room_music_v1'
      args = { p_user_id: userId, p_track_id: body.trackId }
    } else if (action === 'set_room_sleep') {
      if (typeof body.sleeping !== 'boolean' || !requiredText(body.idempotencyKey)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'set_room_sleep_v1'
      args = { p_user_id: userId, p_sleeping: body.sleeping, p_key: body.idempotencyKey }
    } else if (action === 'interact_burrow_toy_window') {
      const times=[body.windowStartedAt,body.occurredAt,body.lastOccurredAt];
      if(!uuid(body.idempotencyKey)||!Number.isSafeInteger(body.count)||body.count<1||body.count>50
        ||(body.partnerId!=null&&!uuid(body.partnerId))||(body.pairVersion!=null&&!/^[a-f0-9]{32}$/.test(body.pairVersion))
        ||!requiredText(body.toyId,160)||!(uuid(body.photoId)||(/^local-plushie-/.test(body.photoId??'')&&uuid(body.photoId.slice(14))))
        ||!times.every(t=>typeof t==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(t)&&Number.isFinite(Date.parse(t)))
        ||Date.parse(times[0])>Date.parse(times[1])||Date.parse(times[1])>Date.parse(times[2])
        ||Date.parse(times[2])>=Date.parse(times[0])+3600000
        ||typeof body.localDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.localDate)
        ||!Number.isFinite(Date.parse(`${body.localDate}T00:00:00Z`))
        ||new Date(`${body.localDate}T00:00:00Z`).toISOString().slice(0,10)!==body.localDate)
        return NextResponse.json({error:'invalid_request'},{status:400})
      if(body.ownerId!==userId)return NextResponse.json({error:'own_toy_only'},{status:403})
      rpc='record_burrow_toy_window_v1'
      args={p_user_id:userId,p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null,
        p_toy_id:body.toyId,p_photo_id:body.photoId,p_window_started_at:body.windowStartedAt,
        p_occurred_at:body.occurredAt,p_last_occurred_at:body.lastOccurredAt,p_local_date:body.localDate,
        p_count:body.count,p_key:body.idempotencyKey}
    } else if (action === 'interact_burrow_toy_batch') {
      if (!uuid(body.idempotencyKey) || !Number.isSafeInteger(body.count) || body.count<1 || body.count>50
        || (body.partnerId!=null&&!uuid(body.partnerId)) || (body.pairVersion!=null&&!/^[a-f0-9]{32}$/.test(body.pairVersion))
        || typeof body.localDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.localDate)
        || !Number.isFinite(Date.parse(`${body.localDate}T00:00:00Z`))
        || new Date(`${body.localDate}T00:00:00Z`).toISOString().slice(0,10)!==body.localDate) return NextResponse.json({error:'invalid_request'},{status:400})
      if(body.ownerId!==userId)return NextResponse.json({error:'own_toy_only'},{status:403})
      rpc='interact_burrow_toy_batch_v1'
      args={p_user_id:userId,p_owner_id:userId,p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null,
        p_local_date:body.localDate,p_count:body.count,p_key:body.idempotencyKey}
    } else if (action === 'interact_burrow_toy') {
      if (!uuid(body.idempotencyKey)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      if(body.ownerId!=null&&body.ownerId!==userId)return NextResponse.json({error:'own_toy_only'},{status:403})
      rpc = 'interact_burrow_toy_v2'
      args = { p_user_id: userId, p_owner_id:userId, p_key: body.idempotencyKey }
    } else if (['begin_friend_visit_v2','respond_friend_visit_v2','prepare_friend_visit_v3','respond_friend_visit_v3'].includes(action)) {
      if (!uuid(body.visitId) || !/^[a-f0-9]{32}$/.test(body.pairVersion ?? '')
        || (action.startsWith('respond_friend_visit_') && (!uuid(body.sessionId) || !['A','B','C'].includes(body.choiceId))))
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = action
      args = { p_user_id: userId, p_visit_id: body.visitId, p_pair_version: body.pairVersion,
        ...(action.startsWith('respond_friend_visit_') ? { p_session_id: body.sessionId, p_choice: body.choiceId } : {}) }
    } else if (action === 'respond_friend_visit') {
      if (!uuid(body.visitId) || !body.response || Array.isArray(body.response) || typeof body.response !== 'object') return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'respond_friend_visit_v1'
      args = { p_user_id: userId, p_visit_id: body.visitId, p_response: body.response }
    } else if (action === 'claim_special_quest') {
      if (!requiredText(body.questId) || !Number.isSafeInteger(body.stage) || body.stage < 1) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_special_quest_v1'
      args = { p_user_id: userId, p_quest_id: body.questId, p_stage: body.stage }
    } else if (action === 'save_memory') {
      if (!requiredText(body.body, 5000) || !requiredText(body.idempotencyKey)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'save_memory_room_entry_v1'
      args = { p_user_id: userId, p_entry_id: body.entryId || null, p_body: body.body, p_prompt_id: requiredText(body.promptId) || null, p_key: body.idempotencyKey }
    } else if (action === 'delete_memory') {
      if (!uuid(body.entryId)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'delete_memory_room_entry_v1'
      args = { p_user_id: userId, p_entry_id: body.entryId }
    } else if (action === 'save_room_loadout') {
      if (!['home', 'our'].includes(body.roomType) || !body.slots || Array.isArray(body.slots) || typeof body.slots !== 'object') {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'save_room_loadout_v1'
      args = { p_user_id: userId, p_room_type: body.roomType, p_slots: body.slots }
    } else if (action === 'save_bunny_outfit') {
      if (!requiredText(body.itemId, 160)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'save_bunny_outfit_v1'
      args = { p_user_id: userId, p_item_id: body.itemId }
    } else if (action === 'visit_partner_room') {
      rpc = 'visit_partner_room_v1'
      args = { p_user_id: userId }
    } else if (action === 'refill_room_need') {
      const ownerId = requiredText(body.ownerId, 80)
      const need = body.need === 'food' || body.need === 'water' ? body.need : null
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!ownerId || !need || !idempotencyKey) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'interact_room_need_with_cooldown_v1'
      args = {
        p_actor_id: userId,
        p_owner_id: ownerId,
        p_need: need,
        p_idempotency_key: idempotencyKey,
      }
    } else if (action === 'complete_affection') {
      const affectionType = requiredText(body.affectionType, 40)
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!affectionType || !idempotencyKey) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'complete_affection_v1'
      args = {
        p_sender_id: userId,
        p_affection_type: affectionType,
        p_gesture_metrics: body.gestureMetrics && typeof body.gestureMetrics === 'object'
          ? body.gestureMetrics : {},
        p_idempotency_key: idempotencyKey,
      }
    } else if (action === 'nudge_adventure') {
      if(!teamCapable(request)||!uuid(body.partyId)||!uuid(body.idempotencyKey))
        return NextResponse.json({error:'invalid_request'},{status:400})
      rpc='nudge_adventure_v1'
      args={p_user:userId,p_party:body.partyId,p_key:body.idempotencyKey}
    } else if (action === 'start_adventure') {
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!idempotencyKey) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      if(body.encounterVersion===5&&(!teamCapable(request)||!uuid(body.recordId)||!requiredText(body.catalogRelease,128)
        ||(body.partnerId!=null&&!uuid(body.partnerId))||(body.partnerId!=null&&!/^[a-f0-9]{32}$/.test(body.pairVersion??''))
        ||(body.partnerId==null&&body.pairVersion!=null)))
        return NextResponse.json({error:'invalid_request'},{status:400})
      rpc = body.encounterVersion === 5 ? 'start_adventure_v5' : body.encounterVersion === 4 ? 'start_adventure_v4' : body.encounterVersion === 3 ? 'start_adventure_v3'
        : body.encounterVersion === 2 ? 'start_adventure_v2' : 'start_adventure_v1'
      args = {
        p_user_id: userId,
        p_record_id: body.recordId || null,
        p_idempotency_key: idempotencyKey,
        ...(body.encounterVersion===5?{p_catalog_release:body.catalogRelease,p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null}:{}),
      }
    } else if (action === 'accelerate_adventure') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'accelerate_adventure_for_plus_v1'
      args = { p_user_id: userId, p_adventure_id: adventureId }
    } else if (action === 'settle_adventure') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'adventure_command_v2'
      args = { p_user_id: userId, p_adventure_id: adventureId, p_action: 'settle' }
    } else if (action === 'claim_adventure_treasure' || action === 'claim_adventure_result') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'adventure_command_v2'
      args = { p_user_id: userId, p_adventure_id: adventureId, p_action: action === 'claim_adventure_treasure' ? 'treasure' : 'claim' }
    } else if (action === 'complete_friend_interaction') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'adventure_command_v2'
      args = {
        p_user_id: userId,
        p_adventure_id: adventureId,
        p_action: 'respond',
        p_response: body.response && typeof body.response === 'object' ? body.response : {},
      }
    } else if (action === 'purchase_room_changes') {
      const slots = body.slots
      const changes = {...slots, ...(body.outfitItemId ? {outfit:body.outfitItemId} : {})}
      if (!slots || Array.isArray(slots) || typeof slots !== 'object' || !requiredText(body.idempotencyKey,120)
        || Object.keys(changes).length<1 || Object.keys(changes).length>16
        || Object.entries(changes).some(([slot,id])=>!requiredText(slot,60)||!requiredText(id,160))
        || !Number.isSafeInteger(body.expectedTotal) || body.expectedTotal<0 || body.expectedTotal>16000000
        || (body.partnerId!=null&&!uuid(body.partnerId))
        || (body.partnerId ? !/^[a-f0-9]{32}$/.test(body.pairVersion??'') : body.pairVersion!=null)
        || !body.expectedPrices || typeof body.expectedPrices!=='object' || Array.isArray(body.expectedPrices)
        || Object.keys(body.expectedPrices).length>16 || Object.entries(body.expectedPrices).some(([id,price])=>
          !requiredText(id,160)||!Number.isSafeInteger(price)||price<0||price>1000000)
        || Object.values(changes).some(id=>!Object.hasOwn(body.expectedPrices,id)))
        return NextResponse.json({error:'invalid_request'},{status:400})
      rpc=personalRooms(request)?'purchase_personal_room_changes_v1':'purchase_room_changes_v1'
      args={p_user_id:userId,...(personalRooms(request)?{}:{p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null}),
        p_changes:changes,p_expected_prices:body.expectedPrices,p_expected_total:body.expectedTotal,
        p_key:body.idempotencyKey,p_catalog_release:shopClientRelease(request)}
    } else if (action === 'purchase_catalog_item') {
      const itemId = requiredText(body.itemId, 160)
      const recipientId = requiredText(body.recipientId, 80) || userId
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!itemId || !idempotencyKey || (body.expectedPrice != null &&
        (!Number.isSafeInteger(body.expectedPrice) || body.expectedPrice < 1 || body.expectedPrice > 1000000))) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = body.expectedPrice == null ? 'purchase_catalog_item_v1' : 'purchase_catalog_item_v2'
      args = {
        p_buyer_id: userId,
        p_recipient_id: recipientId,
        p_item_id: itemId,
        p_idempotency_key: idempotencyKey,
        ...(body.expectedPrice == null ? {} : { p_expected_price: body.expectedPrice }),
      }
      if (body.scoped === true) {
        if (body.expectedPrice==null || !requiredText(body.idempotencyKey,120)
          || (body.partnerId!=null&&!uuid(body.partnerId))
          || (body.partnerId ? !/^[a-f0-9]{32}$/.test(body.pairVersion??'') : body.pairVersion!=null))
          return NextResponse.json({error:'invalid_request'},{status:400})
        rpc='purchase_catalog_item_scoped_v1'
        args={p_user_id:userId,p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null,
          p_recipient_id:recipientId,p_item_id:itemId,p_expected_price:body.expectedPrice,
          p_key:idempotencyKey,p_catalog_release:shopClientRelease(request)}
      }
    } else if (action === 'purchase_room_loadout') {
      const idempotencyKey = requiredText(body.idempotencyKey, 120)
      // Old bundles include invisible legacy defaults in a full-room checkout.
      // They are not Shop products and must never become purchase targets.
      const slots = body.slots && typeof body.slots==='object' && !Array.isArray(body.slots)
        ? Object.fromEntries(Object.entries(body.slots).filter(([slot])=>!['decor','shelf_decor','poster','background'].includes(slot))) : body.slots
      const outfitItemId = body.outfitItemId == null ? null : requiredText(body.outfitItemId, 160)
      if (!idempotencyKey || !slots || Array.isArray(slots) || typeof slots !== 'object'
        || Object.keys(slots).length < 1 || Object.keys(slots).length > 19
        || (body.outfitItemId != null && !outfitItemId)
        || Object.entries(slots).some(([slot, itemId]) => !requiredText(slot, 60) || !requiredText(itemId, 160))) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      if (body.expectedPrices != null && (typeof body.expectedPrices !== 'object' || Array.isArray(body.expectedPrices)
        || Object.keys(body.expectedPrices).length > 20 || Object.entries(body.expectedPrices).some(([id, price]) =>
          !requiredText(id, 160) || !Number.isSafeInteger(price) || price < 0 || price > 1000000)
        || [...Object.values(slots), ...(outfitItemId ? [outfitItemId] : [])].some(id => !Object.hasOwn(body.expectedPrices, id)))) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = body.expectedPrices == null ? 'purchase_room_loadout_v1' : 'purchase_room_loadout_v2'
      args = { p_user_id: userId, p_slots: slots, p_key: idempotencyKey, p_outfit_item_id: outfitItemId }
      if (body.expectedPrices != null) args.p_expected_prices = body.expectedPrices
    } else if (action === 'claim_shop_gift') {
      if (!uuid(body.giftId) || typeof body.replace !== 'boolean' || !requiredText(body.pairVersion, 160)) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = personalRooms(request) ? 'claim_personal_shop_gift_v1' : 'claim_shop_gift_v1'
      args = { p_recipient_id: userId, p_gift_id: body.giftId, p_replace: body.replace, p_pair_version: body.pairVersion }
    } else if (action === 'claim_gift') {
      const giftId = requiredText(body.giftId, 80)
      if (!giftId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_gift_v1'
      args = { p_recipient_id: userId, p_gift_id: giftId }
    } else if (action === 'assign_daily_quests') {
      rpc = 'assign_daily_quests_v1'
      args = { p_user_id: userId }
    } else if (action === 'claim_daily_plus_bonus') {
      if (typeof body.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.localDate)
        || !Number.isFinite(Date.parse(`${body.localDate}T00:00:00Z`))
        || new Date(`${body.localDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.localDate) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_daily_plus_bonus_v1'
      args = { p_user_id: userId, p_local_date: body.localDate }
    } else if (action === 'claim_daily_quest') {
      const assignmentId = requiredText(body.assignmentId, 80)
      if (!assignmentId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_daily_quest_v1'
      args = { p_user_id: userId, p_assignment_id: assignmentId }
    } else if (action === 'mark_affection_read') {
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.filter((id) => uuid(id)))].slice(0, 100)
        : []
      if (ids.length === 0) return NextResponse.json({ success: true, updated: 0 })
      const { data, error } = await supabase.from('affection_events')
        .update({ received_at: new Date().toISOString(), read_at: new Date().toISOString() })
        .eq('recipient_id', userId).in('id', ids).is('read_at', null).select('id')
      if (error) throw error
      return NextResponse.json({ success: true, updated: data?.length || 0 })
    } else {
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
    }

    if (['purchase_catalog_item','purchase_room_loadout'].includes(action)) {
      const ids = action === 'purchase_catalog_item' ? [body.itemId]
        : [...Object.values(args.p_slots), ...(body.outfitItemId ? [body.outfitItemId] : [])]
      if (ids.some(id => !shopItemSupported(id, request)))
        return NextResponse.json({error:'client_upgrade_required'}, {status:409})
    }
    if (action === 'start_adventure' && rpc === 'start_adventure_v4' && request.headers?.get?.('x-burrow-catalog')) {
      rpc = 'start_burrow_adventure_catalog_v1'
      args = {...args, p_catalog_release: shopClientRelease(request)}
    }
    let { data, error } = await supabase.rpc(rpc, args)
    if (['purchase_personal_room_changes_v1','purchase_room_changes_v1','purchase_catalog_item_scoped_v1'].includes(rpc) && error?.code==='PGRST202')
      return NextResponse.json({error:'checkout_unavailable'},{status:503})
    if (rpc === 'start_burrow_adventure_catalog_v1' && error?.code === 'PGRST202') {
      // Before migration/publication only the baseline bundle may fall back.
      if (!shopClientCanUseLegacy(request))
        return NextResponse.json({error:'catalog_temporarily_unavailable'}, {status:503})
      const {p_catalog_release, ...legacyArgs} = args
      rpc = 'start_adventure_v4'; args = legacyArgs
      const legacy = await supabase.rpc(rpc, args); data = legacy.data; error = legacy.error
    }
    // Rolling deploy: a new client can still start safely before migration 255.
    // The V3 fallback contains no coin snapshots and preserves its exact UI flow.
    if(action==='start_adventure'&&rpc==='start_adventure_v4'&&error?.code==='PGRST202'){
      const legacy=await supabase.rpc('start_adventure_v3',args);data=legacy.data;error=legacy.error
    }
    if(action==='claim_shop_gift'&&error?.code==='PGRST202')
      return NextResponse.json({error:'gift_claim_unavailable'},{status:503})
    if(action==='interact_burrow_toy_batch'&&error?.code==='PGRST202')
      return NextResponse.json({error:'toy_batch_unavailable'},{status:503})
    if(action==='interact_burrow_toy_window'&&error?.code==='PGRST202')
      return NextResponse.json({error:'toy_window_unavailable'},{status:503})
    if (error) throw error
    // A missing pair does not lock someone out of their own room. Keep every
    // fallback self-scoped; partner-targeted gifts/affection/games never enter
    // this path. The database function rechecks the pair inside its transaction.
    if (data?.error === 'not_paired' || (data?.error === 'not_found'
      && ['settle_adventure', 'claim_adventure_result', 'complete_friend_interaction'].includes(action))) {
      let soloRpc = null
      let soloArgs = null
      if (action === 'purchase_catalog_item' && (body.recipientId == null || body.recipientId === userId)) {
        soloRpc = 'solo_burrow_purchase_v1'
        soloArgs = { p_user_id: userId, p_item_id: body.itemId, p_key: body.idempotencyKey }
      } else if (action === 'refill_room_need' && body.ownerId === userId) {
        soloRpc = 'solo_burrow_care_with_cooldown_v1'
        soloArgs = { p_user_id: userId, p_need: body.need, p_key: body.idempotencyKey }
      } else if (action === 'interact_burrow_toy') {
        soloRpc = 'solo_burrow_toy_v1'
        soloArgs = { p_user_id: userId, p_key: body.idempotencyKey }
      } else if (action === 'save_room_loadout') {
        soloRpc = 'solo_burrow_loadout_v1'
        soloArgs = { p_user_id: userId, p_slots: body.slots }
      } else if (action === 'save_bunny_outfit') {
        soloRpc = 'solo_burrow_outfit_v1'
        soloArgs = { p_user_id: userId, p_item_id: body.itemId }
      } else if (action === 'save_memory') {
        soloRpc = 'solo_burrow_memory_v1'
        soloArgs = { p_user_id: userId, p_entry_id: body.entryId || null,
          p_body: body.body, p_prompt_id: body.promptId || null, p_key: body.idempotencyKey }
      } else if (action === 'delete_memory') {
        soloRpc = 'solo_burrow_delete_memory_v1'
        soloArgs = { p_user_id: userId, p_entry_id: body.entryId }
      } else if (action === 'start_adventure' && body.encounterVersion!==5) {
        soloRpc = 'solo_burrow_start_adventure_v1'
        soloArgs = { p_user_id: userId, p_record_id: body.recordId || null, p_key: body.idempotencyKey }
      } else if (action === 'settle_adventure') {
        soloRpc = 'solo_burrow_settle_adventure_v1'
        soloArgs = { p_user_id: userId, p_adventure_id: body.adventureId }
      } else if (action === 'claim_adventure_result') {
        soloRpc = 'solo_burrow_claim_adventure_v1'
        soloArgs = { p_user_id: userId, p_adventure_id: body.adventureId }
      } else if (action === 'complete_friend_interaction') {
        soloRpc = 'solo_burrow_friend_interaction_v1'
        soloArgs = { p_user_id: userId, p_adventure_id: body.adventureId,
          p_response: body.response && typeof body.response === 'object' ? body.response : {} }
      }
      if (soloRpc) {
        const solo = await supabase.rpc(soloRpc, soloArgs)
        if (solo.error) throw solo.error
        data = solo.data
      }
    }
    // Accepted database dates/duration are authoritative, never test overrides.
    if (action === 'start_adventure' && !data?.error && data?.adventureId && [3,4,5].includes(body.encounterVersion)) {
      // A committed start must remain a success even if this supplementary read
      // fails. Bootstrap retries it during the countdown, never rerolls it.
      try {
        const adventureDisplay = await readAdventureDisplay(supabase, userId, data.adventureId)
        if (adventureDisplay && !adventureDisplay.error) data = { ...data, adventureDisplay }
      } catch (error) { console.warn('[adventure/start] display read failed:', error?.message || error) }
    }
    // Include the ledger keys already folded into this balance, including
    // simultaneous claims from another device. Supplementary reads fail open.
    if (!data?.error && ['claim_daily_quest', 'claim_special_quest', 'complete_affection', 'refill_room_need',
      'purchase_catalog_item', 'purchase_room_loadout', 'purchase_room_changes', 'respond_friend_visit_v2', 'respond_friend_visit_v3', 'claim_adventure_treasure'].includes(action)) {
      data = await withRewardWallet(supabase, userId, data, { ...body, action })
    }
    const status = commandStatus(data?.error)
    if(!data?.error&&['complete_affection','nudge_adventure'].includes(action))after(async()=>{
      try{await drainPushNotificationOutbox(supabase,10)}catch{console.warn('[notification] affection delivery pending')}
    })
    return NextResponse.json(
      data?.error ? data : { success: true, ...data },
      { status },
    )
  } catch (error) {
    if(error?.message==='economic_domain_mismatch')return NextResponse.json({error:'economic_domain_mismatch'},{status:403})
    if([429,503].includes(error?.status))return securityFailure(error)
    // The trigger aborts the entire save (note, Moments, receipt and quota).
    // Treat an expected allowance rejection as actionable, not a network error.
    if (error?.code === 'P0001' && ['love_note_minute_limit', 'love_note_daily_limit'].includes(error.message)) {
      const minute = error.message === 'love_note_minute_limit'
      let detail
      try { detail = JSON.parse(error.details) } catch {}
      const supplied = Number(detail?.retryAfterSeconds)
      const retryAfterSeconds = Number.isFinite(supplied) && supplied > 0
        ? Math.min(minute ? 60 : 172800, Math.ceil(supplied)) : minute ? 60 : 86400
      return NextResponse.json({ error: error.message, retryAfterSeconds, limit: minute ? 5 : 100,
        window: minute ? 'minute' : 'day' }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } })
    }
    console.error('[vnext/command] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
