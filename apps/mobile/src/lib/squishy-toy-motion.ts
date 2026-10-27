import { clampToyPull, toyPullLimit, TOY_TAP_SLOP } from './burrow-toy-warp';

export type ToyHit='squeeze'|'punch';
type Attack={elapsed:number;duration:number;from:number;velocity:number;to:number};
type Pending={delay:number;duration:number;to:number};
export type ToySpring={x:number;v:number;k:number;c:number;attack:Attack|null;pending:Pending|null};
type Rub={x:number;y:number;radius:number;spring:ToySpring};
type Pull={x:number;y:number;dx:ToySpring;dy:ToySpring;held:boolean};
type Touch={id:number;x:number;y:number;moved:boolean;slot:number;startX:number;startY:number;rub:number};
type Particle={x:number;y:number;age:number;life:number;dx:number;dy:number};
export type ToyGeometry={baseX:number;baseY:number;headWidth:number;headX?:number;headTop?:number;scale:number;bounds:number[]};
export type ToyMotion={clock:number;active:boolean;reduced:boolean;geometry:ToyGeometry;
  squeeze:ToySpring;squeezeComp:ToySpring;punch:ToySpring;punchComp:ToySpring;breath:ToySpring;
  rubs:Rub[];pulls:Pull[];touches:Touch[];particles:Particle[];feedbackAt:number;particleSerial:number};

