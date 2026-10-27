import {useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {validateTouchClip,type TouchClip} from '@novame/domain';
import {apiClient} from './api';
import {storage} from './storage';
import {kPlushieTouch,kPlushieTouchDraft,kPlushieTouchGuide,kPlushieTouchRecording} from '../shared/storage/keys';
import {validTouchCheckpoint,type TouchRecordingCheckpoint} from './plushie-touch-recorder';
import {getBurrowSnapshot} from './burrow-store';
import {sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {burrowArtForItem} from './burrow-art-assets';
import {loadRoomPhoto} from './burrow-room-photo-cache';
import {prepareBurrowImage} from './prepared-burrow-images';
import type {MajorUpdateBootstrap,MajorUpdateCatalogItem} from './app-major-update-api';
import {showBurrowToast} from './burrow-toast';
type Scope={user:string;partner:string;pair:string};
export type TouchSummary={id:string;sender_id:string;recipient_id:string;pair_version:string;toy_id:string;created_at:string;expires_at:string|null;read_at:string|null;touches?:number;toy?:MajorUpdateCatalogItem};
export type TouchMessage=TouchSummary&{clip:TouchClip;toy:MajorUpdateCatalogItem;photo:MajorUpdateBootstrap['roomPhotos'][number]|null};
type Meta={version:1|2;userId:string;partnerId:string;pairVersion:string;serverNow:string;localDate:string;hasPlus:boolean;remaining:number;sameDomain:boolean;items:TouchSummary[]};
type Payload={action:'send';protocol?:2;partnerId:string;pairVersion:string;localDate:string;key:string;toyId:string;photoId:string;clip:TouchClip};
type Job={scope:Scope;payload:Payload;state:'queued'|'committed'|'blocked';error?:string};
type State={scope:string;meta:Meta|null;prepared:Record<string,TouchMessage>;ready:string[];seen:string[];jobs:Job[];error:string|null};
const empty=():State=>({scope:'',meta:null,prepared:{},ready:[],seen:[],jobs:[],error:null});
let state=empty(),context:Scope|null=null,generation=0,pinned:string|null=null;
const listeners=new Set<()=>void>(),preparing=new Map<string,Promise<void>>();
let reading:Promise<void>|null=null,draining:Promise<void>|null=null,retry:ReturnType<typeof setTimeout>|undefined,failures=0;
const key=(s:Scope)=>`${s.user}:${s.partner}:${s.pair}`;
function live(s:Scope,own=generation){const snap=getBurrowSnapshot(),d=snap.data;return own===generation&&!snap.pairInvalidated&&s.user===sessionUserId()
 &&d?.profile.id===s.user&&d.partner?.id===s.partner&&d.pairVersion===s.pair;}
function emit(next:State,persist=true){
 // Durable state before optimistic publication; failed writes cannot pretend
 // that a send/seen intent has been safely accepted.
 if(persist)storage.set(kPlushieTouch.name,JSON.stringify({...next,prepared:{},ready:[],error:null}));
 state=next;for(const fn of listeners)try{fn();}catch{}
}
export const touchSnapshot=()=>state;
export const subscribeTouch=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export function usePlushieTouches(){return useSyncExternalStore(subscribeTouch,touchSnapshot,touchSnapshot);}
export function usePlushieTouchBadge(){return useSyncExternalStore(subscribeTouch,()=>context&&live(context)?state.meta?.items.filter(m=>m.recipient_id===context?.user&&!m.read_at&&!state.seen.includes(m.id)&&state.ready.includes(m.id)).length??0:0,()=>0);}
export function setPlushieTouchScope(next:Scope|null){
 if((context?key(context):'')===(next?key(next):''))return;
 context=next;generation++;pinned=null;pausePlushieTouch();reading=null;draining=null;preparing.clear();
 let restored=empty();
 if(next)try{const v=JSON.parse(storage.getString(kPlushieTouch.name)??'null');if(v?.scope===key(next)&&Array.isArray(v.jobs)&&Array.isArray(v.seen)
  &&[1,2].includes(v.meta?.version)&&Array.isArray(v.meta.items)){
   restored={...restored,scope:key(next),meta:v.meta,seen:v.seen.filter((s:unknown)=>typeof s==='string').slice(-70),
    jobs:v.jobs.filter((j:Job)=>j.scope&&key(j.scope)===key(next)&&validateTouchClip(j.payload?.clip)&&['queued','committed','blocked'].includes(j.state)).slice(-4)};
  }}catch{}
 // Never persist clips/inbox from another pair. Restored sends can also exist
 // before the first metadata read, e.g. a killed offline composer.
 if(next&&!restored.meta)try{const v=JSON.parse(storage.getString(kPlushieTouch.name)??'null');if(v?.scope===key(next)&&Array.isArray(v.jobs))
  restored.jobs=v.jobs.filter((j:Job)=>j.scope&&key(j.scope)===key(next)&&validateTouchClip(j.payload?.clip)&&['queued','committed','blocked'].includes(j.state)).slice(-4);}catch{}
 try{const draft=JSON.parse(storage.getString(kPlushieTouchDraft.name)??'null');if(draft&&(!next||draft.scope!==key(next)))storage.remove(kPlushieTouchDraft.name);}catch{}
 try{const recording=JSON.parse(storage.getString(kPlushieTouchRecording.name)??'null');if(recording&&(!next||recording.scope!==key(next)))storage.remove(kPlushieTouchRecording.name);}catch{}
 restored.scope=next?key(next):'';
 try{emit(restored);}catch{emit({...restored,error:'Local storage is unavailable. Please free up space and try again.'},false);}
}
export function pausePlushieTouch(){if(retry)clearTimeout(retry);retry=undefined;}
export function touchMessage(id:string|undefined){return id&&state.ready.includes(id)?state.prepared[id]:undefined;}
export function pinTouchMessage(id:string|null){pinned=id&&state.ready.includes(id)?id:null;}
export type TouchDraft={scope:string;toyId:string;photoId:string;clip:TouchClip;recoveryKey?:string};
export function touchDraft():TouchDraft|null{try{const d=JSON.parse(storage.getString(kPlushieTouchDraft.name)??'null');return context&&live(context)&&d?.scope===key(context)&&validateTouchClip(d.clip)?d:null;}catch{return null;}}
export function saveTouchDraft(toyId:string,photoId:string,clip:TouchClip,expectedScope?:string,recoveryKey?:string){if(!context||!live(context)||(expectedScope&&key(context)!==expectedScope)||!validateTouchClip(clip))throw Error('touch_not_ready');storage.set(kPlushieTouchDraft.name,JSON.stringify({scope:key(context),toyId,photoId,clip,...(recoveryKey?{recoveryKey}:{})}));}
export function discardTouchDraft(){storage.remove(kPlushieTouchDraft.name);}
export type TouchRecordingDraft={scope:string;toyId:string;photoId:string;checkpoint:TouchRecordingCheckpoint};
export function touchRecording():TouchRecordingDraft|null{try{const d=JSON.parse(storage.getString(kPlushieTouchRecording.name)??'null');
 return context&&live(context)&&d?.scope===key(context)&&typeof d.toyId==='string'&&typeof d.photoId==='string'&&validTouchCheckpoint(d.checkpoint)?d:null;
}catch{return null;}}
export function saveTouchRecording(toyId:string,photoId:string,checkpoint:TouchRecordingCheckpoint,expectedScope:string){
 if(!context||!live(context)||key(context)!==expectedScope||!validTouchCheckpoint(checkpoint))throw Error('touch_not_ready');
 storage.set(kPlushieTouchRecording.name,JSON.stringify({scope:key(context),toyId,photoId,checkpoint}));
}
export function discardTouchRecording(){storage.remove(kPlushieTouchRecording.name);}
export function recoverTouchJob(commandKey:string){const job=state.jobs.find(j=>j.payload.key===commandKey&&j.state==='blocked');if(!job||!context||!live(context))return null;
 saveTouchDraft(job.payload.toyId,job.payload.photoId,job.payload.clip,undefined,commandKey);return job.payload.clip;}
export function discardBlockedTouchJob(commandKey:string,expectedScope:string){
 if(!context||!live(context)||key(context)!==expectedScope)throw Error('touch_not_ready');
 const job=state.jobs.find(j=>j.payload.key===commandKey);if(job&&job.state!=='blocked')throw Error('touch_pending');
 emit({...state,jobs:state.jobs.filter(j=>j.payload.key!==commandKey)});
}
export function touchGuideSeen(){try{return context&&storage.getString(kPlushieTouchGuide.name)===context.user;}catch{return false;}}
export function acknowledgeTouchGuide(){if(context)storage.set(kPlushieTouchGuide.name,context.user);}
export async function prepareTouchMessage(id:string):Promise<void>{
 const s=context,own=generation;if(!s||!live(s,own))return;
 const row=state.meta?.items.find(m=>m.id===id);if(!row)return;
 const hit=state.prepared[id],photos=getBurrowSnapshot().data?.roomPhotos??[];
 if(hit&&state.ready.includes(id)&&(!hit.photo||photos.some(p=>p.id===hit.photo!.id&&p.updatedAt===hit.photo!.updatedAt)))return;
 const pending=preparing.get(id);if(pending)return pending;
 const task=(async()=>{
  const response=await apiClient.get<{version:1|2;userId:string;partnerId:string;pairVersion:string;message:TouchMessage}>(`/api/vnext/plushie-touch?pair=${s.pair}&v=2&id=${id}`);
  const m=response.message;
  if(![1,2].includes(response.version)||response.userId!==s.user||response.partnerId!==s.partner||response.pairVersion!==s.pair||!m||m.id!==id
   ||!((m.recipient_id===s.user&&m.sender_id===s.partner)||(response.version===2&&state.meta?.hasPlus&&m.sender_id===s.user&&m.recipient_id===s.partner))||m.pair_version!==s.pair||!validateTouchClip(m.clip))throw Error('touch_not_ready');
  const art=burrowArtForItem(m.toy,'couple_dolls');if(!art)throw Error('touch_asset_unavailable');
  await prepareBurrowImage(art.source,1024);
  if(m.photo)await loadRoomPhoto(m.photo);
  if(!live(s,own)||!state.meta?.items.some(item=>item.id===id))return;
  const ids=[...state.ready.filter(k=>k!==id&&k!==pinned),id].slice(-(pinned&&pinned!==id?5:6));
  if(pinned&&pinned!==id&&state.prepared[pinned])ids.push(pinned);
  const prepared={...state.prepared,[id]:m};
  for(const k of Object.keys(prepared))if(!ids.includes(k))delete prepared[k];
  emit({...state,prepared,ready:ids},false);
 })().finally(()=>{if(preparing.get(id)===task)preparing.delete(id);});preparing.set(id,task);return task;
}
export function refreshPlushieTouch():Promise<void>{
 const s=context,own=generation;if(!s||!live(s,own)||AppState.currentState!=='active')return Promise.resolve();if(reading)return reading;
 const task=(async()=>{
  try{
   const meta=await apiClient.get<Meta>(`/api/vnext/plushie-touch?pair=${s.pair}&v=2`);
   if(!live(s,own))return;
   if(![1,2].includes(meta.version)||meta.userId!==s.user||meta.partnerId!==s.partner||meta.pairVersion!==s.pair||!Array.isArray(meta.items))throw Error('touch_not_ready');
   const ids=meta.items.map(m=>m.id),prepared={...state.prepared};for(const id of Object.keys(prepared))if(!ids.includes(id))delete prepared[id];
   emit({...state,meta,prepared,ready:state.ready.filter(id=>ids.includes(id)),seen:state.seen.filter(id=>ids.includes(id)),error:null});
   await prepareTouchPage(0);failures=0;
  }catch(error){if(live(s,own)){
   const code=(error as {body?:{error?:string}})?.body?.error;
   if(code==='pair_changed'){emit({...empty(),scope:key(s),jobs:state.jobs.map(j=>({...j,state:'blocked',error:'pair_changed'}))});return;}
   emit({...state,error:'Could not refresh touches. Tap to retry.'},false);
   if(!retry)retry=setTimeout(()=>{retry=undefined;void refreshPlushieTouch();},Math.min(60000,2000*2**Math.min(failures++,5)));
  }}
 })().finally(()=>{if(reading===task)reading=null;});reading=task;return task;
}
export async function prepareTouchPage(page:number){
 const rows=state.meta?.items.slice(page*5,page*5+5)??[];let i=0;
 await Promise.all([0,1].map(async()=>{while(i<rows.length)await prepareTouchMessage(rows[i++].id);}));
}
export function queuePlushieTouch(toyId:string,photoId:string,clip:TouchClip,expectedScope?:string,recoveryKey?:string){
 const s=context;if(!s||!live(s)||(expectedScope&&key(s)!==expectedScope)||!validateTouchClip(clip))throw Error('touch_not_ready');
 if(!state.meta?.sameDomain)throw Error('economic_domain_conflict');
 if(state.jobs.some(j=>j.state==='queued'))throw Error('touch_pending');
 const recovered=recoveryKey?state.jobs.find(j=>j.payload.key===recoveryKey&&j.state==='blocked'&&j.payload.toyId===toyId&&j.payload.photoId===photoId&&JSON.stringify(j.payload.clip)===JSON.stringify(clip)):undefined;
 if(recoveryKey&&!recovered)throw Error('touch_not_ready');
 if(recovered){emit({...state,jobs:state.jobs.map(j=>j===recovered?{...j,state:'queued',error:undefined}:j),meta:{...state.meta,remaining:0}});try{discardTouchDraft();}catch{}void resumePlushieTouch();return recovered.payload.key;}
 if(!state.meta.remaining)throw Error('touch_quota_used');
 if(clip.version===2&&state.meta.version!==2)throw Error('touch_not_ready');
 const immutableClip:TouchClip={...clip,events:clip.events.map(e=>[...e])};
 const payload:Payload={action:'send',...(clip.version===2?{protocol:2 as const}:{}),partnerId:s.partner,pairVersion:s.pair,localDate:state.meta.localDate,key:randomUUID(),toyId,photoId,clip:immutableClip};
 const job:Job={scope:{...s},payload,state:'queued'};
 emit({...state,jobs:[...state.jobs.filter(j=>j.state==='blocked').slice(-1),job],meta:{...state.meta,remaining:0}});
 try{discardTouchDraft();}catch{}
 void resumePlushieTouch();return payload.key;
}
export function markTouchPlayed(id:string){
 const s=context;if(!s||!live(s)||!touchMessage(id))return;
 const row=state.meta?.items.find(m=>m.id===id);if(!row||row.recipient_id!==s.user||row.read_at)return;
 if(!state.seen.includes(id))emit({...state,seen:[...state.seen,id]});void resumePlushieTouch();
}
export function resumePlushieTouch():Promise<void>{
 const s=context,own=generation;if(!s||!live(s,own)||AppState.currentState!=='active')return Promise.resolve();if(draining)return draining;pausePlushieTouch();
 const task=(async()=>{
  try{
   for(const job of state.jobs.filter(j=>j.state==='queued')){
    if(!live(s,own)||AppState.currentState!=='active')return;
    try{
     const r=await apiClient.post<{success:boolean;version:number}>('/api/vnext/plushie-touch',job.payload);
     if(!live(s,own))return;if(!r.success||r.version!==1)throw Error('touch_not_ready');
     const committed:State={...state,jobs:state.jobs.map(j=>j.payload.key===job.payload.key?{...j,state:'committed'}:j)};
     // A storage failure after the receipt cannot turn this transaction into
     // a rejection. Retrying the original persisted key remains server-safe.
     try{emit(committed);}catch{emit(committed,false);}
    }catch(error){
     if(!live(s,own))return;const code=(error as {body?:{error?:string}})?.body?.error;
     if(['pair_changed','not_paired','feature_disabled','touch_quota_used','touch_period_expired','touch_toy_unavailable','economic_domain_conflict','invalid_request','idempotency_conflict'].includes(code??'')){
      emit({...state,jobs:state.jobs.map(j=>j.payload.key===job.payload.key?{...j,state:'blocked',error:code}:j)});
      showBurrowToast('Touch Note could not be sent. Your recording is saved; open your Plushie to recover it.',key(s));
     }
     else throw error;
    }
   }
   for(const id of state.seen){
    if(!live(s,own)||AppState.currentState!=='active')return;
    try{await apiClient.post('/api/vnext/plushie-touch',{action:'seen',protocol:2,pairVersion:s.pair,messageId:id});
     if(live(s,own))emit({...state,seen:state.seen.filter(k=>k!==id),meta:state.meta?{...state.meta,items:state.meta.items.map(m=>m.id===id?{...m,read_at:new Date().toISOString()}:m)}:null});}
    catch(error){if((error as {status?:number}).status!==404)throw error;
     if(live(s,own))emit({...state,seen:state.seen.filter(k=>k!==id)});}
   }
   await refreshPlushieTouch();
  }catch{if(live(s,own))retry=setTimeout(()=>{retry=undefined;void resumePlushieTouch();},Math.min(60000,2000*2**Math.min(failures++,5)));}
 })().finally(()=>{if(draining===task)draining=null;});draining=task;return task;
}
subscribeSessionIdentity(()=>{context=null;generation++;pinned=null;pausePlushieTouch();reading=null;draining=null;preparing.clear();emit(empty(),false);});
