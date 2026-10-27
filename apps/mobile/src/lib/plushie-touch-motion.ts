import {createTouchCounter,countTouchEvent,advanceTouchCounter,type TouchClip,type TouchQuality} from '@novame/domain';
import {beginToyTouch,moveToyTouch,endToyTouch,cancelToyTouches,hitToy,type ToyMotion} from './squishy-toy-motion';
export function createTouchPlayback(quality:TouchQuality='full'){
 'worklet';return {at:-1,last:-1,elapsed:0,paused:false,cursor:0,count:0,counter:createTouchCounter(2),quality:quality==='light'?'standard' as TouchQuality:quality,feedbackAt:-1000,notifyAt:-1000,windowAt:-1,slow:0,frames:0,done:false};
}
export type TouchPlayback=ReturnType<typeof createTouchPlayback>;
export function pauseTouchPlayback(s:TouchPlayback,paused:boolean){'worklet';s.paused=paused;s.last=-1;s.windowAt=-1;s.frames=0;s.slow=0;}
/** UI-thread-only. One bounded cursor and no per-event timers, network, task
 * records, wallet mutations or serialized React snapshots. */
export function advanceTouchPlayback(s:TouchPlayback,m:ToyMotion,clip:TouchClip,now:number,frameMs:number,adaptive=true){
 'worklet';if(s.done||s.paused)return {pulse:false,notify:false,finished:false,degraded:false,elapsed:s.elapsed,count:s.count};
 if(s.at<0){s.at=now;s.counter=createTouchCounter(clip.version);}
 if(s.last>=0)s.elapsed=Math.min(60000,s.elapsed+Math.max(0,now-s.last));s.last=now;
 const elapsed=s.elapsed;let pulse=false,degraded=false;
 if(s.windowAt<0)s.windowAt=now;
 s.frames++;if(frameMs>34)s.slow++;
 if(now-s.windowAt>=1500&&s.frames>=3){
  if(adaptive&&s.slow/s.frames>.15&&s.quality==='full'){
   s.quality='standard';cancelToyTouches(m);degraded=true;
  }
  s.frames=0;s.slow=0;s.windowAt=now;
 }
 const b=m.geometry.bounds;
 // Bound adversarial/late batches; never replay hundreds of missed impulses
 // in one JS turn, and at most one haptic request per rendered frame.
 let budget=64;
 while(s.cursor<clip.events.length&&clip.events[s.cursor][0]<=elapsed&&budget-->0){
  const e=clip.events[s.cursor++],[,kind,p,x,y]=e;
  const px=b[0]+(b[2]-b[0])*x/1000,py=b[1]+(b[3]-b[1])*y/1000;
  m.clock=now;
  if(s.quality==='full'){
   if(kind===0)beginToyTouch(m,p,px,py);
   else if(kind===1)moveToyTouch(m,p,px,py);
   else if(kind===2||kind===3)endToyTouch(m,p);
   else hitToy(m,kind===4?'squeeze':'punch');
  }else if(s.quality==='standard'&&(kind===0||kind>=4))hitToy(m,kind===5?'punch':'squeeze');
  const tick=s.counter.next,held=s.counter.held;countTouchEvent(s.counter,e);
  if(clip.version===2&&held&&tick>=0&&tick<=e[0]){
   const latest=tick+Math.floor((Math.min(59999,e[0])-tick)/500)*500;
   if(elapsed-latest<180&&now-s.feedbackAt>=140){pulse=true;s.feedbackAt=now;if(s.quality==='standard')hitToy(m,'squeeze');}
  }
  if(kind===0||kind>=4){
   // No catch-up vibration burst after a stall. Preserve the timeline; dense
   // touches are represented by one safe pulse instead of an impulse queue.
   if(elapsed-e[0]<180&&now-s.feedbackAt>=140){pulse=true;s.feedbackAt=now;}
  }
 }
 const until=s.cursor<clip.events.length&&clip.events[s.cursor][0]<=elapsed?clip.events[s.cursor][0]-1:elapsed;
 const before=s.counter.count,next=s.counter.next;advanceTouchCounter(s.counter,until);s.count=s.counter.count;
 if(s.count>before&&next>=0&&until-next<180&&now-s.feedbackAt>=140){pulse=true;s.feedbackAt=now;if(s.quality==='standard')hitToy(m,'squeeze');}
 const finished=elapsed>=60000;
 if(finished){cancelToyTouches(m);s.done=true;s.count=clip.touches;}
 const notify=finished||now-s.notifyAt>=100||degraded;
 if(notify)s.notifyAt=now;
 return {pulse,notify,finished,degraded,elapsed,count:s.count,quality:s.quality};
}
