const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const path=load('apps/mobile/src/lib/adventure-digging-path.ts');
const layout=load('apps/mobile/src/lib/adventure-screen-layout.ts');
const trail=load('apps/mobile/src/lib/adventure-trail.ts');
const jsx=(type,props,key)=>typeof type==='function'?type(props):({type,props,key});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('the reference route contains exactly four radius-60 arcs and keeps both supplied endpoint coordinates',()=>{
 assert.equal((path.DIGGING_PATH.match(/A60 60/g)||[]).length,4);
 const a=path.diggingPathPoint(0),b=path.diggingPathPoint(1);
 assert.deepEqual({...a},{x:62,y:47,facing:1});near(b.x,418);near(b.y,389);
 near(path.DIGGING_PATH_LENGTH,958+120*Math.PI);
 for(const p of [-1,NaN,Infinity])assert.equal(path.diggingPathPoint(p).x,62);
 near(path.diggingPathPoint(2).x,418);
});
test('stroke length and cursor use identical arc distances, including all joins and both reverse-direction turns',()=>{
 const arc=30*Math.PI,segments=[304,arc,51,arc,250,arc,51,arc,302];
 const joins=[[62,47],[366,47],[426,107],[426,158],[366,218],[116,218],[56,278],[56,329],[116,389],[418,389]];
 let distance=0;
 for(let i=0;i<joins.length;i++){
  const p=path.diggingPathPoint(distance/path.DIGGING_PATH_LENGTH);near(p.x,joins[i][0]);near(p.y,joins[i][1]);
  if(i<segments.length)distance+=segments[i];
 }
 let measured=0,last=path.diggingPathPoint(0);
 for(let i=1;i<=20000;i++){
  const p=path.diggingPathPoint(i/20000),delta=Math.hypot(p.x-last.x,p.y-last.y);
  assert.ok(delta<=path.DIGGING_PATH_LENGTH/20000+1e-6,'no teleport at a turn');
  assert.ok(p.x>=56&&p.x<=426&&p.y>=47&&p.y<=389);
  measured+=delta;last=p;
 }
 near(measured,path.DIGGING_PATH_LENGTH,.001);
 assert.equal(path.diggingPathPoint(.5).facing,-1);assert.equal(path.diggingPathPoint(.9).facing,1);
});
test('a six-particle brown dirt burst spreads, falls and fades completely within each one-second loop',()=>{
 for(let i=0;i<6;i++){
  assert.equal(path.diggingDirtParticle(0,i,1).opacity,0);
  assert.equal(path.diggingDirtParticle(1,i,1).opacity,0);
  const a=path.diggingDirtParticle(.3,i,1),b=path.diggingDirtParticle(.3,i,-1);
  assert.ok(a.opacity>0&&a.opacity<1);near(a.x,-b.x);near(a.y,b.y);
  assert.ok(a.scale>0&&a.scale<=1);
 }
});
test('reference, SE, standard and Pro Max layouts keep the route uniform, centered, clear of header/status/footer and safe areas',()=>{
 for(const [w,h,top,bottom]of [[486,1038,0,0],[320,520,20,0],[320,568,20,0],[375,667,20,0],[375,812,44,34],[390,844,47,34],[393,852,59,34],[430,932,59,34],[440,956,62,34]]){
  for(const sync of [0,30]){
   const l=layout.adventureProgressLayout(w,h,top,bottom,sync);
   assert.ok(l.headerTop>=top);assert.ok(l.headerTop+l.headerHeight<=l.routeTop);
   assert.ok(l.routeScale>0);near(l.routeHeight,440*l.routeScale);
   near(l.routeLeft,(w-486*l.routeScale)/2);assert.ok(l.routeLeft>=0);
   assert.ok(l.routeTop+l.routeHeight+19*l.scale<=l.statusTop);
   assert.ok(l.statusTop+l.statusHeight+sync<l.footerTop);
   assert.ok(l.footerBottom>=bottom+12);assert.ok(l.buttonHeight>=50);
  }
 }
 const ref=layout.adventureProgressLayout(486,1038,0,0);near(ref.routeTop,174);near(ref.routeScale,1);near(ref.footerTop,908);
});

