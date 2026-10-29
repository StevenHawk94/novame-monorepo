import type {RoomCareAction} from '@novame/domain';
import type {BurrowArtAsset} from './burrow-art-assets';
export const GARDEN_DURATION={carrot:5000,leaf:5000,water:4000,fertilizer:4000} as const;
const PI=Math.PI;
// Worklet declarations are lowered to initialized values by the native Babel
// plugin. Define dependencies BEFORE consumers, not as forward references.
function circlePath(x:number,y:number,r:number){'worklet';return `M${x-r},${y}a${r},${r} 0 1,0 ${2*r},0a${r},${r} 0 1,0 ${-2*r},0Z`;}
export function gardenAngle(action:RoomCareAction,ms:number){
 'worklet';
 const ease=(t:number)=>1-(1-t)**3,smooth=(t:number)=>t*t*(3-2*t);
 if(action==='fertilizer')return 150*ease(Math.min(1,Math.max(0,ms)/650));
 if(action==='water')return 52*smooth(Math.min(1,Math.max(0,ms)/700));
 return 0;
}
export function gardenBitePath(action:RoomCareAction,ms:number){
 'worklet';
 const step=Math.floor(Math.min(5000,Math.max(0,ms))/5000*18);
 if(!step)return '';
 const size=action==='leaf'?980:736;if(step===18)return `M0 0H${size}V${size}H0Z`;
 const leaf=action==='leaf',cut=leaf?650-step*65:-550+step*52;
 const point=(s:number,t:number)=>`${(t+s)/2},${(t-s)/2}`;
 let d=leaf?`M${point(cut,-1600)}L${point(2200,-1600)}L${point(2200,3000)}L${point(cut,3000)}Z`
  :`M${point(cut,-1200)}L${point(-1800,-1200)}L${point(-1800,2400)}L${point(cut,2400)}Z`;
 for(let t=leaf?180:200;t<(leaf?1761:1500);t+=leaf?148:110)d+=circlePath((t+cut)/2,(t-cut)/2,leaf?69+step%3*5:51+step%3*3);
 return d;
}
function ellipsePath(x:number,y:number,rx:number,ry:number,angle:number){
 'worklet';const a=angle*PI/180,dx=rx*Math.cos(a),dy=rx*Math.sin(a);
 return `M${x-dx},${y-dy}a${rx},${ry} ${angle} 1,0 ${dx*2},${dy*2}a${rx},${ry} ${angle} 1,0 ${-dx*2},${-dy*2}Z`;
}
export function gardenWaterOutlet(angle:number,lane:number){
 'worklet';const a=angle*PI/180,axis=62*PI/180,spread=lane*119;
 const lx=40+(1126+Math.cos(axis)*spread)*.22-180,ly=75+(390+Math.sin(axis)*spread)*.22-175;
 return {x:180+lx*Math.cos(a)-ly*Math.sin(a),y:175+lx*Math.sin(a)+ly*Math.cos(a)};
}
/** Shared 420×480 pouring canvas. Visible flower bounds, not transparent
 * image padding, determine the centered bouquet and the landing surface. */
export function gardenFlowerLayout(flower?:BurrowArtAsset){
 const [left,top,right,bottom]=flower?.bounds??[0,0,180,240];
 const width=Math.max(1,right-left),height=Math.max(1,bottom-top),scale=Math.min(124/width,155/height);
 const w=width*scale,h=height*scale,x=(420-w)/2,y=465-h;
 return {left:x,top:y,width:w,height:h,image:{left:-left*scale,top:-top*scale,width:(flower?.width??180)*scale,height:(flower?.height??240)*scale},
  landing:{x:210,y:y+Math.min(12,h*.08),halfWidth:Math.min(23,w*.2)}};
}
export function gardenToolTransform(action:RoomCareAction){
 'worklet';
 const scale=action==='water'?.72:.8;
 const outlet=action==='water'?gardenWaterOutlet(52,0):{x:245,y:150+70*Math.cos(Math.PI/6)};
 return {scale,x:190-outlet.x*scale,y:205-outlet.y*scale};
}
function pourPoint(x:number,y:number,action:RoomCareAction){
 'worklet';const tool=gardenToolTransform(action);return{x:tool.x+x*tool.scale,y:tool.y+y*tool.scale};
}
/** Exact complement of the reference half-plane + overlapping equal-radius
 * circles. Adjacent circle arcs meet at their tangent-axis midpoint. Native
 * clipping avoids an expensive offscreen luminance mask on every frame. */
