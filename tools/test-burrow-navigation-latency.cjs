const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const base='apps/mobile/src/lib/';
const model=load(base+'burrow-destination-model.ts');
const data=()=>({profile:{id:'me'},partner:{id:'you'},pairVersion:'one',pairAccessVerified:true,catalogComplete:true,
  dailyAdventureUsed:false,readyRecordId:null,activeAdventure:null});

test('native preloading excludes guarded records, reward settlements and command/device pages',()=>{
  const d=data();assert.deepEqual([...model.burrowPreloadDestinations(d,'home')],['affection','adventure']);
  for(const patch of [{readyRecordId:'record'},{dailyAdventureUsed:true},
    {activeAdventure:{id:'a',status:'result_ready'}},{activeAdventure:{id:'a',status:'interaction_required'}}])
    assert.deepEqual([...model.burrowPreloadDestinations({...d,...patch},'home')],['affection']);
  assert.deepEqual([...model.burrowPreloadDestinations({...d,activeAdventure:{id:'a',status:'in_progress'}},'home')],['affection','adventure']);
  assert.deepEqual([...model.burrowPreloadDestinations(d,'burrow')],['memories_room']);
  for(const source of ['adventure','affection','shop','memories_room','game_room'])assert.equal(model.burrowPreloadDestinations(d,source).length,0);
});
test('native route identities cannot merge different rooms, parameters or task navigation',()=>{
  const ids=['affection','adventure','memories_room'].map(section=>model.burrowDestinationId({params:{section}}));
  assert.equal(new Set(ids).size,3);assert.ok(ids.every(Boolean));
  for(const params of [{section:'game_room'},{section:'adventure',adventureFade:'1'},
    {section:'memories_room',journalPage:'page'},{section:'affection',inbox:'1'}])
    assert.equal(model.burrowDestinationId({params}),undefined);
});
test('real native StackRouter reuses the prepared room and pops to the identical source',()=>{
  const {createRequire}=require('node:module'),path=require('node:path');
  const native=createRequire(require.resolve('@react-navigation/native/package.json',{paths:[path.resolve('apps/mobile')]}));
  const {StackRouter}=native('@react-navigation/routers');
  const options={routeNames:['tabs','burrow-detail'],routeParamList:{},routeGetIdList:{'burrow-detail':model.burrowDestinationId}};
  const router=StackRouter({initialRouteName:'tabs'});let state=router.getInitialState(options);const source=state.routes[0];
  for(const section of ['affection','adventure','memories_room'])state=router.getStateForAction(state,{type:'PRELOAD',payload:{name:'burrow-detail',params:{section}}},options);
  assert.equal(state.preloadedRoutes.length,3);const prepared=state.preloadedRoutes.find(r=>r.params.section==='affection');
  state=router.getStateForAction(state,{type:'PUSH',payload:{name:'burrow-detail',params:{section:'affection'}}},options);
  assert.equal(state.routes.at(-1).key,prepared.key);assert.equal(state.routes[0],source);assert.equal(state.preloadedRoutes.length,2);
  state=router.getStateForAction(state,{type:'POP',payload:{count:1}},options);assert.equal(state.routes[0],source);
  assert.equal(state.routes.length,1);
});
function preloader(){
  const h=hooks(),jobs=[],calls=[];let d=data(),epoch=1,focused=true,foreground='active',ready=true,preloadedRoutes=[];
  const parent={getState:()=>({routeNames:['tabs','burrow-detail'],routes:[{name:'tabs'}],preloadedRoutes}),
    preload:(name,params)=>{calls.push({name,params});preloadedRoutes.push({name,params});}};
  const navigation={getParent:()=>parent,isFocused:()=>focused};
  const api=load(base+'burrow-destination-preload.ts',{
    react:h.react,'react-native':{AppState:{get currentState(){return foreground;},addEventListener:()=>({remove(){}})}},'@react-navigation/native':{useNavigation:()=>navigation},
    './burrow-attention':{useNotificationContentReady:()=>ready},
    './burrow-store':{getBurrowSnapshot:()=>({data:d})},'./session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'me'},
    './ui-idle':{stageForegroundJobs:batch=>{const own=batch.map(job=>({...job,live:true}));jobs.push(...own);return()=>own.forEach(job=>job.live=false);}},
    './burrow-page-entry':{burrowPageIsReady:()=>ready},'./burrow-destination-model':model,
  });
  return {render:(source='home')=>h.render(()=>api.useBurrowDestinationPreload(source,focused,d)),calls,jobs,
    run(){jobs.filter(job=>job.live).forEach(job=>job.run());},unmount:h.unmount,
    set data(next){d=next;},get data(){return d;},blur(){focused=false;},background(){foreground='background';},switch(){epoch++;},deny(){ready=false;}};
}
test('native view preparation is idle-only, bounded and never replaces an existing active/preloaded room',()=>{
  const h=preloader();h.render();assert.equal(h.calls.length,0);assert.equal(h.jobs.length,2);
  h.run();h.run();assert.deepEqual(h.calls.map(call=>call.params.section),['affection','adventure']);
  h.unmount();assert.ok(h.jobs.every(job=>!job.live));
});
for(const reason of ['blur','background','switch','deny','pair','ready-record'])test(`a queued hidden mount is fenced on ${reason}`,()=>{
  const h=preloader();h.render();
  if(reason==='pair')h.data={...h.data,partner:{id:'new'}};
  else if(reason==='ready-record')h.data={...h.data,readyRecordId:'saved'};
  else h[reason]();h.run();
  assert.deepEqual(h.calls.map(call=>call.params.section),reason==='ready-record'?['affection']:[]);h.unmount();
});
test('retained hidden models ignore unrelated attention but preserve private identity and own notification changes',()=>{
  const {retainedPageChanged:changed}=load(base+'retained-page-model.ts');const before={...data(),attention:{scope:'one',games:[],moments:[],letters:[],journal:[]}};
  const games={...before,attention:{...before.attention,games:[{id:'game'}]}};
  for(const page of ['home','shop','collection','quests','moments'])assert.equal(changed(before,games,page),false,page);
  assert.equal(changed(before,games,'burrow'),true);
  assert.equal(changed(before,{...before,attention:{...before.attention,moments:[{id:'new'}]}},'moments'),true);
  for(const page of ['home','burrow','shop','collection','quests','moments'])
    assert.equal(changed(before,{...before,pairAccessVerified:false},page),true,page);
});
test('selected attention snapshots do not repaint a room for another channel; readiness and revocation still update it',async()=>{
  const h=hooks(),readiness=load(base+'notification-readiness.ts').createNotificationReadiness();
  let owner='me',d={...data(),serverNow:new Date().toISOString(),localDate:'today',unread:{affection:0,gifts:0},affectionInbox:[],
    attention:{scope:'me:you:one',games:[{id:'round:invite',at:'now'}],journal:[],letters:[],moments:[]},quests:{quests:[]}};
  const observed=[];let previous,changed=0;
  const react={...h.react,useSyncExternalStore(subscribe,get){h.react.useMemo(()=>{const check=()=>{const next=get();if(next!==previous){changed++;previous=next;}};
    previous=get();const release=subscribe(check);observed.push(release);return release;},[subscribe,get]);return get();}};
  const api=load(base+'burrow-attention.ts',{
    react,'./storage':{storage:{getString(){},set(){}}},'../shared/storage/keys':{kBurrowAttention:{keyFor:String}},
    './session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity(){}},'./burrow-presentation':{adventureHasArrived:()=>false},
    './burrow-moments-model':{momentKind:()=>true},'./notification-readiness':{notificationReadiness:readiness},
  });
  h.render(()=>api.useBurrowAttention(d,undefined,'home'));
  await readiness.prepare('me:you:one','games',JSON.stringify(d.attention.games),async()=>{},()=>true);
  assert.equal(changed,0,'games ready does not repaint the Home scene');observed.splice(0).forEach(fn=>fn());
  h.render(()=>api.useBurrowAttention(d,undefined,'rooms'));owner='other';readiness.reset();
  assert.ok(changed>0,'authorization/identity change removes private badge');observed.forEach(fn=>fn());h.unmount();
});
test('Home asset preparation no longer reruns on blur and preparation uses design identities, not wallet ticks',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(source,/\},\[section,homeDesign,attempt\]\)/);assert.doesNotMatch(source,/\[section,homeDesign,attempt,focused\]/);
  assert.match(source,/const preparedDesign=useMemo/);
  assert.match(fs.readFileSync('apps/mobile/src/components/burrow/affection-hub.tsx','utf8'),/ReceiveModal visible=\{focused&&inbox\}/);
});
