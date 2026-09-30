import { NextResponse } from 'next/server'
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
    const supabase = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(supabase)) return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
    for (const field of ['ownerId', 'adventureId', 'recordId', 'recipientId', 'giftId', 'assignmentId', 'entryId', 'visitId']) {
      if (body[field] != null && !uuid(body[field])) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    let rpc = null
    let args = null

    if (action === 'set_record_sharing') {
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
    } else if (action === 'interact_burrow_toy') {
      if (!uuid(body.idempotencyKey)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      rpc = 'interact_burrow_toy_v1'
      args = { p_user_id: userId, p_key: body.idempotencyKey }
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
      rpc = 'interact_room_need_v1'
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
    } else if (action === 'start_adventure') {
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!idempotencyKey) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'start_adventure_v1'
      args = {
        p_user_id: userId,
        p_record_id: body.recordId || null,
        p_idempotency_key: idempotencyKey,
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
      rpc = 'settle_adventure_v1'
      args = { p_user_id: userId, p_adventure_id: adventureId }
    } else if (action === 'claim_adventure_result') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_adventure_result_v1'
      args = { p_user_id: userId, p_adventure_id: adventureId }
    } else if (action === 'complete_friend_interaction') {
      const adventureId = requiredText(body.adventureId, 80)
      if (!adventureId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'complete_friend_interaction_v1'
      args = {
        p_user_id: userId,
        p_adventure_id: adventureId,
        p_response: body.response && typeof body.response === 'object' ? body.response : {},
      }
    } else if (action === 'purchase_catalog_item') {
      const itemId = requiredText(body.itemId, 160)
      const recipientId = requiredText(body.recipientId, 80) || userId
      const idempotencyKey = requiredText(body.idempotencyKey)
      if (!itemId || !idempotencyKey) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'purchase_catalog_item_v1'
      args = {
        p_buyer_id: userId,
        p_recipient_id: recipientId,
        p_item_id: itemId,
        p_idempotency_key: idempotencyKey,
      }
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
    } else if (action === 'claim_daily_quest') {
      const assignmentId = requiredText(body.assignmentId, 80)
      if (!assignmentId) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      rpc = 'claim_daily_quest_v1'
      args = { p_user_id: userId, p_assignment_id: assignmentId }
    } else if (action === 'mark_affection_read') {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id) => uuid(id)).slice(0, 100)
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

    const { data, error } = await supabase.rpc(rpc, args)
    if (error) throw error
    const status = commandStatus(data?.error)
    return NextResponse.json(
      data?.error ? data : { success: true, ...data },
      { status },
    )
  } catch (error) {
    console.error('[vnext/command] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
