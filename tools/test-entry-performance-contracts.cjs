const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const base='apps/mobile/src/lib/';
const fixture=()=>({profile:{id:'me',timezone_name:'UTC'},partner:{id:'you'},pairVersion:'one',pairAccessVerified:true,
  catalogComplete:true,localDate:'2026-10-23',serverNow:'2026-10-23T12:00:00Z',hasPlus:false,
  wallet:{balance:10,version:1},catalog:[{stable_id:'lamp',metadata:{slot:'lamp'}}],inventory:[],loadouts:[],roomPhotos:[],
  affectionInbox:[],moments:[],memoryEntries:[],gifts:[],specialQuests:[],quests:{quests:[]},
  attention:{scope:'me:you:one',localDate:'2026-10-23',games:[],journal:[],letters:[],moments:[]}});
function storeHarness(){
  const h=hooks(),releases=[],balanceSubscriptions=[],idleJobs=[];let value=fixture(),focused=true,invalidations=0,epoch=1,onIdentity,yielding=async()=>{};
  const api=load(base+'burrow-store.ts',{
    './adventure-arrival':load(base+'adventure-arrival.ts'),
    './async-lifecycle':load(base+'async-lifecycle.ts'),
    react:{...h.react,useSyncExternalStore(subscribe,get){
      h.react.useEffect(()=>{let previous=get();const release=subscribe(()=>{const next=get();if(next!==previous){invalidations++;previous=next;}});releases.push(release);return release;},[subscribe,get]);return get();}},
    '@react-navigation/native':{useIsFocused:()=>focused},'expo-router':{useFocusEffect(){}},
    'react-native':{AppState:{currentState:'active'},InteractionManager:{runAfterInteractions:()=>({cancel(){}})}},
    'expo-crypto':{randomUUID:()=> 'operation'},
    './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'me',subscribeSessionIdentity:fn=>{onIdentity=fn;}},
    './app-major-update-api':{fetchMajorUpdateBootstrap:async()=>value},
    './ui-idle':{yieldToUi:delay=>yielding(delay),afterUiSettles:run=>{const job={run,cancelled:false};idleJobs.push(job);return()=>{job.cancelled=true;};}},
    './burrow-cache':{persistBurrowSnapshot(){},persistBurrowWallet(){},readBurrowSnapshot:()=>null,readBurrowActionKeys:()=>[],persistBurrowActionKeys(){},clearBurrowSnapshot(){}},
    './coin-reward-store':{syncCoinWallet(){},useCoinBalance:active=>{balanceSubscriptions.push(active);return null;},setCoinRewardReconciler(){},subscribeCoinWallet(){},getConfirmedCoinWallet:()=>null},
  });
  return {api,balanceSubscriptions,idleJobs,focus:next=>{focused=next;},get value(){return value;},set value(next){value=next;},set yield(fn){yielding=fn;},
    get invalidations(){return invalidations;},render:fn=>h.render(fn),switch(){epoch++;onIdentity();},
    dispose(){releases.forEach(fn=>fn());h.unmount();}};
}
test('a route selector ignores wallet/photo/unread updates but observes scope and its live removal guard',async()=>{
  const h=storeHarness();await h.api.refreshBurrow();
  const read=()=>h.api.useBurrowSelector(s=>({scope:`${s.data?.profile.id}:${s.data?.partner?.id}:${s.data?.pairVersion}`,busy:s.busy}),
    (a,b)=>a.scope===b.scope&&a.busy===b.busy);
  const first=h.render(read);
  h.value={...h.value,wallet:{balance:40},roomPhotos:[{id:'photo'}],unread:{affection:3}};
  await h.api.refreshBurrow({silent:true});assert.equal(h.invalidations,0);assert.equal(h.render(read),first);
  let release;const running=h.api.runBurrowAction('guard',()=>new Promise(resolve=>{release=resolve;}));
  await flush();assert.equal(h.render(read).busy,true);release();await running;assert.equal(h.render(read).busy,false);
  h.value={...h.value,pairVersion:'two'};await h.api.refreshBurrow({silent:true});assert.notEqual(h.render(read).scope,first.scope);
  h.switch();assert.match(h.render(read).scope,/undefined/);h.dispose();
});
for(const page of ['affection','adventure','plushie'])test(`${page} does not create an unrelated live wallet subscription`,async()=>{
  const h=storeHarness();await h.api.refreshBurrow();h.render(()=>h.api.useBurrow(false,page));
  assert.equal(h.balanceSubscriptions.at(-1),false);h.dispose();
});
for(const page of ['home','moments','shop','adventure'])test(`hidden ${page} does not queue an unnecessary redraw; focus immediately reads the latest ready snapshot`,async()=>{
  const h=storeHarness();await h.api.refreshBurrow();
  const render=()=>h.render(()=>h.api.useBurrow(page==='home',page)),first=render();h.focus(false);render();
  h.value={...h.value,wallet:{balance:50},moments:[{id:'new'}],activeAdventure:{id:'ready',status:'result_ready'}};
  await h.api.refreshBurrow({silent:true});assert.equal(h.idleJobs.length,0);
  assert.equal(render(),first);h.focus(true);const latest=render();
  assert.equal(latest.data.activeAdventure.id,'ready');assert.notEqual(latest,first);h.dispose();
});
test('Adventure observes all display/settlement inputs, not unrelated room, letter or game updates',()=>{
  const {retainedPageChanged:changed}=load(base+'retained-page-model.ts'),before=fixture();
  for(const patch of [{roomPhotos:[{id:'p'}]},{loadouts:[{id:'l'}]},{wallet:{balance:500}},
    {memoryEntries:[{id:'note'}]},{attention:{...before.attention,games:[{id:'round'}]}}])
    assert.equal(changed(before,{...before,...patch},'adventure'),false);
  for(const patch of [{activeAdventure:{id:'trip'}},{adventureResult:{id:'r'}},{adventurePlan:{version:2}},
    {inventory:[{item_id:'gift'}]},{readyRecordId:'record'},{dailyAdventureUsed:true},{hasPlus:true},
    {pairAccessVerified:false},{profile:{...before.profile,timezone_name:'Asia/Shanghai'}}])
    assert.equal(changed(before,{...before,...patch},'adventure'),true);
});
test('footer suppresses unrelated updates but reads the latest content when its ready revision is published',()=>{
  const h=hooks(),storeListeners=new Set(),readyListeners=new Set();let data=fixture(),revision=0,ready='',invalidations=0;
  const releases=[],react={...h.react,useSyncExternalStore(sub,get){h.react.useMemo(()=>{let before=get();releases.push(sub(()=>{
    const next=get();if(next!==before){invalidations++;before=next;}}));},[sub,get]);return get();}};
  const api=load(base+'burrow-tab-attention.ts',{
    react,'./burrow-store':{getBurrowSnapshot:()=>({data}),subscribeBurrowSnapshot:fn=>{storeListeners.add(fn);return()=>storeListeners.delete(fn);}},
    './burrow-attention':{attentionRevision:()=>String(revision),attentionViewKey:v=>String(v.count),
      burrowAttentionCounts:d=>({count:d?.pairAccessVerified&&d.attention.games[0]?.id===ready?1:0}),
      subscribeAttention:fn=>{readyListeners.add(fn);return()=>readyListeners.delete(fn);}},
  });
  const render=()=>h.render(()=>api.useBurrowTabAttention());render();
  data={...data,wallet:{balance:99},roomPhotos:[{id:'p'}]};storeListeners.forEach(fn=>fn());assert.equal(invalidations,0);
  data={...data,attention:{...data.attention,games:[{id:'new-content'}]}};storeListeners.forEach(fn=>fn());assert.equal(invalidations,0);
  ready='new-content';revision++;readyListeners.forEach(fn=>fn());assert.equal(invalidations,1);assert.equal(render().count,1);
  data={...data,pairAccessVerified:false};storeListeners.forEach(fn=>fn());assert.equal(render().count,0);
  releases.forEach(fn=>fn());h.unmount();assert.equal(storeListeners.size,0);assert.equal(readyListeners.size,0);
});
test('notification versions reuse unchanged branches without rescanning content; actual revisions invalidate',()=>{
  const api=load(base+'notification-content-version.ts'),data=fixture();let scans=0;
  const rows=[{id:'one',created_at:'now'}];rows.map=new Proxy(rows.map,{apply(fn,receiver,args){scans++;return Reflect.apply(fn,receiver,args);}});
  data.moments=rows;const first=api.notificationContentVersion(data,'moments');assert.equal(scans,1);
  for(let n=0;n<100;n++)assert.equal(api.notificationContentVersion({...data,wallet:{balance:n},serverNow:String(n)},'moments'),first);
  assert.equal(scans,1);
  assert.notEqual(api.notificationContentVersion({...data,moments:[...rows,{id:'two',created_at:'later'}]},'moments'),first);
  assert.notEqual(api.notificationContentVersion({...data,profile:{...data.profile,timezone_name:'Asia/Shanghai'}},'moments'),first);
});
test('idle sharing splits large reads, retains equal branches and preserves changed fresh projection nodes',async()=>{
  const {shareSnapshotWhenIdle:share}=load(base+'idle-snapshot-sharing.ts');let yields=0;
  const before={rows:Array.from({length:1200},(_,id)=>({id,label:'item'})),projection:{same:true}},next=structuredClone(before);
  next.projection={same:false};const result=await share(before,next,{maxNodes:100,yield:async()=>{yields++;},valid:()=>true});
  assert.ok(yields>10);assert.equal(result.rows,before.rows);assert.equal(result.projection,next.projection);assert.notEqual(result,before);
  let valid=true;assert.equal(await share(before,structuredClone(before),{maxNodes:10,valid:()=>valid,yield:async()=>{valid=false;}}),null);
});
test('silent reconciliation never publishes partial data and rebases a local purchase made during a yield',async()=>{
  const h=storeHarness();h.value={...h.value,catalog:Array.from({length:1000},(_,id)=>({stable_id:'item'+id,metadata:{slot:'lamp'},price:id}))};
  await h.api.refreshBurrow();const before=h.api.getBurrowSnapshot().data;h.value=structuredClone(h.value);h.value.wallet.balance=50;
  let resume,paused=false;h.yield=delay=>delay===0&&!paused?(paused=true,new Promise(resolve=>{resume=resolve;})):Promise.resolve();
  const reading=h.api.refreshBurrow({silent:true});await flush();assert.equal(paused,true);assert.equal(h.api.getBurrowSnapshot().data,before);
  h.api.confirmBurrowPurchaseLocally('item1','me','local-purchase');assert.ok(h.api.getBurrowSnapshot().data.inventory.some(row=>row.item_id==='item1'));
  resume();await reading;assert.ok(h.api.getBurrowSnapshot().data.inventory.some(row=>row.item_id==='item1'));
  assert.equal(h.api.getBurrowSnapshot().data.catalog,before.catalog);h.dispose();
});
test('ordinary navigation never regains a complete-store subscription or a forced optional Game refresh',()=>{
  const route=fs.readFileSync('apps/mobile/app/(main)/burrow-detail.tsx','utf8'),footer=fs.readFileSync('apps/mobile/src/components/main/bottom-tab-bar.tsx','utf8');
  assert.doesNotMatch(route,/useBurrowSnapshot/);assert.match(route,/useBurrowSelector/);
  assert.doesNotMatch(footer,/useBurrowSnapshot/);assert.match(footer,/useBurrowTabAttention/);
  assert.doesNotMatch(fs.readFileSync(base+'burrow-foreground-prewarm.ts','utf8'),/warmBurrowGameOverview\(\{force:true\}\)/);
});
