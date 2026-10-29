const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{load,hooks}=require('./lifecycle-test-utils.cjs'),{motionHarness}=require('./motion-test-utils.cjs');
const domain=load('packages/domain/src/room-care.ts'),motion=load('apps/mobile/src/lib/garden-care-motion.ts');
const model=load('apps/mobile/src/lib/room-care-model.ts');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
test('four action/target meanings and ledger keys remain distinct; helper keys keep legacy retry protection',()=>{
 assert.equal(domain.roomCareAction('food',false),'carrot');assert.equal(domain.roomCareAction('water',false),'water');
 assert.equal(domain.roomCareAction('food',true),'leaf');assert.equal(domain.roomCareAction('water',true),'fertilizer');
 const keys=domain.ROOM_CARE_ACTIONS.map(k=>domain.roomCareRewardKey(k,'2026-10-28'));assert.equal(new Set(keys).size,4);
 assert.equal(keys[2],'room-need-reward:food:2026-10-28');assert.equal(keys[3],'room-need-reward:water:2026-10-28');
});
function data(){const blank=()=>Object.fromEntries(domain.ROOM_CARE_ACTIONS.map(k=>[k,{lastAt:null,nextAt:null}]));return{profile:{id:'me'},partner:{id:'partner'},pairVersion:'pair',localDate:'2026-10-28',roomCare:{version:2,actorId:'me',partnerId:'partner',pairVersion:'pair',own:blank(),partner:blank()},roomNeeds:{food:100,water:100},partnerNeeds:{food:100,water:100}};}
test('request captures immutable actor/partner/version/day and refuses unknown capability or foreign owner',()=>{
 const d=data(),p=model.roomCarePayload(d,'partner','food','immutable');assert.equal(p.careAction,'leaf');assert.equal(p.pairVersion,'pair');
 d.pairVersion='changed';assert.equal(p.pairVersion,'pair');assert.throws(()=>model.roomCarePayload(d,'partner','food','key'),/unavailable/);
 assert.throws(()=>model.roomCarePayload(data(),'stranger','water','key'),/not_allowed/);
});
test('v2 cooldown reads each action, never full legacy meters or another care action; pending work stays scoped',()=>{
 const api=load('apps/mobile/src/lib/burrow-care-cooldown.ts'),d=data(),now=Date.parse('2026-10-28T12:00:00Z');
 assert.equal(api.careCoolingDown(d,'food',now),false,'a full original meter does not steal a separate action');
 d.roomCare.own.carrot.nextAt='2026-10-28T18:00:00Z';assert.equal(api.careCoolingDown(d,'food',now),true);
 assert.equal(api.careCoolingDown(d,'food',now,'partner'),false);
 d.roomCare.partner.leaf.nextAt='2026-10-28T18:00:00Z';assert.equal(api.careCoolingDown(d,'food',now,'partner'),true);
 assert.equal(api.careCoolingDown(d,'water',now,'partner'),false);
 api.configureCarePending((_d,owner,action)=>owner==='partner'&&action==='fertilizer');assert.equal(api.careCoolingDown(d,'water',now,'partner'),true);
});
test('stale reads cannot erase a receipt, but newer care and identity/relationship changes stay authoritative',()=>{
 const a=data(),b=data();a.roomCare.own.carrot={lastAt:'2026-10-28T10:00:00Z',nextAt:'2026-10-28T22:00:00Z'};
 const merged=model.mergeRoomCare(a,b);assert.equal(merged.roomCare.own.carrot.lastAt,a.roomCare.own.carrot.lastAt);
 assert.equal(b.roomCare.own.carrot.lastAt,null,'does not mutate response');
 b.roomCare.own.water={lastAt:'2026-10-28T11:00:00Z',nextAt:'2026-10-28T23:00:00Z'};
 assert.equal(model.mergeRoomCare(a,b).roomCare.own.water.lastAt,b.roomCare.own.water.lastAt);
 b.pairVersion='new';b.roomCare.pairVersion='new';assert.equal(model.mergeRoomCare(a,b),b);
 const c=data();c.profile.id='other';c.roomCare.actorId='other';assert.equal(model.mergeRoomCare(a,c),c);
});
test('reference SVG geometry is local, complete, and contains no HTML, external media, filters or ForeignObject',()=>{
 const r=require('../apps/mobile/src/lib/garden-care-art.json');assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);
 const walk=n=>[n,...n.children.flatMap(walk)];
 for(const kind of domain.ROOM_CARE_ACTIONS){const tree=walk(r.art[kind]);assert.equal(r.art[kind].props.viewBox,'0 0 420 420');
  assert.ok(tree.filter(n=>n.tag==='path').length>2);assert.ok(tree.every(n=>!['foreignObject','script','image','filter'].includes(n.tag)));
 }
 assert.match(JSON.stringify(r.art.leaf),/#77c40c/);assert.match(JSON.stringify(r.art.fertilizer),/#9fb27a/);
});
test('5-second foods retain 18 reference bite steps; the final mask hides the whole original canvas',()=>{
 for(const kind of ['leaf','carrot']){
  assert.equal(motion.GARDEN_DURATION[kind],5000);assert.equal(motion.gardenBitePath(kind,0),'');
  const masks=new Set(Array.from({length:18},(_,i)=>motion.gardenBitePath(kind,(i+1)*5000/18+.01)));assert.equal(masks.size,18);
  assert.match(motion.gardenBitePath(kind,5000),kind==='leaf'?/H980V980/:/H736V736/);
 }
});
test('fertilizer and watering retain 150/52 degree pouring poses through 100%, with four-second completion',()=>{
 assert.equal(motion.gardenAngle('fertilizer',0),0);assert.equal(motion.gardenAngle('fertilizer',650),150);assert.equal(motion.gardenAngle('fertilizer',3450),150);assert.equal(motion.gardenAngle('fertilizer',4000),150);
 assert.equal(motion.gardenAngle('water',700),52);assert.equal(motion.gardenAngle('water',3250),52);assert.equal(motion.gardenAngle('water',4000),52);
 for(const action of domain.ROOM_CARE_ACTIONS){const p=motion.createGardenParticles(action),frame=motion.gardenFrame(action,1800,p);
  assert.equal(frame.paths.length,16);assert.ok(frame.paths.some(Boolean));assert.ok(p.length<1400);
  assert.deepEqual(JSON.parse(JSON.stringify(frame)),JSON.parse(JSON.stringify(motion.gardenFrame(action,1800,p))),'paused time freezes all geometry');
  const ending=motion.gardenFrame(action,motion.GARDEN_DURATION[action],p);
  assert.equal(ending.paths.some(Boolean),action==='water'||action==='fertilizer','pouring freezes in its final active pose; food has finished');
  const reduced=motion.gardenFrame(action,1800,p,true);assert.ok(reduced.paths.every(v=>v===''));assert.equal(reduced.angle,action==='water'?52:action==='fertilizer'?150:0,'reduced motion uses a static pouring pose, not an end-of-action return');
 }
 const water=motion.gardenFrame('water',1800,motion.createGardenParticles('water'));assert.ok(water.jets.every(Boolean));assert.ok(water.jetOpacity>0);
});
function controller(action,flower){
 const h=hooks(),m=motionHarness(h),jsx=(type,props)=>({type,props});let foreground=true,interrupt,finished=0,stops=0;
 const Component=load('apps/mobile/src/components/burrow/garden-care-interaction.tsx',{
  react:{...h.react,useId:()=>':test:'},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Text:'Text',View:'View',StyleSheet:{create:v=>v}},
  '@/components/ui/feedback-pressable':{Pressable:'Button'},'@/lib/app-viewport':{useAppViewport:()=>({width:390,height:844})},
  'react-native-reanimated':{...m.reanimated,useAnimatedReaction:(prepare,react)=>{const previous=h.react.useRef();m.reanimated.useFrameCallback(()=>{const next=prepare();if(next!==previous.current){react(next,previous.current);previous.current=next;}},true);}},'react-native-svg':{__esModule:true,default:'Svg'},
  '@/lib/garden-care-art.json':require('../apps/mobile/src/lib/garden-care-art.json'),'@/lib/garden-care-motion':motion,
  './care-interaction':{useCareHoldFeedback:fn=>{interrupt=fn;return{start(){},stop(){stops++;},canStart:()=>foreground};}},'./care-progress':{CareProgress:'Progress'},
  './burrow-image':{Image:'Image'},
 }).GardenCareInteraction;
 const render=()=>h.render(()=>Component({action,flower,complete:false,onComplete:()=>finished++}));render();
 const button=()=>nodes(render()).find(n=>n.type==='Button');
 return{h,m,render,start:()=>button().props.onPressIn(),stop:()=>button().props.onPressOut(),background:()=>{foreground=false;interrupt();},foreground:()=>{foreground=true;},finished:()=>finished,stops:()=>stops};
}
for(const action of domain.ROOM_CARE_ACTIONS)test(`${action}: real shared controller holds, freezes on release/background, resumes and completes once; unmount stops`,()=>{
 const c=controller(action);c.start();c.m.time.advance(1600);const at=c.m.values[0].value;assert.ok(at>1500&&at<1700);
 c.stop();c.m.time.advance(3000);assert.equal(c.m.values[0].value,at);assert.equal(c.finished(),0);
 c.start();c.m.time.advance(480);c.background();const paused=c.m.values[0].value;c.m.time.advance(5000);assert.equal(c.m.values[0].value,paused);
 c.foreground();c.m.time.advance(500);assert.equal(c.m.values[0].value,paused,'foreground never auto-resumes');
 c.start();c.m.time.advance(motion.GARDEN_DURATION[action]-paused+100);assert.equal(c.finished(),1);c.start();c.m.time.advance(1000);assert.equal(c.finished(),1);
 c.h.unmount();assert.equal(c.m.time.timers.size,0);
});
test('all current flower variants are centered with uncropped original ratio and a landing inside their visible crown',()=>{
 const source=fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts','utf8').split('  vases: [')[1].split('\n  ],')[0];
 const flowers=[...source.matchAll(/width: (\d+), height: (\d+), bounds: (\[[^\]]+\])/g)].map(([,w,h,b])=>({width:+w,height:+h,bounds:JSON.parse(b)}));
 assert.equal(flowers.length,16);
 for(const flower of flowers){const f=motion.gardenFlowerLayout(flower);
  assert.equal(f.left+f.width/2,210);assert.equal(f.top+f.height,465);
  assert.equal(f.image.width/f.image.height,flower.width/flower.height);
  assert.ok(f.landing.x-f.landing.halfWidth>f.left&&f.landing.x+f.landing.halfWidth<f.left+f.width);
  assert.ok(f.landing.y>f.top&&f.landing.y<f.top+f.height*.15);
  for(const action of ['water','fertilizer'])for(const ms of [1800,3400,3999,4000]){
   const frame=motion.gardenFrame(action,ms,motion.createGardenParticles(action),false,f.landing);
   assert.ok(frame.paths.some(Boolean));assert.equal(frame.angle,action==='water'?52:150);
   // Paths are circles/ellipses; their center plus radius must end above the
   // actual bouquet landing plane, never continue through the vase or floor.
   for(const path of frame.paths)for(const [,x,y,rx,ry]of path.matchAll(/M([-\d.e]+),([-\d.e]+)a([-\d.e]+),([-\d.e]+)/g)){
    assert.ok(Number.isFinite(+x)&&Number.isFinite(+y));
    assert.ok(+y+Math.max(+rx,+ry)<f.landing.y+4,'bounded landing, including droplet radius');
   }
  }
 }
});
test('watering/fertilizing render the supplied real flower below their tools without changing the food layouts',()=>{
 const flower={source:'current-owner-flower',width:500,height:500,bounds:[74,38,427,500]};
 for(const action of domain.ROOM_CARE_ACTIONS){const c=controller(action,flower),tree=nodes(c.render()),image=tree.find(n=>n.type==='Image');
  assert.equal(!!image,action==='water'||action==='fertilizer');
  if(image){assert.equal(image.props.source,flower.source);const f=tree.find(n=>n.props?.testID==='garden-care-flower');assert.ok(f.props.style.top>0);}
  c.h.unmount();
 }
});
test('render loop is native, bounded and has no WebView, JS frame timers or unsafe SVG child snapshot path',()=>{
 const s=fs.readFileSync('apps/mobile/src/components/burrow/garden-care-interaction.tsx','utf8');
 const code=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 assert.doesNotMatch(code,/WebView|ForeignObject|setInterval|setTimeout|requestAnimationFrame|setState\(/);
 assert.match(s,/useFrameCallback/);assert.match(s,/runOnJS\(deliver\)/);assert.match(s,/length:16/);
 assert.match(s,/node\.children\.map\(\(stop,i\)=>[\s\S]*?<Stop/,'native gradients must receive real direct Stop elements, not recursive wrapper props');
});
test('actual native worklet compilation captures initialized dependencies, including bite-mask helpers',()=>{
 const path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 const local={paths:[path.resolve('apps/mobile')]},r=createRequire(require.resolve('babel-preset-expo',local));
 const file=path.resolve('apps/mobile/src/lib/garden-care-motion.ts');
 const {code}=r('@babel/core').transformSync(fs.readFileSync(file,'utf8'),{filename:file,configFile:false,babelrc:false,
  plugins:[require.resolve('react-native-worklets/plugin',local),r.resolve('@babel/plugin-transform-typescript'),r.resolve('@babel/plugin-transform-modules-commonjs')]});
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,global:{Error}});
 const compiled=module.exports,seen=new Set();function verify(fn){if(seen.has(fn))return;seen.add(fn);
  for(const [key,value]of Object.entries(fn.__closure??{})){assert.notEqual(value,undefined,`uninitialized UI-thread capture: ${key}`);if(typeof value==='function')verify(value);}}
 for(const name of ['gardenFrame','gardenBitePath','gardenAngle','gardenWaterOutlet'])verify(compiled[name]);
 for(const action of domain.ROOM_CARE_ACTIONS){const p=compiled.createGardenParticles(action);
  for(const ms of [0,300,1800,4000])assert.ok(compiled.gardenFrame(action,ms,p));}
});
