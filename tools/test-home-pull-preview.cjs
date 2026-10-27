const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const layout=load('apps/mobile/src/lib/burrow-home-layout.ts');
const model=load('apps/mobile/src/lib/home-pull-preview.ts',{'./burrow-home-layout':layout});
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(initial={}){
  const h=hooks(),time=clock(),motion=motionHarness(h,time);
  let listener,overlay=false,props={enabled:true,scale:320/900,visibleHeight:568,scope:'me',...initial};
  const gestures=[];
  const Gesture={Pan(){const pan={config:{},handlers:{}};
    for(const name of ['enabled','maxPointers','activeOffsetY','failOffsetY','failOffsetX','cancelsTouchesInView','shouldCancelWhenOutside'])pan[name]=value=>(pan.config[name]=value,pan);
    for(const name of ['onStart','onUpdate','onFinalize'])pan[name]=value=>(pan.handlers[name]=value,pan);
    gestures.push(pan);return pan;
  }};
  const {useHomePullPreview}=load('apps/mobile/src/lib/use-home-pull-preview.ts',{
    react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:(name,fn)=>(listener=fn,{remove(){listener=undefined;}})}},
    'react-native-gesture-handler':{Gesture},'react-native-reanimated':motion.reanimated,
    './overlay-presence':{useOverlayPresent:()=>overlay},'./home-pull-preview':model,
  },time.globals);
  let result;
  const render=(next={})=>{props={...props,...next};result=h.render(()=>useHomePullPreview(props));return result;};
  render();
  return {h,time,motion,render,get result(){return result;},
    start(){result.gesture.handlers.onStart();},move(y){result.gesture.handlers.onUpdate({translationY:y});},end(){result.gesture.handlers.onFinalize();},
    offset(){return render().animatedStyle.transform[0].translateY;},
    state(state){listener(state);render();},overlay(value){overlay=value;render();},
    get listener(){return listener;},get config(){return result.gesture.config;},gestures};
}

