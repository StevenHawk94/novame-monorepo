import { wateringCanPoint, type careLayout } from './burrow-care-layout';
type Layout = ReturnType<typeof careLayout>;
type Drop = { x:number;y:number;vx:number;vy:number;r:number;a:number };
export const WATER_HOLES=[[-221.9,-25.6],[-217.9,-34.8],[-214,-44],[-210,-53.2],[-206.1,-62.4]] as const;
export const WATER_TUNE={duration:3,rate:12,speed:120,spread:26,gravity:900,tilt:75};
export function createWaterMotion(complete=false) {
  'worklet';
  return {holding:false,completed:complete,progress:complete?1:0,holdStartedAt:0,holdSeconds:0,tilt:0,drops:[] as Drop[],accumulators:[0,0,0,0,0],paths:['','','','','']};
}
export function waterDropPath(drop:Drop){
  'worklet';
  const speed=Math.hypot(drop.vx,drop.vy)||1,ux=drop.vx/speed,uy=drop.vy/speed,tail=drop.r*1.8+speed*.009;
  const a={x:drop.x-uy*drop.r,y:drop.y+ux*drop.r},b={x:drop.x+uy*drop.r,y:drop.y-ux*drop.r};
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(drop.x+ux*drop.r).toFixed(1)} ${(drop.y+uy*drop.r).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)} L${(drop.x-ux*tail).toFixed(1)} ${(drop.y-uy*tail).toFixed(1)} Z`;
}
/** UI-thread physics. No React state, JS timer, bridge path serialization or
 * per-frame callbacks. Completion is the only business event emitted. */
export function advanceWaterMotion(state:ReturnType<typeof createWaterMotion>,elapsedMs:number,current:Layout,reduced=false,now?:number){
  'worklet';
  // Only physics clamps its step. Hold duration is real elapsed foreground
  // time, so a dropped frame must not turn a three-second hold into five.
  const seconds=Math.max(elapsedMs,0)/1000,dt=Math.min(seconds,.05);let completed=false;
  if(state.holding&&!state.completed){
    state.holdSeconds=Math.max(state.holdSeconds+seconds,now!==undefined&&state.holdStartedAt>0?Math.max(0,now-state.holdStartedAt)/1000:0);
    state.progress=Math.min(1,state.holdSeconds/WATER_TUNE.duration);
    if(state.progress>=1){state.completed=true;state.holding=false;completed=true;}
  }
  const target=state.holding?-WATER_TUNE.tilt:0;
  state.tilt+=(target-state.tilt)*Math.min(1,dt*11);
  if(state.holding&&state.tilt<-30&&!reduced){
    const step=WATER_TUNE.spread/(WATER_HOLES.length-1);
    WATER_HOLES.forEach(([hx,hy],index)=>{
      state.accumulators[index]+=dt*WATER_TUNE.rate;
      while(state.accumulators[index]>=1){
        state.accumulators[index]--;
        const point=wateringCanPoint(hx,hy,state.tilt,current.can);
        const degrees=203+state.tilt+(index-2)*step+(Math.random()-.5)*5;
        const radians=degrees*Math.PI/180,speed=WATER_TUNE.speed*(.85+Math.random()*.3)*current.can.scale/.62;
        state.drops.push({x:point.x,y:point.y,vx:Math.cos(radians)*speed,vy:Math.sin(radians)*speed,r:(2.8+Math.random()*1.2)*current.can.scale/.62,a:.78+Math.random()*.2});
      }
    });
  }else state.accumulators.fill(0);
  state.drops=state.drops.filter(drop=>{drop.vy+=WATER_TUNE.gravity*current.can.scale/.62*dt;drop.x+=drop.vx*dt;drop.y+=drop.vy*dt;return !reduced&&drop.y<current.waterEnd&&drop.x>0&&drop.x<current.stageWidth;}).slice(-600);
  const paths=['','','','',''];
  for(const drop of state.drops){
    const visible=drop.a*Math.min(1,Math.max(0,(current.waterEnd-drop.y)/24));if(visible<.08)continue;
    paths[Math.min(4,Math.max(0,Math.round(visible*5)-1))]+=waterDropPath(drop)+' ';
  }
  state.paths=paths;return completed;
}
