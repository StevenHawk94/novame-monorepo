import {TOUCH_RULES,validateTouchClip,createTouchCounter,countTouchEvent,advanceTouchCounter,type TouchClip,type TouchEvent} from '@novame/domain';
/** Local-only checkpoint. Never accepted by the send API as a complete clip. */
export type TouchRecordingCheckpoint={version:1|2;started:boolean;elapsedMs:number;touches:number;events:TouchEvent[]};
export function validTouchCheckpoint(value:unknown):value is TouchRecordingCheckpoint {
 const v=value as TouchRecordingCheckpoint;
 if(!v||![1,2].includes(v.version)||typeof v.started!=='boolean'||!Number.isSafeInteger(v.elapsedMs)||v.elapsedMs<0||v.elapsedMs>60000
  ||!Array.isArray(v.events)||v.events.length>TOUCH_RULES.maxEvents-1||!Number.isSafeInteger(v.touches)||v.touches<0||v.touches>999)return false;
 if(!v.started)return v.elapsedMs===0&&v.touches===0&&v.events.length===0;
 if(!v.events.length||!Array.isArray(v.events.at(-1))||v.events.at(-1)![0]>v.elapsedMs)return false;
 // Validation-only action permits a zero-count partial locally; it is never
 // stored or sent. The unchanged wire validator checks coordinates/order.
 return validateTouchClip({version:v.version,durationMs:60000,touches:v.touches||1,
  events:v.touches?v.events:[...v.events,[v.elapsedMs,4,0,0,0]]});
}
/** Input-only model: no rendering, task, rating, wallet or network imports. */
export function createTouchRecorder(checkpoint?:TouchRecordingCheckpoint|null,version:1|2=1){
 const restored=validTouchCheckpoint(checkpoint)?checkpoint:null;
 version=restored?.version??version;
 let start:number|null=restored?.started?0:null,stopped=false,interrupted=false,count=restored?.touches??0;
 const counter=createTouchCounter(version);for(const e of restored?.events??[])countTouchEvent(counter,e);
 const events:TouchEvent[]=restored?.events.map(e=>[...e])??[],held=new Map<number,{slot:number;x:number;y:number;last:number}>();
 let last=restored?.elapsedMs??0,bytes=JSON.stringify(events).replace(/[:,]/g,'$& ').length;
 const append=(event:TouchEvent)=>{events.push(event);bytes+=JSON.stringify(event).replace(/[:,]/g,'$& ').length+2;countTouchEvent(counter,event);};
 const at=(elapsed:number)=>Math.min(60000,Math.max(last,Math.floor(elapsed)));
 const finishElapsed=(elapsed:number):TouchClip|null=>{
  if(start===null||elapsed<60000||interrupted)return null;
  if(!stopped){for(const h of held.values())append([60000,3,h.slot,h.x,h.y]);held.clear();stopped=true;last=60000;}
  const clip:TouchClip={version,durationMs:60000,touches:version===2?counter.count:count,events:events.map(e=>[...e])};
  return validateTouchClip(clip)?clip:null;
 };
 return {
  input(e:TouchEvent){
   if(stopped||interrupted)return;
   const [stamp,k,id,x,y]=e;if(start===null){if(![0,4,5].includes(k))return;start=stamp;}
   const raw=Math.round(stamp-start);if(raw>60000)return;const t=Math.max(last,0,raw);last=t;
   // Reserve room for held-finger cancellations. Drop excess sampling, not
   // the whole minute, if the bounded event/JSONB budget is reached.
   const room=events.length<TOUCH_RULES.maxEvents-8&&bytes<TOUCH_RULES.maxBytes-1024;
   if(k>=4){if(count<999&&room){append([t,k,0,0,0]);count++;}return;}
   if(k===0){if(!room||held.has(id)||held.size>=2||count>=999)return;
    const slot=[0,1].find(n=>![...held.values()].some(v=>v.slot===n))!;
    held.set(id,{slot,x,y,last:t});append([t,0,slot,x,y]);return;}
   const h=held.get(id);if(!h)return;h.x=x;h.y=y;
   if(k===1){if(!room||t-h.last<TOUCH_RULES.sampleMs)return;h.last=t;append([t,1,h.slot,x,y]);}
   else {const end=k===2&&count>=999?3:k;append([t,end,h.slot,x,y]);held.delete(id);if(end===2)count++;}
  },
  elapsed(now:number){return start===null?0:at(now-start);},
  advance(elapsed:number){if(start!==null){advanceTouchCounter(counter,at(elapsed));}},
  get started(){return start!==null;},get touches(){return version===2?counter.count:count;},get interrupted(){return interrupted;},
  checkpoint(elapsed:number):TouchRecordingCheckpoint {const t=start===null?0:at(elapsed);advanceTouchCounter(counter,t);return {version,started:start!==null,elapsedMs:t,touches:version===2?counter.count:count,
   events:[...events.map(e=>[...e] as TouchEvent),...Array.from(held.values(),h=>[t,3,h.slot,h.x,h.y] as TouchEvent)]};},
  pause(elapsed:number){const t=at(elapsed);for(const h of held.values())append([t,3,h.slot,h.x,h.y]);held.clear();last=t;},
  // Explicit scope revocation only. Ordinary lifecycle pauses retain input.
  interrupt(){interrupted=true;held.clear();},
  finishElapsed,
  finish(now:number){return finishElapsed(start===null?0:now-start);},
 };
}
