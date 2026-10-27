// Deterministic mobile state-boundary tests; not a substitute for device QA.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {clock}=require('./lifecycle-test-utils.cjs');
const root=path.resolve(__dirname,'..');
function load(file,imports={},globals={}){
  return require('./lifecycle-test-utils.cjs').load(file,imports,{setTimeout:()=>1,clearTimeout(){},...globals});
}
function harness(){
  const time=clock();
  let epoch=1,next=0,fetches=0,fetch=async()=>({profile:{id:'a'}});const identities=[];
  const api=load('apps/mobile/src/lib/burrow-store.ts',{'./adventure-arrival':load('apps/mobile/src/lib/adventure-arrival.ts'),
    react:{useCallback:f=>f,useRef:value=>({current:value}),useSyncExternalStore:(_,snapshot)=>snapshot()},
    '@react-navigation/native': {useIsFocused:()=>true},
    'expo-router':{useFocusEffect(){}},'react-native':{AppState:{}},
    'expo-crypto':{randomUUID:()=>`key-${++next}`},
    './app-major-update-api':{fetchMajorUpdateBootstrap:()=>{fetches++;return fetch();}},
    './async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts',{},time.globals),
    './coin-reward-store':{syncCoinWallet(){},setCoinRewardReconciler(){},subscribeCoinWallet(){},getConfirmedCoinWallet:()=>null,useCoinBalance:()=>null},
    './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'a',subscribeSessionIdentity:fn=>identities.push(fn)},
    './burrow-cache':{readBurrowSnapshot:()=>null,readBurrowActionKeys:()=>[],persistBurrowSnapshot(){},persistBurrowActionKeys(){},clearBurrowSnapshot(){}},
  },{...time.globals,performance:{now:()=>time.globals.Date.now()}});
  return {...api,snapshot:()=>api.useBurrow(),fetches:()=>fetches,setFetch:fn=>fetch=fn,
    advance:time.advance,
    signOut(){epoch++;identities.forEach(fn=>fn());}};
}
test('simultaneous screens share one in-flight bootstrap',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  const first=h.refreshBurrow(),second=h.refreshBurrow();assert.equal(first,second);assert.equal(h.fetches(),1);
  resolve({profile:{id:'a'}});await first;assert.equal(h.snapshot().data.profile.id,'a');assert.equal(h.snapshot().loading,false);
});
test('minimal receipt accepts the server deadline; display/bootstrap refines the start without duplicate launch',async()=>{
 const h=harness(),t=Date.parse('2026-10-18T00:00:00Z'),iso=ms=>new Date(t+ms).toISOString();
 const base={profile:{id:'a'},partner:null,pairVersion:null,localDate:'2026-10-18',serverNow:iso(0),activeAdventure:null,readyRecordId:'pending:job',catalog:[],inventory:[],loadouts:[],specialQuests:[],adventurePlan:null,adventureResult:null};
 h.setFetch(async()=>base);await h.refreshBurrow();
 const p={owner:'a',scope:'a:solo:',localDate:base.localDate,recordId:'pending:job',startedAt:iso(0)};
 h.projectAdventureJournalLocally(p);assert.equal(h.snapshot().data.activeAdventure.localStartPending,true);
 h.advance(3000);h.projectAdventureJournalLocally({...p,recordId:'record'});assert.equal(h.snapshot().data.activeAdventure.localStartPending,true);
 h.advance(2000);h.projectAdventureJournalLocally({...p,recordId:'record',adventureId:'real',endsAt:iso(65000)});
 let a=h.snapshot().data.activeAdventure;assert.equal(a.id,'real');assert.equal(a.localStartPending,undefined);assert.equal(a.started_at,iso(0));assert.equal(a.ends_at,iso(65000));
 const authoritative={id:'real',status:'in_progress',started_at:iso(5000),ends_at:iso(65000)};
 h.cacheAdventureDisplay({userId:'a',partnerId:null,pairVersion:null,serverNow:iso(5000),activeAdventure:authoritative,adventurePlan:null,adventureResult:null});
 a=h.snapshot().data.activeAdventure;assert.equal(a.localStartPending,undefined);assert.equal(a.started_at,iso(5000));assert.equal(a.ends_at,iso(65000));
 h.projectAdventureJournalLocally({...p,recordId:'record',adventureId:'real',endsAt:iso(65000)});
 assert.equal(h.snapshot().data.activeAdventure.started_at,iso(5000));assert.equal(h.snapshot().data.activeAdventure.localStartPending,undefined);
 h.setFetch(async()=>({...base,serverNow:iso(6000),activeAdventure:authoritative}));await h.refreshBurrow();
 assert.equal(h.snapshot().data.activeAdventure.localStartPending,undefined);assert.equal(h.snapshot().data.activeAdventure.started_at,iso(5000));h.signOut();
});
test('reopening a Burrow page uses a fresh shared snapshot without another request',async()=>{
  const h=harness();await h.refreshBurrow();
  await h.refreshBurrowIfStale();
  assert.equal(h.fetches(),1);
});
test('confirmed shelf placement persists immediately and older reads cannot restore the old display',async()=>{
 for(const elapsed of [0,1]){
 const h=harness(),base={profile:{id:'a'},partner:null,pairVersion:null,inventory:[{owner_id:'a',item_id:'new'}],catalog:[{stable_id:'new',tags:['adventure_v2_gift']}],adventureCollection:{enabled:true,progress:[],displays:[{user_id:'a',gift_id:'old'}]}};
 h.setFetch(async()=>base);await h.refreshBurrow();let resolve;
 h.setFetch(()=>new Promise(r=>resolve=r));const old=h.refreshBurrow();h.advance(elapsed);h.confirmBurrowShelfGift('a','new');
 assert.equal(h.snapshot().data.adventureCollection.displays[0].gift_id,'new');
 resolve(base);await old;assert.equal(h.snapshot().data.adventureCollection.displays[0].gift_id,'new');
 h.advance(1);const fresh={...base,adventureCollection:{...base.adventureCollection,displays:[{user_id:'a',gift_id:'new'}]}};
 h.setFetch(async()=>fresh);await h.refreshBurrow();assert.equal(h.snapshot().data.adventureCollection.displays[0].gift_id,'new');
 h.confirmBurrowShelfGift('other','new');h.confirmBurrowShelfGift('a','unowned');assert.equal(h.snapshot().data.adventureCollection.displays.length,1);
 h.signOut();assert.equal(h.snapshot().data,null);
 }
});
test('durable visit answer removes the badge immediately; stale reads cannot undo pending completion; rejection restores state',async()=>{
 const h=harness(),base={profile:{id:'a'},partner:{id:'b'},pairVersion:'one',friendVisit:{version:2,id:'visit',myCompleted:false}};
 h.setFetch(async()=>base);await h.refreshBurrow();
 h.projectFriendVisitAnswerLocally('visit','pending');assert.equal(h.snapshot().data.friendVisit.myCompleted,true);
 await h.refreshBurrow();assert.equal(h.snapshot().data.friendVisit.myCompleted,true);
 h.projectFriendVisitAnswerLocally('visit','confirmed');h.advance(1);
 h.setFetch(async()=>({...base,friendVisit:{...base.friendVisit,myCompleted:true}}));await h.refreshBurrow();assert.equal(h.snapshot().data.friendVisit.myCompleted,true);
 h.projectFriendVisitAnswerLocally('visit','rejected');assert.equal(h.snapshot().data.friendVisit.myCompleted,false);
 assert.equal(h.snapshot().error,'visit_submission_rejected');
});
test('late private snapshot is discarded after sign-out',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));const pending=h.refreshBurrow();
  h.signOut();resolve({profile:{id:'old-user'}});await pending;assert.equal(h.snapshot().data,null);
});
test('pair invalidation discards old flight without clearing the new flight',async()=>{
  const h=harness();let oldResolve,newResolve;
  h.setFetch(()=>new Promise(r=>oldResolve=r));const old=h.refreshBurrow();h.invalidateBurrowPair();
  h.setFetch(()=>new Promise(r=>newResolve=r));const fresh=h.refreshBurrow();
  oldResolve({profile:{id:'old-pair'}});await old;assert.equal(h.snapshot().data,null);assert.equal(h.snapshot().loading,true);
  newResolve({profile:{id:'new-pair'}});await fresh;assert.equal(h.snapshot().data.profile.id,'new-pair');
});
test('a command begun before pair invalidation cannot clear a new command busy state',async()=>{
  const h=harness();let oldResolve,newResolve;
  const old=h.runBurrowAction('old',()=>new Promise(r=>oldResolve=r));h.invalidateBurrowPair();
  const fresh=h.runBurrowAction('new',()=>new Promise(r=>newResolve=r));oldResolve();assert.equal(await old,false);
  assert.equal(h.snapshot().busy,true);newResolve();assert.equal(await fresh,true);assert.equal(h.snapshot().busy,false);
});
test('confirmed re-pairing restores feature access with only the new snapshot; old responses cannot merge back',async()=>{
  for(const partner of ['b','c']){
    const h=harness();const original={profile:{id:'a'},partner:{id:'b'},pairVersion:'old',memoryEntries:[{id:'old-note'}],moments:[{id:'old-moment'}],wallet:{balance:50,version:1},inventory:[]};
    h.setFetch(async()=>original);await h.refreshBurrow();let resolveOld;
    h.setFetch(()=>new Promise(resolve=>resolveOld=resolve));const old=h.refreshBurrow();h.invalidateBurrowPair();assert.equal(h.snapshot().pairInvalidated,true);
    const fresh={...original,partner:{id:partner},pairVersion:'new',memoryEntries:[],moments:[]};
    h.setFetch(async()=>fresh);await h.refreshBurrow();assert.equal(h.snapshot().pairInvalidated,false);
    resolveOld(original);await old;assert.equal(h.snapshot().data.pairVersion,'new');assert.equal(h.snapshot().data.partner.id,partner);
    assert.equal(h.snapshot().data.memoryEntries.length,0);assert.equal(h.snapshot().data.moments.length,0);assert.equal(h.snapshot().data.wallet.balance,50);
  }
});
test('a missed pairing notification is repaired by bootstrap and fences the old in-flight command',async()=>{
  const h=harness(),original={profile:{id:'a'},partner:{id:'b'},pairVersion:'old',wallet:{balance:50,version:1},memoryEntries:[],moments:[],inventory:[]};
  h.setFetch(async()=>original);await h.refreshBurrow();let done;
  const old=h.runBurrowAction('memory',()=>new Promise(resolve=>done=resolve));
  h.setFetch(async()=>({...original,pairVersion:'new'}));await h.refreshBurrow();
  assert.equal(h.snapshot().data.pairVersion,'new');assert.equal(h.snapshot().pairInvalidated,false);
  done();assert.equal(await old,false,'former-pair command completion cannot publish into the confirmed new relationship');
});
test('resume refresh waits for the previous request then obtains a new snapshot',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  const old=h.refreshBurrow(),resume=h.refreshBurrowAfterCurrent({after:h.burrowClock()+1});assert.equal(h.fetches(),1);
  h.advance(1);
  h.setFetch(async()=>({profile:{id:'fresh'}}));resolve({profile:{id:'cached'}});await old;await resume;
  assert.equal(h.fetches(),2);assert.equal(h.snapshot().data.profile.id,'fresh');
});
test('resume waiting on an old identity cannot fetch or publish after sign-out',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  h.refreshBurrow();const resume=h.refreshBurrowAfterCurrent({after:h.burrowClock()+1});h.signOut();resolve({profile:{id:'old'}});await resume;
  assert.equal(h.fetches(),1);assert.equal(h.snapshot().data,null);
});
test('revoked pairing or rollout clears private room snapshot; ordinary offline failure retains it',async()=>{
  for(const code of ['not_paired','feature_disabled','network_error']){
    const h=harness();await h.refreshBurrow();
    h.setFetch(async()=>{throw {body:{error:code}};});await h.refreshBurrow();
    assert.equal(h.snapshot().error,code);
    assert.equal(h.snapshot().data===null,code!=='network_error');
    assert.equal(h.snapshot().pairInvalidated,code!=='network_error');
  }
});
test('uncertain mutation retry reuses key; a confirmed next action gets a fresh key',async()=>{
  const h=harness();const keys=[];
  assert.equal(await h.runBurrowAction('gift',async key=>{keys.push(key);throw Error('offline');}),false);
  assert.equal(await h.runBurrowAction('gift',async key=>keys.push(key)),true);
  assert.equal(keys[0],keys[1]);assert.equal(h.snapshot().busy,false);
  await h.runBurrowAction('gift',async key=>keys.push(key));assert.notEqual(keys[1],keys[2]);
});
test('rapid taps cannot dispatch two concurrent financial commands',async()=>{
  const h=harness();let resolve;let calls=0;
  const pending=h.runBurrowAction('buy',()=>{calls++;return new Promise(r=>resolve=r);});
  assert.equal(h.runBurrowAction('buy',async()=>calls++),pending);assert.equal(calls,1);
  resolve();await pending;
});
test('new entry waits for its own native layout/data, not removed legacy assets',()=>{
  const h=load('apps/mobile/src/lib/home-entry-readiness.ts',{'./async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts')});h.setHomeEntryExperience('burrow');h.beginHomeEntry();
  const attempt=h.getHomeEntryState().attempt;
  for(const key of ['burrow-data','burrow-layout','burrow-art'])h.markHomeEntryAsset(key,attempt);
  assert.equal(h.homeEntryDataIsReady(),true);assert.equal(h.homeEntryIsReady(),false);
  for(const key of ['tab:index','tab:burrow','tab:quests','tab:shop','tab:friends','tabs-layout'])h.markHomeEntryAsset(key,attempt);
  assert.equal(h.homeEntryIsReady(),true);
  h.setHomeEntryExperience('legacy');assert.equal(h.homeEntryIsReady(),false);
});
