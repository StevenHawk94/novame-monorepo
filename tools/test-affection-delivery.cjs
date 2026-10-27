const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
function harness(){
 const h=hooks(),time=clock(),animations=[],listeners=new Set();
 let phase='ready',id='first',ends=0,reducedListener;
 const app={currentState:'active',addEventListener:(_event,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
 class Value{
  constructor(value){this.value=value;}
  setValue(value){this.value=value;}
  stopAnimation(){}
  interpolate(config){return{value:this,config};}
 }
 const Animated={Value,Text:'Heart',timing:(value,config)=>{
  const animation={value,config,start(fn){this.callback=fn;},stop(){this.callback?.({finished:false});}};
  animations.push(animation);return animation;
 }};
 const {AffectionDelivery}=load('apps/mobile/src/components/burrow/affection-delivery.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Animated,AppState:app,AccessibilityInfo:{isReduceMotionEnabled:async()=>false,
   addEventListener:(_event,fn)=>{reducedListener=fn;return{remove(){}};}},Easing:{bezier:()=> 'bezier'},
   View:'View',Text:'Text',StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height:844})},
  'react-native-svg':{default:'Svg',Line:'Line',Path:'Path'},'./burrow-image':{Image:'Image'},
  './affection-gesture':{AFFECTION_COPY:{hug:{label:'Hug'}}},'@/components/ui/user-avatar':{UserAvatar:'Avatar'},
 },time.globals);
 const render=()=>h.render(()=>AffectionDelivery({sender:{id:'A'},recipient:{id:'B'},type:'hug',phase,deliveryId:id,onTransitEnd:()=>ends++}));
 return {render,animations,time,unmount:h.unmount,get ends(){return ends;},
  phase:value=>{phase=value;},id:value=>{id=value;},reduce:value=>reducedListener(value),
  appState:value=>{app.currentState=value;for(const fn of listeners)fn(value);}};
}
test('a normal flight finishes once; rerenders and the fallback cannot duplicate Sent',async()=>{
 const h=harness();h.render();await flush();h.phase('sending');h.render();
 const a=h.animations.at(-1);assert.equal(a.config.duration,1850);a.callback({finished:true});
 assert.equal(h.ends,1);a.callback({finished:true});h.render();h.time.advance(5000);assert.equal(h.ends,1);h.unmount();
});
test('a lost or interrupted native callback has a bounded presentation-only fallback',()=>{
 const h=harness();h.phase('sending');h.render();h.animations.at(-1).callback({finished:false});
 h.time.advance(2049);assert.equal(h.ends,0);h.time.advance(1);assert.equal(h.ends,1);h.unmount();
});
test('backgrounded delivery catches up on foreground, without blocking or replaying its flight',()=>{
 const h=harness();h.phase('sending');h.render();h.appState('background');
 h.time.advance(5000);assert.equal(h.ends,0);h.appState('active');assert.equal(h.ends,1);
 h.appState('active');assert.equal(h.ends,1);h.unmount();
});
test('reduced motion settles immediately; a preferences update cannot restart the same delivery',()=>{
 const h=harness();h.render();h.reduce(true);h.render();h.phase('sending');h.render();assert.equal(h.ends,1);
 h.reduce(false);h.render();h.time.advance(5000);assert.equal(h.ends,1);h.unmount();
});
test('stale callbacks cannot end the next send and unmount never produces a late Sent',()=>{
 const h=harness();h.phase('sending');h.render();const first=h.animations.at(-1);
 h.id('second');h.render();first.callback({finished:true});assert.equal(h.ends,0);
 const second=h.animations.at(-1);second.callback({finished:true});assert.equal(h.ends,1);
 h.phase('ready');h.render();h.id('third');h.phase('sending');h.render();const third=h.animations.at(-1);
 h.unmount();third.callback({finished:true});h.time.advance(5000);assert.equal(h.ends,1);
});
