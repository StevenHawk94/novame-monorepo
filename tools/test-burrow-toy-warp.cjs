const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const warp=load('apps/mobile/src/lib/burrow-toy-warp.ts');
const m=load('apps/mobile/src/lib/squishy-toy-motion.ts',{'./burrow-toy-warp':warp});
const geometry={baseX:440,baseY:1000,headWidth:280,scale:.5,bounds:[240,260,640,1000]};
const fresh=()=>m.createToyMotion({...geometry,bounds:[...geometry.bounds]});
const tick=(s,ms,step=1000/120)=>{for(let t=0;t<ms;t+=step)m.advanceToyMotion(s,Math.min(step,ms-t));};
const clone=value=>JSON.parse(JSON.stringify(value));
test('Plushie hearts live for two seconds and keep rising for their whole lifetime',()=>{
 const s=fresh();m.hitToy(s,'squeeze');const p=s.particles[0];
 assert.equal(p.life,2000);assert.ok(p.dy<0);tick(s,1000);
 assert.ok(p.age<p.life);const middle=p.y+p.dy*p.age/p.life;tick(s,900);
 assert.ok(p.age<p.life);assert.ok(p.y+p.dy*p.age/p.life<middle);
 tick(s,200);assert.ok(p.age>=p.life);
});

for(const kind of ['squeeze','punch'])test(`${kind}: hearts originate at the art's head, slightly below the old above-head anchor`,()=>{
 const s=m.createToyMotion({...geometry,headX:420,headTop:260});m.hitToy(s,kind);
 for(const p of s.particles.filter(p=>p.life===2000)){
  assert.equal(p.x+12,420);assert.equal(p.y,260);assert.ok(p.dy<0);assert.equal(p.life,2000);
 }
});

