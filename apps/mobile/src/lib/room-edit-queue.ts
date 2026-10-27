export type RoomEditScope = { owner: string; partner: string | null; pairVersion: string | null };
export type RoomEditWire = { action: 'purchase_room_loadout'|'purchase_room_changes'; slots: Record<string,string>; outfitItemId?: string;
  idempotencyKey: string; expectedPrices: Record<string,number>; partnerId?:string|null;pairVersion?:string|null;expectedTotal?:number };
export type RoomEdit = { id: string; changes: Record<string,string>; prices: Record<string,number>;
  purchased: string[]; name: string; total: number; wire?: RoomEditWire };
type Journal = { version: 1; scope: RoomEditScope; base: Record<string,string>; acquired: string[]; edits: RoomEdit[] };
export const sameRoomScope = (a: RoomEditScope, b: RoomEditScope) => a.owner === b.owner && a.partner === b.partner && a.pairVersion === b.pairVersion;
const clone = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
const ids = (value:unknown):value is Record<string,string> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([key,id]) => key.length>0 && key.length<=60 && typeof id==='string' && id.length>0 && id.length<=160);
function valid(value:Journal, scope:RoomEditScope) {
  return value?.version===1 && value.scope && sameRoomScope(value.scope,scope) && ids(value.base)
    && Array.isArray(value.acquired) && value.acquired.every(id=>typeof id==='string')
    && Array.isArray(value.edits) && value.edits.every(e=>typeof e.id==='string' && ids(e.changes)
      && Array.isArray(e.purchased) && e.purchased.every(id=>typeof id==='string') && typeof e.name==='string'
      && Number.isSafeInteger(e.total) && e.total>=0 && e.prices && Object.values(e.prices).every(p=>Number.isSafeInteger(p)&&p>=0)
      && (!e.wire || ['purchase_room_loadout','purchase_room_changes'].includes(e.wire.action) && e.wire.idempotencyKey===e.id && ids(e.wire.slots)));
}
/** One ordered, durable room journal. Never replay a later room ahead of an
 * ambiguous checkout: the original key/payload must settle before rebasing.
 * Each intent contains only the user's changed slots, not a stale whole room. */
