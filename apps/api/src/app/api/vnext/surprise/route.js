import { after,NextResponse } from 'next/server'
import {drainPushNotificationOutbox} from '@/lib/push-notifications'
import { appMajorUpdateServiceClient, authenticatedUserId, majorUpdateEnabled } from '@/lib/app-major-update'
import { readRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
import { photoUUID } from '@/lib/burrow-photo.mjs'
import { SURPRISE_BUCKET, readSurpriseBody, decodeSurprise } from '@/lib/burrow-surprise.mjs'
import { shopItemSupported } from '@/lib/shop-catalog-release.mjs'
export const runtime = 'edge'
export const maxDuration = 60
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const failure = (error,reason) => reply({ error,...(reason?{reason}:{} ) }, error === 'plus_required' ? 403 : error === 'not_found' ? 404 : ['insufficient_balance','pair_changed','idempotency_conflict','price_changed','price_confirmation_required'].includes(error) ? 409 : 400)
export async function GET(request) {
  try {
    const user = await authenticatedUserId(request); if (!user) return reply({error:'Unauthorized'},401)
    const params = new URL(request.url).searchParams
    const id = params.get('id'), history = params.get('history')
    if (id && !photoUUID(id)) return failure('invalid_request')
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({error:'feature_disabled'},403)
    if(params.has('key')){
      const key=params.get('key'),partner=params.get('partnerId'),version=params.get('pairVersion')
      if(id||history||!photoUUID(key)||!photoUUID(partner)||!/^[a-f0-9]{32}$/.test(version??''))return failure('invalid_request')
      const status=await db.rpc('burrow_surprise_send_status_v1',{p_user:user,p_key:key,p_partner:partner,p_version:version})
      if(status.error)throw status.error
      if(status.data.error)return failure(status.data.error)
      const wallet=status.data.committed||status.data.paid?await readRewardWallet(db,user):null
      return reply({...status.data,...(wallet?{wallet:wallet.wallet,coinState:wallet}:{})})
    }
    if (history) {
      const before=params.get('before'), beforeId=params.get('beforeId')
      if(id || !['received','sent'].includes(history) || Boolean(before)!==Boolean(beforeId)
        || (before && (before.length>40 || !/^\d{4}-\d{2}-\d{2}T/.test(before) || !Number.isFinite(Date.parse(before)) || !photoUUID(beforeId)))) return failure('invalid_request')
      const {data,error}=await db.rpc('burrow_surprise_history_v1',{p_user:user,p_direction:history,p_before:before||null,p_before_id:beforeId||null})
      if(error)throw error
      return data.error?failure(data.error):reply(data)
    }
    const {data,error} = await db.rpc('read_burrow_surprises_v1',{p_user:user,p_id:id||null,p_open:false})
    if (error) throw error
    if (data.error) return failure(data.error)
    if (!id) return reply(data)
    const photoOnly=params.get('photoOnly')==='1'
    const links = await Promise.all((photoOnly?[data.photoPath]:[data.photoPath,data.audioPath]).map(path=>db.storage.from(SURPRISE_BUCKET).createSignedUrl(path,300)))
    if (links.some(link=>link.error)) throw Error('media_unavailable')
    return reply({photoUrl:links[0].data.signedUrl,...(!photoOnly?{audioUrl:links[1].data.signedUrl}:{})})
  } catch { return reply({error:'surprise_unavailable'},503) }
}
export async function POST(request) {
  const started=Date.now();let stage='authenticate'
  try {
    const user = await authenticatedUserId(request); if (!user) return reply({error:'Unauthorized'},401)
    stage='read_body'
    const body = await readSurpriseBody(request)
    const db = appMajorUpdateServiceClient()
    if (!await majorUpdateEnabled(db)) return reply({error:'feature_disabled'},403)
    if (body.action === 'open') {
      if (!photoUUID(body.id)) return failure('invalid_request')
      const result = await db.rpc('read_burrow_surprises_v1',{p_user:user,p_id:body.id,p_open:true})
      if (result.error) throw result.error
      return result.data.error ? failure(result.data.error) : reply({success:true})
    }
    if(body.action==='cancel_paid'){
      if(!photoUUID(body.key))return failure('invalid_request')
      const result=await db.rpc('cancel_paid_burrow_surprise_v1',{p_user:user,p_key:body.key})
      if(result.error)throw result.error
      if(result.data.error)return failure(result.data.error)
      const wallet=await readRewardWallet(db,user)
      return reply({...result.data,...(wallet?{wallet:wallet.wallet,coinState:wallet}:{})})
    }
    if(body.action==='pay'){
      if(!photoUUID(body.key)||!photoUUID(body.partnerId)||!/^[a-f0-9]{32}$/.test(body.pairVersion??'')
        ||!/^[a-f0-9]{64}$/.test(body.digest??'')||!Number.isInteger(body.durationMs)||body.durationMs<1000||body.durationMs>60000
        ||!Number.isInteger(body.expectedPrice)||body.expectedPrice<1||body.expectedPrice>99999
        ||!shopItemSupported('surprise:'+body.frame,request)||body.photo!=null||body.audio!=null)return failure('invalid_request')
      const limit=await db.rpc('check_rate_limit',{p_bucket:`surprise-pay:${user}`,p_limit:60,p_window_seconds:3600})
      if(limit.error||!limit.data)throw Error('rate_limit_unavailable')
      if(!limit.data.allowed)return reply({error:'upload_limit'},429)
      const result=await db.rpc('pay_burrow_surprise_v1',{p_user:user,p_partner:body.partnerId,p_version:body.pairVersion,
        p_key:body.key,p_frame:body.frame,p_duration:body.durationMs,p_digest:body.digest,p_expected_price:body.expectedPrice})
      if(result.error)throw result.error
      if(result.data.error)return failure(result.data.error)
      const wallet=await readRewardWallet(db,user)
      return reply({...result.data,...(wallet?{wallet:wallet.wallet,coinState:wallet}:{})})
    }
    if (!['send','deliver_paid'].includes(body.action)) return failure('invalid_request')
    if (body.expectedPrice != null && (!Number.isInteger(body.expectedPrice) || body.expectedPrice < 1 || body.expectedPrice > 1000000)) return failure('invalid_request')
    stage='validate_media'
    const {photo,audio,durationMs:actualDuration} = decodeSurprise(body)
    if(body.action==='deliver_paid'&&Math.abs(actualDuration-body.durationMs)>1000)return failure('invalid_request','audio_duration_mismatch')
    const durationMs=body.action==='deliver_paid'?body.durationMs:Math.min(60000,Math.round(actualDuration))
    if (!shopItemSupported('surprise:'+body.frame,request)) return reply({error:'client_upgrade_required'},409)
    stage='rate_limit'
    const limit = await db.rpc('check_rate_limit',{p_bucket:`surprise:${user}`,p_limit:30,p_window_seconds:3600})
    if (limit.error || !limit.data) throw Error('rate_limit_unavailable')
    if (!limit.data.allowed) return reply({error:'upload_limit'},429)
    const digestBytes = new TextEncoder().encode(JSON.stringify([body.frame,body.durationMs,body.photo,body.audio]))
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',digestBytes)),b=>b.toString(16).padStart(2,'0')).join('')
    stage='prepare_ticket'
    if(body.action==='deliver_paid'){
      const status=await db.rpc('burrow_surprise_send_status_v1',{p_user:user,p_key:body.key,p_partner:body.partnerId,p_version:body.pairVersion})
      if(status.error)throw status.error
      if(status.data.error)return failure(status.data.error)
      if(!status.data.paid)return failure('payment_required')
    }
    const prepared = await db.rpc('prepare_burrow_surprise_v2',{p_user:user,p_partner:body.partnerId,p_version:body.pairVersion,
      p_key:body.key,p_frame:body.frame,p_duration:durationMs,p_digest:digest,p_expected_price:body.expectedPrice??null})
    if (prepared.error) throw prepared.error
    if (prepared.data.error) {console.warn('[surprise/send]',JSON.stringify({stage,code:prepared.data.error,ms:Date.now()-started}));return failure(prepared.data.error)}
    if (!prepared.data.committed) {
      stage='upload_media'
      await Promise.all([[prepared.data.photoPath,photo,'image/jpeg'],[prepared.data.audioPath,audio,'audio/mp4']].map(async([path,bytes,contentType])=>{
        const result = await db.storage.from(SURPRISE_BUCKET).upload(path,bytes,{contentType,upsert:false,cacheControl:'0'})
        if (result.error && !['409','Duplicate'].includes(String(result.error.statusCode??result.error.code))) throw result.error
      }))
    }
    stage='commit'
    const sent = await db.rpc('complete_burrow_surprise_v1',{p_user:user,p_id:prepared.data.id})
    if (sent.error) throw sent.error
    if (sent.data.error) {console.warn('[surprise/send]',JSON.stringify({stage,code:sent.data.error,ms:Date.now()-started}));return failure(sent.data.error)}
    after(async()=>{try{await drainPushNotificationOutbox(db,10)}catch{console.warn('[notification] surprise delivery pending')}})
    const wallet = await readRewardWallet(db,user)
    return reply({success:true,...sent.data,...(wallet?{wallet:wallet.wallet,coinState:wallet}:{})})
  } catch (error) {
    if(error?.message==='economic_domain_mismatch')return reply({error:'economic_domain_mismatch'},403)
    // No UUIDs, signed URLs, photos, recordings or request bodies in logs.
    console.warn('[surprise/send]',JSON.stringify({stage,code:error?.message==='invalid_request'?'invalid_request':'unavailable',reason:error?.reason,
      databaseCode:/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error?.code??'')?error.code:undefined,ms:Date.now()-started}))
    return error?.message==='invalid_request' ? failure('invalid_request',error.reason) : reply({error:'surprise_unavailable'},503)
  }
}
