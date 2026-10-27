import type { MajorUpdateBootstrap } from './app-major-update-api';

type Photo=MajorUpdateBootstrap['roomPhotos'][number];
export type PlushiePhotoScope={userId:string;partnerId:string;pairVersion:string};
export type PlushiePhotoJob=PlushiePhotoScope&{key:string;ownerId:string;toyId:string;base64:string;
  preview:Photo;previous?:Photo;failed?:string};
type Receipt={photo:Photo;photoUsage?:MajorUpdateBootstrap['photoUsage']};
const target=(job:{ownerId:string;toyId?:string})=>`${job.ownerId}:${job.toyId??''}`;
const sameScope=(a:PlushiePhotoScope,b:PlushiePhotoScope)=>a.userId===b.userId&&a.partnerId===b.partnerId&&a.pairVersion===b.pairVersion;
export const localPlushiePhoto=(photo:Photo)=>photo.id.startsWith('local-plushie-');

/** Durable exact-byte intents. Only the server commits quota/ownership/Moments.
 * Local acceptance is independent of network latency; retries reuse one ticket.
 * A single flight also prevents older uploads overwriting a newer selection. */
export function createPlushiePhotoOutbox(deps:{
  kind?:'frame'|'doll';
  owner:()=>string|null|undefined;active:()=>boolean;
  load:(owner:string)=>unknown;save:(owner:string,jobs:PlushiePhotoJob[])=>void;
  send:(job:PlushiePhotoJob)=>Promise<Receipt>;
  confirmed:(job:PlushiePhotoJob,receipt:Receipt)=>void;changed:()=>void;
  rejected:(job:PlushiePhotoJob,code:string)=>void;retire:(photo:Photo)=>void;
  code:(error:unknown)=>string;schedule:(task:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void;
}){
  const kind=deps.kind??'doll',prefix=kind==='frame'?'local-frame-':'local-plushie-';
  const isLocal=(photo:Photo)=>photo.id.startsWith(prefix);
  let owner:string|null=null,scope:PlushiePhotoScope|null=null,jobs:PlushiePhotoJob[]=[],generation=0;
  let flight:object|null=null,timer:unknown=null,delay=2000;
  const bases=new Map<string,Photo>();
  const pending=()=>jobs.filter(job=>!job.failed&&scope&&sameScope(job,scope));
  function pause(){if(timer!==null)deps.cancel(timer);timer=null;}
  function persist(next:PlushiePhotoJob[]){if(!owner)throw Error('photo_session_changed');deps.save(owner,next);jobs=next;}
  function reset(){pause();generation++;owner=null;scope=null;jobs=[];flight=null;delay=2000;bases.clear();}
  function schedule(ms=0){
    if(timer!==null||flight||!deps.active()||!pending().length)return;
    timer=deps.schedule(()=>{timer=null;void flush();},ms);
  }
  function receive(next:PlushiePhotoScope){
    if(next.userId!==deps.owner())return;
    if(owner!==next.userId){
      reset();
      const raw=deps.load(next.userId);
      if(raw!==null&&raw!==undefined){
        if(!Array.isArray(raw)||raw.length>8||raw.some(j=>!j||j.userId!==next.userId||typeof j.partnerId!=='string'||typeof j.pairVersion!=='string'
          ||typeof j.key!=='string'||typeof j.ownerId!=='string'||typeof j.toyId!=='string'
          ||typeof j.base64!=='string'||j.base64.length>1_400_000||!j.base64||!j.preview||j.preview.id!==`${prefix}${j.key}`
          ||!Number.isFinite(Date.parse(j.preview.updatedAt))||![j.userId,j.partnerId].includes(j.ownerId)
          ||j.preview.ownerId!==j.ownerId||(j.preview.toyId??'')!==j.toyId||j.preview.kind!==kind
          ||kind==='frame'&&(j.ownerId!==j.userId||j.toyId!=='')))throw Error('photo_outbox_unavailable');
        jobs=raw as PlushiePhotoJob[];
      }
      owner=next.userId;
    }
    if(scope&&!sameScope(scope,next)){pause();generation++;flight=null;}
    scope=next;schedule();
  }
  function enqueue(job:PlushiePhotoJob){
    if(!scope||!sameScope(scope,job)||job.userId!==deps.owner())throw Error('photo_session_changed');
    const replay=jobs.find(j=>sameScope(j,job)&&j.key===job.key&&!j.failed);
    if(replay){if(replay.base64!==job.base64||target(replay)!==target(job))throw Error('idempotency_conflict');return;}
    const existing=jobs.find(j=>sameScope(j,job)&&target(j)===target(job)&&(kind==='doll'||!!j.failed));
    if(existing&&!existing.failed)throw Error('photo_sync_pending');
    const retained=jobs.filter(j=>sameScope(j,job)&&j!==existing&&!j.failed);
    if(retained.length>=8)throw Error('photo_drafts_full');
    const retired=jobs.filter(j=>!sameScope(j,job)||(j.failed&&j!==existing));
    persist([...retained,job]);
    for(const old of retired){deps.retire(old.preview);bases.delete(old.key);}
    if(existing){deps.retire(existing.preview);bases.delete(existing.key);}
    deps.changed();schedule();
  }
  function project(data:MajorUpdateBootstrap):MajorUpdateBootstrap{
    const relevant=jobs.filter(j=>j.userId===data.profile.id&&j.partnerId===(data.partner?.id??'')&&j.pairVersion===(data.pairVersion??''));
    if(!relevant.length&&!data.roomPhotos?.some(isLocal))return data;
    const originals=(data.roomPhotos??[]).filter(p=>!isLocal(p));
    const photos=[...originals];
    for(const job of relevant){
      const index=photos.findIndex(p=>p.kind===kind&&target(p)===target(job));
      const remote=originals.find(p=>p.kind===kind&&target(p)===target(job));
      const base=remote&&(!job.previous||Date.parse(remote.updatedAt)>=Date.parse(job.previous.updatedAt))?remote:job.previous;
      if(base&&!isLocal(base)&&(!bases.has(job.key)||Date.parse(base.updatedAt)>=Date.parse(bases.get(job.key)!.updatedAt)))bases.set(job.key,base);
      if(!job.failed){if(index>=0)photos.splice(index,1);photos.push(job.preview);}
      else if(index<0&&bases.has(job.key))photos.push(bases.get(job.key)!);
    }
    return photos.length===data.roomPhotos.length&&photos.every((photo,i)=>photo===data.roomPhotos[i])?data:{...data,roomPhotos:photos};
  }
  async function flush(){
    const job=pending()[0];
    if(!job||flight||!deps.active()||job.userId!==deps.owner())return;
    const token={},version=generation;flight=token;
    const current=()=>flight===token&&generation===version&&job.userId===deps.owner()&&!!scope&&sameScope(job,scope);
    let retry=false,retryAfter=0;
    try{
      const receipt=await deps.send(job);if(!current())return;
      if(!receipt.photo||receipt.photo.kind!==kind||receipt.photo.ownerId!==job.ownerId||(receipt.photo.toyId??'')!==job.toyId
        ||!Number.isFinite(Date.parse(receipt.photo.updatedAt))||isLocal(receipt.photo))throw Error('photo_receipt_unavailable');
      // Persist removal first. A crash before it merely replays the same ticket.
      persist(jobs.filter(j=>j.key!==job.key).map(j=>kind==='frame'&&sameScope(j,job)&&target(j)===target(job)
        ?{...j,previous:receipt.photo}:j));delay=2000;
      deps.confirmed(job,receipt);
      bases.delete(job.key);
    }catch(error){
      if(!current())return;
      const code=deps.code(error);
      if(code==='upload_limit')retryAfter=60*60*1000;
      const definitive=['daily_limit_reached','not_paired','pair_changed','not_owner','not_owned','invalid_toy','toy_not_owned',
        'invalid_request','forbidden','photo_conflict','idempotency_conflict','toy_required','not_found','item_not_owned','upload_expired','profile_not_found'].includes(code);
      if(definitive){
        try{persist(jobs.map(j=>j.key===job.key?{...j,failed:code}:j));deps.changed();deps.rejected(job,code);}catch{retry=true;}
      }else{retry=true;}
      // No photo bytes, signed links or person identifiers in diagnostics.
      console.warn(`[${kind==='frame'?'frame':'plushie'}-photo/sync]`,definitive?'rejected':'retry_pending',/^[a-z_]{1,60}$/.test(code)?code:'unavailable');
    }finally{
      if(flight===token){flight=null;const wait=retry?Math.max(delay,retryAfter):0;if(retry)delay=Math.min(delay*2,60000);schedule(wait);}
    }
  }
  return {receive,enqueue,project,pause,resume:()=>schedule(),reset,pending,
    photoSyncState:(photoId:string)=>{const job=jobs.find(j=>j.preview.id===photoId);return job?(job.failed?'failed' as const:'pending' as const):'unknown' as const;},
    serverPhoto:(job:PlushiePhotoJob)=>bases.get(job.key)};
}
