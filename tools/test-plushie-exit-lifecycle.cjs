const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const warp=load('apps/mobile/src/lib/burrow-toy-warp.ts');
const motion=load('apps/mobile/src/lib/squishy-toy-motion.ts',{'./burrow-toy-warp':warp});
const geometry={baseX:440,baseY:1000,headWidth:280,scale:.5,bounds:[240,260,640,1000]};
function harness(options={}){
 const h=hooks(),ui=[],js=[],gestures=[];let focused=true,disabled=false,app,controller,frame,handle;
 const stats={writes:0,recorded:0,feedback:0,removed:0},driver={active:false,setActive(v){this.active=v;}};
 const reanimated={useReducedMotion:()=>false,runOnUI:fn=>(...a)=>ui.push(()=>fn(...a)),runOnJS:fn=>(...a)=>js.push(()=>fn(...a)),
  useFrameCallback(fn,autostart){assert.equal(autostart,false);frame=fn;return driver;},useSharedValue:initial=>{
   const ref=h.react.useRef(null);if(!ref.current){let value=initial;const watched=!!initial?.geometry;
    ref.current={get value(){return value;},set value(next){value=next;if(watched)stats.writes++;},modify(fn){value=fn(value);if(watched)stats.writes++;}};
   }return ref.current;
  }};
 const {useSquishyToy}=load('apps/mobile/src/lib/use-squishy-toy.ts',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener(_name,fn){app=fn;return{remove(){stats.removed++;}};}}},
  '@react-navigation/native':{useIsFocused:()=>focused},'react-native-reanimated':reanimated,
  'react-native-gesture-handler':{Gesture:{Manual(){const g={};for(const name of ['enabled','shouldCancelWhenOutside'])g[name]=()=>g;
   for(const name of ['onTouchesDown','onTouchesMove','onTouchesUp','onTouchesCancelled','onFinalize'])g[name]=fn=>{g[name+'Callback']=fn;return g;};gestures.push(g);return g;}}},
  './haptics':{haptics:{light:()=>stats.feedback++,medium:()=>stats.feedback++}},'./page-edge-gesture':{LEFT_EDGE_BACK_WIDTH:24},'./squishy-toy-motion':motion,
 });
 const flushUI=()=>{for(const fn of ui.splice(0))fn();},flushJS=()=>{for(const fn of js.splice(0))fn();};
 const render=()=>{controller=h.render(()=>useSquishyToy({geometry,left:0,top:0,disabled,onInteract:()=>stats.recorded++,onControllerReady:v=>{handle=v;},...options}));flushUI();return controller;};
 const touch={id:1,x:220,y:325,absoluteX:220},manager={begin(){},activate(){},end(){},fail(){}};
 return {h,stats,driver,render,flushUI,flushJS,touch,manager,get controller(){return controller;},get handle(){return handle;},
  get gesture(){return gestures.at(-1);},frame:(timestamp=100)=>frame({timestamp,timeSincePreviousFrame:16}),
  app:status=>app(status),focus:value=>{focused=value;return render();},background:value=>{app(value?'background':'active');return render();},disable:value=>{disabled=value;return render();}};
}
for(const recording of [false,true])test(`holding the same point ${recording?'retains recording feedback each 500ms':'does not repeat ordinary feedback'}, and never adds timed task/rating records`,()=>{
 const q=harness(recording?{onInput:()=>{}}:{});q.render();q.frame(100);q.gesture.onTouchesDownCallback({allTouches:[q.touch],changedTouches:[q.touch]},q.manager);q.flushJS();
 const first=q.stats.feedback;q.frame(200);q.frame(699);q.flushJS();assert.equal(q.stats.feedback,first);
 q.frame(700);q.frame(1200);q.flushJS();assert.equal(q.stats.feedback,first+(recording?2:0));assert.equal(q.stats.recorded,0);
 assert.equal(q.controller.state.value.particleSerial,recording?9:3);
 q.gesture.onTouchesUpCallback({changedTouches:[q.touch]},q.manager);q.flushJS();assert.equal(q.stats.recorded,1);q.h.unmount();
});
test('paused replay skips shader notifications without resetting its held deformation; Continue uses the same controller',()=>{
 const enabled={value:true};let calls=0;const q=harness({readOnly:true,frameEnabled:enabled,onFrame:()=>{calls++;}});q.render();q.frame(100);
 const writes=q.stats.writes,state=q.controller.state.value;enabled.value=false;q.frame(200);q.frame(300);assert.equal(q.stats.writes,writes);assert.equal(calls,1);assert.equal(q.controller.state.value,state);
 enabled.value=true;q.frame(400);assert.equal(calls,2);assert.ok(q.stats.writes>writes);q.h.unmount();
});
test('read-only replay retains held pose across system background/foreground, while normal gestures still cancel on resume',()=>{
 const q=harness({readOnly:true});q.render();q.controller.state.modify(s=>{motion.beginToyTouch(s,1,440,650);return s;});const before=q.controller.state.value;
 q.background(true);const writes=q.stats.writes;q.frame(50000);assert.equal(q.stats.writes,writes);
 q.background(false);assert.equal(q.controller.state.value,before);assert.equal(q.controller.state.value.touches.length,1);q.h.unmount();
});
for(const pause of ['focus','background','disable'])test(`Plushie ${pause}: stop before native teardown, ignore late frames/gestures, resume with no held pull`,()=>{
 const q=harness();q.render();assert.equal(q.driver.active,true);const g=q.gesture,c=q.controller;
 g.onTouchesDownCallback({allTouches:[q.touch],changedTouches:[q.touch]},q.manager);
 g.onTouchesMoveCallback({changedTouches:[{...q.touch,x:280}]});q.frame();assert.equal(c.state.value.touches.length,1);
 c.record();q[pause](pause==='focus'?false:true);assert.equal(q.driver.active,false);const writes=q.stats.writes;
 q.frame();g.onTouchesMoveCallback({changedTouches:[q.touch]});g.onTouchesUpCallback({changedTouches:[q.touch]},q.manager);
 g.onTouchesCancelledCallback({},q.manager);g.onFinalizeCallback();c.performHit('punch');c.record();q.flushJS();
 assert.equal(q.stats.writes,writes,'no shader notifications while the screen is inactive');assert.equal(q.stats.recorded,0);assert.equal(q.stats.feedback,0);
 q[pause](pause==='focus'?true:false);assert.equal(q.driver.active,true);assert.equal(c.state.value.touches.length,0);
 c.performHit('punch');q.frame();q.flushJS();assert.ok(q.stats.writes>writes);assert.ok(q.stats.feedback>0);q.h.unmount();q.flushUI();
});
test('recording input starts only on a valid action after a real UI frame; ignored moves and finalization cannot orphan the recorder',()=>{
 const inputStart={value:-1},inputOffset={value:0},events=[],q=harness({onInput:batch=>events.push(...batch),inputStart,inputOffset});q.render();
 q.controller.record(undefined,'squeeze');q.flushJS();assert.equal(inputStart.value,-1);assert.equal(events.length,0);
 q.frame(1234.6);q.gesture.onTouchesMoveCallback({changedTouches:[q.touch]});q.flushJS();assert.equal(inputStart.value,-1);
 q.gesture.onTouchesDownCallback({allTouches:[q.touch],changedTouches:[q.touch]},q.manager);q.flushJS();
 assert.equal(inputStart.value,1234.6);assert.equal(events[0][0],0);assert.equal(events[0][1],0);
 q.gesture.onFinalizeCallback();q.flushJS();assert.equal(events.at(-1)[1],3);
 q.background(true);q.background(false);const count=events.length;q.controller.record(undefined,'punch');q.flushJS();assert.equal(events.length,count);
 q.frame(400000);inputStart.value=400000;inputOffset.value=19000;q.controller.record(undefined,'punch');q.flushJS();assert.equal(events.at(-1)[0],19000);q.h.unmount();q.flushUI();
});
test('queued input from a previous foreground segment is dropped even when React batches inactive/active without a render',()=>{
 const events=[],q=harness({onInput:batch=>events.push(...batch),inputStart:{value:-1},inputOffset:{value:0}});q.render();q.frame(1000);
 q.gesture.onTouchesDownCallback({allTouches:[q.touch],changedTouches:[q.touch]},q.manager);
 q.app('inactive');q.app('active');q.flushUI();q.flushJS();assert.equal(events.length,0,'old queued down cannot reopen a paused pointer');
 q.frame(2000);q.controller.record(undefined,'punch');q.flushJS();assert.equal(events.length,1);assert.equal(events[0][1],5);q.h.unmount();q.flushUI();
});

test('unmount does not write motion; queued worklets, retained JS handles and delayed receipts cannot revive a detached Canvas',()=>{
 const q=harness();q.render();const c=q.controller,g=q.gesture,handle=q.handle;
 g.onTouchesDownCallback({allTouches:[q.touch],changedTouches:[q.touch]},q.manager);c.performHit('squeeze');c.record();
 const writes=q.stats.writes;q.h.unmount();assert.equal(q.driver.active,false);q.flushUI();
 assert.equal(q.stats.writes,writes,'teardown only changes an independent liveness flag, never renderer inputs');assert.equal(q.handle,null);assert.equal(q.stats.removed,1);
 handle.hit('punch');q.flushUI();q.frame();c.performHit('punch');c.record();
 g.onTouchesMoveCallback({changedTouches:[q.touch]});g.onTouchesUpCallback({changedTouches:[q.touch]},q.manager);g.onTouchesCancelledCallback({},q.manager);g.onFinalizeCallback();q.flushJS();
 assert.equal(q.stats.writes,writes);assert.equal(q.stats.recorded,0);assert.equal(q.stats.feedback,0);
});
