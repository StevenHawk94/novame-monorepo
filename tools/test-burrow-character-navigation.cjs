const { test }=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const engine=load('packages/engine/src/burrow.ts',{'@novame/domain':{SPECIAL_QUEST_STEPS:{}}});
const presentation=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':engine});
const {createAdventureArrival,adventureHasArrived,adventureIsAway,adventureNeedsCompletion,roomSlots,roomNeedDisplay,careProgress}=presentation;
const adventure=(status='in_progress',id='a')=>({id,status,started_at:'2026-09-27T00:00:00Z',ends_at:'2026-09-27T08:00:00Z'});
const snapshot=(status='in_progress')=>({profile:{id:'me'},activeAdventure:adventure(status)});
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

function gateHarness() {
  const h=hooks(),resumes=[],timers=new Map();let appListener,nextTimer=0,refreshes=0;
  const state={enabled:true,data:{...snapshot(),serverNow:'2026-09-27T00:00:00Z'},loading:false,error:null,busy:false,receivedAt:0,
    segments:['(main)','(tabs)'],params:{},pending:false,overlay:false,settling:false,pushes:[]};
  const {AdventureArrivalGate}=load('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx',{
    react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:(_e,fn)=>{appListener=fn;return {remove(){appListener=null;}};}}},
    'expo-router':{useSegments:()=>state.segments,useGlobalSearchParams:()=>state.params,router:{push:x=>state.pushes.push(x)}},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>state.enabled},
    '@/lib/adventure-delivery':{resumeAdventureDelivery:async()=>{},pauseAdventureDelivery(){}},
    '@/lib/adventure-prefetch':{warmAdventureCompletion:async()=>{}},
    '@/lib/adventure-journal-jobs':{pauseAdventureJournalJobs(){},resumeAdventureJournalJobs(){},restoreAdventureJournalProjection(){}},
    '@/lib/app-major-update-api':{fetchAdventureDisplay:()=>new Promise(()=>{}),settleAdventure:async()=>{}},
    '@/lib/burrow-store':{burrowClock:()=>0,getBurrowSnapshot:()=>state,useBurrowSnapshot:()=>state,
      projectBurrowAdventureArrival(){},cacheAdventureDisplay(){},
      refreshBurrowAfterCurrent:options=>{if(options?.silent){refreshes++;return Promise.resolve();}const request=deferred();resumes.push(request);return request.promise;}},
    '@/lib/burrow-presentation':presentation,'@/lib/session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity:()=>()=>{}},
    '@/lib/reflect-settlement-outbox':{hasActiveReflectSettlement:()=>state.settling},
    '@/lib/use-home-entry':{useHomeEntry:()=>({pending:state.pending})},'@/lib/overlay-presence':{useOverlayPresent:()=>state.overlay},
  },{setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  return {state,resumes,timers,refreshes:()=>refreshes,render:()=>h.render(AdventureArrivalGate),app:v=>appListener(v),unmount:()=>h.unmount()};
}
test('arrival gate refreshes on launch but never forces a result route over Home or an editor',async()=>{
  const g=gateHarness();g.render();assert.equal(g.resumes.length,1);
  g.state.data=snapshot('result_ready');g.render();assert.equal(g.state.pushes.length,0,'old in-flight response cannot bypass resume refresh');
  g.state.overlay=true;g.resumes[0].resolve();await flush();g.render();assert.equal(g.state.pushes.length,0);
  g.state.overlay=false;g.state.pending=true;g.render();assert.equal(g.state.pushes.length,0);
  g.state.pending=false;g.state.segments=['(main)','reflect-typing'];g.render();assert.equal(g.state.pushes.length,0);
  g.state.segments=['(main)','(tabs)'];g.state.settling=true;g.render();assert.equal(g.state.pushes.length,0);
  g.state.settling=false;g.state.busy=true;g.render();assert.equal(g.state.pushes.length,0);
  g.state.busy=false;g.render();assert.equal(g.state.pushes.length,0);g.render();assert.equal(g.state.pushes.length,0);g.unmount();
});
test('deadline and background resume refresh badges without navigation; inactive dialogs do not refresh',async()=>{
  const g=gateHarness();g.render();g.state.data={...g.state.data};g.resumes[0].resolve();await flush();g.render();
  const timer=[...g.timers.values()][0];assert.equal(timer.ms,28800000);timer.fn();await flush();assert.equal(g.refreshes(),1);
  g.state.data=snapshot('result_ready');g.render();assert.equal(g.state.pushes.length,0);
  g.app('inactive');g.render();g.app('active');g.render();assert.equal(g.resumes.length,1);
  g.app('background');g.render();g.app('active');g.render();assert.equal(g.resumes.length,2);
  g.state.data=snapshot('result_ready');g.resumes[1].resolve();await flush();g.render();assert.equal(g.state.pushes.length,0);g.unmount();
});
test('arrival gate does not duplicate an open result route, or navigate after unmount',async()=>{
  const g=gateHarness();g.render();g.state.segments=['(main)','burrow-detail'];g.state.params={section:'adventure'};
  g.state.data=snapshot('result_ready');g.resumes[0].resolve();await flush();g.render();
  g.state.segments=['(main)','(tabs)'];g.render();assert.equal(g.state.pushes.length,0);
  g.app('background');g.app('active');g.unmount();g.resumes[1].resolve();await flush();assert.equal(g.state.pushes.length,0);
});

