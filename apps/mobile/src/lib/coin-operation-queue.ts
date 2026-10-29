import type { QuestIntent } from './quest-progress-model';
export type CoinOperation={id:string;owner:string;path:string;payload:Record<string,unknown>;key:string|null;amount:number;deferred:boolean;display?:Record<string,unknown>;quest?:QuestIntent};
export type CoinOperationSettlement={operation:CoinOperation;receipt?:unknown;error?:unknown};
export function validCoinOperation(r:CoinOperation,allowPurchases=false){
 const actions=['claim_daily_quest','claim_special_quest','complete_affection','refill_room_need','complete_room_care_v2','claim_daily_plus_bonus','respond_friend_visit_v3',...(allowPurchases?['purchase_catalog_item']:[])];
 return !!r&&typeof r.id==='string'&&typeof r.owner==='string'&&r.payload&&typeof r.payload==='object'&&!Array.isArray(r.payload)
  &&(r.path==='/api/vnext/command'?actions.includes(String(r.payload.action)):['/api/vnext/release-room','/api/reflect/finalize','/api/tame-enemy'].includes(r.path))
  &&(r.key===null||typeof r.key==='string')&&Number.isSafeInteger(r.amount)&&r.amount>=0&&r.amount<=99999&&typeof r.deferred==='boolean'
  &&(!r.quest||(typeof r.quest.scope==='string'&&r.quest.scope.startsWith(`${r.owner}:`)
   &&/^\d{4}-\d{2}-\d{2}$/.test(r.quest.day)&&typeof r.quest.questId==='string'
   &&(r.quest.verified===undefined||typeof r.quest.verified==='boolean')
   &&(r.quest.stage===undefined||Number.isSafeInteger(r.quest.stage)&&r.quest.stage>0)));
}
/** Durable intent and ambiguous-failure policy are shared by all coin grants.
 * Wire payloads are replayed unchanged; they never authorize a client amount. */
