const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,clock,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
function syncHarness() {
  const time=clock(),channels=[];let calls=0,invalidations=0,refresh=async()=>true;
  const {createBurrowSync}=load('apps/mobile/src/lib/burrow-sync-controller.ts',{},time.globals);
  const sync=createBurrowSync({session:async()=>({userId:'a',token:'token'}),
    connect:async(_session,change,status)=>{const c={change,status,closed:false};channels.push(c);return {close:()=>{c.closed=true;}};},
    refresh:()=>{calls++;return refresh();},invalidatePair:()=>invalidations++});
  return {sync,time,channels,calls:()=>calls,invalidations:()=>invalidations,setRefresh:fn=>refresh=fn};
}
test('realtime bursts coalesce and changes during fetch cause one fresh fetch',async()=>{
  const h=syncHarness();h.sync.start();await flush();h.time.advance(0);await flush();
  for(let i=0;i<20;i++)h.channels[0].change(false);
  h.time.advance(399);assert.equal(h.calls(),1);
  const pending=deferred();h.setRefresh(()=>pending.promise);h.time.advance(1);await flush();
  for(let i=0;i<20;i++)h.channels[0].change(false);
  h.setRefresh(async()=>true);pending.resolve(true);await flush();h.time.advance(400);await flush();
  assert.equal(h.calls(),3);h.sync.stop();
});
test('network retry backs off, manual request expedites it; background cancels timers',async()=>{
  const h=syncHarness();h.setRefresh(async()=>false);h.sync.start();await flush();h.time.advance(0);await flush();
  h.time.advance(1999);assert.equal(h.calls(),1);h.time.advance(1);await flush();assert.equal(h.calls(),2);
  h.sync.request(0);h.time.advance(0);await flush();assert.equal(h.calls(),3);
  h.sync.stop();h.time.advance(120000);await flush();assert.equal(h.calls(),3);assert.equal(h.channels[0].closed,true);
});
test('reconnected or stopped channels cannot deliver stale pairing events',async()=>{
  const h=syncHarness();h.sync.start();await flush();const old=h.channels[0];old.status(false);
  h.time.advance(2000);await flush();assert.equal(h.channels.length,2);assert.equal(old.closed,true);
  old.change(true);assert.equal(h.invalidations(),0);h.channels[1].change(true);assert.equal(h.invalidations(),1);
  h.sync.stop();h.channels[1].change(true);assert.equal(h.invalidations(),1);
});
test('a late session lookup after stop never creates a subscription',async()=>{
  const time=clock(),pending=deferred();let connected=0;
  const {createBurrowSync}=load('apps/mobile/src/lib/burrow-sync-controller.ts',{},time.globals);
  const sync=createBurrowSync({session:()=>pending.promise,connect:async()=>{connected++;return {close(){}};},refresh:async()=>true,invalidatePair(){}});
  sync.start();sync.stop();pending.resolve({userId:'a',token:'x'});await flush();assert.equal(connected,0);
});

