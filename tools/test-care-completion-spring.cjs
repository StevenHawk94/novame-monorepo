const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness(reduced=false){
 const h=hooks(),values=[],springs=[],timings=[],listeners=new Set(),backs=new Set(),cancelled=[];
 let closed=0;
 const props={title:'Yum!',message:'Your bunny is full and happy.',onClose:()=>closed++};
 const {CareQuestCelebration}=load('apps/mobile/src/components/burrow/care-quest-celebration.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Text:'Text',View:'View',Pressable:'Button',StyleSheet:{create:x=>x,absoluteFillObject:{}},
   AppState:{addEventListener:(_event,fn)=>(listeners.add(fn),{remove:()=>listeners.delete(fn)})},
   BackHandler:{addEventListener:(_event,fn)=>(backs.add(fn),{remove:()=>backs.delete(fn)})}},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},ReduceMotion:{System:'system',Never:'never'},
   Easing:{out:x=>x,cubic:'cubic'},useReducedMotion:()=>reduced,
   useSharedValue:initial=>{const ref=h.react.useRef(null);if(!ref.current){ref.current={initial,value:initial};values.push(ref.current);}return ref.current;},
   useAnimatedStyle:fn=>fn(),cancelAnimation:value=>cancelled.push(value),
   withSpring:(target,config)=>{const result={spring:true,target,config};springs.push(result);return result;},
   withTiming:(target,config)=>{const result={timing:true,target,config};timings.push(result);return result;},
  },
 });
 const render=()=>nodes(h.render(()=>CareQuestCelebration(props)));
 return{h,props,values,springs,timings,listeners,backs,cancelled,render,closed:()=>closed};
}
for(const partner of [false,true])for(const flower of [false,true])test(`${partner?'partner':'own'} ${flower?'flower':'bunny'} completion animates only the card once, with Done usable immediately`,()=>{
 const x=harness();Object.assign(x.props,{title:flower?'Ahh!':'Yum!',message:`${partner?"Irina's":'Your'} ${flower?'flower is fresh and growing.':'bunny is full and happy.'}`,icon:flower?'heart':undefined});
 const tree=x.render(),card=tree.find(n=>n.type==='AnimatedView'&&Array.isArray(n.props.style));
 assert.ok(card,'the formerly static card must be the animated host');
 assert.equal(x.values[0].initial,.84);assert.equal(x.values[1].initial,0);
 assert.equal(card.props.style[0].maxWidth,350);assert.equal(x.values[0].value.target,1);
 assert.equal(x.springs.length,1);assert.equal(x.springs[0].target,1);assert.equal(x.springs[0].config.overshootClamping,false);
 const config=x.springs[0].config;assert.ok(config.damping/(2*Math.sqrt(config.mass*config.stiffness))<1,'spring must oscillate, not just ease into place');
 x.props.onClose=()=>{};x.render();x.props.reward=5;x.render();assert.equal(x.springs.length,1,'new callbacks/receipts must not replay');
 const button=tree.find(n=>n.type==='Button');assert.notEqual(button.props.disabled,true);button.props.onPress();assert.equal(x.closed(),1);
 x.h.unmount();assert.equal(x.listeners.size,0);assert.equal(x.backs.size,0);assert.ok(x.cancelled.includes(x.values[0]));assert.ok(x.cancelled.includes(x.values[1]));
});
test('Reduce Motion keeps scale at one and uses only a short card fade',()=>{
 const x=harness(true);x.render();assert.equal(x.springs.length,0);assert.equal(x.values[0].value,1);
 assert.equal(x.timings.length,1);assert.equal(x.timings[0].target,1);assert.ok(x.timings[0].config.duration<=180);assert.equal(x.timings[0].config.reduceMotion,'never');x.h.unmount();
});
test('background consumes only the entrance animation; return/refresh does not bounce again or close the card',()=>{
 const x=harness();x.render();for(const fn of x.listeners)fn('background');
 assert.equal(x.values[0].value,1);assert.equal(x.values[1].value,1);assert.equal(x.closed(),0);
 for(const fn of x.listeners)fn('active');x.render();assert.equal(x.springs.length,1);x.h.unmount();
});
test('all four completion entrances retain one shared card, not the cooldown/native modal or monetary presentation',()=>{
 const screen=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');
 assert.equal((screen.match(/<CareQuestCelebration\b/g)||[]).length,1);
 const source=fs.readFileSync('apps/mobile/src/components/burrow/care-quest-celebration.tsx','utf8');
 assert.doesNotMatch(source,/withRepeat|runOnJS|enqueueRoomCare|coin-reward|<Modal/);
 assert.match(source,/!reward && <View/,'existing confetti behavior stays unchanged');
});