function visibleFoodPath(action:'carrot'|'leaf',step:number){
 const size=action==='leaf'?980:736;if(!step)return `M0 0H${size}V${size}H0Z`;if(step===18)return 'M0 0Z';
 const leaf=action==='leaf',cut=leaf?650-step*65:-550+step*52,r=leaf?69+step%3*5:51+step%3*3;
 const centers:number[]=[];for(let t=leaf?180:200;t<(leaf?1761:1500);t+=leaf?148:110)centers.push(t);
 const side=leaf?-1:1,range=r*Math.SQRT2,point=(s:number,t:number)=>`${(t+s)/2},${(t-s)/2}`;
 let d=`M${point(cut,-2000)}L${point(cut,centers[0]-range)}`;
 for(let i=0;i<centers.length;i++){
  const center=centers[i],end=i===centers.length-1?center+range:(center+centers[i+1])/2;
  const offset=side*Math.sqrt(Math.max(0,2*r*r-(end-center)**2));
  d+=`A${r},${r} 0 0,${leaf?0:1} ${point(cut+offset,end)}`;
 }
 return d+`L${point(cut,4000)}L${point(side*4000,4000)}L${point(side*4000,-2000)}Z`;
}
const FOOD_CLIPS={carrot:Array.from({length:19},(_,i)=>visibleFoodPath('carrot',i)),leaf:Array.from({length:19},(_,i)=>visibleFoodPath('leaf',i))};
export function gardenClipPath(action:'carrot'|'leaf',ms:number){
 'worklet';return FOOD_CLIPS[action][Math.floor(Math.min(5000,Math.max(0,ms))/5000*18)];
}
type Particle={born:number;x:number;y:number;vx:number;vy:number;rx:number;ry:number;life:number;opacity:number;color:number};
/** Finite reference emissions, generated ONCE, not new views/timers per grain.
 * Randomness is seeded per scene; motion/alpha remain frozen when released. */
export function createGardenParticles(action:RoomCareAction,seed=321){
 let state=seed>>>0;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const rows:Particle[]=[];
 if(action==='leaf'||action==='carrot'){
  for(let step=1;step<=18;step++)for(let i=0;i<5;i++){
   const leaf=action==='leaf',cut=leaf?650-step*65:-550+step*52,t=leaf?960:step<12?780:730;
   rows.push({born:5000/18*step,x:leaf?18+(t+cut)/2*.392:14+(t+cut)/2*392/736,
    y:leaf?18+(t-cut)/2*.392:8+(t-cut)/2*392/736,vx:(rand()-.5)*(leaf?55:70),vy:-30-rand()*(leaf?40:30),
    rx:2+rand()*2,ry:0,life:.55,opacity:1,color:leaf?i%2:step<12?0:1});
  }
 }else if(action==='fertilizer'){
  for(let i=1;i<=Math.floor((4000-650)/28);i++){
   const born=650+i*28,a=gardenAngle(action,born)*PI/180,lx=(rand()-.5)*72,ly=-70;
   rows.push({born,x:210+lx*Math.cos(a)-ly*Math.sin(a),y:150+lx*Math.sin(a)+ly*Math.cos(a),
    vx:22+rand()*38,vy:10+rand()*30,rx:2.4+rand()*2.6,ry:0,life:.76,opacity:1,color:0});
  }
 }else{
  let budget=0,emitted=0;
  for(let ms=1;ms<=4000;ms++){
   const angle=gardenAngle(action,ms),power=Math.sqrt(Math.min(1,Math.max(0,(angle-20)/32)));
   budget+=power/3;
   while(budget>=1){budget--;const lane=(emitted%9-4)/4;emitted++;
    const o=gardenWaterOutlet(angle,lane+(rand()-.5)*.035),direction=(angle-28+lane*8+(rand()-.5)*4)*PI/180;
    const speed=(183+rand()*24)*(.75+.25*power);
    rows.push({born:ms-rand()*8,x:o.x,y:o.y,vx:Math.cos(direction)*speed,vy:Math.sin(direction)*speed,
     rx:.85+rand()*.6,ry:2+rand()*1.6,life:.51+rand()*.04,opacity:.6+rand()*.27,color:emitted%4===0?1:0});
   }
  }
 }
 return rows.sort((a,b)=>a.born-b.born);
}
/** Fixed 16 opacity/color paths replace hundreds of individually updated SVG
 * nodes. Pour trajectories converge on the displayed bouquet; food keeps its
 * reference physics. Alpha is rounded to eight levels. */
