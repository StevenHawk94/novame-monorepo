import {NextResponse} from 'next/server'
import {authenticatedUserId,appMajorUpdateServiceClient,majorUpdateEnabled} from '@/lib/app-major-update'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
import {validateTouchClip,TOUCH_RULES} from '@novame/domain'
export const runtime='edge'
const uuid=v=>typeof v==='string'&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const pair=v=>typeof v==='string'&&/^[a-f\d]{32}$/i.test(v)
const reply=(value,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}})
function result(r){if(r.error)throw r.error;return reply(r.data,r.data?.error?(r.data.error==='not_found'?404:409):200)}
export async function GET(request){
 try{
  const user=await authenticatedUserId(request);if(!user)return reply({error:'Unauthorized'},401)
  const p=new URL(request.url).searchParams,version=p.get('pair'),id=p.get('id')
  if(!pair(version)||(id&&!uuid(id)))return reply({error:'invalid_request'},400)
  const db=appMajorUpdateServiceClient();if(!await majorUpdateEnabled(db))return reply({error:'feature_disabled'},403)
  await securityRateLimit(db,request,user,'touch-read',90,60)
  const suffix=p.get('v')==='2'?'v2':'v1'
  return result(await db.rpc(id?`read_plushie_touch_${suffix}`:`plushie_touch_state_${suffix}`,id?{p_user:user,p_pair:version,p_id:id,p_seen:false}:{p_user:user,p_pair:version}))
 }catch(error){return securityFailure(error)}
}
export async function POST(request){
 try{
  const user=await authenticatedUserId(request);if(!user)return reply({error:'Unauthorized'},401)
  const raw=await request.text();if(new TextEncoder().encode(raw).length>TOUCH_RULES.maxBytes+2048)return reply({error:'invalid_request'},400)
  let b;try{b=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
  if(!pair(b?.pairVersion))return reply({error:'invalid_request'},400)
  const db=appMajorUpdateServiceClient();if(!await majorUpdateEnabled(db))return reply({error:'feature_disabled'},403)
  await securityRateLimit(db,request,user,'touch-write',30,60)
  if(b.action==='seen'){
   if(!uuid(b.messageId))return reply({error:'invalid_request'},400)
   return result(await db.rpc(b.protocol===2?'read_plushie_touch_v2':'read_plushie_touch_v1',{p_user:user,p_pair:b.pairVersion,p_id:b.messageId,p_seen:true}))
  }
  if(b.action!=='send'||!uuid(b.partnerId)||!uuid(b.key)||!uuid(b.photoId)||typeof b.toyId!=='string'||b.toyId.length>160
   ||!/^\d{4}-\d{2}-\d{2}$/.test(b.localDate??'')||!validateTouchClip(b.clip)||(b.clip.version===2&&b.protocol!==2))return reply({error:'invalid_request'},400)
  return result(await db.rpc('send_plushie_touch_v1',{p_user:user,p_partner:b.partnerId,p_pair:b.pairVersion,p_day:b.localDate,
   p_key:b.key,p_toy:b.toyId,p_photo:b.photoId,p_clip:b.clip}))
 }catch(error){return securityFailure(error)}
}
