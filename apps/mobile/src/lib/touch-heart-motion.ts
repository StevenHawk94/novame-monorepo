// Fixed-budget UI-thread presentation only; never changes recorded touches.
export const TOUCH_HEART_FLIGHT_MS=850;
export function queueTouchHeartBursts(previous:readonly number[],clock:number,amount=1){
 'worklet';const next=[...previous];let remaining=Math.min(6,amount);
 // Keep in-flight hearts AND their landing rebound. At high input density,
 // coalesce visual feedback rather than recycling every slot before landing.
 for(let i=0;i<Math.min(6,next.length)&&remaining>0;i++)if(clock-next[i]>=TOUCH_HEART_FLIGHT_MS+420){next[i]=clock;remaining--;}
 return next;
}
export function touchHeartScale(count:number){
 'worklet';return 2/3+Math.max(0,Math.min(999,Number.isFinite(count)?count:0))/999/3;
}
export function touchHeartCollectScale(clock:number,bursts:readonly number[]){
 'worklet';let pulse=0;
 for(let i=0;i<Math.min(6,bursts.length);i++){
  const age=clock-bursts[i]-TOUCH_HEART_FLIGHT_MS;
  if(age>=0&&age<420)pulse=Math.max(pulse,Math.exp(-age/115)*Math.sin(age/34)*.09);
 }
 return 1+pulse;
}
export function touchHeartFlight(age:number,index:number,travelY:number){
 'worklet';const t=Math.max(0,Math.min(1,age/TOUCH_HEART_FLIGHT_MS));
 return {opacity:age<0||age>=TOUCH_HEART_FLIGHT_MS?0:Math.min(1,t*10,(1-t)*8),
  x:(index%2?1:-1)*(12+index*9)*Math.sin(t*Math.PI),y:travelY*t,scale:1-t*.7};
}
