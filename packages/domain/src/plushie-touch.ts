/** Versioned wire protocol. Coordinates are relative to the toy alpha bounds,
 * never screen pixels, private photo bytes or Metro numeric asset IDs. */
export const TOUCH_RULES={version:2,durationMs:60000,maxTouches:999,maxEvents:8192,maxBytes:262144,
  sampleMs:34,hapticGapMs:140,holdMs:500,plusHistoryLimit:10,freeMonthly:1,plusDaily:1} as const;
// down, move, up, cancel, squeeze, bonk; [time,kind,pointer,x,y].
export type TouchEvent=[number,number,number,number,number];
export type TouchClip={version:1|2;durationMs:60000;touches:number;events:TouchEvent[]};
export type TouchQuality='full'|'standard'|'light';
type TouchSendAccess={sameDomain:boolean;sendAllowed?:boolean;hasPlus:boolean;sendHasPlus?:boolean};
/** Server transport permission is not proof of shared economic/Plus identity.
 * Old servers omit the new fields, retaining their existing same-domain gate. */
export function touchSendAllowed(meta:TouchSendAccess|null|undefined){
 return !!meta&&(meta.sendAllowed===true||(meta.sendAllowed===undefined&&meta.sameDomain===true));
}
export function touchSendHasPlus(meta:TouchSendAccess|null|undefined){
 return !!meta&&(meta.sendHasPlus===true||(meta.sendHasPlus===undefined&&meta.hasPlus===true));
}
/** Incremental, shared by recorder/playback; two fingers share one hold clock.
 * V1 remains release-counted. V2 never manufactures up/down events for holds. */
export function createTouchCounter(version:1|2){'worklet';return {version,count:0,held:0,next:-1};}
export function advanceTouchCounter(s:ReturnType<typeof createTouchCounter>,until:number){
 'worklet';const end=Math.min(59999,until);
 if(s.version===2&&s.held&&s.next>=0&&s.next<=end){
  const n=Math.floor((end-s.next)/500)+1;s.count=Math.min(999,s.count+n);s.next+=n*500;
 }
}
export function countTouchEvent(s:ReturnType<typeof createTouchCounter>,e:TouchEvent){
 'worklet';advanceTouchCounter(s,e[0]);const k=e[1];
 if(k===0){if(s.version===2&&!s.held){s.count=Math.min(999,s.count+1);s.next=e[0]+500;}s.held++;}
 else if(k===2||k===3){s.held--;if(!s.held)s.next=-1;if(s.version===1&&k===2)s.count=Math.min(999,s.count+1);}
 else if(k>=4)s.count=Math.min(999,s.count+1);
}
export function validateTouchClip(value:unknown):value is TouchClip{
 const c=value as TouchClip;
 if(!c||![1,2].includes(c.version)||c.durationMs!==TOUCH_RULES.durationMs||!Number.isInteger(c.touches)
  ||c.touches<1||c.touches>TOUCH_RULES.maxTouches||!Array.isArray(c.events)||!c.events.length||c.events.length>TOUCH_RULES.maxEvents)return false;
 if(Object.keys(c).length!==4)return false;
 const held=new Set<number>(),counter=createTouchCounter(c.version);let previous=-1,count=0;
 for(const e of c.events){
  if(!Array.isArray(e)||e.length!==5||!e.every(Number.isSafeInteger))return false;
  const [t,k,p,x,y]=e;
  if(t<previous||t<0||t>60000||k<0||k>5||p<0||p>1||x< -1000||x>2000||y< -1000||y>2000)return false;
  if(c.version===2&&t===60000&&(k===0||k>=4))return false;
  if(previous<0&&(t!==0||![0,4,5].includes(k)))return false;
  previous=t;
  if(k===0){if(held.has(p)||x<0||x>1000||y<0||y>1000)return false;held.add(p);}
  else if(k<4){if(!held.has(p))return false;if(k>=2){held.delete(p);if(k===2)count++;}}
  else {if(p!==0||x!==0||y!==0)return false;count++;}
  countTouchEvent(counter,e);
 }
 // Match PostgreSQL jsonb::text's comma/colon whitespace budget exactly for
 // this numeric-only schema, not JS UTF-16 length of arbitrary extra fields.
 return held.size===0&&(c.version===1?count:counter.count)===c.touches&&JSON.stringify(c).replace(/[:,]/g,'$& ').length<=TOUCH_RULES.maxBytes;
}
