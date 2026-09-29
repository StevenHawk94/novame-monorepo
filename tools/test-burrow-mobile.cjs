// Deterministic mobile state-boundary tests; not a substitute for device QA.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,console,Date,Map,Set,
    require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
  return module.exports;
}
function harness(){
  let epoch=1,next=0,fetches=0,fetch=async()=>({profile:{id:'a'}});const identities=[];
  const api=load('apps/mobile/src/lib/burrow-store.ts',{
    react:{useCallback:f=>f,useSyncExternalStore:(_,snapshot)=>snapshot()},
    'expo-router':{useFocusEffect(){}},'react-native':{AppState:{}},
    'expo-crypto':{randomUUID:()=>`key-${++next}`},
    './app-major-update-api':{fetchMajorUpdateBootstrap:()=>{fetches++;return fetch();}},
    './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>identities.push(fn)},
  });
  return {...api,snapshot:()=>api.useBurrow(),fetches:()=>fetches,setFetch:fn=>fetch=fn,
    signOut(){epoch++;identities.forEach(fn=>fn());}};
}
test('simultaneous screens share one in-flight bootstrap',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  const first=h.refreshBurrow(),second=h.refreshBurrow();assert.equal(first,second);assert.equal(h.fetches(),1);
  resolve({profile:{id:'a'}});await first;assert.equal(h.snapshot().data.profile.id,'a');assert.equal(h.snapshot().loading,false);
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
test('resume refresh waits for the previous request then obtains a new snapshot',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  const old=h.refreshBurrow(),resume=h.refreshBurrowAfterCurrent();assert.equal(h.fetches(),1);
  h.setFetch(async()=>({profile:{id:'fresh'}}));resolve({profile:{id:'cached'}});await old;await resume;
  assert.equal(h.fetches(),2);assert.equal(h.snapshot().data.profile.id,'fresh');
});
test('resume waiting on an old identity cannot fetch or publish after sign-out',async()=>{
  const h=harness();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));
  h.refreshBurrow();const resume=h.refreshBurrowAfterCurrent();h.signOut();resolve({profile:{id:'old'}});await resume;
  assert.equal(h.fetches(),1);assert.equal(h.snapshot().data,null);
});
test('revoked pairing or rollout clears private room snapshot; ordinary offline failure retains it',async()=>{
  for(const code of ['not_paired','feature_disabled','network_error']){
    const h=harness();await h.refreshBurrow();
    h.setFetch(async()=>{throw {body:{error:code}};});await h.refreshBurrow();
    assert.equal(h.snapshot().error,code);
    assert.equal(h.snapshot().data===null,code!=='network_error');
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
  assert.equal(await h.runBurrowAction('buy',async()=>calls++),false);assert.equal(calls,1);
  resolve();await pending;
});
test('new entry waits for its own native layout/data, not removed legacy assets',()=>{
  const h=load('apps/mobile/src/lib/home-entry-readiness.ts');h.setHomeEntryExperience('burrow');h.beginHomeEntry();
  const attempt=h.getHomeEntryState().attempt;
  for(const key of ['burrow-data','burrow-layout'])h.markHomeEntryAsset(key,attempt);
  assert.equal(h.homeEntryDataIsReady(),true);assert.equal(h.homeEntryIsReady(),false);
  for(const key of ['tab:index','tab:love','tab:shop','tab:friends','tab:collection','tabs-layout','entry-copy'])h.markHomeEntryAsset(key,attempt);
  assert.equal(h.homeEntryIsReady(),true);
  h.setHomeEntryExperience('legacy');assert.equal(h.homeEntryIsReady(),false);
});
