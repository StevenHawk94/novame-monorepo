import type { PreparedFriendVisit } from './app-major-update-api';
export type LocalFriendVisit = {
  owner: string; scope: string; visitId: string; candidate: PreparedFriendVisit;
  frozen?: PreparedFriendVisit; step: number; choiceId?: string; done?: boolean;
  status?: 'pending' | 'confirmed' | 'rejected'; error?: string;
  receipt?: {feedback:string[];reward:number;applied?:boolean};
};
type Context = {owner:string;scope:string};
export function validPreparedVisit(value: unknown): value is PreparedFriendVisit {
  const v=value as PreparedFriendVisit;
  return !!v&&typeof v.sessionId==='string'&&typeof v.visitId==='string'&&typeof v.pairVersion==='string'
    &&typeof v.friendId==='string'&&['independent','followup'].includes(v.mode)
    &&['Trivia','Preference','Guess'].includes(v.type)&&typeof v.question==='string'
    &&(v.scene===null||typeof v.scene==='string')&&Array.isArray(v.lines)&&v.lines.every(x=>typeof x==='string')
    &&Array.isArray(v.choices)&&v.choices.length>0&&v.choices.every(c=>['A','B','C'].includes(c.id)
      &&typeof c.label==='string'&&Array.isArray(c.feedback)&&c.feedback.length>0&&c.feedback.every(x=>typeof x==='string')
      &&Number.isSafeInteger(c.reward)&&c.reward>=0&&c.reward<=10);
}

/** Local, immutable presentation + durable outbox. Network latency never owns
 * the cursor. Candidates can refresh, but an opened session cannot change. */