export function gardenFrame(action:RoomCareAction,ms:number,particles:readonly Particle[],reduced=false,landing={x:210,y:322,halfWidth:23}){
 'worklet';
 ms=Math.max(0,Math.min(GARDEN_DURATION[action],ms));
 const paths=Array.from({length:16},()=>''),jets=['',''];
 let jetOpacity=0;const pouring=action==='water'||action==='fertilizer';
 const angle=reduced?(pouring&&ms>0?gardenAngle(action,GARDEN_DURATION[action]):0):gardenAngle(action,ms);
 if(!reduced&&(ms<GARDEN_DURATION[action]||action==='water'||action==='fertilizer')){
  // Lifetime never exceeds 760ms. Binary search keeps the work proportional
  // to LIVE particles, not the whole four-second emission history.
  let lo=0,hi=particles.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(particles[mid].born<ms-760)lo=mid+1;else hi=mid;}
  for(let i=lo;i<particles.length&&particles[i].born<=ms;i++){
   const p=particles[i],t=(ms-p.born)/1000;if(t<0||t>p.life)continue;
   const water=action==='water',fert=action==='fertilizer';
   const opacity=water?p.opacity*Math.min(1,Math.max(0,t/.035))*Math.min(1,Math.max(0,(p.life-t)/.08))
    :fert?Math.min(1,Math.max(0,(.76-t)/.18)):Math.max(0,1-t/.55);
   if(opacity<=0)continue;
   const bucket=p.color*8+Math.min(7,Math.max(0,Math.round(opacity*8)-1));
   let x=p.x+p.vx*t,y=p.y+p.vy*t+(water?280:fert?240:100)*t*t;
   if(water||fert){
    const origin=pourPoint(p.x,p.y,action),u=Math.min(1,t/p.life);
    const endX=landing.x+Math.sin(p.born*12.9898)*landing.halfWidth;
    x=origin.x+(endX-origin.x)*u;y=origin.y+(landing.y-origin.y)*u*u;
    if(y+p.ry+p.rx>=landing.y)continue;
   }
   paths[bucket]+=water?ellipsePath(x,y,p.rx,p.ry+Math.min(t*2,1),-Math.atan2(p.vx,p.vy+560*t)*180/PI):circlePath(x,y,p.rx);
  }
  if(action==='water'){
   const power=Math.sqrt(Math.min(1,Math.max(0,(angle-20)/32)));
   jetOpacity=power*.72;
   for(let i=0;i<9;i++){
    const lane=(i-4)/4,oRaw=gardenWaterOutlet(angle,lane),o=pourPoint(oRaw.x,oRaw.y,action);
    let d=`M${o.x} ${o.y}`;for(let k=1;k<=10;k++){const u=k/10*.24*Math.min(1,power*2);d+=`L${o.x+(landing.x+lane*landing.halfWidth-o.x)*u} ${o.y+(landing.y-o.y)*u*u}`;}
    jets[i%3===0?0:1]+=d;
   }
  }
 }
 return {mask:action==='carrot'||action==='leaf'?gardenClipPath(action,ms):'',angle,paths,jets,jetOpacity};
}
