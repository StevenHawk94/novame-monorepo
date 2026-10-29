import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus, majorUpdateEnabled } from '@/lib/app-major-update'
import { PHOTO_BUCKET, PHOTO_LINK_SECONDS, photoUUID, decodeRoomPhoto, readPhotoRequest } from '@/lib/burrow-photo.mjs'
import {personalRooms} from '@/lib/personal-room-contract.mjs'

export const runtime = 'edge'
export const maxDuration = 60
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const params = new URL(request.url).searchParams
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    if (params.get('mode') === 'history') {
      const before=params.get('before'), beforeId=params.get('beforeId')
      if (Boolean(before)!==Boolean(beforeId) || (before && (before.length>40 || !/^\d{4}-\d{2}-\d{2}T/.test(before) || !Number.isFinite(Date.parse(before)) || !photoUUID(beforeId)))) return reply({error:'invalid_request'},400)
      const history=await db.rpc('read_burrow_frame_history_v1',{p_user:userId,p_before:before||null,p_before_id:beforeId||null})
      if(history.error)throw history.error
      if(history.data.error)return reply(history.data,400)
      const items=history.data.items||[]
      const signed=items.length?await db.storage.from(PHOTO_BUCKET).createSignedUrls(items.map(item=>item.private_path),PHOTO_LINK_SECONDS):{data:[]}
      if(signed.error)throw signed.error
      // The RPC binds every path to the JWT owner; never accept arbitrary paths.
      const urls=new Map((signed.data||[]).map(link=>[link.path,link.signedUrl]))
      return reply({success:true,hasPlus:history.data.hasPlus,nextCursor:history.data.nextCursor,
        items:items.map(item=>({id:item.id,createdAt:item.created_at,url:urls.get(item.private_path),expiresAt:Date.now()+PHOTO_LINK_SECONDS*1000})).filter(item=>item.url)})
    }
    const id = params.get('id'), version = params.get('version')
    if (!photoUUID(id) || (version && !Number.isFinite(Date.parse(version)))) return reply({ error: 'invalid_request' }, 400)
    let { data, error } = await db.rpc('read_room_photo_v1', { p_user_id: userId, p_photo_id: id })
    if (error) throw error
    if (data.error === 'not_paired' || data.error === 'not_found') {
      const solo = await db.rpc('solo_burrow_read_photo_v1', { p_user_id: userId, p_photo_id: id })
      if (solo.error) throw solo.error
      data = solo.data
    }
    if(data.error==='not_found'){
      const touch=await db.rpc('read_plushie_touch_photo_v1',{p_user:userId,p_photo:id})
      if(touch.error)throw touch.error
      data=touch.data
    }
    if (data.error) return reply(data, commandStatus(data.error))
    if (version) {
      const current = await db.from('room_photos').select('id').eq('id', id).eq('private_path', data.path).eq('updated_at', version).maybeSingle()
      if (current.error) throw current.error
      if (!current.data) return reply({ error: 'photo_conflict' }, 409)
    }
    const signed = await db.storage.from(PHOTO_BUCKET).createSignedUrl(data.path, PHOTO_LINK_SECONDS)
    if (signed.error) throw signed.error
    return reply({ success: true, url: signed.data.signedUrl, expiresIn: PHOTO_LINK_SECONDS })
  } catch { return reply({ error: 'photo_unavailable' }, 503) }
}