const scope={userId:'a',partnerId:'b',pairVersion:'a'.repeat(32)},base={entryId:null,body:'A walk together',promptId:null,expectedUpdatedAt:null};
function localHarness(disk=new Map()) {
  let epoch=1,id=0,owner='a',partner='b',pairVersion=scope.pairVersion,post=async()=>({success:true}),writeError=false;const calls=[];
  const imports={react:{useSyncExternalStore:(_s,get)=>get()},'expo-crypto':{randomUUID:()=>`key-${Date.now()}-${++id}`},
    './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>{if(writeError)throw Error('disk');disk.set(k,v);}}},
    '../shared/storage/keys':{kBurrowMemoryLocal:{prefix:'memory:'}},
    './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity(){}},
    './api':{apiClient:{post:async(_url,body)=>{calls.push(body);return post(body);}}},
    './async-lifecycle':{withDeadline:p=>p},'./burrow-store':{getBurrowSnapshot:()=>({data:{profile:{id:owner},partner:{id:partner},pairVersion},error:null})}};
  return {api:load('apps/mobile/src/lib/burrow-memory-local.ts',imports),disk,calls,reload(){this.api=load('apps/mobile/src/lib/burrow-memory-local.ts',imports);},
    setPost:fn=>post=fn,failDisk:()=>writeError=true,changePair:()=>partner='c',rePair:()=>pairVersion='b'.repeat(32),changeAccount:()=>{epoch++;owner='other';}};
}
test('same-partner re-pair blocks old and unversioned pending saves for explicit review',async()=>{
  for(const legacy of [false,true]){
    const h=localHarness();const initial=legacy?{userId:'a',partnerId:'b'}:scope;
    h.api.queueMemoryDraft(initial,h.api.saveMemoryDraft(initial,base));
    h.rePair();await h.api.recoverMemoryJobs(scope);
    assert.equal(h.calls.length,0);assert.equal(h.api.readMemoryLocal(scope).jobs[0].error,'pair_changed');
    assert.equal(h.api.readMemoryLocal(scope).jobs[0].draft.body,base.body);
  }
});
test('unsubmitted draft survives reload without network; explicit Save persists before send',async()=>{
  const h=localHarness();const draft=h.api.saveMemoryDraft(scope,base);h.reload();assert.equal(h.api.readMemoryLocal(scope).drafts.new.body,base.body);
  await h.api.recoverMemoryJobs(scope);assert.equal(h.calls.length,0);
  h.api.queueMemoryDraft(scope,draft);assert.equal(h.api.readMemoryLocal(scope).jobs.length,1);
  assert.equal(h.api.readMemoryLocal(scope).drafts.new,undefined);await h.api.recoverMemoryJobs(scope);assert.equal(h.calls.length,1);assert.equal(h.api.readMemoryLocal(scope).jobs.length,0);
});
test('lost response and process restart preserve original request key',async()=>{
  const h=localHarness();h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,base));h.setPost(async()=>{throw Error('offline');});
  assert.equal(await h.api.recoverMemoryJobs(scope),false);const first=h.calls[0];h.reload();h.setPost(async()=>({success:true}));
  await h.api.recoverMemoryJobs(scope);assert.equal(h.calls[1].idempotencyKey,first.idempotencyKey);assert.equal(h.calls[1].partnerId,'b');
});
test('new draft typed while save is in flight survives acknowledgement',async()=>{
  const h=localHarness(),pending=deferred();h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,base));h.setPost(()=>pending.promise);
  const run=h.api.recoverMemoryJobs(scope);h.api.saveMemoryDraft(scope,{...base,body:'A second story'});pending.resolve({success:true});await run;
  assert.equal(h.api.readMemoryLocal(scope).drafts.new.body,'A second story');assert.equal(h.api.readMemoryLocal(scope).jobs.length,0);
});
test('pair and account changes block replay; late results do not clear old scope jobs',async()=>{
  for(const change of ['changePair','changeAccount']) {
    const h=localHarness(),pending=deferred();h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,base));h.setPost(()=>pending.promise);
    const run=h.api.recoverMemoryJobs(scope);h[change]();pending.resolve({success:true});await run;
    assert.equal(h.api.readMemoryLocal(scope).jobs.length,1);await h.api.recoverMemoryJobs(scope);assert.equal(h.calls.length,1);
    assert.equal(h.api.readMemoryLocal({userId:'other',partnerId:'c'}).jobs.length,0);
  }
});
test('conflicts stay blocked until review; copying cannot overwrite an existing draft',async()=>{
  const h=localHarness();h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,base));h.setPost(async()=>({error:'memory_conflict'}));
  await h.api.recoverMemoryJobs(scope);const job=h.api.readMemoryLocal(scope).jobs[0];assert.equal(job.blocked,true);
  h.api.retryMemoryJobs(scope);await h.api.recoverMemoryJobs(scope);assert.equal(h.calls.length,1);
  h.api.copyMemoryJobToDraft(scope,job.id);assert.equal(h.api.readMemoryLocal(scope).drafts.new.body,base.body);
  assert.throws(()=>h.api.copyMemoryJobToDraft(scope,job.id),/draft_exists/);
  h.api.forgetBlockedMemoryJob(scope,job.id);assert.equal(h.api.readMemoryLocal(scope).jobs.length,0);
});
test('disk failure sends nothing and corrupt storage is preserved',async()=>{
  const h=localHarness();const draft=h.api.saveMemoryDraft(scope,base);h.failDisk();assert.throws(()=>h.api.queueMemoryDraft(scope,draft));
  await h.api.recoverMemoryJobs(scope);assert.equal(h.calls.length,0);h.disk.set('memory:a:b','broken');
  assert.throws(()=>h.api.readMemoryLocal(scope),/local_data_unavailable/);assert.equal(h.disk.get('memory:a:b'),'broken');
});
test('queue is bounded and deduplicates repeated Save of same revision',()=>{
  const h=localHarness(),draft=h.api.saveMemoryDraft(scope,base);h.api.queueMemoryDraft(scope,draft);h.api.queueMemoryDraft(scope,draft);
  assert.equal(h.api.readMemoryLocal(scope).jobs.length,1);
  for(let i=1;i<20;i++)h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,{...base,body:`story${i}`}));
  assert.throws(()=>h.api.queueMemoryDraft(scope,h.api.saveMemoryDraft(scope,base)),/queue_full/);
});
test('manual retry emits wake only on explicit retry, not keystrokes',()=>{
  const h=localHarness();let wake=0;h.api.subscribeMemoryRetry(()=>wake++);
  h.api.saveMemoryDraft(scope,base);assert.equal(wake,0);h.api.retryMemoryJobs(scope);assert.equal(wake,1);
});