function spring(k=170,c=9):ToySpring {
  'worklet';
  return {x:0,v:0,k,c,attack:null,pending:null};
}
export function createToyMotion(geometry:ToyGeometry,reduced=false):ToyMotion {
  'worklet';
  return {clock:0,active:false,reduced,geometry,squeeze:spring(270,10.6),squeezeComp:spring(148.5,13.1),
    punch:spring(337.5,9.6),punchComp:spring(148.5,13.1),breath:spring(230,15),
    rubs:Array.from({length:4},()=>({x:0,y:0,radius:1,spring:spring(170,7)})),
    pulls:Array.from({length:4},()=>({x:0,y:0,dx:spring(170,12),dy:spring(170,12),held:false})),
    touches:[],particles:Array.from({length:12},()=>({x:0,y:0,age:1,life:1,dx:0,dy:0})),
    feedbackAt:-1000,particleSerial:0};
}
function attack(s:ToySpring,to:number,duration:number) {
  'worklet';
  // Capture position AND velocity. A new action cannot reset a moving doll.
  s.attack={elapsed:0,duration,from:s.x,velocity:s.v,to};s.pending=null;
}
function advanceSpring(s:ToySpring,ms:number) {
  'worklet';
  if(s.pending) {
    const before=Math.min(ms,s.pending.delay),pending=s.pending;
    s.pending=null;advanceSpring(s,before);pending.delay-=before;ms-=before;
    if(pending.delay<=0)attack(s,pending.to,pending.duration);else s.pending=pending;
    if(ms<=0)return;
  }
  if(s.attack) {
    const a=s.attack,before=Math.min(ms,a.duration-a.elapsed);
    a.elapsed+=before;ms-=before;
    const t=Math.min(1,a.elapsed/a.duration),t2=t*t,t3=t2*t,d=a.duration/1000;
    s.x=(2*t3-3*t2+1)*a.from+(t3-2*t2+t)*d*a.velocity+(-2*t3+3*t2)*a.to;
    s.v=((6*t2-6*t)*a.from+(3*t2-4*t+1)*d*a.velocity+(-6*t2+6*t)*a.to)/d;
    if(t>=1){s.x=a.to;s.v=0;s.attack=null;}
    if(ms<=0)return;
  }
  // Closed-form spring: no Euler instability at 60/120Hz or after a long frame.
  const dt=ms/1000,b=s.c/2,w=Math.sqrt(Math.max(.01,s.k-b*b));
  const e=Math.exp(-b*dt),co=Math.cos(w*dt),si=Math.sin(w*dt),x=s.x,v=s.v,q=(v+b*x)/w;
  s.x=e*(x*co+q*si);s.v=e*(-b*(x*co+q*si)-x*w*si+q*w*co);
  if(Math.abs(s.x)<.0001&&Math.abs(s.v)<.001){s.x=0;s.v=0;}
}
function alive(s:ToySpring) {
  'worklet';
  return !!s.attack||!!s.pending||s.x!==0||s.v!==0;
}
export function toyAxes(s:ToyMotion) {
  'worklet';
  return {x:Math.max(.7,Math.min(1.18,1+s.squeeze.x+s.punchComp.x+s.breath.x)),
    y:Math.max(.7,Math.min(1.18,1+s.punch.x+s.squeezeComp.x+s.breath.x))};
}
function unwarp(s:ToyMotion,x:number,y:number) {
  'worklet';
  const axes=toyAxes(s),g=s.geometry;
  return {x:g.baseX+(x-g.baseX)/axes.x,y:g.baseY+(y-g.baseY)/axes.y};
}
export function feedback(s:ToyMotion,x:number,y:number) {
  'worklet';
  if(s.clock-s.feedbackAt<140)return false;
  s.feedbackAt=s.clock;
  if(!s.reduced)for(let i=0;i<3;i++) {
    const p=s.particles[(s.particleSerial++)%s.particles.length];
    p.x=x;p.y=y;p.age=-i*35;p.life=2000;p.dx=(i-1)*25;p.dy=-170-i*18;
  }
  s.active=!s.reduced;return true;
}
export function hitToy(s:ToyMotion,kind:ToyHit) {
  'worklet';
  if(!s.reduced) {
    const drive=kind==='squeeze'?s.squeeze:s.punch,comp=kind==='squeeze'?s.squeezeComp:s.punchComp;
    attack(drive,-.3,kind==='squeeze'?55:44);
    comp.pending={delay:5,duration:110,to:.15};s.active=true;
  }
  return feedback(s,(s.geometry.headX??s.geometry.baseX)-12,s.geometry.headTop??s.geometry.bounds[1]);
}
function bulge(s:ToyMotion,x:number,y:number) {
  'worklet';
  let index=s.rubs.findIndex(r=>!alive(r.spring));
  if(index<0) {
    let distance=Infinity;index=0;
    for(let i=0;i<s.rubs.length;i++) {
      const r=s.rubs[i],d=Math.hypot(x-r.x,y-r.y);
      if(d<distance){index=i;distance=d;}
    }
    // Occupied slots keep their centres; add energy, never teleport a bump.
  }else {s.rubs[index].x=x;s.rubs[index].y=y;}
  const r=s.rubs[index];r.radius=s.geometry.headWidth*.58;
  attack(r.spring,.55,80);attack(s.breath,-.012,50);s.active=true;return index;
}
export function beginToyTouch(s:ToyMotion,id:number,x:number,y:number) {
  'worklet';
  if(s.touches.length>=2||s.touches.some(t=>t.id===id))return {accepted:false,feedback:false};
  const point=unwarp(s,x,y),b=s.geometry.bounds;
  if(point.x<b[0]||point.y<b[1]||point.x>b[2]||point.y>b[3])return {accepted:false,feedback:false};
  const rub=s.reduced?-1:bulge(s,point.x,point.y);
  s.touches.push({id,x:point.x,y:point.y,moved:false,slot:-1,startX:0,startY:0,rub});
  return {accepted:true,feedback:feedback(s,point.x,point.y)};
}
export function moveToyTouch(s:ToyMotion,id:number,x:number,y:number) {
  'worklet';
  const t=s.touches.find(item=>item.id===id);if(!t||s.reduced)return;
  const point=unwarp(s,x,y);let dx=point.x-t.x,dy=point.y-t.y;
  if(!t.moved&&Math.hypot(dx,dy)*s.geometry.scale<=TOY_TAP_SLOP)return;
  if(!t.moved) {
    t.moved=true;
    // Crossing the tap slop takes ownership at the CURRENT finger position;
    // don't suddenly apply all the displacement accumulated before activation.
    t.x=point.x;t.y=point.y;dx=0;dy=0;
    if(t.rub>=0){const r=s.rubs[t.rub].spring;r.attack=null;r.c=14;}
    let slot=s.pulls.findIndex(p=>!p.held&&!alive(p.dx)&&!alive(p.dy));
    if(slot<0) {
      let distance=Infinity;
      for(let i=0;i<s.pulls.length;i++)if(!s.pulls[i].held) {
        const p=s.pulls[i],d=Math.hypot(t.x-p.x,t.y-p.y);
        if(d<distance){distance=d;slot=i;}
      }
    }
    if(slot<0)return;
    const p=s.pulls[slot];if(!alive(p.dx)&&!alive(p.dy)){p.x=t.x;p.y=t.y;}
    p.held=true;t.slot=slot;t.startX=p.dx.x;t.startY=p.dy.x;
  }
  if(t.slot<0)return;
  const p=s.pulls[t.slot],pull=clampToyPull(t.startX+dx,t.startY+dy,s.geometry.headWidth);
  p.dx.x=pull.x;p.dy.x=pull.y;p.dx.v=0;p.dy.v=0;s.active=true;
}
export function endToyTouch(s:ToyMotion,id:number) {
  'worklet';
  const index=s.touches.findIndex(t=>t.id===id);if(index<0)return false;
  const t=s.touches[index];if(t.slot>=0)s.pulls[t.slot].held=false;
  s.touches.splice(index,1);s.active=!s.reduced;return true;
}
export function cancelToyTouches(s:ToyMotion) {
  'worklet';
  s.touches=[];for(const p of s.pulls)p.held=false;s.active=!s.reduced;
}
export function advanceToyMotion(s:ToyMotion,ms:number) {
  'worklet';
  s.clock+=ms;if(!s.active)return;
  const dt=Math.min(48,Math.max(0,ms));
  for(const channel of [s.squeeze,s.squeezeComp,s.punch,s.punchComp,s.breath])advanceSpring(channel,dt);
  for(const r of s.rubs){advanceSpring(r.spring,dt);if(!alive(r.spring))r.spring.c=7;}
  const limit=toyPullLimit(s.geometry.headWidth)*1.12;
  for(const p of s.pulls)if(!p.held) {
    advanceSpring(p.dx,dt);advanceSpring(p.dy,dt);
    const length=Math.hypot(p.dx.x,p.dy.x);
    if(length>limit){p.dx.x*=limit/length;p.dy.x*=limit/length;}
  }
  for(const p of s.particles)if(p.age<p.life)p.age+=dt;
  s.active=s.touches.length>0||[s.squeeze,s.squeezeComp,s.punch,s.punchComp,s.breath].some(alive)
    ||s.rubs.some(r=>alive(r.spring))||s.pulls.some(p=>p.held||alive(p.dx)||alive(p.dy))
    ||s.particles.some(p=>p.age<p.life);
}
export function toyShaderUniforms(s:ToyMotion,scale:number) {
  'worklet';
  const axes=toyAxes(s);
  return {bodyBase:[s.geometry.baseX*scale,s.geometry.baseY*scale],axes:[axes.x,axes.y],
    rubs:s.rubs.map(r=>[r.x*scale,r.y*scale,r.radius*scale,Math.max(-.15,Math.min(.6,r.spring.x))]),
    pulls:s.pulls.map(p=>[p.x*scale,p.y*scale,p.dx.x*scale,p.dy.x*scale]),
    pullRadius:s.geometry.headWidth*.52*scale,pullLimit:toyPullLimit(s.geometry.headWidth)*scale};
}