export function createCoinOperationQueue(deps:{
 allowPurchases?:boolean;
 owner:()=>string|null|undefined;active:()=>boolean;load:()=>unknown;save:(rows:CoinOperation[])=>void;
 project:(row:CoinOperation,quiet:boolean)=>void;send:(row:CoinOperation)=>Promise<unknown>;
 confirm:(row:CoinOperation,receipt:any)=>void;reject:(row:CoinOperation,error:unknown)=>void;
 definitive:(error:unknown)=>boolean;schedule:(fn:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void;
}){
 const rows=new Map<string,CoinOperation>(),projected=new Set<string>(),running=new Set<string>(),blocked=new Set<string>();
 const terminal=new Map<string,unknown>(),receipts=new Map<string,unknown>();
 const waiters=new Map<string,{resolve:(v:any)=>void;reject:(e:unknown)=>void}[]>(),listeners=new Set<()=>void>(),settlements=new Set<(event:CoinOperationSettlement)=>void>();
 let timer:unknown,generation=0,attempt=0;
 const key=(r:CoinOperation)=>`${r.owner}:${r.id}`;
 try{const disk=deps.load();if(Array.isArray(disk))for(const r of disk)if(validCoinOperation(r,deps.allowPurchases))rows.set(key(r),r);}catch{}
 const emit=()=>{for(const fn of listeners)try{fn();}catch{/* Observers cannot change an intent's outcome. */}};
 const settled=(event:CoinOperationSettlement)=>{for(const fn of settlements)try{fn(event);}catch{/* Display observers cannot invalidate a monetary receipt. */}};
 const save=()=>deps.save([...rows.values()]);
 function project(row:CoinOperation,quiet:boolean){const id=key(row);if(projected.has(id))return;projected.add(id);try{deps.project(row,quiet);}catch(e){projected.delete(id);throw e;}}
 function enqueue(row:CoinOperation,quiet=false){
  if(!validCoinOperation(row,deps.allowPurchases))throw Error('invalid_request');
  try{row=JSON.parse(JSON.stringify(row)) as CoinOperation;}catch{throw Error('invalid_request');}
  if(row.owner!==deps.owner())throw Error('session_changed');
  const id=key(row),old=rows.get(id);
  if(old&&JSON.stringify(old.payload)!==JSON.stringify(row.payload))throw Error('idempotency_conflict');
  if(!old){rows.set(id,row);try{save();}catch(e){rows.delete(id);throw Error('intent_not_saved');}project(row,quiet);emit();}
  const promise=new Promise<any>((resolve,reject)=>waiters.set(id,[...(waiters.get(id)??[]),{resolve,reject}]));
  resume();return promise;
 }
 function submit(row:CoinOperation,quiet=false){try{return enqueue(row,quiet);}catch(error){return Promise.reject(error);}}
 function resume(){
  if(!deps.active()||!deps.owner())return;
  const candidates=[...rows.values()].filter(r=>r.owner===deps.owner()&&!running.has(key(r))&&!blocked.has(key(r))).slice(0,Math.max(0,2-running.size));
  for(const row of candidates){
   const id=key(row),epoch=generation;project(row,true);running.add(id);
   let submission:Promise<unknown>;
   try{submission=receipts.has(id)?Promise.resolve(receipts.get(id)):terminal.has(id)?Promise.reject(terminal.get(id)):deps.send(row);}
   catch(error){submission=Promise.reject(error);}
   void submission.then(receipt=>{
    if(epoch!==generation||row.owner!==deps.owner())return;
    // Once the authority has accepted this operation, only LOCAL application
    // may be retried. A rating/storage/React observer is not a server rejection.
    receipts.set(id,receipt);
    deps.confirm(row,receipt);rows.delete(id);projected.delete(id);attempt=0;
    receipts.delete(id);
    // A receipt is already committed. A failed journal cleanup must never turn
    // success into failure: replaying the saved intent remains idempotent.
    try{save();}catch{}
    settled({operation:row,receipt});
    const pending=waiters.get(id);waiters.delete(id);pending?.forEach(w=>w.resolve(receipt));emit();
   }).catch(error=>{
    if(epoch!==generation||row.owner!==deps.owner())return;
    if(receipts.has(id)){blocked.add(id);return;}
    if(deps.definitive(error)){
     terminal.set(id,error);rows.delete(id);
     try{save();}catch{rows.set(id,row);blocked.add(id);return;}
     terminal.delete(id);projected.delete(id);
     try{deps.reject(row,error);}catch{/* A display observer cannot revive rejected authorization. */}
     settled({operation:row,error});emit();
    }
    else blocked.add(id);
    const pending=waiters.get(id);waiters.delete(id);pending?.forEach(w=>w.reject(error));
   }).finally(()=>{
    if(epoch!==generation)return;running.delete(id);
    if(rows.has(id)){if(timer===undefined)timer=deps.schedule(()=>{timer=undefined;blocked.clear();resume();},Math.min(60000,2000*2**Math.min(attempt++,5)));}
    else resume();
   });
  }
 }
 function reset(){generation++;if(timer!==undefined)deps.cancel(timer);timer=undefined;running.clear();projected.clear();blocked.clear();terminal.clear();receipts.clear();
  for(const [id,row] of rows)if(row.owner!==deps.owner())rows.delete(id);
  for(const pending of waiters.values())pending.forEach(w=>w.reject(Error('session_changed')));waiters.clear();emit();}
 return {submit,enqueue,resume,reset,has:(id:string)=>rows.has(`${deps.owner()}:${id}`),
  wake:(eligible:(row:CoinOperation)=>boolean=()=>true)=>{
   for(const id of blocked){const row=rows.get(id);if(row&&eligible(row))blocked.delete(id);}
   if(!blocked.size){if(timer!==undefined)deps.cancel(timer);timer=undefined;attempt=0;}
   resume();
  },
  pending:()=>[...rows.values()].filter(row=>row.owner===deps.owner()).map(row=>JSON.parse(JSON.stringify(row)) as CoinOperation),
  subscribeSettled:(fn:(event:CoinOperationSettlement)=>void)=>(settlements.add(fn),()=>{settlements.delete(fn);}),
  subscribe:(fn:()=>void)=>(listeners.add(fn),()=>{listeners.delete(fn);})};
}