function routeHarness({reduced=false,progress=.5,remaining=7200000,pending=false,timeline='journey',motion:motionPlan}={}){
 const h=hooks(),motion=motionHarness(h),events=new Set();let focused=true;
 const app={currentState:'active',addEventListener(_name,fn){events.add(fn);return{remove:()=>events.delete(fn)};}};
 // Keep worklet outputs callable to inspect shared UI-thread values without a
 // React render or a simulator. Timing/cleanup uses the real motion harness.
 const reanimated={...motion.reanimated,useAnimatedStyle:fn=>fn,useAnimatedProps:fn=>fn,useReducedMotion:()=>reduced};
 const api=load('apps/mobile/src/components/burrow/adventure-digging-route.tsx',{
  react:{...h.react,useId:()=>':route:'},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{AppState:app,View:'View',StyleSheet:{create:s=>s}},
  '@react-navigation/native':{useIsFocused:()=>focused},'react-native-reanimated':reanimated,
  'react-native-svg':{__esModule:true,default:'Svg',Defs:'Defs',LinearGradient:'Gradient',Path:'Path',Stop:'Stop'},
  './burrow-image':{Image:'Image'},'@/lib/adventure-progress-assets':{ADVENTURE_PROGRESS_ART:{start:'shovel',end:'chest',current:'process',biscuit:'biscuit',pinky:'pinky'}},
  '@/lib/adventure-digging-path':path,
 });
 let props={progress,remaining,pending,timeline,motion:motionPlan,scale:.8};
 return {h,motion,events,render:()=>h.render(()=>api.AdventureDiggingRoute(props)),
  props:next=>{props={...props,...next};},focus:value=>{focused=value;},
  appState:value=>{app.currentState=value;events.forEach(fn=>fn(value));}};
}
test('the tunnel restores its original two-layer earth palette without changing geometry or progress',()=>{
 const h=routeHarness(),all=nodes(h.render());
 const strokes=all.filter(n=>n.type==='Path');
 const rim=strokes.find(n=>n.props.strokeWidth===72);
 assert.equal(rim.props.stroke,'#5B2C13');
 assert.equal(rim.props.d,path.DIGGING_PATH);
 assert.equal(rim.props.strokeLinecap,'round');
 assert.equal(strokes.filter(n=>n.props.strokeWidth===56).length,2,'earth and progress widths stay unchanged');
 assert.deepEqual(all.filter(n=>n.type==='Stop').map(n=>n.props.stopColor),['#884724','#71391E','#FF881C','#FF9824']);
 h.h.unmount();
});
test('route first frame uses actual progress; cursor and orange trim remain synchronized without React frame renders',()=>{
 const h=routeHarness(),tree=h.render(),all=nodes(tree),shown=h.motion.values[0],cycle=h.motion.values[1];
 assert.equal(shown.current,.5);assert.equal(h.motion.timings[0].value,1);assert.equal(h.motion.timings[0].config.duration,7200000);
 assert.equal(h.motion.timings[0].config.reduceMotion,'never');
 assert.equal(cycle.loop.animation.config.duration,1000);assert.equal(cycle.loop.count,-1);assert.equal(cycle.loop.reverse,false);
 assert.deepEqual(all.filter(n=>n.type==='Image').map(n=>n.props.source),['shovel','chest','biscuit']);
 const trace=all.find(n=>n.type==='Path'&&n.props.animatedProps),cursor=all.find(n=>n.props.testID==='adventure-digging-cursor');
 for(const p of [0,.1,.3,.5,.72,.9,1]){
  shown.current=p;
  const fraction=path.diggingCursorFraction(p),trim=trace.props.animatedProps(),position=cursor.props.style[1](),point=path.diggingPathPoint(fraction);
  near(trim.strokeDashoffset,path.DIGGING_PATH_LENGTH*(1-fraction));near(position.transform[0].translateX,point.x*.8);near(position.transform[1].translateY,point.y*.8);
 }
 shown.current=.5;cycle.current=.3;
 const dirt=nodes(cursor).filter(n=>n.type==='AnimatedView'&&Array.isArray(n.props.style)&&n.props.style[0]?.backgroundColor==='#9A542D');
 assert.equal(dirt.length,6);assert.ok(dirt.every(n=>n.props.style[2]().opacity>0));
 shown.current=1;assert.ok(dirt.every(n=>n.props.style[2]().opacity===0));
 h.h.unmount();assert.equal(h.events.size,0);assert.equal(h.motion.time.timers.size,0);assert.equal(cycle.loop,undefined);
});
test('background, navigation, remount and completion cancel loops; resume seeks actual time rather than replaying progress',()=>{
 const h=routeHarness();h.render();h.appState('background');h.render();
 assert.equal(h.motion.time.timers.size,0);assert.equal(h.motion.values[1].loop,undefined);
 h.props({progress:.75,remaining:3600000});h.appState('active');h.render();assert.equal(h.motion.values[0].current,.75);assert.equal(h.motion.timings.at(-1).config.duration,3600000);
 h.focus(false);h.render();assert.equal(h.motion.time.timers.size,0);assert.equal(h.motion.values[1].loop,undefined);
 h.focus(true);h.render();assert.ok(h.motion.values[1].loop);
 h.props({progress:1,remaining:0});h.render();assert.equal(h.motion.time.timers.size,0);assert.equal(h.motion.values[1].loop,undefined);h.h.unmount();
 const reopened=routeHarness({progress:.82,remaining:2000});reopened.render();assert.equal(reopened.motion.values[0].current,.82);reopened.h.unmount();
});
test('Reduce Motion disables decorative dirt/bobbing without pretending the time-based adventure has completed',()=>{
 const h=routeHarness({reduced:true});h.render();assert.equal(h.motion.values[1].loop,undefined);
 assert.equal(h.motion.values[0].current,.5);assert.equal(h.motion.timings[0].config.duration,7200000);h.h.unmount();
});
test('pending distance starts immediately and confirmation preserves dirt phase without per-tick restarts',()=>{
 const h=routeHarness({pending:true,progress:0,remaining:60000,timeline:'pending',motion:{target:59/60,duration:59000,afterwards:0}});h.render();
 const shown=h.motion.values[0],cycle=h.motion.values[1],loop=cycle.loop;
 assert.equal(shown.current,0);assert.equal(h.motion.timings.length,1);assert.ok(loop);
 near(h.motion.timings[0].value,59/60);assert.equal(h.motion.timings[0].config.duration,59000);
 cycle.current=.42;
 for(let i=1;i<=5;i++){
  h.props({progress:0,remaining:60000});h.render();
  assert.equal(shown.current,0);assert.equal(cycle.current,.42);assert.equal(cycle.loop,loop);
 }
 h.props({pending:false,progress:.02,remaining:58800,timeline:'real-start:real-end',motion:undefined});h.render();
 assert.equal(shown.current,.02);assert.equal(h.motion.timings.length,2);
 assert.equal(cycle.current,.42);assert.equal(cycle.loop,loop,'confirmation must preserve the existing digging loop');
 shown.current=.05;
 for(let i=1;i<=5;i++){
  h.props({progress:.02+i/1000,remaining:58800-i*1000});h.render();
  assert.equal(shown.current,.05,'countdown render must not write the UI progress');assert.equal(h.motion.timings.length,2);
  assert.equal(cycle.loop,loop);assert.equal(cycle.current,.42);
 }
 h.h.unmount();assert.equal(h.motion.time.timers.size,0);
});
test('real clock/plan corrections can speed up or slow down but cannot move the cursor backwards or restart dirt',()=>{
 const h=routeHarness({progress:.3,remaining:42000,timeline:'plan-a'});h.render();
 const shown=h.motion.values[0],cycle=h.motion.values[1],loop=cycle.loop;shown.current=.4;cycle.current=.67;
 h.props({progress:.35,remaining:50000,timeline:'plan-b'});h.render();assert.equal(shown.current,.4);
 assert.equal(h.motion.timings.at(-1).config.duration,50000);assert.equal(cycle.loop,loop);assert.equal(cycle.current,.67);
 h.props({progress:.6,remaining:12000,timeline:'shortened-plan'});h.render();assert.equal(shown.current,.6);
 assert.equal(h.motion.timings.at(-1).config.duration,12000);assert.equal(cycle.loop,loop);h.h.unmount();
});
test('the redesigned screen shares countdown/progress timestamps, retains header exit and preserves silent sync recovery',()=>{
 const h=hooks(),homes=[],retried=[];let journal=null,clockNow=0;
 const api=load('apps/mobile/src/components/burrow/adventure-progress-screen.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:s=>s,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
  './adventure-digging-route':{AdventureDiggingRoute:'Route'},'./burrow-back-button':{BurrowBackButton:'Back'},
  '@/lib/adventure-screen-layout':layout,'@/lib/adventure-trail':trail,
  '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>journal,retryAdventureJournalJob:id=>retried.push(id)},
  '@/lib/burrow-store':{burrowClock:()=>clockNow},
 });
 const start=Date.parse('2026-10-18T00:00:00Z'),duration=8*3600000;
 const data={profile:{id:'me'},hasPlus:true,specialQuests:[{questId:'adventures_completed',progress:1}],activeAdventure:{id:'a',started_at:new Date(start).toISOString(),ends_at:new Date(start+duration).toISOString()}};
 const original=JSON.stringify(data),render=now=>{clockNow=now;return nodes(h.render(()=>api.AdventureProgressScreen({data,now,onHome:()=>homes.push(true)})));};
 for(const elapsed of [0,1000,duration/2,duration-1000,duration,duration+10000]){
  const all=render(start+elapsed),route=all.find(n=>n.type==='Route');
  near(route.props.progress,Math.min(1,elapsed/duration));assert.equal(route.props.remaining,Math.max(0,duration-elapsed));
  assert.ok(all.some(n=>n.type==='Text'&&n.props.children===layout.adventureCountdown(route.props.remaining).padStart(8,'0')));
 }
 let all=render(start+duration/2);all.find(n=>n.type==='Back').props.onPress();assert.equal(homes.length,1);
 assert.ok(all.some(n=>n.type==='Button'&&n.props.disabled),'Nudge is ineligible without a valid prepared party');
 journal={id:'job',error:'offline',blocked:true};all=render(start+duration/2);all.find(n=>n.props.accessibilityLabel==='Retry syncing adventure record').props.onPress();assert.deepEqual(retried,['job']);
 assert.equal(JSON.stringify(data),original,'display must never change or settle the adventure');h.unmount();
 const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-progress-screen.tsx','utf8');
 assert.doesNotMatch(source,/AdventureVideo|ADVENTURE_PROGRESS_ART.video|claimAdventure|settleAdventure|setInterval/);
 const route=fs.readFileSync('apps/mobile/src/components/burrow/adventure-digging-route.tsx','utf8');
 assert.doesNotMatch(route,/setInterval|setTimeout|runOnJS|getPointAtLength|measure\(/);
});
test('the same ongoing page visibly counts down before every receipt and silently corrects without remounting',()=>{
 const h=hooks();let clockNow=0,journal={id:'job'};
 const {AdventureProgressScreen}=load('apps/mobile/src/components/burrow/adventure-progress-screen.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:s=>s,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
  './adventure-digging-route':{AdventureDiggingRoute:'Route'},'./burrow-back-button':{BurrowBackButton:'Back'},
  '@/lib/adventure-screen-layout':layout,'@/lib/adventure-trail':trail,
  '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>journal,retryAdventureJournalJob(){}},
  '@/lib/burrow-store':{burrowClock:()=>clockNow},
 });
 const t=Date.parse('2026-10-18T00:00:00Z'),iso=n=>new Date(t+n).toISOString();
 const data={profile:{id:'me'},partner:null,pairVersion:null,specialQuests:[],activeAdventure:{id:'pending:pending:job',started_at:iso(0),ends_at:iso(60000),localStartPending:true}};
 const render=now=>{clockNow=now;return nodes(h.render(()=>AdventureProgressScreen({data,now:t+now,onHome(){}})));};
 let key;
 for(const [id,elapsed,end]of [['pending:pending:job',0,60000],['pending:record',3000,60000],['real-adventure',5000,65000]]){
  data.activeAdventure={...data.activeAdventure,id,ends_at:iso(end)};
  const all=render(elapsed),route=all.find(n=>n.type==='Route');key??=route.key;
  assert.equal(route.key,key);assert.equal(route.props.pending,true);near(route.props.progress,elapsed/60000);assert.equal(route.props.remaining,60000-elapsed);
  assert.equal(route.props.timeline,'1:0');assert.ok(all.some(n=>n.type==='Text'&&n.props.children===layout.adventureCountdown(60000-elapsed).padStart(8,'0')));
 }
 journal=undefined;
 const interim=render(5500).find(n=>n.type==='Route');assert.equal(interim.key,key,'receipt persistence before store projection must not remount the character');
 near(interim.props.progress,5.5/60);journal={id:'job'};
 data.activeAdventure={id:'real-adventure',started_at:iso(5000),ends_at:iso(65000)};
 let all=render(6000),route=all.find(n=>n.type==='Route');assert.equal(route.key,key);assert.equal(route.props.pending,false);near(route.props.progress,6/60);
 assert.equal(route.props.remaining,54000);assert.ok(all.some(n=>n.type==='Text'&&n.props.children==='00:00:54'));
 const timeline=route.props.timeline;route=render(7000).find(n=>n.type==='Route');assert.equal(route.props.timeline,timeline);assert.equal(route.key,key);
 near(route.props.remaining,53500); // 5-second skew is absorbed at half speed, never a jump back to :59.
 data.profile={id:'other'};route=render(7000).find(n=>n.type==='Route');assert.notEqual(route.key,key,'different account never retains the old animation');h.unmount();
});
test('a server correction runs the two clock segments on the UI thread without restarting the decorative loop',()=>{
 const h=routeHarness({pending:true,progress:.2,remaining:48000,motion:{target:59/60,duration:47000,afterwards:0}});h.render();
 const shown=h.motion.values[0],cycle=h.motion.values[1],loop=cycle.loop;shown.current=.25;cycle.current=.6;
 h.props({pending:false,progress:.25,remaining:45000,timeline:'corrected',motion:{target:.5,duration:30000,afterwards:30000}});h.render();
 assert.equal(shown.current,.25);assert.equal(cycle.loop,loop);assert.equal(cycle.current,.6);
 assert.equal(h.motion.timings.at(-2).value,.5);assert.equal(h.motion.timings.at(-2).config.duration,30000);
 assert.equal(h.motion.timings.at(-1).value,1);assert.equal(h.motion.timings.at(-1).config.duration,30000);
 h.h.unmount();assert.equal(h.motion.time.timers.size,0);
});
