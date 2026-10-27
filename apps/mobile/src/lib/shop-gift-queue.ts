import type { MajorUpdateBootstrap } from './app-major-update-api';
import { notificationScope } from './notification-content-version';
import { projectShopGift, type ShopGiftIntent } from './shop-gift-model';
type Journal={version:1;scope:string;jobs:ShopGiftIntent[]};
/** Durable, serial, idempotent gift intents. No money or entitlement is created
 * here. The server atomically grants ownership and optionally changes ONE slot. */
export function createShopGiftQueue(deps:{owner:()=>string|null|undefined;active:()=>boolean;load:(owner:string)=>unknown;
  save:(owner:string,value:Journal)=>void;send:(job:ShopGiftIntent,scope:string)=>Promise<void>;
  changed:()=>void;rejected:(job:ShopGiftIntent,error:unknown)=>void;confirmed:()=>void;
  definitive:(error:unknown)=>boolean;schedule:(fn:()=>void,ms:number)=>unknown;cancel:(timer:unknown)=>void}) {
  let journal:Journal|null=null,authorized=false,running=false,generation=0,revision=0,attempt=0,timer:unknown;
  const receipts=new Map<string,{job:ShopGiftIntent;revision:number}>();
  const persist=()=>{if(journal)deps.save(journal.scope.split(':')[0],JSON.parse(JSON.stringify(journal)));};
  function reset(){generation++;revision++;authorized=false;running=false;journal=null;receipts.clear();attempt=0;
    if(timer!==undefined)deps.cancel(timer);timer=undefined;}
  function receive(data:MajorUpdateBootstrap,remote=false,readRevision=revision){
    if(data.profile.id!==deps.owner())return;
    const scope=notificationScope(data);
    if(journal?.scope!==scope){reset();let disk:any;try{disk=deps.load(data.profile.id);}catch{}
      const valid=disk?.version===1&&disk.scope===scope&&Array.isArray(disk.jobs)&&disk.jobs.length<=200
        &&disk.jobs.every((job:any)=>typeof job.gift?.id==='string'&&job.gift.sender_id===data.partner?.id
          &&typeof job.itemId==='string'&&job.itemId===job.gift.item_id&&typeof job.replace==='boolean'
          &&(job.slot===null||typeof job.slot==='string')&&(job.previousItemId===null||typeof job.previousItemId==='string'));
      journal=valid?disk:{version:1,scope,jobs:[]};
    }
    if(remote){authorized=data.pairAccessVerified===true&&!!data.partner;
      for(const [id,row] of receipts)if(readRevision>=row.revision)receipts.delete(id);
    }
  }
  function enqueue(job:ShopGiftIntent){
    if(!journal||journal.scope.split(':')[0]!==deps.owner()||!authorized)throw Error('gift_not_ready');
    if(journal.jobs.some(row=>row.gift.id===job.gift.id)||receipts.has(job.gift.id))return;
    if(journal.jobs.length>=200)throw Error('gift_sync_backlog');
    journal.jobs.push(JSON.parse(JSON.stringify(job)));
    try{persist();}catch{journal.jobs.pop();throw Error('intent_not_saved');}
    revision++;deps.changed();resume();
  }
  function retry(){if(timer!==undefined)return;timer=deps.schedule(()=>{timer=undefined;resume();},Math.min(60000,2000*2**Math.min(attempt++,5)));}
  function resume(){
    if(running||timer!==undefined||!authorized||!deps.active()||!journal?.jobs.length||journal.scope.split(':')[0]!==deps.owner())return;
    const own=generation,context=journal,job=context.jobs[0];running=true;
    const current=()=>own===generation&&journal===context&&context.scope.split(':')[0]===deps.owner();
    void Promise.resolve().then(()=>{if(!current()||!authorized)throw Error('session_changed');return deps.send(job,context.scope);}).then(()=>{
      if(!current())return;
      context.jobs.shift();receipts.set(job.gift.id,{job,revision:++revision});attempt=0;
      try{persist();}catch{/* The disk retains the identical idempotent gift ID. */}
      try{deps.changed();}catch{}
      try{deps.confirmed();}catch{}
    }).catch(error=>{
      if(!current())return;
      if(deps.definitive(error)){
        const before=context.jobs;
        context.jobs=context.jobs.slice(1).map(next=>job.replace&&next.slot===job.slot&&next.previousItemId===job.itemId
          ?{...next,previousItemId:job.previousItemId}:next);
        try{persist();}catch{context.jobs=before;retry();return;}
        revision++;try{deps.rejected(job,error);}catch{}
        try{deps.changed();}catch{}
        try{deps.confirmed();}catch{}
      }else retry();
    }).finally(()=>{if(current()){running=false;resume();}});
  }
  return {receive,enqueue,resume,reset,revision:()=>revision,hasPending:()=>!!journal?.jobs.length,
    project:(data:MajorUpdateBootstrap)=>journal?.scope===notificationScope(data)
      ?[...receipts.values()].map(row=>row.job).concat(journal.jobs).reduce((value,job)=>projectShopGift(value,job),data):data,
    pause:()=>{authorized=false;if(timer!==undefined)deps.cancel(timer);timer=undefined;}};
}
