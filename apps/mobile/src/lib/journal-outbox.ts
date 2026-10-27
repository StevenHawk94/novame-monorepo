export type JournalJob={key:string;pageId:string;body:string;expectedUpdatedAt:string|null;questionId:string;date:string;error?:string};
export type JournalRead={pageId:string;answerAt:string|null};
export type JournalScope={owner:string;pairVersion:string};
export type JournalRecord={writes:JournalJob[];reads:JournalRead[]};
/** Durable intent, not a screen promise. Navigation never owns its lifetime. */
export function createJournalOutbox(deps:{load:(scope:JournalScope)=>unknown;persist:(scope:JournalScope,value:JournalRecord)=>void;
 current:(scope:JournalScope)=>boolean;active:()=>boolean;bind:(job:JournalJob,scope:JournalScope)=>Promise<string>;
 send:(job:JournalJob,scope:JournalScope)=>Promise<unknown>;read:(job:JournalRead)=>Promise<void>;
 apply:(job:JournalJob,result:unknown)=>void;changed:()=>void;code:(error:unknown)=>string;
 schedule:(fn:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void}){
 let scope:JournalScope|null=null,value:JournalRecord={writes:[],reads:[]},generation=0,flight:object|null=null,timer:unknown=null,delay=2000;
 const notify=()=>{try{deps.changed();}catch{}};
 function pause(){if(timer!==null)deps.cancel(timer);timer=null;}
 function reset(){pause();generation++;flight=null;scope=null;value={writes:[],reads:[]};}
 function persist(next:JournalRecord){if(!scope||!deps.current(scope))throw Error('session_changed');deps.persist(scope,next);value=next;notify();}
 function resume(ms=0){if(!scope||!deps.current(scope)||!deps.active()||flight||timer!==null||!value.reads.length&&!value.writes.some(j=>!j.error))return;
  timer=deps.schedule(()=>{timer=null;void flush();},ms);}
 function receive(next:JournalScope){if(scope?.owner===next.owner&&scope.pairVersion===next.pairVersion){resume();return;}
  reset();if(!deps.current(next))return;const raw=deps.load(next) as JournalRecord|null;
  if(raw){if(!Array.isArray(raw.writes)||!Array.isArray(raw.reads)||raw.writes.length>100||raw.reads.length>500||
    raw.writes.some(j=>!j||typeof j.key!=='string'||!j.key||typeof j.pageId!=='string'||typeof j.body!=='string'||!j.body.trim()||j.body.length>1500||typeof j.questionId!=='string'||typeof j.date!=='string'||!(j.expectedUpdatedAt===null||typeof j.expectedUpdatedAt==='string'))||
    raw.reads.some(j=>!j||typeof j.pageId!=='string'||!(j.answerAt===null||typeof j.answerAt==='string')))throw Error('journal_queue_unavailable');
   value=raw;}scope=next;notify();resume();}
 function enqueue(job:JournalJob){if(!scope||!deps.current(scope))throw Error('session_changed');
  if(!job.body.trim()||job.body.length>1500)throw Error('invalid_request');
  const same=value.writes.find(j=>j.key===job.key);if(same){if(JSON.stringify(same)!==JSON.stringify(job))throw Error('idempotency_conflict');return;}
  if(value.writes.length>=100)throw Error('journal_queue_full');
  persist({...value,writes:[...value.writes,{...job}]});resume();}
 function acknowledge(job:JournalRead){const old=value.reads.find(j=>j.pageId===job.pageId);
  if(old&&old.answerAt&&(!job.answerAt||old.answerAt>=job.answerAt))return;
  persist({...value,reads:[...value.reads.filter(j=>j.pageId!==job.pageId),job].slice(-500)});resume();}
 function discardRejected(key:string){persist({...value,writes:value.writes.filter(j=>j.key!==key||!j.error)});}
 async function flush(){if(!scope||flight||!deps.current(scope)||!deps.active())return;
  const token={},version=generation,own=scope;flight=token;let retry=0;
  const current=()=>flight===token&&generation===version&&deps.current(own);
  const job=value.writes.find(j=>!j.error),read=value.reads[0];
  try{
   if(job){
    if(job.pageId.startsWith('local:')){const id=await deps.bind({...job},own);if(!current())return;
     persist({...value,writes:value.writes.map(j=>j===job?{...j,pageId:id}:j)});}
    const bound=value.writes.find(j=>j.key===job.key)!;
    const result=await deps.send({...bound},own);if(!current())return;
    // A committed receipt cannot become a server failure due to local observers.
    try{deps.apply(bound,result);}catch{retry=delay;return;}
    persist({...value,writes:value.writes.filter(j=>j.key!==job.key)});delay=2000;
   }else if(read){await deps.read(read);if(!current())return;
    persist({...value,reads:value.reads.filter(j=>j!==read)});delay=2000;}
  }catch(error){if(!current())return;const code=deps.code(error);
   if(job&&['journal_conflict','journal_page_changed','invalid_request','idempotency_conflict','pair_changed','not_found','forbidden','feature_disabled'].includes(code)){
    try{persist({...value,writes:value.writes.map(j=>j.key===job.key?{...j,error:code}:j)});}catch{retry=delay;}
   }else if(read&&['not_found','forbidden','pair_changed','invalid_request'].includes(code)){
    try{persist({...value,reads:value.reads.filter(j=>j!==read)});}catch{retry=delay;}
   }else retry=delay;
   delay=Math.min(delay*2,60000);
  }finally{if(flight===token){flight=null;resume(retry);}}
 }
 return{receive,enqueue,acknowledge,discardRejected,pause,resume,reset,snapshot:()=>value};
}