export async function DELETE(request) {
  try {
    const userId = await authenticatedUserId(request)
    if (!userId) return reply({ error: 'Unauthorized' }, 401)
    const raw = await request.json()
    if (raw?.actorId !== userId || !photoUUID(raw.photoId)) return reply({ error: 'invalid_request' }, 400)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    // Owner-only; room_photos DELETE trigger retires the private storage path.
    const { data, error } = await db.from('room_photos').delete().eq('id', raw.photoId).eq('owner_id', userId).eq('kind', 'frame').select('id')
    if (error) throw error
    if (!data?.length) return reply({ error: 'not_found' }, 404)
    return reply({ success: true })
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
    if (body.toyId != null && (body.kind !== 'doll' || typeof body.toyId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.toyId))) return reply({ error: 'invalid_request' }, 400)
    const bytes = decodeRoomPhoto(body.base64, body.kind === 'frame' ? 'frame' : 'square')
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({ error: 'feature_disabled' }, 403)
    // Upload abuse protection fails closed; the general API limiter fails open.
    const limited = await db.rpc('check_rate_limit', { p_bucket: body.kind === 'doll' ? `burrow-photo:doll:${userId}` : `burrow-photo:${userId}`, p_limit: body.kind === 'doll' ? 10 : 20, p_window_seconds: 3600 })
    if (limited.error || !limited.data) return reply({ error: 'photo_unavailable' }, 503)
    if (!limited.data.allowed) return reply({ error: 'upload_limit' }, 429)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('')
    if (body.partnerId != null && !photoUUID(body.partnerId)) return reply({error:'invalid_request'},400)
    let prepared = body.kind === 'doll' ? await db.rpc(personalRooms(request)?'prepare_personal_toy_photo_v1':'prepare_toy_photo_v1', {
      p_user_id:userId,p_owner_id:body.ownerId,p_toy_id:body.toyId??null,p_partner_id:body.partnerId??null,p_key:body.idempotencyKey,p_digest:digest,
    }) : body.partnerId ? await db.rpc('prepare_burrow_photo_for_pair_v1', {
      p_user_id:userId,p_partner_id:body.partnerId,p_target:{kind:body.kind,ownerId:body.ownerId},p_key:body.idempotencyKey,p_digest:digest,
    }) : await db.rpc('prepare_room_photo_v1', { p_user_id: userId, p_owner_id: body.ownerId,
      p_kind: body.kind, p_key: body.idempotencyKey, p_digest: digest })
    if (prepared.error) throw prepared.error
    if (body.kind !== 'doll' && !body.partnerId && prepared.data.error === 'not_paired' && body.ownerId === userId) {
      prepared = await db.rpc('solo_burrow_prepare_photo_v1', { p_user_id: userId, p_owner_id: userId,
        p_kind: body.kind, p_key: body.idempotencyKey, p_digest: digest })
      if (prepared.error) throw prepared.error
    }
    if (prepared.data.error) return reply(prepared.data, commandStatus(prepared.data.error))
    const photoReceipt = async (receipt) => {
      // Bind the version to this ticket's bytes, never to an unrelated newer
      // photo. A retry after another replacement must not mislabel its JPEG.
      const current = await db.from('room_photos').select('id,owner_id,kind,toy_id,updated_at')
        .eq('private_path', prepared.data.path).eq('owner_id', body.ownerId).eq('kind', body.kind).maybeSingle()
      if (current.error) throw current.error
      if (!current.data) return reply({ error: 'photo_conflict' }, 409)
      const row = current.data
      if (body.kind === 'doll' && row.toy_id !== prepared.data.toyId) return reply({ error:'photo_conflict' },409)
      const usage=await db.rpc('burrow_photo_usage_v1',{p_user:userId})
      if(usage.error)throw usage.error
      return reply({ success: true, ...receipt, photoId: row.id, photoUsage:usage.data,
        photo: { id: row.id, ownerId: row.owner_id, kind: row.kind, ...(row.toy_id ? {toyId:row.toy_id} : {}), updatedAt: row.updated_at } })
    }
    if (prepared.data.committed) return await photoReceipt({ applied: false })
    // Immutable path + digest-bound ticket: retries cannot overwrite a committed photo.
    const uploaded = await db.storage.from(PHOTO_BUCKET).upload(prepared.data.path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })
    if (uploaded.error && !['409','Duplicate'].includes(String(uploaded.error.statusCode ?? uploaded.error.code))) throw uploaded.error
    let complete = await db.rpc(body.kind === 'doll' ? personalRooms(request)?'complete_personal_toy_photo_v1':'complete_toy_photo_v1' : 'complete_room_photo_v1', { p_user_id: userId, p_ticket_id: prepared.data.ticketId })
    if (complete.error) throw complete.error
    if (body.kind !== 'doll' && (complete.data.error === 'not_paired' || complete.data.error === 'not_found')) {
      complete = await db.rpc('solo_burrow_complete_photo_v1', { p_user_id: userId, p_ticket_id: prepared.data.ticketId })
      if (complete.error) throw complete.error
    }
    // Do not delete on ambiguous failure: the transaction may already have committed.
    if (complete.data.error) return reply(complete.data, commandStatus(complete.data.error))
    return await photoReceipt(complete.data)
  } catch (error) {
    if(error?.message==='daily_limit_reached')return reply({error:'daily_limit_reached'},409)
    return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'photo_unavailable' }, error?.message === 'invalid_request' ? 400 : 503)
  }
}
