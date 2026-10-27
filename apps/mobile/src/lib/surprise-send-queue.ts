import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { storage } from './storage';
import { kSurpriseOutbox } from '@/shared/storage/keys';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { apiClient } from './api';
import { sendSurprise, saveSurpriseDraft, readSurpriseDraft, releaseSurpriseFile, type SurpriseDraft } from './surprise-api';
import { uploadSurpriseInBackground, clearConfirmedSurpriseUploads } from './surprise-send-transport';
import { rememberSurprises } from './surprise-history-cache';
import { keepSentSurpriseMedia } from './surprise-media-cache';
import { syncCoinWallet, projectCoinSpend, settleCoinSpend, rejectCoinSpend } from './coin-reward-store';
import type { CoinWalletState } from './coin-reward-ledger';
import { withDeadline } from './async-lifecycle';
import { notifySurpriseChanged } from './surprise-inbox';
import { randomUUID } from 'expo-crypto';
import { prepareSurprise } from './surprise-preparation';

export type SurpriseSendJob={draft:SurpriseDraft;queuedAt:number;state:'queued'|'sending'|'failed'|'sent';
  error?:string;reason?:string;failureStage?:'receipt'|'send';sentId?:string;sentAt?:string;paid?:boolean};
const spendKey=(draft:SurpriseDraft)=>`surprise-send:${draft.key}`;
function project(job:SurpriseSendJob){if(job.draft.deliveryVersion===1&&job.state!=='failed'&&job.state!=='sent')projectCoinSpend(spendKey(job.draft),job.draft.expectedPrice??0);}
type Context={userId:string;partnerId:string;pairVersion:string;verified:boolean};
let context:Context|null=null,jobs:SurpriseSendJob[]=[],loadedFor:string|null|undefined,flight:Promise<void>|null=null;
let generation=0,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
const listeners=new Set<()=>void>();const emit=()=>listeners.forEach(fn=>fn());
const scope=(d:Pick<SurpriseDraft,'userId'|'partnerId'|'pairVersion'>)=>`${d.userId}:${d.partnerId}:${d.pairVersion}`;
const matchesContext=(job:SurpriseSendJob)=>!!context&&scope(job.draft)===scope(context)&&context.userId===sessionUserId();
const belongs=(job:SurpriseSendJob)=>!!context?.verified&&matchesContext(job);
function hydrate(){
  const user=sessionUserId();if(user===loadedFor)return;loadedFor=user;jobs=[];
  try{const saved=JSON.parse(storage.getString(kSurpriseOutbox.name)||'[]');
    if(Array.isArray(saved))jobs=saved.filter(j=>j?.draft?.userId===user&&typeof j.draft.key==='string'&&typeof j.queuedAt==='number')
      .map(j=>({...j,state:j.state==='sending'?'queued':j.state}));
  }catch{}
  jobs.forEach(project);
}
function persist(next:SurpriseSendJob[]){storage.set(kSurpriseOutbox.name,JSON.stringify(next));jobs=next;emit();}
function change(key:string,update:Partial<SurpriseSendJob>){persist(jobs.map(j=>j.draft.key===key?{...j,...update}:j));}
export function useSurpriseOutbox(){
  hydrate();return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>jobs,()=>jobs);
}
export function setSurpriseDeliveryContext(next:Context|null){
  const previous=context;
  const pairChanged=scopeOrEmpty(next)!==scopeOrEmpty(previous);
  const changed=pairChanged||next?.verified!==previous?.verified;context=next;hydrate();
  if(changed){generation++;attempts=0;if(timer)clearTimeout(timer);timer=undefined;
    if(jobs.some(j=>j.state==='sending'))persist(jobs.map(j=>j.state==='sending'?{...j,state:'queued'}:j));
  }
  if(pairChanged&&previous&&previous.userId===sessionUserId()){
    const retired=jobs.filter(j=>scope(j.draft)===scope(previous));
    persist(jobs.filter(j=>scope(j.draft)!==scope(previous)));
    for(const job of retired){rejectCoinSpend(spendKey(job.draft));void releaseSurpriseFile(job.draft.photoUri);void releaseSurpriseFile(job.draft.audioUri);}
  }
}
const scopeOrEmpty=(value:Context|null)=>value?scope(value):'';
/** Persist intent before acknowledging it. Project spending, never fake a server receipt. */
export function enqueueSurprise(draft:SurpriseDraft){
  hydrate();if(!context||!matchesContext({draft} as SurpriseSendJob)||!draft.locked||!draft.photoUri||!draft.audioUri)throw Error('pair_changed');
  const previous=jobs.find(j=>j.draft.key===draft.key);
  if(previous){if(previous.state==='failed')change(draft.key,{state:'queued',error:undefined,reason:undefined});}
  else{
    if(jobs.filter(j=>j.state!=='sent').length>=20)throw Error('outbox_full');
    persist([...jobs.filter(j=>j.state!=='sent'||j.sentAt&&Date.now()-Date.parse(j.sentAt)<30*86400000),{draft:{...draft},queuedAt:Date.now(),state:'queued'}]);
  }
  const job=jobs.find(j=>j.draft.key===draft.key);if(job)project(job);
  // A later task, never inline work during the tap/closing transition.
  if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void resumeSurpriseOutbox();},250);
}
export function retrySurpriseSend(key:string){
  hydrate();const job=jobs.find(j=>j.draft.key===key);if(!job||!belongs(job)||job.state==='sent')return;
  change(key,{state:'queued',error:undefined,reason:undefined});project({...job,state:'queued'});attempts=0;void resumeSurpriseOutbox();
}
export const canEditRejectedSurprise=(job:SurpriseSendJob)=>job.state==='failed'&&job.failureStage==='send'&&
  ['invalid_request','price_changed','price_confirmation_required','insufficient_balance','plus_required','draft_expired','not_for_sale'].includes(job.error??'');
