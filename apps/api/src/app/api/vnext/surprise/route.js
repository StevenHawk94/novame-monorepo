import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient, authenticatedUserId, majorUpdateEnabled } from '@/lib/app-major-update'
import { readRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
import { photoUUID } from '@/lib/burrow-photo.mjs'
import { SURPRISE_BUCKET, readSurpriseBody, decodeSurprise } from '@/lib/burrow-surprise.mjs'
export const runtime = 'edge'
export const maxDuration = 60
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const failure = error => reply({ error }, error === 'not_found' ? 404 : ['insufficient_balance','pair_changed','idempotency_conflict'].includes(error) ? 409 : 400)
export async function GET(request) {
  try {
    const user = await authenticatedUserId(request); if (!user) return reply({error:'Unauthorized'},401)
    const id = new URL(request.url).searchParams.get('id')
    if (id && !photoUUID(id)) return failure('invalid_request')
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({error:'feature_disabled'},403)
    const {data,error} = await db.rpc('read_burrow_surprises_v1',{p_user:user,p_id:id||null,p_open:false})
    if (error) throw error
    if (data.error) return failure(data.error)
    if (!id) return reply(data)
    const links = await Promise.all([data.photoPath,data.audioPath].map(path=>db.storage.from(SURPRISE_BUCKET).createSignedUrl(path,300)))
    if (links.some(link=>link.error)) throw Error('media_unavailable')
    return reply({photoUrl:links[0].data.signedUrl,audioUrl:links[1].data.signedUrl})
  } catch { return reply({error:'surprise_unavailable'},503) }
}
export async function POST(request) {
  try {
    const user = await authenticatedUserId(request); if (!user) return reply({error:'Unauthorized'},401)
    const body = await readSurpriseBody(request)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({error:'feature_disabled'},403)
    if (body.action === 'open') {
      if (!photoUUID(body.id)) return failure('invalid_request')
      const result = await db.rpc('read_burrow_surprises_v1',{p_user:user,p_id:body.id,p_open:true})
      if (result.error) throw result.error
      return result.data.error ? failure(result.data.error) : reply({success:true})
    }
    if (body.action !== 'send') return failure('invalid_request')
    const {photo,audio,durationMs} = decodeSurprise(body)
    const limit = await db.rpc('check_rate_limit',{p_bucket:`surprise:${user}`,p_limit:30,p_window_seconds:3600})
    if (limit.error || !limit.data) throw Error('rate_limit_unavailable')
    if (!limit.data.allowed) return reply({error:'upload_limit'},429)
    const digestBytes = new TextEncoder().encode(JSON.stringify([body.frame,body.durationMs,body.photo,body.audio]))
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',digestBytes)),b=>b.toString(16).padStart(2,'0')).join('')
    const prepared = await db.rpc('prepare_burrow_surprise_v1',{p_user:user,p_partner:body.partnerId,p_version:body.pairVersion,
      p_key:body.key,p_frame:body.frame,p_duration:durationMs,p_digest:digest})
    if (prepared.error) throw prepared.error
    if (prepared.data.error) return failure(prepared.data.error)
    if (!prepared.data.committed) {
      for (const [path,bytes,contentType] of [[prepared.data.photoPath,photo,'image/jpeg'],[prepared.data.audioPath,audio,'audio/mp4']]) {
        const result = await db.storage.from(SURPRISE_BUCKET).upload(path,bytes,{contentType,upsert:false,cacheControl:'0'})
        if (result.error && !['409','Duplicate'].includes(String(result.error.statusCode??result.error.code))) throw result.error
      }
    }
    const sent = await db.rpc('complete_burrow_surprise_v1',{p_user:user,p_id:prepared.data.id})
    if (sent.error) throw sent.error
    if (sent.data.error) return failure(sent.data.error)
    const wallet = await readRewardWallet(db,user)
    return reply({success:true,...sent.data,...(wallet?{wallet:wallet.wallet,coinState:wallet}:{})})
  } catch (error) { return error?.message==='invalid_request' ? failure('invalid_request') : reply({error:'surprise_unavailable'},503) }
}
