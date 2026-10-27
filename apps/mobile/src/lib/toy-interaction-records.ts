import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { storage } from './storage';
import { kToyInputBatches } from '../shared/storage/keys';
import { burrowClock, getBurrowSnapshot, scheduleBurrowRefresh, plushiePhotoSyncState } from './burrow-store';
import { interactBurrowToyWindow } from './app-major-update-api';
import { sessionEpoch,sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { createToyInteractionBatcher, type ToyRecordQueue, type ToyRecordScope } from './toy-interaction-batcher';
import { toyPhotoFor } from './burrow-toy-photos';
import { burrowLocalDay } from './burrow-local-day';
import { questProgress } from './quest-progress-store';
import { coinRewardDefinitelyRejected } from './coin-reward-store';
import type { ToyRecordBatch } from './toy-interaction-batcher';
import {momentsCache} from './moments-cache';
let momentRefresh:ReturnType<typeof setTimeout>|undefined;
function confirmedToy(){
  scheduleBurrowRefresh();
  if(momentRefresh)clearTimeout(momentRefresh);
  const scope=current(),epoch=sessionEpoch();
  momentRefresh=setTimeout(()=>{momentRefresh=undefined;const latest=current(),data=getBurrowSnapshot().data;
    if(epoch===sessionEpoch()&&data&&scope&&latest&&scope.userId===latest.userId&&scope.partnerId===latest.partnerId&&scope.pairVersion===latest.pairVersion)
      void momentsCache.retry(data);
  },500);
}
const toyQuest=(scope:ToyRecordScope,batch:ToyRecordBatch)=>({
  scope:`${scope.userId}:${scope.partnerId??'solo'}:${scope.pairVersion??''}`,day:batch.localDate,questId:'interact_with_toy',
});

const KEY=kToyInputBatches.name;
function current():ToyRecordScope|null {
  const state=getBurrowSnapshot(),data=state.data;
  return !state.pairInvalidated&&data&&data.profile.id===sessionUserId()?{userId:data.profile.id,partnerId:data.partner?.id??null,
    pairVersion:data.pairVersion??null}:null;
}
let restored:ToyRecordQueue|null=null;
try {
  const v=JSON.parse(storage.getString(KEY)??'null');
  const batch=(b:ToyRecordQueue['batch'])=>!!b&&typeof b.id==='string'&&Number.isSafeInteger(b.count)&&b.count>0&&b.count<=50
    &&typeof b.toyId==='string'&&typeof b.photoId==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.localDate)
    &&[b.occurredAt,b.lastOccurredAt,b.windowStartedAt].every(t=>Number.isFinite(Date.parse(t)));
  if(v?.version===2&&typeof v.scope?.userId==='string'&&Array.isArray(v.pending)&&v.pending.every(batch)
    &&(!v.batch||batch(v.batch))&&(!v.windowStartedAt||Number.isFinite(Date.parse(v.windowStartedAt))))restored=v;
}catch{}
const batcher=createToyInteractionBatcher({current,uuid:randomUUID,restored,confirmed:confirmedToy,
  queued:(scope,batch)=>questProgress.fact(`toy:${batch.id}`,toyQuest(scope,batch),'pending'),
  rejected:(scope,batch)=>questProgress.fact(`toy:${batch.id}`,toyQuest(scope,batch),'rejected'),
  definitive:coinRewardDefinitelyRejected,
  active:()=>AppState.currentState==='active',
  persist:queue=>{try{if(queue)storage.set(KEY,JSON.stringify(queue));else storage.remove(KEY);}catch{}},
  send:async(scope,batch)=>{
    if(batch.photoId.startsWith('local-plushie-')){
      const status=plushiePhotoSyncState(batch.photoId);
      if(status==='pending')throw Error('photo_sync_pending');
      if(status==='failed'){
        questProgress.fact(`toy:${batch.id}`,toyQuest(scope,batch),'rejected');return;
      } // Definitive photo rollback must not grant task/Moments credit.
    }
    const receipt=await interactBurrowToyWindow(scope,batch);
    questProgress.fact(`toy:${batch.id}`,toyQuest(scope,batch),receipt?.skipped?'rejected':'confirmed');
  },
});
subscribeSessionIdentity(()=>{
  if(momentRefresh)clearTimeout(momentRefresh);momentRefresh=undefined;
  const queue=batcher.snapshot();
  if(!queue||queue.scope.userId!==sessionUserId())batcher.reset();
});
AppState.addEventListener('change',status=>{if(status==='active')void batcher.flush();else batcher.pause();});
/** Local faces qualify immediately; the background command verifies the upload
 * ticket after photo sync. Empty faces never enter the durable record queue. */
export function recordToyInteraction(toyId?:string){
  const scope=current(),state=getBurrowSnapshot(),data=state.data;
  if(!scope||!data||!toyId)return;
  const photo=toyPhotoFor(data.roomPhotos,scope.userId,toyId);
  if(!photo)return;
  const at=Date.parse(data.serverNow)+Math.max(0,burrowClock()-state.receivedAt);
  if(!Number.isFinite(at))return;
  batcher.enqueue(scope,{toyId,photoId:photo.id,occurredAt:new Date(at).toISOString(),
    localDate:burrowLocalDay(at,data.economicTimezone ?? data.profile.timezone_name)});
}
export function flushToyInteractions(){void batcher.flush();}
