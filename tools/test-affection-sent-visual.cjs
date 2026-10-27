const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
function harness(type='hug'){
  const h=hooks(),animations=[];let focused=true,reduced=false,listener,removed=0;
  class Value{constructor(n){this.value=n;}setValue(n){this.value=n;}interpolate(config){return{value:this,config};}}
  const icons=Object.fromEntries(['hug','kiss','cuddle','spicy','miss_you','gratitude'].map(t=>[t,t+'.webp']));
  const Animated={Value,View:'AnimatedView',Text:'AnimatedText',timing:(value,config)=>{
    const a={value,config,starts:0,stops:0,start(){this.starts++;},stop(){this.stops++;}};animations.push(a);return a;
  }};
  const native={Animated,View:'View',StyleSheet:{absoluteFillObject:{position:'absolute',inset:0},create:s=>s},
    Easing:{linear:'linear'},AppState:{currentState:'active',addEventListener:(_event,fn)=>{listener=fn;return{remove(){removed++;}};}}};
  const imports={react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    '@react-navigation/native':{useIsFocused:()=>focused},'react-native-reanimated':{useReducedMotion:()=>reduced},
    '@/lib/burrow-ui-assets':{BURROW_AFFECTION_ICONS:icons},'./burrow-image':{Image:'Image'}};
  const burst=load('apps/mobile/src/components/burrow/affection-heart-burst.tsx',imports);
  const visual=load('apps/mobile/src/components/burrow/affection-sent-visual.tsx',{...imports,'./affection-heart-burst':burst});
  return{animations,visual,burst,render:()=>h.render(()=>visual.AffectionSentVisual({type})),h,
    focus:v=>focused=v,reduce:v=>reduced=v,background:()=>listener('background'),get removed(){return removed;}};
}
test('all six sent icons use the exact scale sequence and same native clock for the receive heart burst',()=>{
  for(const type of ['hug','kiss','cuddle','spicy','miss_you','gratitude']){
    const t=harness(type),tree=t.render(),[icon,burst]=tree.props.children;
    assert.equal(icon.props.children.props.source,type+'.webp');
    const scale=icon.props.style.transform[0].scale;
    assert.deepEqual(Array.from(scale.config.outputRange),[0,1.3,1,1.2,1,1.1,1]);
    assert.equal(burst.type,t.burst.AffectionHeartBurst);assert.equal(burst.props.progress,scale.value);
    assert.equal(t.animations.length,1);assert.equal(t.animations[0].config.duration,960);assert.equal(t.animations[0].config.useNativeDriver,true);
    assert.equal(t.animations[0].starts,1);t.render();assert.equal(t.animations.length,1,'rerender does not restart');
  }
});
test('background, focus loss and unmount stop the burst; return shows settled icon without replay',()=>{
  const t=harness();t.render();const a=t.animations[0];t.background();assert.equal(a.stops,1);assert.equal(a.value.value,1);
  t.focus(false);t.render();assert.ok(a.stops>=2);assert.equal(t.removed,1);
  t.focus(true);t.render();assert.equal(t.animations.length,1);assert.equal(a.value.value,1);
  t.h.unmount();assert.equal(a.value.value,1);
});
test('reduced motion shows icon immediately, with no bounce or scatter',()=>{
  const t=harness();t.reduce(true);const tree=t.render();assert.equal(t.animations.length,0);
  assert.equal(tree.props.children[0].props.style.transform[0].scale.value.value,1);assert.equal(tree.props.children[1],false);
});
test('shared burst keeps receiver particle count, geometry and fade; hub retains its receive completion callback',()=>{
  const t=harness();const tree=t.render(),burst=t.burst.AffectionHeartBurst({progress:tree.props.children[1].props.progress});
  assert.equal(burst.props.pointerEvents,'none');assert.equal(burst.props.children.length,15);
  assert.deepEqual(Array.from(burst.props.children[0].props.style.transform[0].translateX.config.outputRange),[0,-86]);
  assert.deepEqual(Array.from(burst.props.children[0].props.style.opacity.config.outputRange),[0,1,1,0]);
  const source=fs.readFileSync('apps/mobile/src/components/burrow/affection-hub.tsx','utf8');
  assert.match(source,/<AffectionHeartBurst progress=\{burst\}/);assert.match(source,/!finished\|\|version!==generation.current/);
  assert.match(source,/onReceive\(batch.ids\)/);assert.match(source,/if\(!next\)onClose\(\)/);
  const gesture=fs.readFileSync('apps/mobile/src/components/burrow/affection-gesture.tsx','utf8');
  assert.match(gesture,/<AffectionSentVisual key=\{type\} type=\{type\}/);assert.doesNotMatch(gesture,/SuccessHearts|successPositions|burstPositions/);
});
