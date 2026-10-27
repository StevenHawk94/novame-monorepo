import {useSyncExternalStore} from 'react';
import {randomUUID} from 'expo-crypto';
import {apiClient} from './api';
import {storage} from './storage';
import {kBunnyIdentity} from '../shared/storage/keys';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {isBunnyVariant,type BunnyIdentity,type BunnyVariant} from './bunny-identity-model';
export type {BunnyIdentity,BunnyVariant} from './bunny-identity-model';
type Saved={owner:string;applied:BunnyVariant;confirmed?:BunnyIdentity;intent?:{variant:BunnyVariant;key:string}};
let saved:Saved|null=null,loaded:string|null=null,flight:Promise<void>|null=null;
const listeners=new Set<()=>void>();
const notify=()=>{for(const fn of listeners)try{fn();}catch{}};
function read(){
 const owner=sessionUserId()??null;if(loaded===owner)return saved;
 loaded=owner;saved=null;
 if(owner)try{const value=JSON.parse(storage.getString(kBunnyIdentity.name)??'null');
  if(value?.owner===owner&&isBunnyVariant(value.applied))saved=value;
 }catch{}
 return saved;
}
function write(next:Saved){storage.set(kBunnyIdentity.name,JSON.stringify(next));saved=next;loaded=next.owner;}
export function bunnyVariant(owner=sessionUserId()??''):BunnyVariant{
 const value=read();
 if(value?.owner===owner)return value.applied;
 return value?.confirmed?.partnerId===owner?value.confirmed.partnerVariant??'biscuit':'biscuit';
}
export function useBunnyVariant(owner?:string){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>bunnyVariant(owner),()=>bunnyVariant(owner));}
export function knownBunnyIdentity(){return read()?.confirmed;}
export function useBunnyIdentity(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},knownBunnyIdentity,knownBunnyIdentity);}
export function queueBunnySelection(variant:BunnyVariant){
 const owner=sessionUserId();if(!owner)throw Error('session_changed');
 const value=read();if(value?.confirmed?.finalized)return;
 if(value?.intent?.variant===variant)return; // retry replays original immutable key
 write({owner,applied:variant,confirmed:value?.confirmed,intent:{variant,key:randomUUID()}});notify();
}
export function observeBunnyIdentity(identity:BunnyIdentity){
 if(identity.userId!==sessionUserId())return;
 const value=read();if(value?.confirmed&&identity.revision<value.confirmed.revision)return;
 if(value?.confirmed&&JSON.stringify(value.confirmed)===JSON.stringify(identity))return;
 write({owner:identity.userId,applied:value?.applied??identity.variant??'biscuit',intent:value?.intent,confirmed:identity});
 // Metadata may change silently; only applied colour subscribers repaint.
 notify();
}
export function syncBunnyIdentity(finalize=false):Promise<void>{
 if(flight)return finalize?flight.then(()=>syncBunnyIdentity(true)):flight;
 const owner=sessionUserId(),epoch=sessionEpoch();if(!owner)return Promise.resolve();
 const current=()=>owner===sessionUserId()&&epoch===sessionEpoch();
 const task=(async()=>{
  const intent=read()?.intent;
  if(intent){
   try{
    const receipt=await apiClient.post<BunnyIdentity&{error?:string}>('/api/vnext/bunny',intent);
    if(!current())return;if(receipt.error)throw Error(receipt.error);
    observeBunnyIdentity(receipt);
   }catch(error){
    const code=(error as {body?:{error?:string}})?.body?.error;
    if(!current())return;
    if(code!=='bunny_finalized')throw error;
    // The partner paired first and the server resolved a same-colour clash.
    // This is an authoritative selection, not a request to retry the old colour.
    const receipt=await apiClient.get<BunnyIdentity>('/api/vnext/bunny');
    if(!current())return;observeBunnyIdentity(receipt);
   }
   const value=read();if(value?.intent?.key===intent.key)write({...value,intent:undefined});
  }
  const identity=await apiClient.get<BunnyIdentity>(`/api/vnext/bunny${finalize?'?finalize=1':''}`);
  if(current())observeBunnyIdentity(identity);
 })().finally(()=>{if(flight===task)flight=null;});
 flight=task;return task;
}
/** Called only on a NEW Home entry. No incoming message swaps a visible bunny. */
export async function adoptBunnyOnHome(prepare:(variant:BunnyVariant)=>Promise<unknown>,current:()=>boolean){
 const owner=sessionUserId(),epoch=sessionEpoch();
 const identity=read()?.confirmed;
 if(!owner||!identity?.variant||bunnyVariant()===identity.variant)return;
 await prepare(identity.variant);
 if(!current()||epoch!==sessionEpoch()||owner!==sessionUserId()||read()?.confirmed?.revision!==identity.revision)return;
 const value=read();if(value){write({...value,applied:identity.variant});notify();}
}
subscribeSessionIdentity(()=>{saved=null;loaded=null;flight=null;notify();});