test('cold/resume ready result waits for safe navigation and is consumed only once',()=>{
  const c=createAdventureArrival();c.observe(snapshot('result_ready'),true);
  assert.equal(c.take(false,false),null);assert.equal(c.take(true,false),'a');assert.equal(c.take(true,false),null);
});
test('foreground deadline lights readiness without generating auto-open intent',()=>{
  const c=createAdventureArrival();c.observe(snapshot(),true);c.observe(snapshot('result_ready'),true);
  assert.equal(c.take(true,false),null);
  assert.equal(adventureHasArrived(adventure(),Date.parse('2026-09-27T08:00:00Z')),true);
  assert.equal(adventureIsAway(adventure(),Date.parse('2026-09-27T07:59:59Z')),true);
  assert.equal(adventureIsAway(adventure('result_ready'),0),false);
});
test('resume ignores stale cached result and errors, retries when fresh data arrives',()=>{
  const c=createAdventureArrival(),cached=snapshot('result_ready');c.resume(cached);
  c.observe(cached,true);assert.equal(c.take(true,false),null);
  c.observe(snapshot('result_ready'),false);assert.equal(c.take(true,false),null);
  c.observe(snapshot('result_ready'),true);assert.equal(c.take(true,false),'a');
});
test('already open result, changed adventure, and sign-out discard deferred intent',()=>{
  const c=createAdventureArrival();c.observe(snapshot('interaction_required'),true);
  assert.equal(c.take(false,true),null);assert.equal(c.take(true,false),null);
  c.resume(null);c.observe(snapshot('result_ready'),true);c.observe({activeAdventure:null},true);assert.equal(c.take(true,false),null);
  c.resume(null);c.observe(snapshot('result_ready'),true);c.reset();assert.equal(c.take(true,false),null);
  assert.equal(adventureNeedsCompletion(adventure('interaction_required')),true);
  assert.equal(adventureNeedsCompletion(adventure('completed')),false);
});
const item=(id,type,slot,starter=false)=>({stable_id:id,item_type:type,metadata:{slot,starter},asset:{},title:id});
test('legacy shared furniture is never adopted by either personal room; outfits stay owner-scoped',()=>{
  const data={profile:{id:'me'},partner:{id:'partner'},catalog:[item('starter','outfit','outfit',true),item('mine','outfit','outfit'),item('theirs','outfit','outfit'),item('lamp-default','decor','lamp',true),item('lamp-shared','decor','lamp')],
    loadouts:[{owner_id:'me',room_type:'home',slot:'outfit',item_id:'mine'},{owner_id:'partner',room_type:'home',slot:'outfit',item_id:'theirs'},{room_type:'our',slot:'lamp',item_id:'lamp-shared'}]};
  assert.equal(roomSlots(data,'me').outfit.stable_id,'mine');assert.equal(roomSlots(data,'partner').outfit.stable_id,'theirs');
  assert.equal(roomSlots(data,'new-owner').outfit.stable_id,'starter');
  assert.equal(roomSlots(data,'me').lamp.stable_id,'lamp-default');assert.equal(roomSlots(data,'partner').lamp.stable_id,'lamp-default');
  data.loadouts.push({owner_id:'me',room_type:'home',slot:'lamp',item_id:'lamp-shared'});
  assert.equal(roomSlots(data,'me').lamp.stable_id,'lamp-shared');assert.equal(roomSlots(data,'partner').lamp.stable_id,'lamp-default');
});
test('need values use raw bases without double-decay, exact five-minute boundaries, no negative values',()=>{
  const t=Date.parse('2026-09-27T00:00:00Z');
  const data={serverNow:new Date(t+600000).toISOString(),roomNeeds:{food:98,foodValue:100,foodUpdatedAt:new Date(t).toISOString(),water:0,waterValue:1,waterUpdatedAt:new Date(t).toISOString()},
    partnerNeeds:{food:50,water:50}};
  assert.equal(roomNeedDisplay(data,false,t+899999).food,98);assert.equal(roomNeedDisplay(data,false,t+900000).food,97);
  assert.equal(roomNeedDisplay(data,false,t+900000).water,0);assert.equal(roomNeedDisplay(data,true,t+900000).food,49);
  delete data.roomNeeds.foodValue;assert.equal(roomNeedDisplay(data,false,t+600000).food,98,'pre-migration snapshot is not decayed twice');
  assert.equal(careProgress(null,'food',t),null,'a stale care sheet cannot read a cleared bootstrap');
  assert.equal(careProgress(data,null,t),null);
  assert.equal(careProgress(data,'food',t+600000),98);
});
function actorHarness() {
  const h=hooks();
  const component=load('apps/mobile/src/components/burrow/bunny-actor.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',StyleSheet:{create:x=>x}},
    './outfit-bunny':{OutfitBunny:'OutfitBunny'},
  });
  return {...component,render:props=>h.render(()=>component.BunnyActor(props)),unmount:()=>h.unmount()};
}
test('real outfit boundary replaces SVG placeholders and only animates supplied idle pose',()=>{
  const h=actorHarness(),outfit={title:'Rain',asset:{outfitKey:'13_black_sweater_vest'}};
  const idle=h.render({outfit,pose:'idle'});
  assert.equal(idle.props.children.type,'OutfitBunny');
  assert.equal(idle.props.children.props.outfit,outfit);
  assert.equal(idle.props.children.props.animated,true);
  assert.equal(h.render({outfit,pose:'sleeping'}).props.children.props.animated,false);
});
test('bunny poses retain accessible outfit labels and away hides the figure',()=>{
  const h=actorHarness(),outfit={title:'Office Cozy',asset:{outfitKey:'13_black_sweater_vest'}};
  assert.match(h.render({outfit,pose:'sleeping'}).props.accessibilityLabel,/Office Cozy, sleeping/);
  assert.match(h.render({outfit,pose:'digging'}).props.accessibilityLabel,/digging/);
  assert.equal(h.render({outfit,pose:'away'}),null);h.unmount();
});
test('room render forwards independent sleep/outfit state and blocks food taps when full or busy',()=>{
  const {RoomScene}=load('apps/mobile/src/components/burrow/room-scene.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    'react-native-svg':Object.fromEntries(['default','Path','Rect','Circle','Ellipse','Line','G'].map(n=>[n,n])),
    './room-photo':{RoomPhoto:'RoomPhoto'},'./bunny-actor':{BunnyActor:'BunnyActor'},
    '@/lib/burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
  });
  const mine=item('mine','outfit','outfit'),partner=item('partner','outfit','outfit');
  const tree=RoomScene({slots:{outfit:mine},shared:true,sleeping:{mine:true,partner:false},partnerOutfit:partner,onSlot(){}});
  const actors=nodes(tree).filter(n=>n.type==='BunnyActor');
  assert.equal(actors[0].props.pose,'sleeping');assert.equal(actors[1].props.pose,'idle');assert.equal(actors[1].props.outfit,partner);
  const full=RoomScene({slots:{outfit:mine},canFeed:false,onSlot(){}});
  assert.equal(nodes(full).find(n=>n.type==='Pressable').props.disabled,true);
  const away=RoomScene({slots:{outfit:mine},away:true,onSlot(){}});
  assert.equal(nodes(away).filter(n=>n.type==='Pressable').length,0);
});
test('parent detail route does not install a competing navigation guard; the mounted settlement owns its narrow lock',()=>{
  let data={activeAdventure:adventure('result_ready')},enabled=true,error=null,blocked,busy=false;
  const Detail=load('apps/mobile/app/(main)/burrow-detail.tsx',{
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:()=>{}},
    react:{useCallback:f=>f},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Alert:{alert(){}}},
    'expo-router':{Redirect:'Redirect',useLocalSearchParams:()=>({section:'adventure'})},
    '@react-navigation/native':{useIsFocused:()=>true,usePreventRemove:value=>blocked=value},'@novame/domain':{SHOP_CATEGORIES:['outfits']},
    '@/components/burrow/burrow-screen':{BurrowScreen:'BurrowScreen'},'@/components/burrow/game-room-screen':{GameRoomScreen:'GameRoomScreen'},'@/lib/use-major-update':{useMajorUpdateEnabled:()=>enabled},
    '@/components/burrow/couple-journal-screen':{CoupleJournalScreen:'CoupleJournalScreen'},
    '@/lib/burrow-store':{useBurrowSelector:selector=>selector({data:{profile:{id:'me'},...data},busy,error})},'@/lib/burrow-presentation':presentation,
  }).default;
  Detail();assert.equal(blocked,undefined);data={activeAdventure:adventure('interaction_required')};Detail();assert.equal(blocked,undefined);
  busy=true;Detail();assert.equal(blocked,undefined);busy=false;
  data={activeAdventure:null};Detail();assert.equal(blocked,undefined);
  data={activeAdventure:adventure('result_ready')};error='not_paired';Detail();assert.equal(blocked,undefined);
  error=null;enabled=false;Detail();assert.equal(blocked,undefined);
});
