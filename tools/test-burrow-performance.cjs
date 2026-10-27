const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {load,hooks,clock,flush}=require('./lifecycle-test-utils.cjs');
const base=()=>({profile:{id:'me'},partner:{id:'partner'},pairVersion:'v1',serverNow:'2026-10-11T10:00:00Z',
  wallet:{balance:20,version:1},catalog:[{stable_id:'lamp',metadata:{slot:'lamp'},price:200}],
  inventory:[],loadouts:[],roomPhotos:[],memoryEntries:[],moments:[],gifts:[],affectionInbox:[]});
function harness({cached}={}) {
  const h=hooks(),time=clock(),writes=[],jobs=[];
  let focused=true,epoch=1,balance=null,value=base(),identity;
  const api=load('apps/mobile/src/lib/burrow-store.ts',{'./adventure-arrival':load('apps/mobile/src/lib/adventure-arrival.ts'),
    react:{...h.react,useSyncExternalStore:(_subscribe,get)=>get()},
    '@react-navigation/native':{useIsFocused:()=>focused},
    'expo-router':{useFocusEffect:callback=>h.react.useEffect(()=>focused?callback():undefined,[focused,callback])},
    'react-native':{AppState:{currentState:'active'},InteractionManager:{runAfterInteractions(fn){const job={fn,cancelled:false,cancel(){this.cancelled=true;}};jobs.push(job);return job;}}},
    'expo-crypto':{randomUUID:()=> 'receipt'},
    './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'me',subscribeSessionIdentity:fn=>{identity=fn;}},
    './app-major-update-api':{fetchMajorUpdateBootstrap:async()=>value},
    './async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts',{},time.globals),
    './burrow-cache':{persistBurrowSnapshot:data=>writes.push(data),readBurrowSnapshot:()=>cached??null,readBurrowActionKeys:()=>[],persistBurrowActionKeys(){},clearBurrowSnapshot(){}},
    './coin-reward-store':{syncCoinWallet(){},useCoinBalance:()=>balance,setCoinRewardReconciler(){},subscribeCoinWallet(){},getConfirmedCoinWallet:()=>null},
  },{...time.globals,performance:{now:()=>time.globals.Date.now()}});
  return {api,jobs,writes,time,render:(backgroundRoom=false)=>h.render(()=>api.useBurrow(backgroundRoom)),setValue:next=>value=next,setBalance:next=>balance=next,
    focus:next=>focused=next,identity(){epoch++;identity();},unmount:h.unmount};
}
test('silent reads structurally reuse catalogue/collection rows; only changed branches invalidate',async()=>{
  const h=harness();await h.api.refreshBurrow();const before=h.api.getBurrowSnapshot().data;
  const next=base();next.serverNow='2026-10-11T10:01:00Z';next.inventory=[{owner_id:'me',item_id:'lamp'}];
  h.setValue(next);await h.api.refreshBurrow({silent:true});const after=h.api.getBurrowSnapshot().data;
  assert.equal(after.catalog,before.catalog);assert.equal(after.loadouts,before.loadouts);assert.equal(after.moments,before.moments);
  assert.notEqual(after.inventory,before.inventory);assert.equal(after.inventory.length,1);
  assert.equal(h.api.shareBurrowSnapshot(after,structuredClone(after)),after);
});
test('handled care denials reconcile silently without leaking a global error, while network failures stay retryable',async()=>{
 const h=harness();await h.api.refreshBurrow();const handled=[];
 for(const code of ['already_full','care_cooldown']){
  const error={body:{error:code}};
  assert.equal(await h.api.runBurrowAction('food:me',async()=>{throw error;},{silent:true,expectedErrors:['already_full','care_cooldown'],onError:failure=>handled.push(failure)}),false);
  assert.equal(h.api.getBurrowSnapshot().error,null);
 }
 assert.equal(handled.length,2);
 assert.equal(await h.api.runBurrowAction('food:me',async()=>{throw Error('offline');},{silent:true,expectedErrors:['already_full','care_cooldown']}),false);
 assert.equal(h.api.getBurrowSnapshot().error,'network_error');h.identity();h.unmount();
});
test('a confirmed daily Plus receipt survives stale reads, remains personal and resets on the next server day',async()=>{
  const h=harness(),initial=base();initial.localDate='2026-10-12';initial.dailyPlusBonus={eligible:true,claimed:false,amount:50,localDate:'2026-10-12',key:'plus-login:2026-10-12'};
  h.setValue(initial);await h.api.refreshBurrow();
  h.api.confirmDailyPlusBonusLocally('someone-else',{...initial.dailyPlusBonus,claimed:true});assert.equal(h.api.getBurrowSnapshot().data.dailyPlusBonus.claimed,false);
  h.api.confirmDailyPlusBonusLocally('me',{...initial.dailyPlusBonus,claimed:true});assert.equal(h.api.getBurrowSnapshot().data.dailyPlusBonus.claimed,true);
  h.setValue(structuredClone(initial));await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.dailyPlusBonus.claimed,true);
  const next=structuredClone(initial);next.localDate='2026-10-13';next.dailyPlusBonus.localDate=next.localDate;next.dailyPlusBonus.key='plus-login:'+next.localDate;
  h.setValue(next);await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.dailyPlusBonus.claimed,false);
  h.identity();assert.equal(h.api.getBurrowSnapshot().data,null);h.unmount();
});
test('retained hidden page keeps its snapshot and gets current cached data immediately on focus',async()=>{
  const h=harness();await h.api.refreshBurrow();const first=h.render();assert.equal(h.render(),first);
  h.focus(false);h.render();const next=base();next.wallet.balance=45;h.setValue(next);await h.api.refreshBurrow({silent:true});
  assert.equal(h.render(),first);h.focus(true);const current=h.render();assert.equal(current.data.wallet.balance,45);assert.notEqual(current,first);
  h.setBalance(50);const wallet=h.render();assert.equal(wallet.data.wallet.balance,50);assert.equal(h.render(),wallet);
  h.unmount();
});
test('hidden Home receives changed furniture before navigation, but does not rerender for wallet/busy-only sync',async()=>{
 const h=harness();await h.api.refreshBurrow();const first=h.render(true);h.focus(false);h.render(true);
 const coins=base();coins.wallet.balance=45;h.setValue(coins);await h.api.refreshBurrow({silent:true});
 assert.equal(h.render(true),first);
 const room=base();room.loadouts=[{room_type:'home',owner_id:'me',slot:'lamp',item_id:'lamp'}];h.setValue(room);await h.api.refreshBurrow({silent:true});
 const ready=h.render(true);assert.equal(ready.data.loadouts[0].item_id,'lamp');assert.notEqual(ready,first);h.unmount();
});
test('background cache serialization waits for idle, uses latest receipt and is cancelled on identity change',async()=>{
  const h=harness();await h.api.refreshBurrow();assert.equal(h.writes.length,0);
  h.api.confirmBurrowPurchaseLocally('lamp','me','purchase');assert.equal(h.writes.length,1);
  h.jobs[0].fn();assert.equal(h.writes[1].inventory[0].item_id,'lamp');
  await h.api.refreshBurrow({silent:true});h.identity();assert.equal(h.jobs[1].cancelled,true);
  h.jobs[1].fn();assert.equal(h.writes.length,2);
});

