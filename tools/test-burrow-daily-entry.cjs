const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const localDay=load('apps/mobile/src/lib/burrow-local-day.ts');
const model=load('apps/mobile/src/lib/burrow-daily-entry.ts',{'./burrow-local-day':localDay});
const data=()=>({profile:{id:'A',timezone_name:'America/Los_Angeles'},hasPlus:false,
  dailyAdventureUsed:true,localDate:'2026-10-12',activeAdventure:null,adventureResult:null,readyRecordId:null,
  lastAffectionAt:'2026-10-12T08:00:00Z',serverNow:'2026-10-12T09:00:00Z',partner:{display_name:'Alex'},
  affectionInbox:[],unread:{affection:0}});
const now=Date.parse('2026-10-12T09:00:00Z');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>nodes(tree).filter(n=>n.type==='Text').map(n=>n.props.children).join(' ');
const native={View:'View',Text:'Text',Pressable:'Pressable',ScrollView:'ScrollView',Modal:'Modal',
  StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})};

test('only fully finished adventures open the cached Home napping dialog',()=>{
  assert.equal(model.adventureFinishedToday(data(),now),true);
  for(const status of ['in_progress','result_ready','interaction_required'])
    assert.equal(model.adventureFinishedToday({...data(),activeAdventure:{id:'trip',status}},now),false,status);
  for(const patch of [{adventureResult:{id:'unclaimed'}},{dailyAdventureUsed:false},{localDate:'2026-10-11'}])
    assert.equal(model.adventureFinishedToday({...data(),...patch},now),false);
  assert.equal(model.adventureFinishedToday(null,now),false);
  assert.equal(model.adventureFinishedToday({...data(),readyRecordId:'stale'},now),true,'a contradictory old record cannot bypass today’s used quota');
});
test('Free affection resets at owner midnight; legacy Plus snapshots wait for the authoritative quota',()=>{
  assert.equal(model.freeAffectionUsedToday(data(),now),true);
  assert.equal(model.freeAffectionUsedToday({...data(),hasPlus:true},now),false);
  assert.equal(model.freeAffectionUsedToday({...data(),lastAffectionAt:null},now),false);
  assert.equal(model.freeAffectionUsedToday({...data(),lastAffectionAt:'bad'},now),false);
  assert.equal(model.freeAffectionUsedToday(data(),Date.parse('2026-10-13T06:59:59Z')),true);
  assert.equal(model.freeAffectionUsedToday(data(),Date.parse('2026-10-13T07:00:00Z')),false);
  assert.equal(model.freeAffectionUsedToday({...data(),lastAffectionAt:'2026-10-12T06:59:59Z'},now),false);
  assert.equal(model.freeAffectionUsedToday({...data(),profile:{timezone_name:'Asia/Shanghai'},lastAffectionAt:'2026-10-12T15:59:59Z'},Date.parse('2026-10-12T16:00:00Z')),false);
  assert.equal(model.freeAffectionUsedToday(null,now),false);
});
test('Plus has six sends total, including local reservations; a new local day resets the display gate',()=>{
  const plus={...data(),hasPlus:true,affectionUsage:{localDate:'2026-10-12',used:5,limit:6,remaining:1}};
  assert.equal(model.freeAffectionUsedToday(plus,now),false);
  assert.equal(model.freeAffectionUsedToday({...plus,affectionUsage:{...plus.affectionUsage,pending:1}},now),true);
  assert.equal(model.freeAffectionUsedToday({...plus,affectionUsage:{...plus.affectionUsage,used:6}},now),true);
  assert.equal(model.freeAffectionUsedToday({...plus,affectionUsage:{...plus.affectionUsage,used:6}},Date.parse('2026-10-13T07:00:00Z')),false);
});
test('daily entry icons resolve to the supplied assets with case-sensitive Metro paths',()=>{
  const file='apps/mobile/src/lib/burrow-ui-assets.ts',source=fs.readFileSync(file,'utf8');
  const imports=Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],m[2]]));
  imports['./adventure-friend-bounds.json']={};
  const art=load(file,imports).BURROW_DAILY_ENTRY_ART;
  for(const [key,name] of [['napping','napping.webp'],['plus','plus.webp']]){
    const absolute=path.resolve(path.dirname(file),art[key]);
    assert.equal(path.basename(absolute),name);
    assert.ok(fs.readdirSync(path.dirname(absolute)).includes(name));
  }
});
test('napping stays over Home with a black scrim, exact copy, supplied icon and one OK dismissal',()=>{
  let closed=0;
  const {AdventureNappingDialog}=load('apps/mobile/src/components/burrow/adventure-napping-dialog.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'./burrow-image':{Image:'Image'},
    '@/lib/burrow-ui-assets':{BURROW_DAILY_ENTRY_ART:{napping:'napping.webp'}}});
  const tree=AdventureNappingDialog({onClose:()=>closed++}),all=nodes(tree);
  assert.equal(tree.type,'Modal');assert.equal(tree.props.transparent,true);assert.equal(tree.props.animationType,'fade');
  assert.match(text(tree),/Your bunny is officially napping/);assert.match(text(tree),/New adventure drops tomorrow!/);
  assert.ok(all.some(n=>n.props?.style?.backgroundColor==='#00000099'));
  assert.equal(all.find(n=>n.type==='Image').props.source,'napping.webp');
  all.find(n=>n.props?.accessibilityLabel==='OK').props.onPress();tree.props.onRequestClose();assert.equal(closed,2);
});
test('Free limit uses the heart background, supplied Plus icon, exact requested copy and existing paywall',()=>{
  const calls=[];
  const {AffectionLimitScreen}=load('apps/mobile/src/components/burrow/affection-limit-screen.tsx',{
    react:{useRef:value=>({current:value})},'react-native-svg':{default:'Svg',Path:'Path'},
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:r=>calls.push(r)},
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'expo-router':{router:{push:r=>calls.push(r),back:()=>calls.push('back')}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:'hearts.webp'}},
    '@/lib/burrow-ui-assets':{BURROW_DAILY_ENTRY_ART:{plus:'plus.webp'}},'./burrow-image':{Image:'Image'},
    './burrow-back-button':{BurrowBackButton:'Back'}});
  const tree=AffectionLimitScreen({unreadCount:2,onInbox:()=>calls.push('inbox')}),all=nodes(tree);
  assert.match(text(tree),/Want to send more\?/);
  assert.match(text(tree),/Plus gives you 6x more love every day, for both of you\./);
  assert.ok(all.some(n=>n.props?.style?.some?.(s=>s.backgroundColor==='#f9f2e5')),'opaque reference card');
  assert.ok(all.some(n=>n.type==='Image'&&n.props.source==='hearts.webp'));
  assert.ok(all.some(n=>n.type==='Image'&&n.props.source==='plus.webp'));
  all.find(n=>n.props?.accessibilityLabel==='Try Plus').props.onPress();
  all.find(n=>n.props?.accessibilityLabel==='2 unread affection').props.onPress();
  all.find(n=>n.type==='Back').props.onPress();
  assert.deepEqual(calls,['/(main)/(modals)/subscription-paywall','inbox','back']);
});
test('Plus limit uses the requested pink-heart card and OK exits Affection to Home only once',()=>{
  const calls=[];
  const {AffectionLimitScreen}=load('apps/mobile/src/components/burrow/affection-limit-screen.tsx',{
    react:{useRef:value=>({current:value})},'react-native-svg':{default:'Svg',Path:'Path'},
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:r=>calls.push(r)},
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'expo-router':{router:{push:r=>calls.push(r),back:()=>calls.push('back')}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:'hearts.webp'}},
    '@/lib/burrow-ui-assets':{BURROW_DAILY_ENTRY_ART:{plus:'plus.webp'}},'./burrow-image':{Image:'Image'},
    './burrow-back-button':{BurrowBackButton:'Back'}});
  const tree=AffectionLimitScreen({hasPlus:true}),all=nodes(tree);
  assert.match(text(tree),/That’s a lot of love today/);
  assert.match(text(tree),/You’ve sent all 6 for today\. Come back tomorrow to send more\./);
  assert.ok(all.some(n=>n.type==='Path'&&n.props.fill==='#F36A91'));
  assert.equal(all.some(n=>n.type==='Image'&&n.props.source==='plus.webp'),false);
  assert.equal(all.some(n=>n.props?.accessibilityLabel==='Try Plus'),false);
  const button=all.find(n=>n.props?.accessibilityLabel==='OK');button.props.onPress();button.props.onPress();
  assert.deepEqual(calls,['/(main)/(tabs)']);
});
test('cached affection hub immediately shows the Free limit, preserves inbox, and removes the old cooldown alert',()=>{
  const h=hooks();let current={...data(),affectionInbox:[]},opened=0,focused=false;
  const {AffectionHub}=load('apps/mobile/src/components/burrow/affection-hub.tsx',{
    './affection-heart-burst':{AffectionHeartBurst:'AffectionHeartBurst',AFFECTION_BURST_DURATION:960},
    '@/lib/partner-pairing':{requirePartner:()=>false},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...native,AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
    '@react-navigation/native':{useIsFocused:()=>focused},'expo-router':{router:{push:()=>opened++}},
    '@/lib/burrow-attention':{useBurrowAttention:()=>({affection:0})},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},'./burrow-image':{Image:'Image'},
    '@/lib/burrow-daily-entry':model,'@/lib/app-major-update-api':{},'@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:'hearts'}},
    '@/lib/burrow-store':{burrowClock:()=>100,useBurrowSnapshot:()=>({receivedAt:100})},
    '@/lib/burrow-ui-assets':{BURROW_AFFECTION_ICONS:{}},'@/lib/haptics':{},'./affection-gesture':{AFFECTION_COPY:Object.fromEntries(['hug','kiss','miss_you','cuddle','gratitude','spicy'].map(t=>[t,{label:t}]))},
    './burrow-back-button':{BurrowBackButton:'Back'},'./affection-limit-screen':{AffectionLimitScreen:'FreeLimit'}});
  const render=()=>h.render(()=>AffectionHub({data:current,loading:false,initialInbox:true}));
  assert.ok(nodes(render()).some(n=>n.type==='FreeLimit'));assert.equal(opened,0);
  current={...current,affectionInbox:[{id:'one',affection_type:'hug'}]};render();
  assert.equal(nodes(render()).find(n=>n.type?.name==='ReceiveModal').props.visible,false,'preload never presents a native modal');
  focused=true;assert.equal(nodes(render()).find(n=>n.type?.name==='ReceiveModal').props.visible,true,'actual entry preserves the unread inbox flow');
  current={...current,hasPlus:true};assert.ok(!nodes(render()).some(n=>n.type==='FreeLimit'));
  const hub=fs.readFileSync('apps/mobile/src/components/burrow/affection-hub.tsx','utf8');
  assert.doesNotMatch(hub,/affectionCooldownRemainingMs|Next free affection|A little pause/);
  h.unmount();
});
test('Home intercepts completed Adventure before navigating; native Affection transition matches its pink background',()=>{
  const home=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(home,/onAdventure=\{\(\)=>\{\s*const latest=getBurrowSnapshot\(\)/);
  assert.match(home,/adventureEntryState\(latest.data,at,readAdventureDeliveryRows\(\)\).kind==='napping'/);
  assert.match(home,/registerOverlay/);assert.match(home,/modalOpen=.*nappingOpen/);
  const options=load('apps/mobile/src/lib/main-navigation-options.ts',{'./page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts')});
  assert.equal(options.burrowDetailOptions({section:'affection'}).contentStyle.backgroundColor,'#EF8392');
});

function detailHarness(initial,{canGoBack=true,autoConfirm=true}={}) {
  const h=hooks(),ratings=[],navigation=[],listeners=new Set();let current=initial,sends=0,confirmed=0,failed=false;
  const settle=(error,overrides={})=>{
    if(!error){confirmed++;current={...current,lastAffectionAt:current.serverNow};}
    const event={operation:{id:'complete_affection:ticket',owner:initial.profile.id,...overrides},...(error?{error}:{receipt:{}})};
    for(const fn of listeners)fn(event);
  };
  const {AffectionDetailScreen}=load('apps/mobile/src/components/burrow/affection-detail-screen.tsx',{
    ...require('./rating-test-mocks.cjs'),
    '@/lib/official-rating-milestones':{recordRatingMilestone:(...args)=>ratings.push(args),registerInlineAffectionRating:()=>()=>{}},
    '@/lib/overlay-presence':{registerOverlay:()=>()=>{}},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    'expo-crypto':{randomUUID:()=> 'ticket'},
    'expo-router':{router:{canGoBack:()=>canGoBack,back(){navigation.push('back');},replace:path=>navigation.push(path)}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    '@expo/vector-icons':{Feather:'Icon'},'./burrow-image':{Image:'Image'},
    '@/lib/app-major-update-api':{completeAffection:async()=>{sends++;if(failed)throw Error('offline');}},
    '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:'hearts'}},
    '@/lib/burrow-daily-entry':model,'./affection-limit-screen':{AffectionLimitScreen:'FreeLimit'},
    '@/lib/burrow-store':{useBurrow:()=>({data:current,receivedAt:100}),burrowClock:()=>100,
      getBurrowSnapshot:()=>({data:current,receivedAt:100,error:'offline'}),burrowErrorMessage:x=>x,
      enqueueBurrowAffection:()=>{sends++;if(failed)throw Error('intent_not_saved');
        if(autoConfirm)Promise.resolve().then(()=>settle());return 'complete_affection:ticket';}},
    '@/lib/coin-command-outbox':{coinOperations:{subscribeSettled:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}},
    './affection-delivery':{AffectionDelivery:'Delivery'},'./affection-gesture':{AFFECTION_COPY:{hug:{pageTitle:'Hug'}},AffectionGesture:'Gesture'},
    './burrow-back-button':{BurrowBackButton:'Back'},'@/lib/coin-reward-store':{releaseCoinReward(){}},
    '@/lib/use-page-back-gesture':{usePageBackGesture(){}}});
  return {render:()=>h.render(()=>AffectionDetailScreen({type:'hug'})),unmount:h.unmount,
    ratings,navigation,settle,change:value=>{current=value;},fail:()=>{failed=true;},sends:()=>sends,confirmed:()=>confirmed};
}
for(const canGoBack of [true,false])test(`Affection Sent Done exits once without re-sending, including no-stack entry (${canGoBack})`,async()=>{
 const h=detailHarness({...data(),lastAffectionAt:null},{canGoBack});
 nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete({durationMs:3000});await flush();
 nodes(h.render()).find(n=>n.type==='Delivery').props.onTransitEnd();h.render();
 const gesture=nodes(h.render()).find(n=>n.type==='Gesture');assert.equal(gesture.props.status,'sent');
 gesture.props.onDone();gesture.props.onDone();assert.deepEqual(h.navigation,[canGoBack?'back':'/(main)/(tabs)/love']);
 assert.equal(h.sends(),1);h.unmount();
});
test('direct Affection links respect the daily gate without sending; successful first delivery keeps its Sent screen',async()=>{
  const blocked=detailHarness(data());assert.equal(blocked.render().type,'FreeLimit');assert.equal(blocked.sends(),0);blocked.unmount();
  const h=detailHarness({...data(),lastAffectionAt:null});
  nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete({durationMs:3000});await flush();
  assert.equal(h.sends(),1);assert.equal(h.confirmed(),1);
  let tree=h.render();assert.notEqual(tree.type,'FreeLimit');
  assert.equal(h.ratings.length,0,'server success alone cannot interrupt the delivery animation');
  nodes(tree).find(n=>n.type==='Delivery').props.onTransitEnd();h.render();tree=h.render();
  assert.equal(nodes(tree).find(n=>n.type==='Gesture').props.status,'sent');
  assert.equal(h.ratings.length,1);assert.equal(h.ratings[0][1],'affection');assert.equal(h.ratings[0][2],'ticket');
  h.render();assert.equal(h.ratings.length,1);h.unmount();
});
test('failed Affection does not consume the Free entry or persist a completion',async()=>{
  const h=detailHarness({...data(),lastAffectionAt:null});h.fail();
  nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete({durationMs:3000});await flush();
  assert.equal(h.sends(),1);assert.equal(h.confirmed(),0);assert.notEqual(h.render().type,'FreeLimit');
  nodes(h.render()).find(n=>n.type==='Delivery').props.onTransitEnd();h.render();assert.equal(h.ratings.length,0);h.unmount();
});

test('a durable Affection enters Sent when the flight ends, without a network receipt',()=>{
 const h=detailHarness({...data(),lastAffectionAt:null},{autoConfirm:false});
 const complete=nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete;
 complete({durationMs:3000});complete({durationMs:3000});assert.equal(h.sends(),1);
 let tree=h.render();assert.equal(nodes(tree).find(n=>n.type==='Gesture').props.status,'sending');
 nodes(tree).find(n=>n.type==='Delivery').props.onTransitEnd();h.render();tree=h.render();
 assert.equal(nodes(tree).find(n=>n.type==='Gesture').props.status,'sent');assert.equal(h.ratings.length,0);
 complete({durationMs:3000});assert.equal(h.sends(),1,'Sent cannot enqueue again');
 h.settle();h.render();h.render();assert.equal(h.ratings.length,1,'late verified success counts once');h.unmount();
});
test('late definitive rejection corrects Sent, but unrelated receipts never change the current send',()=>{
 const h=detailHarness({...data(),hasPlus:true,lastAffectionAt:null},{autoConfirm:false});
 nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete({durationMs:3000});
 nodes(h.render()).find(n=>n.type==='Delivery').props.onTransitEnd();h.render();h.render();
 h.settle(Error('invalid_request'),{id:'another-send'});assert.ok(nodes(h.render()).some(n=>n.type==='Gesture'&&n.props.status==='sent'));
 h.settle(Error('invalid_request'));h.render();assert.match(text(h.render()),/Not sent yet/);assert.equal(h.ratings.length,0);h.unmount();
});
test('pair changes invalidate the old send rather than showing it as delivered to the new partner',()=>{
 const h=detailHarness({...data(),partner:{id:'B'},hasPlus:true,lastAffectionAt:null},{autoConfirm:false});
 nodes(h.render()).find(n=>n.type==='Gesture').props.onComplete({durationMs:3000});
 h.change({...data(),partner:{id:'C'},hasPlus:true,lastAffectionAt:null});h.render();
 assert.match(text(h.render()),/Your connection has changed/);h.settle();
 assert.match(text(h.render()),/Your connection has changed/);assert.equal(h.ratings.length,0);h.unmount();
});
