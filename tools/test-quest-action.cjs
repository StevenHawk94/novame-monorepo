const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nodes=tree=>typeof tree==='function'?nodes(tree({pressed:false})):Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function actionHarness(){
 const h=hooks(),motion=motionHarness(h);let active=true,reduced=false;
 const api=load('apps/mobile/src/components/burrow/quest-action.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Text:'Text',StyleSheet:{create:s=>s,absoluteFillObject:{position:'absolute',left:0,top:0,right:0,bottom:0}}},
  'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-reanimated':motion.reanimated,
  '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced})},
 });
 return {h,motion,render:props=>h.render(()=>api.QuestAction(props)),active:value=>{active=value;},reduced:value=>{reduced=value;}};
}
test('orange/gray Claim and daily arrows share a raised gradient base; only a ready reward gently shakes sideways',()=>{
 for(const props of [{ready:true},{ready:false},{ready:false,arrow:true}]){
  const h=actionHarness(),tree=h.render(props),all=nodes(tree),gradients=all.filter(n=>n.type==='Gradient');
  assert.equal(tree.props.pointerEvents,'none');assert.equal(tree.props.accessible,false);
  assert.equal(tree.props.style[0].height,46);assert.equal(gradients[0].props.style[0].height,42);assert.equal(gradients[0].props.style[1].top,4);
  assert.ok(gradients[0].props.style[1].shadowOpacity>0);
  assert.deepEqual(Array.from(gradients[1].props.colors),props.ready?['#E37D42','#CF602D']:['#F2F0EC','#E8E5DF']);
  assert.deepEqual(Array.from(gradients[0].props.colors),props.ready?['#B95428','#A54720']:['#DAD7D1','#C5C1BA']);
  assert.equal(all.find(n=>n.type==='Text').props.children,props.arrow?'➜':'Claim');
  const loop=h.motion.values[0].loop;
  if(props.ready){
   assert.ok(loop);assert.equal(loop.count,-1);assert.equal(loop.reverse,false);
   assert.deepEqual(Array.from(loop.animation.sequence,x=>x.value),[0,-3,3,-2,2,0]);
   assert.ok(loop.animation.sequence[0].config.duration>=1000,'pause between small reminders');
  }else assert.equal(loop,undefined);
  h.h.unmount();assert.equal(h.motion.time.timers.size,0);assert.equal(h.motion.values[0].loop,undefined);
 }
});
test('pressing depresses the face onto its base; claimed/disabled, background and Reduce Motion stop the reminder',()=>{
 const h=actionHarness();h.render({ready:true});assert.ok(h.motion.values[0].loop);
 h.render({ready:true,pressed:true});assert.equal(h.motion.values[0].loop,undefined);
 assert.equal(h.motion.timings.at(-1).value,4);assert.equal(h.motion.timings.at(-1).config.duration,80);
 h.motion.time.advance(80);assert.equal(h.motion.values[1].value,4);
 h.render({ready:true,pressed:false});assert.ok(h.motion.values[0].loop);assert.equal(h.motion.timings.at(-1).value,0);
 h.render({ready:true,disabled:true});assert.equal(h.motion.values[0].loop,undefined);
 h.render({ready:true});h.active(false);h.render({ready:true});assert.equal(h.motion.values[0].loop,undefined);
 h.active(true);h.reduced(true);h.render({ready:true});assert.equal(h.motion.values[0].loop,undefined);
 h.reduced(false);h.render({ready:true});assert.ok(h.motion.values[0].loop);
 h.render({ready:false});assert.equal(h.motion.values[0].loop,undefined);assert.equal(h.motion.values[0].value,0);
 h.h.unmount();assert.equal(h.motion.time.timers.size,0);
});
test('countdown/store rerenders do not restart a ready Claim reminder',()=>{
 const h=actionHarness();h.render({ready:true});const loop=h.motion.values[0].loop;
 for(let i=0;i<20;i++){h.render({ready:true});assert.equal(h.motion.values[0].loop,loop);}
 h.h.unmount();
});
function boardHarness(){
 const h=hooks(),requests=[],go=[],origins=[];
 const api=load('apps/mobile/src/components/burrow/quest-board.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:s=>s}},
  './burrow-image':{Image:'Image'},'@/lib/burrow-ui-assets':{BURROW_QUEST_BANNER:'banner',BURROW_QUEST_ICONS:{}},
  './quest-action':{QuestAction:'QuestAction'},'./quest-progress':{QuestProgress:'QuestProgress'},'./quest-claim-confetti':{QuestClaimConfetti:'Confetti'},
  '@/lib/coin-reward-store':{setNextCoinRewardOrigin:origin=>origins.push(origin)},
 });
 const data={profile:{id:'me'},localDate:'2026-10-18',pairVersion:null,quests:{quests:[{questId:'send_affection',assignmentId:'daily',progress:0,target:1,completedAt:null,claimedAt:null}]},
  specialQuests:[{questId:'items_collected',progress:9,target:10,stage:1}],inventory:[],discoveries:[]};
 let busy=false;
 return {h,data,go,requests,origins,busy:value=>{busy=value;},render:()=>h.render(()=>api.QuestBoard({data,busy,onGo:id=>go.push(id),onClaim:()=>{const request=deferred();requests.push({id:'daily',request});return request.promise;},
  onSpecialClaim:(id,stage)=>{const request=deferred();requests.push({id,stage,request});return request.promise;}}))};
}
const card=(tree,prefix)=>nodes(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel.startsWith(prefix));
const action=tree=>nodes(tree).find(n=>n.type==='QuestAction');
test('every incomplete or unassigned Special Quest is a disabled gray Claim and never navigates, even if its handler is invoked',()=>{
 const h=boardHarness(),tree=h.render();
 const cards=nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel.includes('reward not ready'));
 assert.equal(cards.length,4);
 for(const c of cards){assert.equal(c.props.disabled,true);assert.equal(c.props.accessibilityState.disabled,true);assert.equal(action(c).props.ready,false);assert.equal(action(c).props.arrow,undefined);c.props.onPress();}
 assert.equal(h.requests.length,0);assert.equal(h.go.length,0);
 const daily=card(tree,'Send your person affection');assert.equal(action(daily).props.arrow,true);daily.props.onPress();assert.deepEqual(h.go,['send_affection']);
 const source=fs.readFileSync('apps/mobile/src/components/burrow/quest-board.tsx','utf8');assert.doesNotMatch(source,/onSpecialGo|#31A36C/);
 h.h.unmount();
});
test('special completion enables the orange reminder, optimistic claim disables it immediately, failure restores it, and duplicate taps award once',async()=>{
 const h=boardHarness();h.data.specialQuests[0].progress=10;
 let c=card(h.render(),'Collect Items');assert.equal(c.props.disabled,false);assert.equal(action(c).props.ready,true);
 c.props.onPress({nativeEvent:{pageX:123,pageY:456}});c.props.onPress();assert.equal(h.requests.length,1);assert.equal(h.requests[0].stage,1);assert.equal(h.origins[0].x,123);
 c=card(h.render(),'Collect Items');assert.equal(c.props.disabled,true);assert.equal(action(c).props.ready,false);assert.equal(action(c).props.disabled,true);
 assert.equal(nodes(c).find(n=>n.type==='QuestProgress').props.target,20);
 h.requests[0].request.reject(Error('offline'));await flush();c=card(h.render(),'Collect Items');assert.equal(c.props.disabled,false);assert.equal(action(c).props.ready,true);
 c.props.onPress();assert.equal(h.requests.length,2);h.requests[1].request.resolve(15);await flush();
 h.data.specialQuests[0]={...h.data.specialQuests[0],stage:2,target:20};c=card(h.render(),'Collect Items');assert.equal(c.props.disabled,true);assert.equal(action(c).props.ready,false);
 h.data.specialQuests[0].progress=20;c=card(h.render(),'Collect Items');assert.equal(c.props.disabled,false);assert.equal(action(c).props.ready,true);
 h.busy(true);c=card(h.render(),'Collect Items');assert.equal(action(c).props.disabled,false,'an unrelated background command cannot block a ready Claim');
 c.props.onPress();assert.equal(h.requests.length,3);c=card(h.render(),'Collect Items');assert.equal(action(c).props.disabled,true,'only this claim locks itself');h.h.unmount();
});
test('daily ready Claim is orange/reminding, and its action disappears immediately on optimistic collection',async()=>{
 const h=boardHarness();h.data.quests.quests[0].progress=1;
 let c=card(h.render(),'Send your person affection');assert.equal(action(c).props.ready,true);assert.equal(action(c).props.arrow,false);
 c.props.onPress();c.props.onPress();assert.equal(h.requests.length,1);c=card(h.render(),'Send your person affection');assert.equal(c.props.disabled,true);assert.equal(action(c),undefined);
 h.requests[0].request.resolve(10);await flush();h.h.unmount();
});
