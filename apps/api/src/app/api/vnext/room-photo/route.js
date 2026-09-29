import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus, majorUpdateEnabled } from '@/lib/app-major-update'
import { PHOTO_BUCKET, PHOTO_LINK_SECONDS, photoUUID, decodeRoomPhoto, readPhotoRequest } from '@/lib/burrow-photo.mjs'

export const runtime = 'edge'
export const maxDuration = 60
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!photoUUID(id)) return reply({ error: 'invalid_request' }, 400)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    const { data, error } = await db.rpc('read_room_photo_v1', { p_user_id: userId, p_photo_id: id })
    if (error) throw error
    if (data.error) return reply(data, commandStatus(data.error))
    const signed = await db.storage.from(PHOTO_BUCKET).createSignedUrl(data.path, PHOTO_LINK_SECONDS)
    if (signed.error) throw signed.error
    return reply({ success: true, url: signed.data.signedUrl, expiresIn: PHOTO_LINK_SECONDS })
  } catch { return reply({ error: 'photo_unavailable' }, 503) }
}

export async function POST(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const body = await readPhotoRequest(request)
    // Reject a draft from an earlier account if token refresh raced sign-out.
    // actorId never grants authority: it must equal the verified JWT subject.
    if (!body || body.actorId !== userId || !photoUUID(body.ownerId) || !photoUUID(body.idempotencyKey) || !['frame','doll'].includes(body.kind)) return reply({ error: 'invalid_request' }, 400)
    const bytes = decodeRoomPhoto(body.base64)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    // Upload abuse protection fails closed; the general API limiter fails open.
    const limited = await db.rpc('check_rate_limit', { p_bucket: `burrow-photo:${userId}`, p_limit: 20, p_window_seconds: 3600 })
    if (limited.error || !limited.data) return reply({ error: 'photo_unavailable' }, 503)
    if (!limited.data.allowed) return reply({ error: 'upload_limit' }, 429)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('')
    if (body.partnerId != null && !photoUUID(body.partnerId)) return reply({error:'invalid_request'},400)
    const prepared = body.partnerId ? await db.rpc('prepare_burrow_photo_for_pair_v1', {
      p_user_id:userId,p_partner_id:body.partnerId,p_target:{kind:body.kind,ownerId:body.ownerId},p_key:body.idempotencyKey,p_digest:digest,
    }) : await db.rpc('prepare_room_photo_v1', { p_user_id: userId, p_owner_id: body.ownerId,
      p_kind: body.kind, p_key: body.idempotencyKey, p_digest: digest })
    if (prepared.error) throw prepared.error
    if (prepared.data.error) return reply(prepared.data, commandStatus(prepared.data.error))
    if (prepared.data.committed) return reply({ success: true, applied: false })
    // Immutable path + digest-bound ticket: retries cannot overwrite a committed photo.
    const uploaded = await db.storage.from(PHOTO_BUCKET).upload(prepared.data.path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })
    if (uploaded.error && !['409','Duplicate'].includes(String(uploaded.error.statusCode ?? uploaded.error.code))) throw uploaded.error
    const complete = await db.rpc('complete_room_photo_v1', { p_user_id: userId, p_ticket_id: prepared.data.ticketId })
    if (complete.error) throw complete.error
    // Do not delete on ambiguous failure: the transaction may already have committed.
    return reply(complete.data.error ? complete.data : { success: true, ...complete.data }, commandStatus(complete.data.error))
  } catch (error) {
    return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'photo_unavailable' }, error?.message === 'invalid_request' ? 400 : 503)
  }
}
