const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/care-confetti-motion.ts');
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness(reduced=false){
 const h=hooks(),confetti=require('./motion-test-utils.cjs').careConfettiHarness(),listeners=new Set(),backs=new Set();let closed=0;
 const props={title:'Yum!',message:'Your bunny is full and happy.',onClose:()=>closed++,visible:true};
 const {CareQuestCelebration}=load('apps/mobile/src/components/burrow/care-quest-celebration.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/care-confetti-motion':model,
  'react-native':{Animated:confetti.Animated,Easing:confetti.Easing,Text:'Text',View:'View',Pressable:'Button',StyleSheet:{create:x=>x,absoluteFillObject:{}},
   AppState:{addEventListener:(_event,fn)=>(listeners.add(fn),{remove:()=>listeners.delete(fn)})},
   BackHandler:{addEventListener:(_event,fn)=>(backs.add(fn),{remove:()=>backs.delete(fn)})}},
  'react-native-reanimated':{useReducedMotion:()=>reduced},
 });
 return{h,props,confetti,listeners,backs,render:()=>nodes(h.render(()=>CareQuestCelebration(props))),closed:()=>closed};
}
for(const partner of [false,true])for(const flower of [false,true])test(`${partner?'partner':'own'} ${flower?'flower':'bunny'} preserves original spring, card geometry and immediate Done without replay on receipts`,()=>{
 const x=harness();Object.assign(x.props,{title:flower?'Ahh!':'Yum!',message:`${partner?"Irina's":'Your'} ${flower?'flower is fresh and growing.':'bunny is full and happy.'}`,icon:flower?'heart':undefined});
 const tree=x.render(),card=tree.find(n=>n.props?.style?.[0]?.maxWidth===350);
 assert.ok(card);assert.equal(card.props.style[0].padding,26);assert.equal(card.props.shouldRasterizeIOS,true);
 const curve=card.props.style[1].transform[0].scale.config;assert.equal(curve.outputRange[0],.84);assert.equal(curve.outputRange.at(-1),1);
 assert.deepEqual(curve.outputRange,model.CARE_COMPLETION_SCALE);assert.ok(Math.max(...curve.outputRange)>1.05);assert.ok(Math.min(...curve.outputRange.slice(35,65))<.99);assert.ok(Math.max(...curve.outputRange.slice(65,100))>1.002);
 assert.equal(x.confetti.clocks.length,1);assert.equal(x.confetti.clocks[0].config.useNativeDriver,true);
 assert.equal(x.confetti.animations.length,1);assert.equal(x.confetti.animations[0].config.isInteraction,false);
 x.props.onClose=()=>{};x.render();x.props.reward=5;x.render();assert.equal(x.confetti.animations.length,1);
 const button=tree.find(n=>n.type==='Button');assert.notEqual(button.props.disabled,true);button.props.onPress();assert.equal(x.closed(),1);
 x.h.unmount();assert.equal(x.listeners.size,0);assert.equal(x.backs.size,0);assert.equal(x.confetti.animations[0].stopped,true);
});
test('Reduce Motion keeps scale at one, hides confetti and only fades the card for 160ms',()=>{
 const x=harness(true),tree=x.render(),card=tree.find(n=>n.props?.style?.[0]?.maxWidth===350);
 assert.equal(card.props.style[1].transform[0].scale,1);assert.equal(x.confetti.animations[0].config.duration,160);
 assert.equal(tree.find(n=>n.props?.style?.[0]?.zIndex===2).props.style[1].opacity,0);x.h.unmount();
});
test('background finishes only the visual clock; return/refresh does not bounce or close again',()=>{
 const x=harness();x.render();for(const fn of x.listeners)fn('background');
 assert.equal(x.confetti.clocks[0].value,900);assert.equal(x.closed(),0);assert.equal(x.confetti.animations[0].stopped,true);
 for(const fn of x.listeners)fn('active');x.render();assert.equal(x.confetti.animations.length,1);x.h.unmount();
});
test('all four routes retain the one shared card, existing confetti and monetary authority boundaries',()=>{
 const screen=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');assert.equal((screen.match(/<CareQuestCelebration\b/g)||[]).length,1);
 const source=fs.readFileSync('apps/mobile/src/components/burrow/care-quest-celebration.tsx','utf8');
 assert.doesNotMatch(source,/withRepeat|runOnJS|enqueueRoomCare|coin-reward|<Modal/);assert.match(source,/!reward && <View/);
});
test('prepared inactive card cannot intercept touch, accessibility or Back or animate before acceptance',()=>{
 const x=harness();x.props.visible=false;const tree=x.render(),root=tree[0];
 assert.equal(root.props.pointerEvents,'none');assert.equal(root.props.accessibilityViewIsModal,false);assert.equal(root.props.accessibilityElementsHidden,true);
 assert.equal(root.props.importantForAccessibility,'no-hide-descendants');assert.equal(tree.find(n=>n.type==='Button').props.disabled,true);
 assert.equal(x.confetti.animations.length,0);assert.equal(x.listeners.size,0);assert.equal(x.backs.size,0);
 x.props.visible=true;assert.equal(x.render()[0].props.pointerEvents,'auto');assert.equal(x.confetti.animations.length,1);assert.equal(x.backs.size,1);
 x.props.visible=false;x.render();assert.equal(x.backs.size,0);assert.equal(x.listeners.size,0);assert.equal(x.confetti.clocks[0].value,0);x.h.unmount();
});
test('one finite preattached native clock drives the entire scene; hiding cancels it and does not prepare another page',()=>{
 const source=fs.readFileSync('apps/mobile/src/components/burrow/care-quest-celebration.tsx','utf8');
 const piece=source.slice(source.indexOf('const ConfettiPiece'),source.indexOf('/** Care'));
 assert.doesNotMatch(piece,/useEffect|useSharedValue|withTiming|useAnimatedStyle/);
 const x=harness();x.props.visible=false;x.render();assert.equal(x.confetti.clocks.length,1);assert.equal(x.confetti.animations.length,0);
 x.props.visible=true;x.render();assert.equal(x.confetti.animations[0].config.duration,900);assert.equal(x.confetti.animations[0].config.useNativeDriver,true);
 x.h.unmount();assert.equal(x.confetti.animations[0].stopped,true);
 const screen=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');assert.match(screen,/isCare&&<CareQuestCelebration key=\{careScope\} visible=\{!!careCelebration\}/);
 assert.ok(screen.indexOf('enqueueRoomCare(data,ownerId,which)')<screen.indexOf('setCareCelebration(which)'));
});
test('precomputed native confetti preserves original 36 trajectories, dimensions and spring physics within subpixel precision',()=>{
 assert.equal(model.CARE_CONFETTI.length,36);
 for(const[index,piece]of model.CARE_CONFETTI.entries()){
  assert.equal(piece.width,index%4?8:11);assert.equal(piece.height,index%4?15:10);
  for(let n=0;n<piece.inputRange.length-1;n++){
   const ms=(piece.inputRange[n]+piece.inputRange[n+1])/2,t=1-(1-Math.min(1,ms/(700+index%5*50)))**3;
   const approx=(piece.x[n]+piece.x[n+1])/2,expected=Math.cos(index*2.39996)*(92+index%7*15)*t;assert.ok(Math.abs(approx-expected)<.1);
  }
 }
 for(let n=0;n<model.CARE_COMPLETION_INPUT.length-1;n++){
  const t=(model.CARE_COMPLETION_INPUT[n]+3.75)/1000,d=8.5/1.2,w=Math.sqrt(300/.6-d*d);
  const expected=1-.16*Math.exp(-d*t)*(Math.cos(w*t)+d/w*Math.sin(w*t));
  assert.ok(Math.abs((model.CARE_COMPLETION_SCALE[n]+model.CARE_COMPLETION_SCALE[n+1])/2-expected)<.0006);
 }
});
test('care ignores wallet-only updates while actual room/cooldown/identity changes and real wallet pages remain live',()=>{
 const {retainedPageChanged}=load('apps/mobile/src/lib/retained-page-model.ts');
 const before={profile:{id:'owner'},partner:{id:'partner'},pairVersion:'p',hasPlus:false,localDate:'2026-10-29',wallet:{balance:10},roomCare:{version:2},catalog:[],loadouts:[]},coins={...before,wallet:{balance:15}};
 assert.equal(retainedPageChanged(before,coins,'care'),false);for(const page of ['home','shop','quests','partner_room'])assert.equal(retainedPageChanged(before,coins,page),true);
 for(const key of ['roomCare','loadouts','catalog','profile','partner','pairVersion','localDate'])assert.equal(retainedPageChanged(before,{...before,[key]:{}},'care'),true,key);
 assert.match(fs.readFileSync('apps/mobile/src/lib/burrow-store.ts','utf8'),/useCoinBalance\(focused[^;]+retainedPage!=='care'/);
});