test('both whole-doll attacks compress 30%, keep the feet fixed, and pull limit is exactly 20% larger',()=>{
  assert.equal(warp.TOY_SQUEEZE_WIDTH,.7);assert.equal(warp.TOY_PUNCH_HEAD_SCALE,.7);
  assert.ok(Math.abs(warp.toyPullLimit(280)/(280*.15)-1.2)<1e-12);
  for(const kind of ['squeeze','punch']){
    const s=fresh();m.hitToy(s,kind);tick(s,kind==='squeeze'?55:44);
    assert.ok(Math.abs(s[kind].x+.3)<1e-12);
    const base={x:440,y:1000},axes=kind==='squeeze'?{x:.7,y:1.15}:{x:1.15,y:.7};
    const src=warp.toyActionSamplePoint(base.x+70*axes.x,base.y-200*axes.y,kind,1,base);
    assert.ok(Math.abs(src.x-base.x-70)<1e-9);assert.ok(Math.abs(src.y-base.y+200)<1e-9);
    assert.equal(warp.toyActionSamplePoint(base.x,base.y,kind,1,base).y,base.y);
  }
});
test('rapid alternating hits preserve every channel position and velocity at the event boundary',()=>{
  const s=fresh();
  for(let i=0;i<600;i++){
    tick(s,25);const before=clone([s.squeeze,s.squeezeComp,s.punch,s.punchComp]);
    m.hitToy(s,i%2?'squeeze':'punch');
    [s.squeeze,s.squeezeComp,s.punch,s.punchComp].forEach((v,index)=>{
      assert.equal(v.x,before[index].x);assert.equal(v.v,before[index].v);
    });
    const axes=m.toyAxes(s);assert.ok(axes.x>=.7&&axes.x<=1.18);assert.ok(axes.y>=.7&&axes.y<=1.18);
  }
  tick(s,5000);assert.equal(s.active,false);assert.deepEqual(clone(m.toyAxes(s)),{x:1,y:1});
});
test('frame-rate independent springs finish identically at 60Hz and 120Hz',()=>{
  const a=fresh(),b=fresh();m.hitToy(a,'squeeze');m.hitToy(b,'squeeze');tick(a,600,1000/60);tick(b,600,1000/120);
  for(const key of ['squeeze','squeezeComp'])assert.ok(Math.abs(a[key].x-b[key].x)<1e-8);
});
test('different tap locations keep their own bump; full pool reuses energy without teleporting',()=>{
  const s=fresh();
  for(let i=0;i<4;i++){m.beginToyTouch(s,i,270+i*90,400);m.endToyTouch(s,i);tick(s,25);}
  const centres=clone(s.rubs.map(r=>({x:r.x,y:r.y}))),positions=s.rubs.map(r=>r.spring.x);
  m.beginToyTouch(s,99,600,700);
  assert.deepEqual(clone(s.rubs.map(r=>({x:r.x,y:r.y}))),centres);
  assert.deepEqual(s.rubs.map(r=>r.spring.x),positions);assert.equal(s.rubs.length,4);
  m.endToyTouch(s,99);tick(s,5000);assert.equal(s.active,false);
});
test('two held fingers, returning tails and re-grab do not clear any earlier displacement',()=>{
  const s=fresh();m.beginToyTouch(s,1,280,650);m.beginToyTouch(s,2,600,650);
  assert.equal(m.beginToyTouch(s,3,440,650).accepted,false);
  m.moveToyTouch(s,1,320,650);m.moveToyTouch(s,2,560,650);
  m.moveToyTouch(s,1,360,650);m.moveToyTouch(s,2,520,650);
  assert.equal(s.pulls.filter(p=>p.held).length,2);m.endToyTouch(s,1);m.endToyTouch(s,2);tick(s,80);
  const before=s.pulls.map(p=>[p.dx.x,p.dy.x]);m.beginToyTouch(s,4,300,700);
  assert.deepEqual(s.pulls.map(p=>[p.dx.x,p.dy.x]),before,'down never zeros returning tails');
  m.moveToyTouch(s,4,340,700);assert.equal(s.pulls.filter(p=>p.held).length,1);
  assert.equal(m.endToyTouch(s,4),true);assert.equal(m.endToyTouch(s,4),false);
  tick(s,5000);assert.equal(s.active,false);
});
test('touch hit-testing, cancellation and reduced motion cannot create phantom interactions',()=>{
  const s=fresh();assert.equal(m.beginToyTouch(s,1,0,0).accepted,false);
  m.beginToyTouch(s,2,440,650);m.moveToyTouch(s,2,540,650);m.cancelToyTouches(s);
  assert.equal(m.endToyTouch(s,2),false);assert.ok(s.pulls.every(p=>!p.held));tick(s,5000);assert.equal(s.active,false);
  const reduced=m.createToyMotion(geometry,true);m.hitToy(reduced,'punch');m.beginToyTouch(reduced,3,440,650);m.moveToyTouch(reduced,3,500,650);
  assert.deepEqual(clone(m.toyAxes(reduced)),{x:1,y:1});assert.equal(m.endToyTouch(reduced,3),true);
});
test('high frequency inputs retain bounded pools and feedback rate without limiting the deformation',()=>{
  const s=fresh();let feedback=0;
  for(let i=0;i<1000;i++){tick(s,10);feedback+=Number(m.hitToy(s,i%2?'squeeze':'punch'));}
  assert.ok(feedback<80);assert.equal(s.particles.length,12);assert.equal(s.rubs.length,4);assert.equal(s.pulls.length,4);
  tick(s,5000);assert.equal(s.active,false);
});
test('the stage uses one UI clock and native gestures, fixed Canvas particles and no React action tokens',()=>{
  const hook=fs.readFileSync('apps/mobile/src/lib/use-squishy-toy.ts','utf8');
  assert.match(hook,/useFrameCallback/);assert.match(hook,/Gesture\.Manual/);
  assert.match(hook,/manager\.activate\(\)/);assert.match(hook,/manager\.end\(\)/);assert.match(hook,/LEFT_EDGE_BACK_WIDTH/);
  const stage=fs.readFileSync('apps/mobile/src/components/burrow/localized-toy.tsx','utf8');
  assert.doesNotMatch(stage,/PanResponder|setHearts|setCircle|FloatingHeart|withSequence/);
  assert.doesNotMatch(stage,/\.makeImageSnapshotAsync\(/,'async native view readback can dereference an unregistered Canvas');
  assert.doesNotMatch(stage,/canvasRef|onSize=|\.readPixels\(/,'no late native view access during dismissal');
  assert.match(stage,/Skia\.Surface\.Make\(/,'photo composition uses a view-independent CPU surface');
  assert.match(stage,/length:12/);assert.match(stage,/1024\/Math\.max/);
  const screen=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');
  assert.match(screen,/showActions=\{!!toyPhoto\}/);assert.doesNotMatch(screen,/setAction/);
  const controls=fs.readFileSync('apps/mobile/src/components/burrow/squishy-toy-controls.tsx','utf8');
  assert.match(controls,/Gesture\.Tap\(\)\.onBegin/);assert.match(controls,/onHit\(kind\)/);
  for(const file of ['localized-toy','interactive-doll']){
    const source=fs.readFileSync(`apps/mobile/src/components/burrow/${file}.tsx`,'utf8');
    assert.match(source,/plushie-centered-stage/);assert.match(source,/flex:1,justifyContent:'center'/);
    assert.equal((source.match(/useSquishyToy\(/g)??[]).length,1,'centered body and footer use the same gesture controller');
  }
});

test('Canvas retains the native plushie until its paint handoff, without size subscriptions, readbacks or timers',()=>{
  const {clock}=require('./lifecycle-test-utils.cjs'),time=clock(),h=hooks(),jsx=(type,props)=>({type,props});
  let compositions=0,nextFrame=0;const frames=new Map();
  const frame=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};
  const image={makeNonTextureImage(){return this;}},canvas={clear(){},scale(){},drawImage(){}};
  const asset={source:1,width:512,height:512,bounds:[106,13,406,512],photoBounds:[155,136,357,319]};
  const {LocalizedToy}=load('apps/mobile/src/components/burrow/localized-toy.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{flatten:x=>x}},
    '@shopify/react-native-skia':{Canvas:'Canvas',Fill:'Fill',Group:'Group',ImageShader:'ImageShader',Path:'Path',Shader:'Shader',
      Skia:{RuntimeEffect:{Make:()=>({})},Path:{MakeFromSVGString:()=>({})},Color:x=>x,
        Surface:{Make:()=>{compositions++;return {getCanvas:()=>canvas,flush(){},makeImageSnapshot:()=>image};}}},
      useImage:source=>source?image:null},
    'react-native-gesture-handler':{GestureDetector:'Gesture'},'react-native-reanimated':{useDerivedValue:fn=>({get value(){return fn();}})},
    './burrow-image':{resolveBurrowImageSource:x=>x},'@/lib/burrow-doll-face':{dollFaceBounds:a=>a.photoBounds},
    '@/lib/session-lifecycle':{subscribeSessionIdentity(){}},'@/lib/burrow-toy-warp':warp,'@/lib/squishy-toy-motion':m,
    '@/lib/use-squishy-toy':{useSquishyToy:()=>({state:{},gesture:{},handle:{},identity:{}})},
    '@/lib/use-room-photo-uri':{useRoomPhotoUri:()=>null},'./interactive-doll':{NativeDollSurface:'Native'},'./squishy-toy-controls':{SquishyToyControls:'Controls'},
  },{...time.globals,requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  const render=()=>h.render(()=>LocalizedToy({asset,size:300,artStyle:{width:300,left:0,top:0},onInteract(){},showActions:true,fillStage:true}));
  const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  render();let tree=render();const surface=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='ToyCanvas');assert.ok(surface);
  const shaderTree=surface.type(surface.props),nativeCanvas=nodes(shaderTree).find(n=>n.type==='Canvas');
  assert.ok(nativeCanvas);assert.equal(nativeCanvas.props.onSize,undefined);assert.equal(nativeCanvas.props.ref,undefined);
  assert.equal(nodes(shaderTree).some(n=>typeof n.type==='function'&&n.type.name==='ToyHeart'),false,'body shader viewport cannot clip the separate particles');
  const particles=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='ToyHeartLayer');assert.ok(particles);
  const overlay=particles.type(particles.props),overlayNodes=nodes(overlay),offset=overlayNodes.find(n=>n.type==='Group').props.transform[0].translateY;
  assert.equal(overlay.props.testID,'plushie-heart-overlay');assert.equal(overlay.props.pointerEvents,'none');assert.equal(overlay.props.style.zIndex,2);
  assert.equal(overlay.props.style.top+offset,surface.props.top,'enlarging the viewport cannot shift the heart origin or costume');
  assert.equal(overlay.props.style.height-offset,surface.props.height);
  assert.equal(overlayNodes.filter(n=>typeof n.type==='function'&&n.type.name==='ToyHeart').length,12,'same bounded particle pool, not another frame driver');
  const particle=overlayNodes.find(n=>typeof n.type==='function'&&n.type.name==='ToyHeart'),heartMotion=m.createToyMotion(geometry);m.hitToy(heartMotion,'squeeze');
  for(const age of [0,500,1000,1999]){
    heartMotion.particles[0].age=age;
    const draw=particle.type({...particle.props,state:{value:heartMotion},index:0,scale:.5});
    assert.equal(draw.props.transform.value[2].scale,.5*1.5*(1.2+.4*Math.sin(age/2000*Math.PI)),'ordinary feedback is exactly 50% larger at every flight phase');
  }
  for(const scale of [.2,.5,1,2])for(const kind of ['squeeze','punch']){
    const layer=particles.type({...particles.props,scale}),inset=nodes(layer).find(n=>n.type==='Group').props.transform[0].translateY;
    const motion=m.createToyMotion({...geometry,headTop:0});m.hitToy(motion,kind);
    for(const p of motion.particles.filter(p=>p.life===2000))for(let t=0;t<=1;t+=.05){
      const top=inset+(p.y+p.dy*t)*scale-6*scale;
      assert.ok(top>=0,'the full upward flight, including the heart curve, stays inside the transparent viewport');
    }
  }
  const centered=nodes(tree).find(n=>n.props?.testID==='plushie-centered-stage');assert.equal(centered.props.style.overflow,'visible');
  assert.equal(compositions,1);assert.equal(time.timers.size,0);
  assert.ok(nodes(tree).some(n=>n.type==='Native'),'texture creation cannot remove the first-frame image');
  shaderTree.props.onLayout();frame();assert.ok(nodes(render()).some(n=>n.type==='Native'));
  frame();assert.equal(nodes(render()).some(n=>n.type==='Native'),false);
  // A changed costume must retain its native view again, even when an old
  // Canvas layout callback arrives after the new render.
  asset.source=2;render();tree=render();assert.equal(compositions,2);
  assert.ok(nodes(tree).some(n=>n.type==='Native'));surface.props.onLayout();assert.equal(frames.size,0);
  const next=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='ToyCanvas');next.props.onLayout();assert.equal(frames.size,1);
  h.unmount();assert.equal(frames.size,0);next.props.onLayout();assert.equal(frames.size,0);
  time.advance(1000);assert.equal(time.timers.size,0,'nothing can sample a detached drawable');
});

test('real controller worklets activate/end once, ignore the back edge, retain state through React updates and deliver button hits without renders',()=>{
  const h=hooks();let frame,recorded=0,feedback=0,handle,scope='one',queueJS=false;const calls=[],jobs=[];
  const gesture={};for(const name of ['enabled','shouldCancelWhenOutside'])gesture[name]=()=>gesture;
  for(const name of ['onTouchesDown','onTouchesMove','onTouchesUp','onTouchesCancelled','onFinalize'])gesture[name]=fn=>{gesture[name+'Callback']=fn;return gesture;};
  const driver={setActive(value){this.active=value;}};
  const reanimated={useReducedMotion:()=>false,runOnJS:fn=>(...args)=>queueJS?jobs.push(()=>fn(...args)):fn(...args),runOnUI:fn=>fn,useFrameCallback:fn=>{frame=fn;return driver;},
    useSharedValue:initial=>{const ref=h.react.useRef(null);if(!ref.current)ref.current={value:initial,modify(fn){this.value=fn(this.value);}};return ref.current;}};
  const {useSquishyToy}=load('apps/mobile/src/lib/use-squishy-toy.ts',{
    react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'@react-navigation/native':{useIsFocused:()=>true},
    'react-native-gesture-handler':{Gesture:{Manual:()=>gesture}},'react-native-reanimated':reanimated,
    './haptics':{haptics:{light:()=>feedback++,medium:()=>feedback++}},'./page-edge-gesture':{LEFT_EDGE_BACK_WIDTH:24},'./squishy-toy-motion':m,
  });
  const render=()=>h.render(()=>useSquishyToy({geometry,left:0,top:0,interactionScope:scope,onInteract:()=>recorded++,onControllerReady:value=>{handle=value;}}));
  const controller=render();render();
  const manager={begin:()=>calls.push('begin'),activate:()=>calls.push('activate'),fail:()=>calls.push('fail'),end:()=>calls.push('end')};
  const t={id:1,x:220,y:325,absoluteX:220};
  gesture.onTouchesDownCallback({allTouches:[t],changedTouches:[t]},manager);
  assert.deepEqual(calls,['begin','activate']);frame({timestamp:16,timeSincePreviousFrame:16});
  const old=controller.state.value.rubs[0].spring.x;render();assert.equal(controller.state.value.rubs[0].spring.x,old);
  gesture.onTouchesUpCallback({changedTouches:[t]},manager);assert.equal(recorded,1);assert.equal(calls.at(-1),'end');
  handle.hit('punch');assert.ok(controller.state.value.punch.attack);assert.equal(recorded,1,'screen owns button business events');
  calls.length=0;gesture.onTouchesDownCallback({allTouches:[{...t,absoluteX:10}],changedTouches:[{...t,absoluteX:10}]},manager);
  assert.deepEqual(calls,['fail']);assert.ok(feedback>0);
  calls.length=0;const other={...t,id:2,x:300,absoluteX:300};
  gesture.onTouchesDownCallback({allTouches:[t],changedTouches:[t]},manager);
  gesture.onTouchesDownCallback({allTouches:[t,other],changedTouches:[other]},manager);
  assert.deepEqual(calls,['begin','activate'],'second finger cannot restart the active recognizer');
  gesture.onTouchesUpCallback({changedTouches:[t]},manager);assert.equal(calls.at(-1),'activate');
  gesture.onTouchesUpCallback({changedTouches:[other]},manager);assert.equal(calls.at(-1),'end');assert.equal(recorded,3);
  queueJS=true;gesture.onTouchesDownCallback({allTouches:[t],changedTouches:[t]},manager);
  gesture.onTouchesUpCallback({changedTouches:[t]},manager);scope='two';render();jobs.splice(0).forEach(job=>job());
  assert.equal(recorded,3,'a delayed JS receipt cannot be retargeted into a new relationship');
  const before=clone(controller.state.value);h.unmount();assert.deepEqual(clone(controller.state.value),before,'teardown never wakes a shader mapper');
  assert.equal(driver.active,false);assert.equal(handle,null);
});

for(const recording of [false,true])test(`${recording?'Touch Note recording':'ordinary Plushie'}: held contact ${recording?'keeps half-second feedback':'does not repeat hearts or haptics'}; new taps still respond`,()=>{
 const h=hooks(),gesture={},driver={setActive(){}},batches=[];let frame,recorded=0,feedback=0;
 for(const name of ['enabled','shouldCancelWhenOutside'])gesture[name]=()=>gesture;
 for(const name of ['onTouchesDown','onTouchesMove','onTouchesUp','onTouchesCancelled','onFinalize'])gesture[name]=fn=>{gesture[name+'Callback']=fn;return gesture;};
 const reanimated={useReducedMotion:()=>false,runOnJS:fn=>fn,runOnUI:fn=>fn,useFrameCallback:fn=>{frame=fn;return driver;},
  useSharedValue:initial=>{const r=h.react.useRef(null);if(!r.current)r.current={value:initial,modify(fn){this.value=fn(this.value);}};return r.current;}};
 const {useSquishyToy}=load('apps/mobile/src/lib/use-squishy-toy.ts',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'@react-navigation/native':{useIsFocused:()=>true},
  'react-native-gesture-handler':{Gesture:{Manual:()=>gesture}},'react-native-reanimated':reanimated,
  './haptics':{haptics:{light:()=>feedback++,medium:()=>feedback++}},'./page-edge-gesture':{LEFT_EDGE_BACK_WIDTH:24},'./squishy-toy-motion':m,
 });
 const c=h.render(()=>useSquishyToy({geometry,left:0,top:0,onInteract:()=>recorded++,onInput:recording?batch=>batches.push(...batch):undefined}));
 const manager={begin(){},activate(){},end(){},fail(){}},t={id:1,x:220,y:325,absoluteX:220};
 frame({timestamp:1000,timeSincePreviousFrame:16});gesture.onTouchesDownCallback({allTouches:[t],changedTouches:[t]},manager);
 assert.equal(c.state.value.particleSerial,3);assert.equal(feedback,1);assert.equal(recorded,0);
 for(const timestamp of [1016,1516,2016,2516])frame({timestamp,timeSincePreviousFrame:16});
 assert.equal(c.state.value.particleSerial,recording?12:3);assert.equal(feedback,recording?4:1);
 gesture.onTouchesMoveCallback({changedTouches:[{...t,x:250}]});frame({timestamp:3016,timeSincePreviousFrame:16});
 assert.equal(c.state.value.particleSerial,recording?15:3,'moving a held ordinary contact never adds a timed burst');
 gesture.onTouchesUpCallback({changedTouches:[t]},manager);assert.equal(recorded,1,'normal interaction business count still occurs once on release');
 const afterHold=c.state.value.particleSerial;frame({timestamp:4016,timeSincePreviousFrame:16});
 assert.equal(c.state.value.particleSerial,afterHold,'released contact never repeats');
 gesture.onTouchesDownCallback({allTouches:[t],changedTouches:[t]},manager);assert.equal(c.state.value.particleSerial,afterHold+3);
 gesture.onTouchesUpCallback({changedTouches:[t]},manager);assert.equal(recorded,2);
 for(const kind of ['squeeze','punch']){frame({timestamp:c.state.value.clock+1000,timeSincePreviousFrame:16});const before=c.state.value.particleSerial;c.performHit(kind);assert.equal(c.state.value.particleSerial,before+3);}
 if(recording)assert.deepEqual(batches.map(e=>e[1]),[0,1,2,0,2]);else assert.equal(batches.length,0);
 h.unmount();
});

