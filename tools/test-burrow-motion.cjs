const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const {model,motionHarness}=require('./motion-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
function setup(file){
  const h=hooks(),motion=motionHarness(h);
  const api=load(`apps/mobile/src/components/burrow/${file}.tsx`,{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Modal:'Modal',TextInput:'Input',StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
    'react-native-reanimated':motion.reanimated,'@/lib/burrow-motion':model,
  });
  return {h,motion,api};
}
test('motion tokens keep navigation/rewards short; native coin formatting handles boundaries',()=>{
  assert.equal(model.BURROW_MOTION.page,300);assert.ok(model.BURROW_MOTION.chest<1000);
  assert.equal(model.BURROW_MOTION.coinFlight,720);
  assert.equal(model.BURROW_MOTION.coinHold,1000);
  assert.deepEqual(JSON.parse(JSON.stringify(model.coinArrivalTiming(0))),{flightEnd:960,countDelay:720,countDuration:240});
  assert.deepEqual(JSON.parse(JSON.stringify(model.coinArrivalTiming(400))),{flightEnd:960,countDelay:320,countDuration:240});
  assert.deepEqual(JSON.parse(JSON.stringify(model.coinArrivalTiming(800))),{flightEnd:960,countDelay:0,countDuration:160});
  assert.equal(model.coinArrivalTiming(2000).countDuration,180,'late receipt correction never replays flights');
  for(const [input,output] of [[0,'0'],[999.6,'1,000'],[1240,'1,240'],[99998,'99,998'],[99999,'99999+'],[100500,'99999+'],[99999999,'99999+'],[-1240,'-1,240'],[Infinity,'0'],[NaN,'0']])
    assert.equal(model.formatAnimatedCoins(input),output);
});
test('initial screen has only navigator motion; later stages slide over retained drawing without replay on data changes',()=>{
  const x=setup('adventure-stage-transition'),props={stageKey:'entry',children:'A'};
  const render=()=>x.h.render(()=>x.api.AdventureStageTransition(props)).props.children;
  assert.equal(render().props.entering,undefined);
  const initialOrder=render().props.style[1].zIndex;
  props.stageKey='logged';const stage=render();assert.equal(stage.key,'logged');
  assert.equal(stage.props.entering().initialValues.transform[0].translateX,390);
  assert.equal(stage.props.entering().animations.transform[0].translateX.config.duration,300);
  assert.equal(stage.props.entering().animations.opacity.config.reduceMotion,'system');
  assert.equal(stage.props.style[1].zIndex,initialOrder+1,'incoming page is above the retained outgoing drawing');
  assert.equal(stage.props.exiting().animations.opacity.value,1,'page backgrounds never become translucent');
  props.children='cached updated';assert.equal(render().key,'logged');
  assert.equal(render().props.style[1].zIndex,stage.props.style[1].zIndex,'cache refresh cannot reorder page layers');
  props.stageKey='entry';assert.equal(render().props.style[1].zIndex,initialOrder+2,'back-navigation also covers the exiting drawing');
  props.direction='back';assert.equal(render().props.entering().initialValues.transform[0].translateX,-390);
  assert.equal(stage.props.exiting().animations.transform[0].translateX.value,0,'the true previous drawing stays underneath');
  assert.equal(stage.props.collapsable,false);x.h.unmount();
});
test('dialogue transitions move only a small distance and do not remount character/panel',()=>{
  const x=setup('adventure-stage-transition');x.h.render(()=>x.api.AdventureStageTransition({stageKey:'invite',compact:true}));
  const child=x.h.render(()=>x.api.AdventureStageTransition({stageKey:'intro:0',compact:true})).props.children;
  const motion=child.props.entering();assert.equal(motion.initialValues.transform[0].translateX,16);
  assert.equal(motion.animations.opacity.config.duration,180);x.h.unmount();
});
test('native-only lobby owns no extra Reanimated entry/exit drawing; internal game stages keep their motion',()=>{
 const x=setup('adventure-stage-transition');
 const page=x.h.render(()=>x.api.AdventureStageTransition({stageKey:'catalogue',nativePage:true,children:'catalogue'}));
 assert.equal(page.type,'View');assert.equal(page.props.children.type,'View');assert.equal(page.props.children.props.children,'catalogue');
 assert.equal(page.props.children.props.collapsable,false);assert.equal(page.props.children.props.exiting,undefined);
 x.h.unmount();
});
test('popup has one animation owner; closing callback runs only after its 180ms dismissal',()=>{
  const x=setup('adventure-reward-popup');let closed=0;
  const props={visible:false,closing:false,onClosed:()=>closed++,children:'gift'};
  const render=()=>x.h.render(()=>x.api.AdventureRewardPopup(props));render();
  props.visible=true;const modal=render();assert.equal(modal.props.animationType,'none');
  x.motion.time.advance(280);assert.equal(x.motion.values[0].value,1);
  props.closing=true;render();x.motion.time.advance(179);assert.equal(closed,0);
  x.motion.time.advance(1);assert.equal(closed,1);render();x.motion.time.advance(500);assert.equal(closed,1);x.h.unmount();
});
test('unmounted popup cancels a pending dismissal so it cannot navigate a later screen',()=>{
  const x=setup('adventure-reward-popup');let closed=0;
  x.h.render(()=>x.api.AdventureRewardPopup({visible:true,closing:true,onClosed:()=>closed++}));
  x.h.unmount();x.motion.time.advance(1000);assert.equal(closed,0);
});
test('wallet digits update natively with compact digit-dependent width and a stable native default',()=>{
  const x=setup('animated-coin-balance'),value={value:999};
  const render=()=>x.h.render(()=>x.api.AnimatedCoinBalance({value,from:999,target:1000}));
  const initial=render();assert.equal(initial.props.animatedProps.text,'999');
  value.value=999.7;const next=render();assert.equal(next.props.animatedProps.text,'1,000');
  assert.ok(next.props.style.at(-1).width>initial.props.style.at(-1).width);
  assert.equal(next.props.defaultValue,'999');assert.equal(next.props.editable,false);
  assert.equal(next.props.pointerEvents,'none');x.h.unmount();
});
