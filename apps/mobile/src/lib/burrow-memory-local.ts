import { useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { storage } from './storage';
import { kBurrowMemoryLocal } from '../shared/storage/keys';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { getBurrowSnapshot } from './burrow-store';

export type MemoryScope = { userId: string; partnerId: string; pairVersion?: string };
export type MemoryDraft = { entryId: string | null; body: string; promptId: string | null; expectedUpdatedAt: string | null; revision: string };
export type MemoryJob = { id: string; draft: MemoryDraft; blocked: boolean; error: string | null; pairVersion?: string };
type LocalState = { version: 1; drafts: Record<string,MemoryDraft>; jobs: MemoryJob[] };
let version=0;
const listeners=new Set<()=>void>();
const retryListeners=new Set<()=>void>();
export const subscribeMemoryRetry=(fn:()=>void)=>{retryListeners.add(fn);return()=>{retryListeners.delete(fn);};};
const publish=()=>{version++;listeners.forEach(fn=>fn());};
export const subscribeMemoryLocal=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
subscribeSessionIdentity(publish);
const key=(scope:MemoryScope)=>`${kBurrowMemoryLocal.prefix}${scope.userId}:${scope.partnerId}`;
const draftKey=(entryId:string|null)=>entryId??'new';
const validDraft=(d:MemoryDraft)=>d && typeof d.body==='string'&&d.body.length<=5000&&typeof d.revision==='string'
  &&(d.entryId===null||typeof d.entryId==='string')&&(d.promptId===null||typeof d.promptId==='string')
  &&(d.expectedUpdatedAt===null||typeof d.expectedUpdatedAt==='string');
export function readMemoryLocal(scope:MemoryScope):LocalState {
  const raw=storage.getString(key(scope));
  if(!raw)return {version:1,drafts:{},jobs:[]};
  try {
    const value=JSON.parse(raw) as LocalState;
    if(value.version!==1||!value.drafts||Array.isArray(value.drafts)||!Array.isArray(value.jobs)||value.jobs.length>20
      ||!Object.values(value.drafts).every(validDraft)||!value.jobs.every(j=>typeof j.id==='string'&&typeof j.blocked==='boolean'&&validDraft(j.draft))) throw Error();
    return value;
  } catch { throw Error('local_data_unavailable'); } // Preserve unknown/corrupt bytes.
}
function write(scope:MemoryScope,state:LocalState){storage.set(key(scope),JSON.stringify(state));publish();}
export function saveMemoryDraft(scope:MemoryScope,draft:Omit<MemoryDraft,'revision'>) {
  const state=readMemoryLocal(scope),next={...draft,revision:randomUUID()};
  if(!validDraft(next))throw Error('invalid_request');
  state.drafts[draftKey(next.entryId)]=next;write(scope,state);return next;
}
export function clearMemoryDraft(scope:MemoryScope,entryId:string|null) {
  const state=readMemoryLocal(scope);delete state.drafts[draftKey(entryId)];write(scope,state);
}
export function queueMemoryDraft(scope:MemoryScope,draft:MemoryDraft) {
  const state=readMemoryLocal(scope);
  if(!draft.body.trim())throw Error('invalid_request');
  if(state.jobs.some(j=>j.draft.revision===draft.revision))return;
  if(state.jobs.length>=20)throw Error('queue_full');
  if(draft.entryId&&state.jobs.some(j=>j.draft.entryId===draft.entryId))throw Error('entry_pending');
  state.jobs.push({id:randomUUID(),draft:{...draft},blocked:false,error:null,pairVersion:scope.pairVersion});
  if(state.drafts[draftKey(draft.entryId)]?.revision===draft.revision)delete state.drafts[draftKey(draft.entryId)];
  write(scope,state); // Persist BEFORE any request; no local success fiction.
}
export function useMemoryLocalRevision(){return useSyncExternalStore(subscribeMemoryLocal,()=>version,()=>version);}
export function retryMemoryJobs(scope:MemoryScope) {
  const state=readMemoryLocal(scope);state.jobs.forEach(job=>{if(!job.blocked)job.error=null;});write(scope,state);
  retryListeners.forEach(fn=>fn());
}
/** Conflicts require user review. Copy into the editor; never overwrite a
 * possibly committed server record automatically. The original retry remains. */
export function copyMemoryJobToDraft(scope:MemoryScope,id:string) {
  const state=readMemoryLocal(scope),job=state.jobs.find(j=>j.id===id);
  if(!job)return;
  if(state.drafts.new?.body.trim())throw Error('draft_exists');
  return saveMemoryDraft(scope,{entryId:null,body:job.draft.body,promptId:job.draft.promptId,expectedUpdatedAt:null});
}
export function forgetBlockedMemoryJob(scope:MemoryScope,id:string) {
  const state=readMemoryLocal(scope);state.jobs=state.jobs.filter(j=>j.id!==id||!j.blocked);write(scope,state);
}
const flights=new Map<string,number>();
/** Only explicit Save jobs are replayed. Unsubmitted drafts never leave disk. */
export async function recoverMemoryJobs(scope:MemoryScope):Promise<boolean> {
  const scopeKey=key(scope),epoch=sessionEpoch();
  const startedPairVersion=getBurrowSnapshot().data?.pairVersion;
  if(flights.get(scopeKey)===epoch)return true;
  flights.set(scopeKey,epoch);
  const current=()=>{
    const snap=getBurrowSnapshot();
    return epoch===sessionEpoch()&&!snap.error&&snap.data?.profile.id===scope.userId&&snap.data.partner?.id===scope.partnerId&&snap.data.pairVersion===startedPairVersion;
  };
  try {
    if(!current())return true;
    for(const job of readMemoryLocal(scope).jobs.filter(j=>!j.blocked)) {
      if(!current())return true;
      const pairVersion=getBurrowSnapshot().data?.pairVersion;
      if(!pairVersion||job.pairVersion!==pairVersion){
        const latest=readMemoryLocal(scope),pending=latest.jobs.find(j=>j.id===job.id);
        if(pending){pending.blocked=true;pending.error='pair_changed';write(scope,latest);}
        continue;
      }
      try {
        const result=await withDeadline(apiClient.post<{success?:boolean;error?:string}>('/api/vnext/command',{
          action:'save_memory_durable',actorId:scope.userId,partnerId:scope.partnerId,pairVersion:job.pairVersion,idempotencyKey:job.id,
          entryId:job.draft.entryId,body:job.draft.body,promptId:job.draft.promptId,expectedUpdatedAt:job.draft.expectedUpdatedAt,
        }),20_000);
        if(result.error)throw Error(result.error);
        if(!result.success)throw Error('network_error');
        if(!current())return true;
        const latest=readMemoryLocal(scope);latest.jobs=latest.jobs.filter(j=>j.id!==job.id);write(scope,latest);
      } catch(error) {
        if(!current())return true;
        const code=(error as {body?:{error?:string}})?.body?.error??(error instanceof Error?error.message:'network_error');
        const blocked=['memory_conflict','not_found','invalid_request','idempotency_conflict','pair_changed','feature_disabled','not_paired'].includes(code);
        const latest=readMemoryLocal(scope),pending=latest.jobs.find(j=>j.id===job.id);
        if(pending){pending.blocked=blocked;pending.error=blocked?code:'network_error';write(scope,latest);}
        if(!blocked)return false;
      }
    }
    return true;
  } catch { return false; }
  finally {if(flights.get(scopeKey)===epoch)flights.delete(scopeKey);}
}
