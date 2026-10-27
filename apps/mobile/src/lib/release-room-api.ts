import { ApiError } from '@novame/api-client';
import type { ReleaseMonsterId } from '@novame/domain';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { type CoinResponse } from './coin-reward-store';
import {coinOperations,enqueueCoinOperation,submitCoinOperation} from './coin-command-outbox';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { storage } from './storage';
import { kReleaseRoomStatus } from '../shared/storage/keys';
import { burrowLocalDay } from './burrow-local-day';

export type ReleaseMonsterStatus={id:ReleaseMonsterId;tamedCount:number;lastTamedAt:string|null;partnerTamedCount:number|null;partnerLastTamedAt:string|null};
export type ReleaseRoomStatus={monsters:ReleaseMonsterStatus[];hasPlus:boolean;dailyLimit:number;tamesToday:number;localDate:string;serverNow:string;partnerId:string|null;pairVersion:string|null};
export type ReleaseRoomReceipt=CoinResponse&{completionId:string;applied:boolean;tamedCount:number;victoryIndex:number;status:ReleaseRoomStatus;error?:string};
export type ReleaseAttempt={actorId:string;partnerId:string|null;pairVersion:string|null;monsterId:ReleaseMonsterId;dialogueId:string;choice:number;idempotencyKey:string};
type Identity=Pick<MajorUpdateBootstrap,'profile'|'partner'|'pairVersion'>;
export const releaseRoomScope=(data:Identity)=>`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`;
let cached:{scope:string;value:ReleaseRoomStatus}|null=null;
let pending:{scope:string;epoch:number;promise:Promise<ReleaseRoomStatus>}|null=null;
function remember(scope:string,value:ReleaseRoomStatus){
 if(cached?.scope===scope&&Date.parse(cached.value.serverNow)>Date.parse(value.serverNow))return;
 cached={scope,value};
 try{
  // Counts are display-only and scoped to this exact relationship. Background
  // sync refreshes them; the submit RPC still enforces today's real quota.
  const personal=value;
  storage.set(kReleaseRoomStatus.name,JSON.stringify({scope,value:personal,savedAt:Date.now()}));
 }catch{}
}
subscribeSessionIdentity(()=>{cached=null;pending=null;});
// Also observes confirmations after an automatic retry or app restart, when
// the original page/promise no longer exists.
coinOperations.subscribeSettled(({operation,receipt,error})=>{
 if(operation.path!=='/api/vnext/release-room'||operation.owner!==sessionUserId())return;
 const value=error?failure(error).status:(receipt as ReleaseRoomReceipt)?.status;
 if(value&&value.partnerId===operation.payload.partnerId&&value.pairVersion===operation.payload.pairVersion)
  remember(`${operation.owner}:${value.partnerId??''}:${value.pairVersion??''}`,value);
});
function projectedStatus(scope:string,value:ReleaseRoomStatus):ReleaseRoomStatus {
 let result=value;
 for(const row of coinOperations.pending()){
  const p=row.display;
  if(row.path!=='/api/vnext/release-room'||p?.scope!==scope||p.localDate!==value.localDate
   ||row.payload.partnerId!==value.partnerId||row.payload.pairVersion!==value.pairVersion
   ||!Number.isSafeInteger(p.tamesToday)||Number(p.tamesToday)<1||Number(p.tamesToday)>2
   ||!Number.isSafeInteger(p.tamedCount)||Number(p.tamedCount)<1||typeof p.at!=='string'||!Number.isFinite(Date.parse(p.at)))continue;
  const at=p.at;
  result={...result,tamesToday:Math.max(result.tamesToday,p.tamesToday as number),monsters:result.monsters.map(monster=>
   monster.id===row.payload.monsterId?{...monster,tamedCount:Math.max(monster.tamedCount,p.tamedCount as number),
    lastTamedAt:!monster.lastTamedAt||monster.lastTamedAt<at?at:monster.lastTamedAt}:monster)};
 }
 return result;
}
export function releaseStatusCurrent(value:ReleaseRoomStatus,timeZone='UTC',now=Date.now()){
 try{return value.localDate===burrowLocalDay(now,timeZone)&&Number.isInteger(value.tamesToday)&&value.tamesToday>=0
  &&[1,2].includes(value.dailyLimit)&&Number.isFinite(Date.parse(value.serverNow));}catch{return false;}
}
export function cachedReleaseRoom(scope:string,timeZone?:string,hasPlus?:boolean):ReleaseRoomStatus|null{
 if(!cached||cached.scope!==scope){
  try{
   const saved=JSON.parse(storage.getString(kReleaseRoomStatus.name)??'null');
   if(saved?.scope===scope&&scope.split(':')[0]===sessionUserId()&&Array.isArray(saved.value?.monsters)
    &&Number.isFinite(saved.savedAt)&&Date.now()>=saved.savedAt)cached={scope,value:saved.value};
  }catch{}
 }
 let value=cached?.scope===scope?cached.value:null;
 if(value&&timeZone&&Number.isFinite(Date.parse(value.serverNow))) {
  const day=burrowLocalDay(Date.now(),timeZone);
  if(value.localDate<day)value={...value,localDate:day,tamesToday:0};
 }
 if(value&&hasPlus!==undefined&&value.hasPlus!==hasPlus)value={...value,hasPlus,dailyLimit:hasPlus?2:1};
 return value&&(!timeZone||releaseStatusCurrent(value,timeZone))&&(hasPlus===undefined||hasPlus===value.hasPlus)?projectedStatus(scope,value):null;
}
const matches=(status:ReleaseRoomStatus,data:Identity)=>status.partnerId===(data.partner?.id??null)&&status.pairVersion===(data.pairVersion??null);
export class ReleaseRoomError extends Error{
 constructor(public code:string,public status?:ReleaseRoomStatus){super(code);}
}
function failure(error:unknown):ReleaseRoomError{
 if(error instanceof ReleaseRoomError)return error;
 const body=error instanceof ApiError?error.body as {error?:string;status?:ReleaseRoomStatus}:null;
 return new ReleaseRoomError(body?.error??'release_unavailable',body?.status);
}
export async function fetchReleaseRoom(data:Identity,signal?:AbortSignal):Promise<ReleaseRoomStatus>{
 const epoch=sessionEpoch(),scope=releaseRoomScope(data);
 try{
  if(signal?.aborted)throw new ReleaseRoomError('read_cancelled');
  if(!pending||pending.scope!==scope||pending.epoch!==epoch){
   const read={scope,epoch,promise:Promise.resolve(null as unknown as ReleaseRoomStatus)};
   read.promise=withDeadline(apiClient.get<ReleaseRoomStatus&{error?:string}>('/api/vnext/release-room'),15000).then(result=>{
    if(epoch!==sessionEpoch())throw new ReleaseRoomError('session_changed');
    if(result.error)throw new ReleaseRoomError(result.error);
    if(!matches(result,data))throw new ReleaseRoomError('pair_changed');
    if(!Array.isArray(result.monsters)||!Number.isInteger(result.dailyLimit)||!Number.isInteger(result.tamesToday))throw new ReleaseRoomError('release_unavailable');
    if(pending===read)remember(scope,result);return cached?.scope===scope?cached.value:result;
   }).finally(()=>{if(pending===read)pending=null;});
   pending=read;
  }
  // Shared prewarm/read outlives a screen. An aborted subscriber cannot cancel
  // another screen's read, but must never receive or display its late result.
  const result=await pending.promise;
  if(signal?.aborted)throw new ReleaseRoomError('read_cancelled');
  if(epoch!==sessionEpoch())throw new ReleaseRoomError('session_changed');
  if(!matches(result,data))throw new ReleaseRoomError('pair_changed');
  if(!Array.isArray(result.monsters)||!Number.isInteger(result.dailyLimit))throw new ReleaseRoomError('release_unavailable');
  return projectedStatus(scope,result);
 }catch(error){throw failure(error);}
}
/** Legacy receipt API; the screen uses the durable optimistic queue below. */
export async function submitReleaseRoom(attempt:ReleaseAttempt):Promise<{receipt:ReleaseRoomReceipt;rewardId:string}>{
 const epoch=sessionEpoch(),rewardId=`release-ui:${attempt.idempotencyKey}`;
 try{
  const receipt=await submitCoinOperation<ReleaseRoomReceipt>({id:rewardId,key:`release:${attempt.idempotencyKey}`,amount:10,deferred:true,path:'/api/vnext/release-room',payload:{...attempt}});
  if(epoch!==sessionEpoch())throw new ReleaseRoomError('session_changed');
  if(receipt.error)throw new ReleaseRoomError(receipt.error,receipt.status);
  if(!receipt.status||receipt.status.partnerId!==attempt.partnerId||receipt.status.pairVersion!==attempt.pairVersion)throw new ReleaseRoomError('pair_changed');
  remember(`${attempt.actorId}:${attempt.partnerId??''}:${attempt.pairVersion??''}`,receipt.status);
  return {receipt,rewardId};
 }catch(error){
  const rejected=failure(error);
  if(epoch===sessionEpoch()&&rejected.status?.partnerId===attempt.partnerId&&rejected.status?.pairVersion===attempt.pairVersion)
   remember(`${attempt.actorId}:${attempt.partnerId??''}:${attempt.pairVersion??''}`,rejected.status);
  throw rejected;
 }
}
export function queueReleaseRoom(attempt:ReleaseAttempt,baseline:ReleaseRoomStatus){
 const scope=`${attempt.actorId}:${attempt.partnerId??''}:${attempt.pairVersion??''}`,rewardId=`release-ui:${attempt.idempotencyKey}`;
 if(attempt.actorId!==sessionUserId()||baseline.partnerId!==attempt.partnerId||baseline.pairVersion!==attempt.pairVersion)throw new ReleaseRoomError('session_changed');
 const monster=baseline.monsters.find(row=>row.id===attempt.monsterId);if(!monster)throw new ReleaseRoomError('invalid_request');
 const confirmed=enqueueCoinOperation<ReleaseRoomReceipt>({id:rewardId,key:`release:${attempt.idempotencyKey}`,amount:10,deferred:true,
  path:'/api/vnext/release-room',payload:{...attempt},display:{scope,localDate:baseline.localDate,
   tamesToday:baseline.tamesToday+1,tamedCount:monster.tamedCount+1,at:new Date().toISOString()}});
 return {rewardId,tamedCount:monster.tamedCount+1,status:projectedStatus(scope,baseline),
  pending:()=>coinOperations.has(rewardId),confirmed:confirmed.catch(error=>{throw failure(error);})};
}