test('locally acknowledged Save/Start survive silent stale reads until the real journey arrives',async()=>{
  const h=harness();const initial=base();initial.localDate='2026-10-12';initial.readyRecordId=null;initial.activeAdventure=null;
  h.setValue(initial);await h.api.refreshBurrow();
  h.api.projectAdventureJournalLocally({owner:'me',scope:'me:partner:v1',localDate:'2026-10-12',recordId:'pending:job'});
  assert.equal(h.api.getBurrowSnapshot().data.readyRecordId,'pending:job');
  await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.readyRecordId,'pending:job');
  h.api.projectAdventureJournalLocally({owner:'me',scope:'me:partner:v1',localDate:'2026-10-12',recordId:'pending:job',startedAt:initial.serverNow});
  await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'in_progress');
  const next={...initial,activeAdventure:{id:'real',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:01:00Z'}};
  h.setValue(next);await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.id,'real');
  h.identity();assert.equal(h.api.getBurrowSnapshot().data,null);h.unmount();
});
test('an elapsed frozen journey can display its treasure without awarding inventory or changing other routes',async()=>{
  const h=harness(),initial=base();initial.activeAdventure={id:'real',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:00:01Z'};
  initial.adventureResult={id:'result',metadata:{encounterV2:true}};h.setValue(initial);await h.api.refreshBurrow();
  h.api.projectBurrowAdventureArrival('real');assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'in_progress');
  h.time.advance(1000);h.api.projectBurrowAdventureArrival('real');assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'result_ready');
  assert.equal(h.api.getBurrowSnapshot().data.inventory.length,0);h.unmount();
});
test('arrival uses the running plan synchronously, survives stale refreshes and preserves confirmed chest progress',async()=>{
  const h=harness(),initial=base();initial.activeAdventure={id:'real',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:00:01Z'};
  initial.adventureResult=null;initial.adventurePlan={adventureId:'real',version:'1',readAt:initial.serverNow,
    result:{id:'plan:1',claim_status:'pending',metadata:{encounterV2:true,treasureReserved:true,treasureSnapshot:{stable_id:'chair'}}}};
  h.setValue(initial);await h.api.refreshBurrow();assert.equal(h.api.getBurrowSnapshot().data.adventureResult,null);
  h.time.advance(1000);h.api.projectBurrowAdventureArrival('real');
  assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'result_ready');
  assert.equal(h.api.getBurrowSnapshot().data.adventureResult.metadata.treasureSnapshot.stable_id,'chair');
  assert.equal(h.api.getBurrowSnapshot().data.inventory.length,0);
  const stale=structuredClone(initial);delete stale.adventurePlan;h.setValue(stale);await h.api.refreshBurrow({silent:true});
  assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'result_ready');
  assert.equal(h.api.getBurrowSnapshot().data.adventurePlan.version,'1');
  h.api.confirmBurrowAdventureInteractionLocally('real',true);
  assert.equal(h.api.getBurrowSnapshot().data.adventureResult.metadata.treasureClaimed,true);
  await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.status,'interaction_required');
  assert.equal(h.api.getBurrowSnapshot().data.adventureResult.metadata.treasureClaimed,true);
  h.unmount();
});
test('the start display receipt is scope-checked and immediately cached without a full bootstrap',async()=>{
 const h=harness(),initial=base();initial.activeAdventure={id:'pending:job',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:01:00Z'};
 h.setValue(initial);await h.api.refreshBurrow();
 const display={userId:'me',partnerId:'partner',pairVersion:'v1',serverNow:initial.serverNow,
  activeAdventure:{...initial.activeAdventure,id:'real'},adventureResult:null,adventurePlan:{adventureId:'real',version:'one',readAt:initial.serverNow,result:{id:'plan:1',metadata:{encounterV2:true}}}};
 for(const patch of [{userId:'other'},{partnerId:'ex'},{pairVersion:'old'}])h.api.cacheAdventureDisplay({...display,...patch});
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.id,'pending:job');
 h.api.cacheAdventureDisplay(display);assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.id,'real');
 assert.equal(h.api.getBurrowSnapshot().data.adventurePlan.version,'one');const received=h.api.getBurrowSnapshot().receivedAt;
 h.time.advance(1000);h.api.cacheAdventureDisplay(display);assert.equal(h.api.getBurrowSnapshot().receivedAt,received,'receipt replay must not restart the countdown');h.unmount();
});
for(const hasPlus of [false,true])test(`a minimal ${hasPlus?'Plus':'Free'} start receipt unlocks the production countdown without waiting for display/bootstrap or reentry`,async()=>{
 const duration=load('apps/mobile/src/lib/adventure-duration.ts').adventureDurationMs(hasPlus);
 const display=ms=>new Date(ms).toISOString().slice(11,19);
 const h=harness(),initial=base();initial.hasPlus=hasPlus;initial.localDate='2026-10-12';initial.activeAdventure=null;initial.specialQuests=[];
 const view=hooks(),jsx=(type,props,key)=>({type,props,key}),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 const screen=load('apps/mobile/src/components/burrow/adventure-progress-screen.tsx',{
  react:view.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:s=>s,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
  './adventure-digging-route':{AdventureDiggingRoute:'Route'},'./burrow-back-button':{BurrowBackButton:'Back'},
  '@/lib/adventure-screen-layout':load('apps/mobile/src/lib/adventure-screen-layout.ts'),'@/lib/adventure-trail':load('apps/mobile/src/lib/adventure-trail.ts'),
  '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>undefined,retryAdventureJournalJob(){}},
  '@/lib/burrow-store':{burrowClock:()=>h.api.burrowClock()},
 });
 const render=()=>{const s=h.api.getBurrowSnapshot();return nodes(view.render(()=>screen.AdventureProgressScreen({data:s.data,now:Date.parse(s.data.serverNow)+Math.max(0,h.api.burrowClock()-s.receivedAt),onHome(){}})));};
 h.setValue(initial);await h.api.refreshBurrow();
 const projection={owner:'me',scope:'me:partner:v1',localDate:initial.localDate,recordId:'record',startedAt:initial.serverNow};
 h.api.projectAdventureJournalLocally(projection);
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.localStartPending,true);
 const firstRoute=render().find(n=>n.type==='Route');assert.equal(firstRoute.props.pending,true);
 h.time.advance(2000);
 const optimistic=render().find(n=>n.type==='Route');assert.equal(optimistic.props.remaining,duration-2000,'must tick before any server receipt');
 const endsAt=new Date(Date.parse(initial.serverNow)+duration+2000).toISOString();
 h.api.projectAdventureJournalLocally({...projection,adventureId:'real',endsAt});
 const first=h.api.getBurrowSnapshot();assert.equal(first.data.activeAdventure.id,'real');
 assert.equal(first.data.activeAdventure.localStartPending,undefined,'accepted endsAt must not remain frozen behind a full bootstrap');
 let painted=render(),route=painted.find(n=>n.type==='Route');assert.equal(route.key,firstRoute.key);assert.equal(route.props.pending,false);
 assert.equal(route.props.remaining,optimistic.props.remaining,'confirmation must not add seconds back to the visible counter');
 const remaining=()=>Date.parse(h.api.getBurrowSnapshot().data.activeAdventure.ends_at)-(Date.parse(first.data.serverNow)+h.api.burrowClock()-first.receivedAt);
 assert.equal(remaining(),duration);h.time.advance(1000);assert.equal(remaining(),duration-1000);
 painted=render();assert.ok(painted.some(n=>n.type==='Text'&&n.props.children===display(duration-2000)),'same mounted page ticks during silent half-speed correction');
 h.time.advance(1000);painted=render();assert.ok(painted.some(n=>n.type==='Text'&&n.props.children===display(duration-3000)));
 h.api.projectAdventureJournalLocally({...projection,adventureId:'real',endsAt});
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.localStartPending,undefined);
 assert.equal(remaining(),duration-2000,'queue restoration must not restart the accepted deadline');
 h.setValue({...initial,serverNow:new Date(Date.parse(initial.serverNow)+3000).toISOString()});await h.api.refreshBurrow({silent:true});
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.localStartPending,undefined,'an eventually consistent empty read cannot re-freeze a confirmed start');view.unmount();h.unmount();
});
test('restoring an older persisted real-id pending projection clears it when its accepted deadline is known',async()=>{
 const h=harness(),initial=base();initial.localDate='2026-10-12';
 initial.activeAdventure={id:'real',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:01:00Z',localStartPending:true};
 h.setValue(initial);await h.api.refreshBurrow();
 h.api.projectAdventureJournalLocally({owner:'me',scope:'me:partner:v1',localDate:initial.localDate,recordId:'record',startedAt:initial.serverNow,adventureId:'real',endsAt:initial.activeAdventure.ends_at});
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.localStartPending,undefined);h.unmount();
});
test('replaying a start display without an optional reward plan cannot reset the countdown anchor',async()=>{
 const h=harness(),initial=base();initial.activeAdventure={id:'pending:job',status:'in_progress',started_at:initial.serverNow,ends_at:'2026-10-11T10:01:00Z',localStartPending:true};
 h.setValue(initial);await h.api.refreshBurrow();
 const display={userId:'me',partnerId:'partner',pairVersion:'v1',serverNow:initial.serverNow,activeAdventure:{id:'real',status:'in_progress',started_at:initial.serverNow,ends_at:initial.activeAdventure.ends_at},adventureResult:null,adventurePlan:null};
 h.api.cacheAdventureDisplay(display);const first=h.api.getBurrowSnapshot();
 h.time.advance(3000);h.api.cacheAdventureDisplay(display);
 assert.equal(h.api.getBurrowSnapshot().receivedAt,first.receivedAt,'optional plan failure must not allow receipt replay to freeze time');h.unmount();
});
test('a persisted plan restores after its deadline without a network read, reward grant or extra countdown',()=>{
 const data=base();data.activeAdventure={id:'real',status:'in_progress',started_at:data.serverNow,ends_at:'2026-10-11T10:00:01Z'};
 data.adventureResult=null;data.adventurePlan={adventureId:'real',version:'one',readAt:data.serverNow,result:{id:'plan:1',metadata:{encounterV2:true}}};
 const h=harness({cached:{data,savedAt:0}}),state=h.api.getBurrowSnapshot();
 assert.equal(state.data.activeAdventure.status,'result_ready');assert.equal(state.data.adventureResult.id,'plan:1');
 assert.equal(state.data.inventory.length,0);assert.equal(state.data.wallet.balance,20);h.unmount();
});
test('a late display response cannot revive an already claimed adventure',async()=>{
 const h=harness(),initial=base();initial.activeAdventure={id:'real',status:'result_ready',started_at:initial.serverNow,ends_at:initial.serverNow};
 h.setValue(initial);await h.api.refreshBurrow();h.api.confirmBurrowAdventureClaimLocally('real');
 h.api.cacheAdventureDisplay({userId:'me',partnerId:'partner',pairVersion:'v1',serverNow:initial.serverNow,activeAdventure:initial.activeAdventure,adventureResult:null,adventurePlan:null});
 assert.equal(h.api.getBurrowSnapshot().data.activeAdventure,null);h.unmount();
});
test('retained room navigation reuses tabs; gifts and media interactions remain stack routes',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='openBurrow');
  const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const calls=[],module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,uiWorkPriority:{action(){}},beginInteractionTiming(){},markInteractionTiming(){},cancelBurrowPageEntry(){},enterBurrowPage:(_entry,open)=>open(),burrowPageIsReady:()=>true,requirePartner:()=>false,dismissToRetainedTab:href=>calls.push(['reuse',href]),router:{navigate:href=>calls.push(['tab',href]),push:href=>calls.push(['push',href])}});
  for(const section of ['home','burrow','shop','collection','moments','quests'])module.exports.openBurrow(section);
  assert.equal(calls.length,6);assert.ok(calls.every(call=>call[0]==='tab'));
  for(const section of ['home','burrow','shop','collection','moments','quests'])module.exports.openBurrow(section,undefined,true);
  assert.ok(calls.slice(6).every(call=>call[0]==='reuse'));
  module.exports.openBurrow('shop',{giftTo:'partner'});module.exports.openBurrow('game_room');assert.ok(calls.slice(12).every(call=>call[0]==='push'));
  const bar=fs.readFileSync('apps/mobile/src/components/main/bottom-tab-bar.tsx','utf8');
  assert.ok(!bar.includes("router.push({ pathname: '/(main)/burrow-detail'"));
  assert.ok(bar.includes('CommonActions.navigate(route.name, route.params)'));
  for(const file of ['burrow','shop','collection'])assert.ok(fs.readFileSync(`apps/mobile/app/(main)/(tabs)/${file}.tsx`,'utf8').includes('<BurrowScreen'));
  assert.ok(fs.readFileSync('apps/mobile/app/(main)/(tabs)/_layout.tsx','utf8').includes('<RetainedTabs'));
});