/** Only an explicitly rejected upload may be revised. Unknown/committed sends
 * keep their immutable identity; do not create a new potentially-paid retry. */
export function reviseRejectedSurprise(key:string){
  hydrate();const job=jobs.find(j=>j.draft.key===key);if(!job||!belongs(job)||!canEditRejectedSurprise(job))return null;
  rejectCoinSpend(spendKey(job.draft));
  const next={...job.draft,key:randomUUID(),locked:false,sentId:undefined,expectedPrice:undefined};
  persist(jobs.filter(j=>j!==job));saveSurpriseDraft(next);return next;
}
export function resumeSurpriseOutbox():Promise<void>{
  hydrate();if(flight)return flight;if(!context?.verified||AppState.currentState!=='active')return Promise.resolve();
  if(timer)clearTimeout(timer);timer=undefined;
  const own=generation,epoch=sessionEpoch();
  const task=(async()=>{
    while(AppState.currentState==='active'){
      const job=jobs.find(j=>belongs(j)&&j.state==='queued');if(!job)return;
      const current=()=>generation===own&&epoch===sessionEpoch()&&belongs(job);
      let stage:'receipt'|'send'='receipt';
      if(!current()||AppState.currentState!=='active')return;
      try{
        change(job.draft.key,{state:'sending',error:undefined});
        // Lost acknowledgements recover cheaply, without rereading/reuploading media.
        const status=await withDeadline(apiClient.get<{committed:boolean;paid?:boolean;id?:string;sentAt?:string;wallet?:{balance:number;version:number};coinState?:CoinWalletState}>(`/api/vnext/surprise?key=${encodeURIComponent(job.draft.key)}&partnerId=${encodeURIComponent(job.draft.partnerId)}&pairVersion=${encodeURIComponent(job.draft.pairVersion)}`));
        if(!current())return;
        const paid=(receipt:{wallet?:{balance:number;version:number};coinState?:CoinWalletState})=>{
          if(!current())return;
          change(job.draft.key,{paid:true});settleCoinSpend(spendKey(job.draft),receipt.wallet,receipt.coinState);
        };
        if(status.paid)paid(status);
        if(!status.committed)stage='send';
        const receipt=status.committed&&status.id ? {id:status.id,sentAt:status.sentAt,wallet:status.wallet,coinState:status.coinState}
          : await sendSurprise(job.draft,uploadSurpriseInBackground,paid,status.paid===true);
        if(!current())return;
        if(receipt.wallet)syncCoinWallet(receipt.wallet,receipt.coinState);
        if(job.draft.deliveryVersion===1)settleCoinSpend(spendKey(job.draft),receipt.wallet,receipt.coinState);
        await clearConfirmedSurpriseUploads(job.draft.key).catch(()=>{});
        const sentAt=receipt.sentAt??new Date().toISOString();
        // Original draft files stay pinned until this copy succeeds. Disk-full
        // cannot erase a paid gift or change the confirmed financial outcome.
        let archived=false;
        try{await keepSentSurpriseMedia(job.draft.userId,job.draft.pairVersion,receipt.id,job.draft.photoUri!,job.draft.audioUri!);archived=true;}catch{}
        if(!current())return;
        const message={id:receipt.id,sender_id:job.draft.userId,recipient_id:job.draft.partnerId,
          frame:job.draft.frame,duration_ms:job.draft.durationMs!,sent_at:sentAt,opened_at:null};
        rememberSurprises(scope(job.draft),[message]);
        void prepareSurprise(scope(job.draft),message).catch(()=>{});
        change(job.draft.key,{state:'sent',sentId:receipt.id,sentAt,error:undefined});
        notifySurpriseChanged();
        const latest=readSurpriseDraft(job.draft.userId,job.draft.partnerId,job.draft.pairVersion);
        if(latest?.key===job.draft.key)saveSurpriseDraft({...latest,sentId:receipt.id});
        if(archived){void releaseSurpriseFile(job.draft.photoUri);void releaseSurpriseFile(job.draft.audioUri);}
        attempts=0;
      }catch(error){
        if(!current())return;
        const failure=error as {status?:number;body?:{error?:string;reason?:string}};
        const code=failure.body?.error??(error instanceof Error?error.message:'send_result_unknown');
        const rejected=!!failure.status&&failure.status>=400&&failure.status<500&&![408,429].includes(failure.status);
        // Financial conflicts and transient upload/rate-limit failures are not
        // equivalent. Only explicit rejection cancels an undelivered paid order.
        if(rejected&&job.draft.deliveryVersion===1){
          try{
            const cancelled=await withDeadline(apiClient.post<{committed?:boolean;id?:string;sentAt?:string;wallet?:{balance:number;version:number};coinState?:CoinWalletState}>('/api/vnext/surprise',{action:'cancel_paid',key:job.draft.key}));
            if(!current())return;
            if(cancelled.committed){
              settleCoinSpend(spendKey(job.draft),cancelled.wallet,cancelled.coinState);
              change(job.draft.key,{state:'sent',sentId:cancelled.id,sentAt:cancelled.sentAt,error:undefined});continue;
            }
            if(cancelled.wallet)syncCoinWallet(cancelled.wallet,cancelled.coinState);
            change(job.draft.key,{paid:false});
            rejectCoinSpend(spendKey(job.draft));
          }catch{
            if(!current())return;
            change(job.draft.key,{state:'queued',error:'send_result_unknown'});
            timer=setTimeout(()=>{timer=undefined;void resumeSurpriseOutbox();},5000);return;
          }
        }
        change(job.draft.key,{state:rejected?'failed':'queued',error:code,reason:failure.body?.reason,failureStage:stage});
        if(rejected)continue;
        if(AppState.currentState==='active')timer=setTimeout(()=>{timer=undefined;void resumeSurpriseOutbox();},Math.min(60_000,2000*2**Math.min(attempts++,5)));
        return;
      }
    }
  })().finally(()=>{if(flight===task)flight=null;if(generation!==own)void resumeSurpriseOutbox();});
  flight=task;return task;
}
export function surpriseSendFailure(job:SurpriseSendJob){
  if(job.reason==='local_media_missing')return 'Your saved photo or recording is missing. Any undelivered payment was returned. Make a new surprise.';
  if(job.reason==='audio_too_short')return 'Record at least one full second, then send again.';
  if(job.reason==='photo_invalid')return 'This photo could not be used. Retake your photo.';
  if(job.reason?.startsWith('audio_'))return 'This recording could not be used. Please record again.';
  const messages:Record<string,string>={invalid_request:'This photo or recording could not be used. Please make a new surprise.',
    not_paired:'Pair with your person before sending.',pair_changed:'Your pairing changed. Make a new surprise for your current partner.',
    price_changed:'The price changed. Review the current price before sending again.',price_confirmation_required:'Review the current price before sending again.',
    insufficient_balance:'Not enough coins. Your surprise is saved.',plus_required:'This frame requires Plus.',draft_expired:'This upload expired. Make a new surprise.',
    idempotency_conflict:'This send needs verification. Do not pay again; retry to check its receipt.',not_for_sale:'This frame is no longer available.',
    economic_domain_mismatch:'Test accounts and live accounts cannot send paid gifts to each other.'};
  return messages[job.error??'']??'Still waiting for confirmation. Your surprise is saved and will not be charged twice.';
}
subscribeSessionIdentity(()=>{generation++;context=null;jobs=[];loadedFor=undefined;if(timer)clearTimeout(timer);timer=undefined;emit();});