export function createFriendVisitLocalState(deps:{
  context:()=>Context|null;load:()=>unknown;save:(rows:LocalFriendVisit[])=>void;active:()=>boolean;
  prepare:(id:string,version:string)=>Promise<PreparedFriendVisit>;
  submit:(conversation:PreparedFriendVisit,choiceId:string)=>Promise<{feedback:string[];reward:number;applied?:boolean}>;
  project:(row:LocalFriendVisit,restored:boolean)=>void;
  confirm:(row:LocalFriendVisit,result:unknown)=>void;reject:(row:LocalFriendVisit)=>void;settled:()=>void;
  schedule:(fn:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void;
}) {
  const rows=new Map<string,LocalFriendVisit>(),listeners=new Set<()=>void>();
  try { const disk=deps.load();if(Array.isArray(disk))for(const row of disk) {
    if(row&&typeof row.owner==='string'&&typeof row.scope==='string'&&typeof row.visitId==='string'
      &&validPreparedVisit(row.candidate)&&row.candidate.visitId===row.visitId
      &&(!row.frozen||validPreparedVisit(row.frozen)&&row.frozen.visitId===row.visitId)
      &&Number.isSafeInteger(row.step)&&row.step>=-1
      &&(!row.choiceId||row.frozen?.choices.some((c:{id:string})=>c.id===row.choiceId))
      &&(!row.status||['pending','confirmed','rejected'].includes(row.status)))rows.set(`${row.scope}:${row.visitId}`,row);
  }}catch{/* a corrupt cache cannot authorize a reward */}
  let generation=0,flight:Promise<void>|null=null,timer:unknown,attempts=0;
  const preparing=new Map<string,Promise<void>>();
  const current=(row:Context)=>{const ctx=deps.context();return ctx?.owner===row.owner&&ctx.scope===row.scope;};
  const key=(id:string)=>{const ctx=deps.context();return ctx?`${ctx.scope}:${id}`:null;};
  const read=(id:string)=>{const k=key(id);return k?rows.get(k):undefined;};
  function write(row:LocalFriendVisit) {
    const k=`${row.scope}:${row.visitId}`,old=rows.get(k);rows.set(k,row);
    try{deps.save([...rows.values()]);}catch(error){if(old)rows.set(k,old);else rows.delete(k);throw error;}
    listeners.forEach(fn=>fn());
  }
  function prepare(id:string,version:string,partnerCompleted=false):Promise<void> {
    const ctx=deps.context(),k=key(id);if(!ctx||!k)return Promise.reject(Error('pair_changed'));
    const old=read(id);
    if(old&&(old.frozen||!partnerCompleted||old.candidate.mode==='followup'))return Promise.resolve();
    const requestKey=`${k}:${partnerCompleted?'followup':'latest'}`;
    const existing=preparing.get(requestKey);if(existing)return existing;
    const epoch=generation;
    const task=deps.prepare(id,version).then(value=>{
      if(epoch!==generation||!current(ctx))return;
      if(!validPreparedVisit(value)||value.visitId!==id||value.pairVersion!==version)throw Error('content_unavailable');
      const latest=read(id);if(latest?.frozen||latest?.candidate.mode==='followup'&&value.mode==='independent')return;
      write({...ctx,visitId:id,step:-1,...latest,candidate:value});
    }).finally(()=>{if(preparing.get(requestKey)===task)preparing.delete(requestKey);});
    preparing.set(requestKey,task);return task;
  }
  function open(id:string) {
    const row=read(id);if(!row)return false;if(row.frozen)return true;
    try{write({...row,frozen:row.candidate});return true;}catch{return false;}
  }
  function advance(id:string) {
    const row=read(id);if(!row?.frozen||row.done)return false;
    try{write({...row,step:row.step+1});return true;}catch{return false;}
  }
  function answer(id:string,choiceId:string) {
    const row=read(id);if(!row?.frozen||row.done||row.choiceId||!row.frozen.choices.some(c=>c.id===choiceId))return false;
    const next={...row,choiceId,step:0,status:'pending' as const,error:undefined};
    try{write(next);}catch{return false;}
    deps.project(next,false);void resume();return true;
  }
  function finish(id:string) {
    const row=read(id);if(!row||!row.choiceId||row.done)return false;
    try{write({...row,done:true});return true;}catch{return false;}
  }
  function pause(){if(timer!==undefined)deps.cancel(timer);timer=undefined;}
  function resume():Promise<void> {
    pause();if(flight)return flight;if(!deps.active()||!deps.context())return Promise.resolve();
    const started=generation,ctx=deps.context();
    const task=drain(started).finally(()=>{if(flight===task)flight=null;
      const next=deps.context();if(next&&(started!==generation||ctx?.scope!==next.scope))void resume();});
    flight=task;return task;
  }
  async function drain(epoch:number) {
    while(deps.active()) {
      const row=[...rows.values()].find(r=>current(r)&&r.status==='pending'&&r.choiceId&&r.frozen);
      if(!row)return;
      deps.project(row,true);
      try {
        const result=await deps.submit(row.frozen!,row.choiceId!);
        if(epoch!==generation||!current(row))return;
        const latest=read(row.visitId)!;
        write({...latest,status:'confirmed',receipt:{feedback:result.feedback,reward:result.reward,applied:result.applied},error:undefined});
        deps.confirm(row,result);deps.settled();attempts=0;
      } catch(error) {
        if(epoch!==generation||!current(row))return;
        const e=error as {body?:{error?:string};message?:string};
        const code=e?.body?.error??e?.message??String(error);
        if(['pair_changed','not_found','visit_expired','visit_session_changed','invalid_response','idempotency_conflict','feature_disabled','content_unavailable'].includes(code)) {
          try{write({...read(row.visitId)!,status:'rejected',error:code});deps.reject(row);deps.settled();}catch{/* retry durable intent */}
          return;
        }
        // A timeout can follow a committed answer: retain the projection and
        // replay the exact same prepared session and choice, never a new begin.
        if(deps.active())timer=deps.schedule(()=>{timer=undefined;void resume();},Math.min(60_000,2_000*2**Math.min(attempts++,5)));
        return;
      }
    }
  }
  return {read,prepare,open,advance,answer,finish,resume,pause,
    subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    reset(){generation++;pause();preparing.clear();rows.clear();listeners.forEach(fn=>fn());},
  };
}
