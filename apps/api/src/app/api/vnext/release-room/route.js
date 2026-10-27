import { NextResponse } from 'next/server'
import { authenticatedUserId, appMajorUpdateServiceClient, majorUpdateEnabled } from '@/lib/app-major-update'
import { withRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
import { RELEASE_ROOM_DIALOGUES } from '@novame/domain'
export const runtime='edge'
const reply=(body,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
async function context(request){
 const user=await authenticatedUserId(request)
 if(!user)return {response:reply({error:'Unauthorized'},401)}
 const db=appMajorUpdateServiceClient()
 if(!await majorUpdateEnabled(db))return {response:reply({error:'feature_disabled'},403)}
 return {user,db}
}
export async function GET(request){
 try{
  const {response,user,db}=await context(request);if(response)return response
  const result=await db.rpc('release_room_status_v1',{p_user_id:user})
  if(result.error||!result.data)return reply({error:'release_unavailable'},503)
  return reply(result.data,result.data.error?409:200)
 }catch{return reply({error:'release_unavailable'},503)}
}
export async function POST(request){
 try{
  const {response,user,db}=await context(request);if(response)return response
  const text=await request.text();if(text.length>5000)return reply({error:'invalid_request'},400)
  let body;try{body=JSON.parse(text)}catch{return reply({error:'invalid_request'},400)}
  const rows=Object.hasOwn(RELEASE_ROOM_DIALOGUES,body?.monsterId??'')?RELEASE_ROOM_DIALOGUES[body.monsterId]:null
  if(body?.actorId!==user||!rows?.some(row=>row.id===body.dialogueId)||!Number.isInteger(body.choice)||body.choice<0||body.choice>3
   ||typeof body.idempotencyKey!=='string'||!body.idempotencyKey.trim()||body.idempotencyKey.length>200
   ||(body.partnerId!=null&&!uuid(body.partnerId))||(body.partnerId!=null&&(typeof body.pairVersion!=='string'||!/^[a-f0-9]{32}$/.test(body.pairVersion)))
   ||(body.partnerId==null&&body.pairVersion!=null))return reply({error:'invalid_request'},400)
  const result=await db.rpc('submit_release_room_v1',{p_user_id:user,p_monster_id:body.monsterId,p_dialogue_id:body.dialogueId,p_choice:body.choice,
   p_key:body.idempotencyKey,p_partner_id:body.partnerId??null,p_pair_version:body.pairVersion??null})
  if(result.error||!result.data)return reply({error:'release_unavailable'},503)
  const receipt=await withRewardWallet(db,user,result.data,{action:'release'})
  return reply(receipt,receipt.error?409:200)
 }catch{return reply({error:'release_unavailable'},503)}
}