test('memory prefix participates in account cleanup without deleting device settings',()=>{
  const disk=new Map([['burrow_memory_local:v1:a:b','private'],['novame_notification_settings','device']]);
  const registry=load('apps/mobile/src/shared/storage/registry.ts',{'./mmkv':{mmkv:{getAllKeys:()=>[...disk.keys()],remove:key=>disk.delete(key)}}},{__DEV__:false});
  load('apps/mobile/src/shared/storage/keys.ts',{'./registry':registry,'./artifacts':{deleteOnboardingAvatar(){},deleteRecordDraftAudio(){}}});registry.clearOnSignOut();
  assert.equal(disk.has('burrow_memory_local:v1:a:b'),false);assert.equal(disk.get('novame_notification_settings'),'device');
});

const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
function composerHarness() {
  const local=localHarness(),h=hooks();let done=0;
  const {MemoryComposer}=load('apps/mobile/src/components/burrow/memory-composer.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Alert:{alert(){}},Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:x=>x}},
    '@/lib/memory-prompt':{dailyMemoryPrompt:()=>({id:'prompt',prompt:'Today?'})},'@/lib/burrow-memory-local':local.api,
  });
  const data={profile:{id:'a'},partner:{id:'b'},memoryEntries:[],memoryPrompts:[{id:'prompt',prompt:'Today?'}],localDate:'2026-09-27'};
  return {...local,render:()=>nodes(h.render(()=>MemoryComposer({data,entryId:null,onDone:()=>done++}))),done:()=>done};
}
test('composer typing persists only draft; Save queues text and clears input without claiming server success',()=>{
  const h=composerHarness();h.render().find(x=>x.type==='TextInput').props.onChangeText('A little moment');
  let tree=h.render();assert.equal(tree.find(x=>x.type==='TextInput').props.value,'A little moment');assert.equal(h.calls.length,0);
  tree.find(x=>x.props?.title==='Save memory').props.onPress();tree=h.render();
  assert.equal(tree.find(x=>x.type==='TextInput').props.value,'');assert.equal(h.api.readMemoryLocal(scope).jobs.length,1);
  assert.ok(tree.some(x=>typeof x.props?.children==='string'&&x.props.children.includes('not yet confirmed')));assert.equal(h.done(),1);
});
test('composer keeps visible text when local storage fails and can retry Save',()=>{
  const h=composerHarness();h.failDisk();h.render().find(x=>x.type==='TextInput').props.onChangeText('Keep this text');
  const tree=h.render();assert.equal(tree.find(x=>x.type==='TextInput').props.value,'Keep this text');
  assert.ok(tree.some(x=>x.props?.accessibilityRole==='alert'));assert.equal(h.calls.length,0);
});

test('durable API binds authenticated actor, partner, key and edit version before RPC',async()=>{
  const id='00000000-0000-0000-0000-000000000001',partner='00000000-0000-0000-0000-000000000002',calls=[];
  const route=load('apps/api/src/app/api/vnext/command/route.js',{'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200})}},
    '@/lib/app-major-update':{authenticatedUserId:async()=>id,majorUpdateEnabled:async()=>true,commandStatus:e=>e?409:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{error:'memory_conflict'}};}})}});
  const body={action:'save_memory_durable',actorId:id,partnerId:partner,pairVersion:scope.pairVersion,body:'text',idempotencyKey:id,entryId:id,expectedUpdatedAt:'2026-09-27T10:00:00.123456Z'};
  const send=patch=>route.POST(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({...body,...patch})}));
  for(const patch of [{actorId:partner},{partnerId:'bad'},{pairVersion:undefined},{pairVersion:'bad'},{idempotencyKey:'bad'},{expectedUpdatedAt:null},{body:''}])assert.equal((await send(patch)).status,400);
  assert.equal(calls.length,0);assert.equal((await send({})).status,409);assert.equal(calls[0].name,'save_memory_room_versioned_v1');
  assert.equal(calls[0].args.p_expected_updated_at,body.expectedUpdatedAt);assert.equal(calls[0].args.p_partner_id,partner);
});
