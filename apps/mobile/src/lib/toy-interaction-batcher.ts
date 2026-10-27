export type ToyRecordScope={userId:string;partnerId:string|null;pairVersion:string|null};
export type ToyRecordInput={toyId:string;photoId:string;localDate:string;occurredAt:string};
export type ToyRecordBatch=ToyRecordInput&{id:string;count:number;windowStartedAt:string;lastOccurredAt:string};
export type ToyRecordQueue={version:2;scope:ToyRecordScope;windowStartedAt:string|null;pending:ToyRecordBatch[];batch:ToyRecordBatch|null};
export const toyRecordScopeKey=(s:ToyRecordScope)=>`${s.userId}:${s.partnerId??''}:${s.pairVersion??''}`;
const HOUR=60*60*1000;

/** Fixed windows from first eligible input, never last input, midnight or toy.
 * Exact occurrence times/receipts survive background sync and app restarts. */
export function createToyInteractionBatcher(options:{current:()=>ToyRecordScope|null;uuid:()=>string;
  send:(scope:ToyRecordScope,batch:ToyRecordBatch)=>Promise<void>;persist:(queue:ToyRecordQueue|null)=>void;confirmed:()=>void;
  restored?:ToyRecordQueue|null;active?:()=>boolean;
  queued?:(scope:ToyRecordScope,batch:ToyRecordBatch)=>void;
  rejected?:(scope:ToyRecordScope,batch:ToyRecordBatch)=>void;
  definitive?:(error:unknown)=>boolean}) {
  let queue=options.restored??null,running=false,timer:ReturnType<typeof setTimeout>|null=null;
  let generation=0,photoRetryDelay=2000;
  const valid=(q:ToyRecordQueue)=>{const current=options.current();return !!current&&toyRecordScopeKey(current)===toyRecordScopeKey(q.scope);};
  function pause(){if(timer)clearTimeout(timer);timer=null;}
  function reset(){generation++;queue=null;pause();options.persist(null);}
  function schedule(ms=250){if(timer||running||options.active?.()===false)return;timer=setTimeout(()=>{timer=null;void flush();},ms);}
  async function flush(){
    if(running||!queue||options.active?.()===false)return;
    if(!valid(queue)){reset();return;}
    const q=queue,ticket=generation;
    if(!q.batch)q.batch=q.pending.shift()??null;
    if(!q.batch)return;
    options.queued?.(q.scope,q.batch);
    options.persist(q);running=true;let photoPending=false;
    try {
      await options.send(q.scope,q.batch);
      if(ticket!==generation||queue!==q||!valid(q))return;
      q.batch=null;photoRetryDelay=2000;options.persist(q);options.confirmed();
    }catch(error){
      const e=error as {message?:string;body?:{error?:string}};
      const code=e.body?.error??e.message;
      photoPending=code==='photo_sync_pending';
      if(queue===q&&ticket===generation&&(['invalid_request','own_toy_only'].includes(code??'')||options.definitive?.(error))){
        if(q.batch)options.rejected?.(q.scope,q.batch);
        q.batch=null;options.persist(q); // Bad persisted input must not block later valid play.
      }
      // Ambiguous failures keep their ticket; never fall back to a legacy
      // command that could double-count or record a blank face.
    }
    finally {
      running=false;
      if(ticket!==generation){if(queue)schedule();}
      else if(queue===q&&!valid(q))reset();
      else if(queue===q&&(q.batch||q.pending.length)){
        const wait=q.batch?photoRetryDelay:1000;
        if(q.batch)photoRetryDelay=Math.min(photoRetryDelay*2,60000);
        schedule(wait);
      }
    }
  }
  return {enqueue(scope:ToyRecordScope,input:ToyRecordInput){
    const at=Date.parse(input.occurredAt);
    if(!input.toyId||!input.photoId||!Number.isFinite(at))return;
    if(!queue||toyRecordScopeKey(queue.scope)!==toyRecordScopeKey(scope)) {
      reset();queue={version:2,scope,windowStartedAt:null,pending:[],batch:null};
    }
    const start=Date.parse(queue.windowStartedAt??'');
    if(!Number.isFinite(start)||at<start||at>=start+HOUR)queue.windowStartedAt=input.occurredAt;
    const last=queue.pending.at(-1);
    // Day/photo changes split only a network batch (quest date/eligibility),
    // not the Moment's window. Commands remain capped at 50 inputs.
    if(last&&last.count<50&&last.windowStartedAt===queue.windowStartedAt&&last.toyId===input.toyId
      &&last.photoId===input.photoId&&last.localDate===input.localDate){last.count++;last.lastOccurredAt=input.occurredAt;}
    else queue.pending.push({...input,id:options.uuid(),count:1,windowStartedAt:queue.windowStartedAt!,lastOccurredAt:input.occurredAt});
    options.persist(queue);options.queued?.(queue.scope,queue.pending.at(-1)!);schedule();
  },flush,reset,pause,snapshot:()=>queue};
}
