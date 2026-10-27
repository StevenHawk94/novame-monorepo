import { useSyncExternalStore } from 'react';
import { listSurprises, type Surprise } from './surprise-api';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { rememberSurprises, rememberSurpriseOpened } from './surprise-history-cache';
let items:Surprise[]=[];let scope='';let pending:Promise<void>|null=null;let invalidation=0;
const listeners=new Set<()=>void>();const emit=()=>listeners.forEach(fn=>fn());
const refreshListeners=new Set<()=>void>();
export function subscribeSurpriseRefresh(fn:()=>void){refreshListeners.add(fn);return()=>{refreshListeners.delete(fn);};}
export function notifySurpriseChanged(){invalidation++;refreshListeners.forEach(fn=>fn());}
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
subscribeSessionIdentity(()=>{items=[];scope='';pending=null;emit();});
export function useSurpriseInbox(){return useSyncExternalStore(subscribe,()=>items,()=>items);}
export function refreshSurpriseInbox(nextScope:string):Promise<void>{
  if(scope!==nextScope){scope=nextScope;items=[];pending=null;emit();}
  if(pending)return pending;
  const epoch=sessionEpoch(),requested=invalidation;
  const task=listSurprises().then(result=>{if(epoch===sessionEpoch()&&scope===nextScope&&requested===invalidation){items=result.items;rememberSurprises(nextScope,items);emit();}}).finally(()=>{
    if(pending!==task)return;pending=null;
    // A broadcast may arrive while a pre-send snapshot is in flight. Do not
    // lose it to request deduplication or wait for the next 60-second poll.
    if(epoch===sessionEpoch()&&scope===nextScope&&requested!==invalidation)void refreshSurpriseInbox(nextScope).catch(()=>{});
  });
  pending=task;return task;
}
export function markSurpriseOpened(id:string){items=items.map(item=>item.id===id?{...item,opened_at:new Date().toISOString()}:item);rememberSurpriseOpened(scope,id);emit();}