test('native button gestures coexist with each other and a held body pull; each keeps its start-scope token',()=>{
  const h=hooks(),gestures=[],body={name:'body'},state=fresh(),hits=[],records=[],identity={value:5};
  const onHit=kind=>{hits.push(kind);m.hitToy(state,kind);},onRecord=revision=>records.push(revision),handle={hit:onHit};
  const {SquishyToyControls}=load('apps/mobile/src/components/burrow/squishy-toy-controls.tsx',{
    react:h.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-native':{StyleSheet:{create:s=>s},Text:'Text',View:'View'},
    'react-native-gesture-handler':{GestureDetector:'Detector',Gesture:{Tap:()=>{
      const g={onBegin(fn){this.begin=fn;return this;},onEnd(fn){this.end=fn;return this;},onFinalize(fn){this.finalize=fn;return this;},simultaneousWithExternalGesture(...others){this.others=others;return this;}};
      gestures.push(g);return g;
    }}},'react-native-reanimated':{default:{View:'AnimatedView'},runOnUI:fn=>fn,useAnimatedStyle:fn=>fn(),useSharedValue:value=>h.react.useRef({value}).current},
  });
  const render=()=>h.render(()=>SquishyToyControls({onHit,onRecord,handle,identity,bodyGesture:body}));render();const tree=render();assert.equal(gestures.length,2);
  const bonk=tree.props.children[1],button=bonk.type(bonk.props).props.children;
  assert.equal(button.props.accessibilityLabel,'Bonk toy');assert.equal(button.props.children.props.children,'Bonk');
  assert.equal(button.props.style[1].backgroundColor,'#FFF2DC');assert.equal(button.props.style[1].shadowOffset.height,3);
  assert.ok(gestures[0].others.includes(body));assert.ok(gestures[1].others.includes(body));
  assert.ok(gestures[0].others.includes(gestures[1]));assert.ok(gestures[1].others.includes(gestures[0]));
  m.beginToyTouch(state,1,440,650);m.moveToyTouch(state,1,480,650);m.moveToyTouch(state,1,520,650);
  gestures[0].begin();gestures[1].begin();assert.deepEqual(hits,['squeeze','punch']);
  const held=bonk.type(bonk.props).props.children.props.style[1];assert.equal(held.backgroundColor,'#F3DFBF');assert.equal(held.shadowOpacity,0);
  assert.equal(held.transform[0].translateY,3);assert.equal(held.transform[1].scale,.98);
  assert.equal(state.touches.length,1);assert.equal(state.pulls.filter(p=>p.held).length,1);
  identity.value=6;gestures[0].end(null,true);gestures[1].end(null,true);assert.deepEqual(records,[5,5]);
  gestures[0].finalize();gestures[1].finalize();assert.equal(bonk.type(bonk.props).props.children.props.style[1].shadowOffset.height,3);
  gestures[1].begin();gestures[1].end(null,false);gestures[1].finalize();assert.deepEqual(records,[5,5],'cancelled taps restore appearance without adding a business event');
  assert.equal(bonk.type(bonk.props).props.children.props.style[1].transform[0].translateY,0);h.unmount();
});