export function createRoomEditQueue(deps:{
  owner:()=>string|null|undefined; active:()=>boolean; load:(owner:string)=>unknown; save:(owner:string,value:unknown)=>void;
  send:(wire:RoomEditWire,scope:RoomEditScope,approvedTotal:number)=>Promise<unknown>; definitive:(error:unknown)=>boolean;
  changed:()=>void; confirmed:(edit:RoomEdit,receipt:any)=>void; rejected:(edit:RoomEdit,error:unknown)=>void;
  schedule:(fn:()=>void,ms:number)=>unknown; cancel:(timer:unknown)=>void;
}) {
  let journal:Journal|null=null, running=false, authorized=false, projecting=false, generation=0, revision=0, committedAt=0, attempt=0, timer:unknown;
  let terminal:{edit:RoomEdit;error:unknown}|null=null;
  const persist=()=>{if(journal)deps.save(journal.scope.owner,clone(journal));};
  const current=()=>{
    if(!journal)return {};
    return Object.assign({},journal.base,...journal.edits.map(e=>e.changes)) as Record<string,string>;
  };
  function receive(scope:RoomEditScope,base:Record<string,string>,remote=false,readRevision=revision){
    if(scope.owner!==deps.owner())return;
    if(!journal||!sameRoomScope(journal.scope,scope)){
      reset();
      committedAt=readRevision;
      let disk:unknown;try{disk=deps.load(scope.owner);}catch{}
      journal=valid(disk as Journal,scope)?clone(disk as Journal):{version:1,scope,base:{...base},acquired:[],edits:[]};
      projecting=valid(disk as Journal,scope);
    }
    if(remote){
      authorized=true;
      // An older Bootstrap cannot undo a receipt or a newer queued choice.
      if(readRevision>=committedAt){journal.base={...base};journal.acquired=[];projecting=journal.edits.length>0;}
      try{persist();}catch{}
    }
  }
  function enqueue(edit:RoomEdit){
    if(!journal||journal.scope.owner!==deps.owner())throw Error('session_changed');
    const existing=journal.edits.find(e=>e.id===edit.id);
    if(existing)return existing.id;
    if(journal.edits.length>=40)throw Error('room_sync_backlog');
    edit=clone(edit);
    const shown=current();
    edit.changes=Object.fromEntries(Object.entries(edit.changes).filter(([slot,id])=>shown[slot]!==id));
    if(!Object.keys(edit.changes).length)return '';
    journal.edits.push(edit);
    try{persist();}catch{journal.edits.pop();throw Error('intent_not_saved');}
    projecting=true;revision++;deps.changed();resume();return edit.id;
  }
  function resume(){
    if(running||timer!==undefined||!authorized||!deps.active()||!journal||journal.scope.owner!==deps.owner()||!journal.edits.length)return;
    const savedJournal=journal,edit=journal.edits[0],epoch=generation;
    if(terminal?.edit===edit){
      journal.edits.shift();
      try{persist();}catch{journal.edits.unshift(edit);retry();return;}
      const error=terminal.error;terminal=null;revision++;
      try{deps.rejected(edit,error);}catch{/* Notification failure cannot revive an authorization. */}
      try{deps.changed();}catch{}resume();return;
    }
    if(!edit.wire){
      const slots=Object.fromEntries(Object.entries(edit.changes).filter(([slot])=>slot!=='outfit'));
      const quotedIds=[...Object.values(slots),...(edit.changes.outfit?[edit.changes.outfit]:[])];
      edit.wire={action:'purchase_room_changes',slots,idempotencyKey:edit.id,
        partnerId:journal.scope.partner,pairVersion:journal.scope.pairVersion,expectedTotal:edit.total,
        expectedPrices:Object.fromEntries(quotedIds.map(id=>[id,edit.prices[id]])),
        ...(edit.changes.outfit?{outfitItemId:edit.changes.outfit}:{})};
      try{persist();}catch{edit.wire=undefined;retry();return;}
    }
    running=true;
    void Promise.resolve().then(()=>{
      if(epoch!==generation||journal!==savedJournal)throw Error('session_changed');
      return deps.send(clone(edit.wire!),{...savedJournal.scope},edit.total);
    }).then(receipt=>{
      if(epoch!==generation||journal!==savedJournal||journal.scope.owner!==deps.owner())return;
      // Financial settlement is committed. Persist its matching room/base in
      // the SAME small journal before accepting the next edit.
      journal.base={...(edit.wire!.action==='purchase_room_changes'?journal.base:{}),...edit.wire!.slots,...(journal.base.outfit?{outfit:journal.base.outfit}:{}),
        ...(edit.wire!.outfitItemId?{outfit:edit.wire!.outfitItemId}:{})};
      journal.acquired=[...new Set([...journal.acquired,...edit.purchased])];
      journal.edits.shift();committedAt=++revision;attempt=0;
      try{persist();}catch{/* Disk still contains the same idempotent wire, safe after restart. */}
      try{deps.confirmed(edit,receipt);}catch{/* A committed payment is never rejected by a toast/rating observer. */}
      try{deps.changed();}catch{}
    }).catch(error=>{
      if(epoch!==generation||journal!==savedJournal||journal.scope.owner!==deps.owner())return;
      if(deps.definitive(error)){
        // Do not announce a final failure until its removal is durable. A
        // disk-full cleanup must not leave a rejected authorization on disk
        // which could be purchased unexpectedly after a later restart.
        terminal={edit,error};
      }else retry();
    }).finally(()=>{if(epoch===generation){running=false;resume();}});
  }
  function retry(){
    if(timer!==undefined)return;
    timer=deps.schedule(()=>{timer=undefined;resume();},Math.min(60000,2000*2**Math.min(attempt++,5)));
  }
  function reset(){generation++;revision++;running=false;authorized=false;attempt=0;
    if(timer!==undefined)deps.cancel(timer);timer=undefined;journal=null;terminal=null;projecting=false;committedAt=revision;}
  return {receive,enqueue,resume,reset,revision:()=>revision,scope:()=>journal?.scope,
    wake:()=>{if(timer!==undefined)deps.cancel(timer);timer=undefined;resume();},
    slots:current,acquired:()=>journal?[...new Set([...journal.acquired,...journal.edits.flatMap(e=>e.purchased)])]:[],
    pending:()=>journal?clone(journal.edits):[],projecting:()=>projecting,
    pause:()=>{authorized=false;if(timer!==undefined)deps.cancel(timer);timer=undefined;},
  };
}
