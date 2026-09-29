import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus, majorUpdateEnabled } from '@/lib/app-major-update'
import { PHOTO_LINK_SECONDS, photoUUID, decodeRoomPhoto, readPhotoRequest } from '@/lib/burrow-photo.mjs'

export const runtime = 'edge'
export const maxDuration = 60
const bucket = 'burrow-memory-photos'
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!photoUUID(id)) return reply({ error: 'invalid_request' }, 400)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    const { data, error } = await db.rpc('read_memory_photo_v1', { p_user_id: userId, p_photo_id: id })
    if (error) throw error
    if (data.error) return reply(data, commandStatus(data.error))
    const signed = await db.storage.from(bucket).createSignedUrl(data.path, PHOTO_LINK_SECONDS)
    if (signed.error) throw signed.error
    return reply({ success: true, url: signed.data.signedUrl, expiresIn: PHOTO_LINK_SECONDS })
  } catch { return reply({ error: 'photo_unavailable' }, 503) }
}

export async function POST(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const body = await readPhotoRequest(request)
    if (!body || body.actorId !== userId || !photoUUID(body.entryId)) return reply({ error: 'invalid_request' }, 400)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    if (body.action === 'remove') {
      if (!photoUUID(body.photoId)) return reply({ error: 'invalid_request' }, 400)
      const result = await db.rpc('delete_memory_photo_v1', { p_user_id: userId, p_entry_id: body.entryId, p_photo_id: body.photoId })
      if (result.error) throw result.error
      return reply(result.data.error ? result.data : { success: true, ...result.data }, commandStatus(result.data.error))
    }
    if (body.action !== 'upload' || !Number.isInteger(body.slot) || body.slot < 0 || body.slot > 2
      || !photoUUID(body.idempotencyKey) || (body.expectedPhotoId !== null && !photoUUID(body.expectedPhotoId))) return reply({ error: 'invalid_request' }, 400)
    const bytes = decodeRoomPhoto(body.base64)
    const limited = await db.rpc('check_rate_limit', { p_bucket: `memory-photo:${userId}`, p_limit: 20, p_window_seconds: 3600 })
    if (limited.error || !limited.data) return reply({ error: 'photo_unavailable' }, 503)
    if (!limited.data.allowed) return reply({ error: 'upload_limit' }, 429)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('')
    if (body.partnerId != null && !photoUUID(body.partnerId)) return reply({error:'invalid_request'},400)
    const prepared = body.partnerId ? await db.rpc('prepare_burrow_photo_for_pair_v1', {
      p_user_id:userId,p_partner_id:body.partnerId,p_target:{kind:'memory',entryId:body.entryId,slot:body.slot,expectedPhotoId:body.expectedPhotoId},p_key:body.idempotencyKey,p_digest:digest,
    }) : await db.rpc('prepare_memory_photo_v1', { p_user_id: userId, p_entry_id: body.entryId,
      p_slot: body.slot, p_expected_id: body.expectedPhotoId, p_key: body.idempotencyKey, p_digest: digest })
    if (prepared.error) throw prepared.error
    if (prepared.data.error) return reply(prepared.data, commandStatus(prepared.data.error))
    if (prepared.data.committed) return reply({ success: true, applied: false })
    const uploaded = await db.storage.from(bucket).upload(prepared.data.path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })
    if (uploaded.error && !['409','Duplicate'].includes(String(uploaded.error.statusCode ?? uploaded.error.code))) throw uploaded.error
    const complete = await db.rpc('complete_memory_photo_v1', { p_user_id: userId, p_ticket_id: prepared.data.ticketId })
    if (complete.error) throw complete.error
    // Ambiguous outcomes are retried with the same ticket; garbage collection
    // retires abandoned tickets later, never delete inline after a timeout.
    return reply(complete.data.error ? complete.data : { success: true, ...complete.data }, commandStatus(complete.data.error))
  } catch (error) {
    const invalid = error?.message === 'invalid_request'
    return reply({ error: invalid ? 'invalid_request' : 'photo_unavailable' }, invalid ? 400 : 503)
  }
}
