export type LoveNoteIntent={userId:string;partnerId:string;pairVersion:string;key:string;body:string;createdAt:string;error?:string;draftKey?:string};
type Scope=Pick<LoveNoteIntent,'userId'|'partnerId'|'pairVersion'>;
const same=(a:Scope,b:Scope)=>a.userId===b.userId&&a.partnerId===b.partnerId&&a.pairVersion===b.pairVersion;
/** The durable local commit owns completion UI. Serial retries preserve the
 * exact body, recipient generation and server receipt key after navigation. */
export function createLoveNoteOutbox(deps:{owner:()=>string|null|undefined;active:()=>boolean;
  load:(owner:string)=>unknown;save:(owner:string,jobs:LoveNoteIntent[])=>void;
  send:(job:LoveNoteIntent)=>Promise<void>;confirmed:()=>void;rejected:(job:LoveNoteIntent)=>void;
  code:(error:unknown)=>string;schedule:(fn:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void}){
  let owner:string|null=null,scope:Scope|null=null,jobs:LoveNoteIntent[]=[],generation=0,flight:object|null=null,timer:unknown=null,delay=2000;
  function pause(){if(timer!==null)deps.cancel(timer);timer=null;}
  function reset(){pause();generation++;owner=null;scope=null;jobs=[];flight=null;delay=2000;}
  function persist(next:LoveNoteIntent[]){if(!owner)throw Error('session_changed');deps.save(owner,next);jobs=next;}
  const pending=()=>jobs.filter(job=>scope&&same(scope,job)&&!job.error);
  function schedule(ms=0){if(timer!==null||flight||!deps.active()||!pending().length)return;
    timer=deps.schedule(()=>{timer=null;void flush();},ms);}
  function receive(next:Scope){
    if(next.userId!==deps.owner())throw Error('session_changed');
    if(owner!==next.userId){reset();const raw=deps.load(next.userId);
      if(raw!==null&&raw!==undefined){
        if(!Array.isArray(raw)||raw.length>100||raw.some(j=>!j||j.userId!==next.userId||typeof j.partnerId!=='string'||typeof j.pairVersion!=='string'
          ||typeof j.key!=='string'||!j.key||typeof j.body!=='string'||!j.body.trim()||j.body.length>500
          ||!Number.isFinite(Date.parse(j.createdAt))||(j.error!==undefined&&typeof j.error!=='string')
          ||(j.draftKey!==undefined&&typeof j.draftKey!=='string')))throw Error('note_outbox_unavailable');
        jobs=raw;
      }owner=next.userId;
    }
    if(scope&&!same(scope,next)){pause();generation++;flight=null;}
    scope=next;schedule();
  }
  function enqueue(job:LoveNoteIntent){
    if(!scope||!same(scope,job)||job.userId!==deps.owner())throw Error('session_changed');
    if(!job.body.trim()||job.body.length>500)throw Error('invalid_request');
    const existing=jobs.find(j=>same(j,job)&&j.key===job.key);
    if(existing){if(existing.body!==job.body)throw Error('idempotency_conflict');
      if(existing.error)persist(jobs.map(j=>j===existing?{...j,error:undefined,draftKey:job.draftKey??j.draftKey}:j));schedule();return;}
    if(jobs.length>=100)throw Error('note_queue_full');
    persist([...jobs,{...job}]);schedule();
  }
  async function flush(){
    const job=pending()[0];if(!job||flight||!deps.active()||job.userId!==deps.owner())return;
    const token={},version=generation;flight=token;
    const current=()=>flight===token&&version===generation&&job.userId===deps.owner()&&!!scope&&same(scope,job);
    let retry=0;
    try{await deps.send({...job});if(!current())return;
      persist(jobs.filter(j=>j!==job));delay=2000;try{deps.confirmed();}catch{}
    }catch(error){if(!current())return;const code=deps.code(error);
      if(['invalid_request','idempotency_conflict','pair_changed','not_paired','feature_disabled','not_found','forbidden'].includes(code)){
        try{persist(jobs.map(j=>j===job?{...j,error:code}:j));try{deps.rejected(job);}catch{}}catch{retry=delay;}
      }else{
        const seconds=Number((error as {body?:{retryAfterSeconds?:unknown}})?.body?.retryAfterSeconds);
        retry=code==='love_note_minute_limit'||code==='love_note_daily_limit'
          ?Math.max(delay,(Number.isFinite(seconds)&&seconds>0?Math.min(seconds,86400):code==='love_note_minute_limit'?60:86400)*1000):delay;
      }
      // Never log private text, keys or recipient identifiers.
      if(retry)delay=Math.min(delay*2,60000);
    }finally{if(flight===token){flight=null;schedule(retry);}}
  }
  return {receive,enqueue,pause,resume:()=>schedule(),reset,
    recover:()=>jobs.find(j=>scope&&same(j,scope)&&j.error),pending};
}
