import {useSyncExternalStore} from 'react';
import {storage} from './storage';
import {kAdventureDelivery} from '../shared/storage/keys';
import {subscribeSessionIdentity} from './session-lifecycle';
import type {AdventureDelivery} from './adventure-delivery-queue';

let rows:AdventureDelivery[]|undefined,revision=0;
const listeners=new Set<()=>void>();
const emit=()=>{revision++;for(const listener of listeners)try{listener();}catch{/* Presentation cannot reject a durable intent. */}};
export function readAdventureDeliveryRows():readonly AdventureDelivery[]{
  if(!rows)try{const saved=JSON.parse(storage.getString(kAdventureDelivery.name)??'[]');rows=Array.isArray(saved)?saved.filter(j=>j&&typeof j.id==='string'&&typeof j.owner==='string'&&typeof j.scope==='string'&&typeof j.finish==='boolean'&&typeof j.treasure==='boolean'&&typeof j.treasureSaved==='boolean'&&typeof j.responseSaved==='boolean'):[];}catch{rows=[];}
  return rows!;
}
/** Single queue journal, not another entitlement/reward ledger. Commit first. */
export function saveAdventureDeliveryRows(next:AdventureDelivery[]){
  storage.set(kAdventureDelivery.name,JSON.stringify(next));rows=next;emit();
}
export const subscribeAdventureDelivery=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const adventureDeliveryRevision=()=>revision;
export function useAdventureDeliveryRevision(enabled=true){
  return useSyncExternalStore(enabled?subscribeAdventureDelivery:()=>()=>{},enabled?adventureDeliveryRevision:()=>0,()=>0);
}
subscribeSessionIdentity(()=>{rows=undefined;emit();});