test('shader compiles and actual pixels show whole-body 30% squash with a fixed baseline',async()=>{
  const {LoadSkiaWeb}=require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  const {getSkiaExports,TileMode,FilterMode,MipmapMode}=require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/headless');
  await LoadSkiaWeb();const {Skia}=getSkiaExports(),effect=Skia.RuntimeEffect.Make(warp.TOY_WARP_SKSL);assert.ok(effect);
  const surface=Skia.Surface.MakeOffscreen(880,1080),paint=Skia.Paint();surface.getCanvas().clear(Skia.Color('transparent'));
  paint.setColor(Skia.Color('#ff0000'));surface.getCanvas().drawRect({x:240,y:200,width:400,height:400},paint);
  paint.setColor(Skia.Color('#0000ff'));surface.getCanvas().drawRect({x:240,y:800,width:400,height:200},paint);surface.flush();
  const child=surface.makeImageSnapshot().makeShaderOptions(TileMode.Decal,TileMode.Decal,FilterMode.Nearest,MipmapMode.None);
  const draw=axes=>{
    const target=Skia.Surface.MakeOffscreen(880,1080),brush=Skia.Paint();
    brush.setShader(effect.makeShaderWithChildren([440,1000,...axes,...Array(32).fill(0),145,50.4],[child]));
    target.getCanvas().drawPaint(brush);target.flush();return target.makeImageSnapshot().readPixels();
  };
  const squeezed=draw([.7,1]),punched=draw([1,.7]);
  const occupied=(bytes,y)=>Array.from({length:880},(_,x)=>x).filter(x=>bytes[(y*880+x)*4+3]>0);
  assert.equal(occupied(squeezed,400).length,280);
  const reds=Array.from({length:1000},(_,y)=>y).filter(y=>punched[(y*880+440)*4]>200);
  const blues=Array.from({length:1080},(_,y)=>y).filter(y=>punched[(y*880+440)*4+2]>200);
  assert.ok(Math.abs(reds[0]-440)<=1);assert.equal(blues.length,140);assert.equal(blues.at(-1),999);
});