test('all screen sizes reveal the exact old 2000px canvas top after the same 160pt, without rescaling',()=>{
  for(const [width,height] of [[320,568],[375,667],[390,844],[428,926],[430,932],[768,1024],[1024,768]]){
    const tab=layout.homeTabBarHeight(width,0),art=layout.homeArtLayout(width,height-tab,tab);
    const scale=art.scale,max=model.homePullMaximum(scale,height),top=height-2000*scale;
    assert.equal(model.homePullProgress(0,160),1);
    assert.equal(model.homePullProgress(0,80)*max,max/2);
    assert.ok(Math.abs(top+max)<1e-8,`${width}×${height}: fully reveals top`);
    assert.equal(model.homePullProgress(0,2000)*max,max,'no overpull');
    assert.equal(model.homePullProgress(0,-160)*max,0,'never move upward');
    assert.equal(art.scale,Math.min(width/900,height/1600),'original layout scale unchanged');
  }
  assert.ok(Math.abs(model.homePullMaximum(320/900,568)/(320/900)-402.5)<1e-8);
  assert.ok(Math.abs(model.homePullMaximum(428/900,926)/(428/900)-52.803738317757)<1e-8);
  for(const value of [NaN,Infinity,0,-1])assert.equal(model.homePullMaximum(value,568),0);
  assert.equal(model.homePullMaximum(0.3,900),0);
  assert.equal(model.homePullProgress(0,NaN),0);
});
test('native pan is one finger, down-only, fails horizontal/up swipes, cancels presses',()=>{
  const x=harness();
  assert.deepEqual(plain(x.config),{enabled:true,maxPointers:1,activeOffsetY:8,failOffsetY:[-8,1000000],failOffsetX:[-12,12],cancelsTouchesInView:true,shouldCancelWhenOutside:false});
  let clicks=0;const press=x.result.guard(()=>clicks++);press();assert.equal(clicks,1,'ordinary tap remains immediate');
  x.start();x.move(80);assert.ok(Math.abs(x.offset()-model.homePullMaximum(320/900,568)/2)<1e-8);
  press();assert.equal(clicks,1,'no accidental click during drag');
  x.move(500);assert.equal(x.offset(),model.homePullMaximum(320/900,568));
  x.move(-100);assert.equal(x.offset(),0,'drag back cannot move past rest');
  x.move(160);x.end();press();assert.equal(clicks,1);
  assert.equal(x.motion.timings.at(-1).config.duration,150,'immediate quick non-spring return');
  x.time.advance(150);assert.equal(x.offset(),0);press();assert.equal(clicks,1,'late press is guarded');
  x.time.advance(50);press();assert.equal(clicks,2);x.h.unmount();
});
test('new drag interrupts return from its current position, without jump or old completion resetting it',()=>{
  const x=harness();x.start();x.move(80);const half=x.offset();x.end();x.time.advance(50);
  x.start();assert.equal(x.offset(),half);x.move(40);
  assert.equal(x.offset(),model.homePullMaximum(320/900,568)*0.75);
  x.time.advance(200);assert.equal(x.offset(),model.homePullMaximum(320/900,568)*0.75);
  x.end();x.time.advance(150);assert.equal(x.offset(),0);x.h.unmount();
});
for(const state of ['inactive','background'])test(`${state} immediately clears drag; resume rejects stale events and starts from rest`,()=>{
  const x=harness();let clicks=0;const press=x.result.guard(()=>clicks++);
  x.start();x.move(160);const stale=x.result.gesture.handlers;
  x.state(state);assert.equal(x.offset(),0);assert.equal(x.config.enabled,false);
  stale.onUpdate({translationY:160});stale.onFinalize();assert.equal(x.offset(),0);
  x.state('active');assert.equal(x.config.enabled,true);
  stale.onUpdate({translationY:160});stale.onFinalize();assert.equal(x.offset(),0);
  press();assert.equal(clicks,0);x.time.advance(200);press();assert.equal(clicks,1);
  x.start();x.move(80);assert.ok(x.offset()>0);x.end();x.h.unmount();assert.equal(x.listener,undefined);
});
test('overlay, page blur, scope and size changes cancel motion; native callbacks cannot revive old drag',()=>{
  const x=harness();
  for(const interrupt of [()=>x.overlay(true),()=>x.render({enabled:false}),()=>x.render({scope:'other'}),()=>x.render({scale:428/900,visibleHeight:926})]){
    x.overlay(false);x.render({enabled:true,scale:320/900,visibleHeight:568,scope:'me'});
    x.start();x.move(160);const old=x.result.gesture.handlers;interrupt();
    assert.equal(x.offset(),0);old.onUpdate({translationY:160});old.onFinalize();assert.equal(x.offset(),0);
  }
  assert.equal(x.config.enabled,true,'resize must not leave allowed=false via stale effect cleanup');
  x.start();x.move(160);assert.equal(x.offset(),model.homePullMaximum(428/900,926));x.h.unmount();
});
test('cancel while returning prevents old animation completion; unmount blocks delayed presses',()=>{
  const x=harness();let clicks=0;const press=x.result.guard(()=>clicks++);
  x.start();x.move(160);x.end();x.state('background');x.time.advance(1000);assert.equal(x.offset(),0);
  x.state('active');x.start();x.move(80);x.h.unmount();x.time.advance(1000);press();assert.equal(clicks,0);
  assert.equal(x.motion.values[0].value,0);assert.equal(x.time.timers.size,0);
});
test('inactive and active batched before React commits still reset and re-enable the gesture',()=>{
  const x=harness();x.start();x.move(160);
  x.listener('inactive');x.listener('active');x.render();assert.equal(x.offset(),0);
  x.start();x.move(80);assert.ok(x.offset()>0,'allowed must not remain false when foreground state was batched');
  x.overlay(true);x.listener('inactive');x.listener('active');x.render();
  x.start();x.move(160);assert.equal(x.offset(),0,'resume must respect the current overlay');x.h.unmount();
});
test('disabled/full-height previews do not activate or intercept ordinary taps',()=>{
  for(const initial of [{enabled:false},{scale:0.3,visibleHeight:900}]){
    const x=harness(initial);assert.equal(x.config.enabled,false);let clicks=0;
    x.start();x.move(160);x.end();assert.equal(x.offset(),0);x.result.guard(()=>clicks++)();assert.equal(clicks,1);x.h.unmount();
  }
});
test('only the room canvas moves; chrome/actions stay fixed; Home explicitly opts in outside overlays',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
  assert.match(source,/pullToPeekEnabled=false/);
  assert.match(source,/enabled:pullToPeekEnabled&&!previewOnly&&!partnerRoom&&!busy/);
  const canvas=source.slice(source.indexOf('<Animated.View'),source.indexOf('</Animated.View>'));
  assert.match(canvas,/home-pull-room/);assert.match(canvas,/pull\.animatedStyle/);
  assert.match(canvas,/\{artwork\}/);
  const artwork=source.slice(source.indexOf('const artwork=useMemo'),source.indexOf('return <GestureDetector'));
  for(const text of ['home-background-rim','home-background-floor','OutfitBunny','HomeLoveLetter'])assert.ok(artwork.includes(text),text);
  for(const text of ['Open menu','Open carrot wallet','onAffection','onAdventure'])assert.ok(!canvas.includes(text),text);
  assert.match(source,/bottom: previewOnly \? -previewBottomCrop \* scale : -tabBarHeight/);
  assert.match(source,/<GestureDetector gesture=\{pull.gesture\}>/);
  const parent=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(parent,/pullToPeekEnabled=\{focused&&!!homeVisual&&!homeEntering&&!modalOpen\}/);
});
