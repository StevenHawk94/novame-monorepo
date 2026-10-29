const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,flush}=require('./lifecycle-test-utils.cjs');
const domain=load('packages/domain/src/plushie-touch.ts'),warp=load('apps/mobile/src/lib/burrow-toy-warp.ts');
const motion=load('apps/mobile/src/lib/squishy-toy-motion.ts',{'./burrow-toy-warp':warp});
const playback=load('apps/mobile/src/lib/plushie-touch-motion.ts',{'@novame/domain':domain,'./squishy-toy-motion':motion});
const jsx=(type,props)=>({type,props});
function find(n,type){if(!n)return;if(Array.isArray(n))return n.map(v=>find(v,type)).find(Boolean);if(n.type===type)return n;return find(n.props?.children,type);}
function harness(){
 const h=hooks(),time=clock(),listeners={},finished=[],pauses=[];let paused=false,focused=true,tree,pulses=0,caps={availableBytes:200*1024*1024,lowMemory:false};
 const clip={version:2,durationMs:60000,touches:120,events:[[0,0,0,500,500],[60000,3,0,500,500]]};
 const m=motion.createToyMotion({baseX:256,baseY:512,headWidth:200,scale:1,bounds:[0,0,512,512]});
 const {PlushieTouchPlayback}=load('apps/mobile/src/components/burrow/plushie-touch-playback.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',AppState:{addEventListener:(key,fn)=>{listeners[key]=fn;return{remove(){}};}}},
  '@react-navigation/native':{useIsFocused:()=>focused},'react-native-reanimated':{runOnUI:f=>f,runOnJS:f=>f,useReducedMotion:()=>false,useSharedValue:initial=>{const r=h.react.useRef(null);return r.current??={value:initial,modify(fn){this.value=fn(this.value);}};}},
  '@/lib/plushie-touch-motion':playback,'@/lib/squishy-toy-motion':motion,'@/lib/burrow-art-assets':{burrowArtForItem:()=>({})},
  '@/lib/haptics':{haptics:{touchPulse:async()=>{pulses++;}}},'@/lib/touch-note-runtime':{touchCapabilities:async()=>caps},
  '@/lib/touch-heart-motion':load('apps/mobile/src/lib/touch-heart-motion.ts'),
  './plushie-touch-toy':{PlushieTouchToy:'Toy'},'./plushie-touch-heart':{TouchHeartMeter:'Meter',TouchFlyingHearts:'Flying'},
 },{...time.globals,setInterval(fn,ms){const token={active:true,id:null};const tick=()=>{if(!token.active)return;fn();if(token.active)token.id=time.globals.setTimeout(tick,ms);};token.id=time.globals.setTimeout(tick,ms);return token;},clearInterval(token){token.active=false;time.globals.clearTimeout(token.id);}});
 const render=()=>tree=h.render(()=>PlushieTouchPlayback({message:{id:'note',toy:{},clip},size:300,paused,initialQuality:'full',onFinish:()=>finished.push(true),onPause:reason=>{pauses.push(reason);paused=true;}}));
 render();return {h,time,finished,pauses,render,m,get pulses(){return pulses;},get tree(){return tree;},caps:c=>{caps=c;},pause:p=>{paused=p;render();},frame:t=>find(tree,'Toy').props.onFrame(m,{timestamp:t,timeSincePreviousFrame:16}),event:(key,...a)=>listeners[key](...a)};
}
test('actual playback component freezes all visual clocks on Stop, resumes without elapsed jump and clears particles/deformation on completion',()=>{
 const q=harness();q.frame(1000);q.frame(2000);q.render();assert.equal(find(q.tree,'Meter').props.count,3);
 q.pause(true);const before=JSON.stringify(q.m),elapsed=find(q.tree,'Meter').props.clock.value;
 assert.equal(q.frame(90000),false);assert.equal(find(q.tree,'Meter').props.clock.value,elapsed);assert.equal(JSON.stringify(q.m),before);
 q.pause(false);q.frame(100000);assert.equal(find(q.tree,'Meter').props.clock.value,elapsed);
 q.frame(159000);q.render();assert.equal(q.finished.length,1);assert.equal(find(q.tree,'Meter').props.count,120);
 assert.ok(find(q.tree,'Flying').props.bursts.value.every(t=>t<0));assert.equal(q.m.touches.length,0);assert.equal(q.m.active,false);assert.equal(q.frame(160000),false);q.h.unmount();
});
test('native memory warning/Android-capability polling only degrades Detailed to Standard; critical Standard pauses; unmount stops polling',async()=>{
 const q=harness();q.frame(1000);q.frame(2000);q.event('memoryWarning');q.render();assert.equal(find(q.tree,'Toy').props.quality,'standard');
 q.caps({availableBytes:8*1024*1024,lowMemory:true});q.time.advance(3000);await flush();q.render();assert.equal(q.pauses.length,1);assert.match(q.pauses[0],/Memory/);
 assert.equal(q.frame(50000),false);const count=q.pauses.length;q.h.unmount();q.time.advance(10000);await flush();assert.equal(q.pauses.length,count);
});
test('system interruption pauses instead of completing or discarding the active note',()=>{
 const q=harness();q.frame(1000);q.frame(2000);q.event('change','inactive');q.render();assert.equal(q.pauses.length,1);assert.equal(q.finished.length,0);assert.equal(q.frame(90000),false);q.h.unmount();
});
