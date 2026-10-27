const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
function friendsHarness(id='a'){
  const values=new Map(),gets=[],deletes=[],widgets=[],identities=[];let epoch=1,owner=id;
  const lifecycle={sessionEpoch:()=>epoch,sessionUserId:()=>owner,subscribeSessionIdentity:fn=>{identities.push(fn);return()=>{};}};
  const api=load('apps/mobile/src/lib/friends-api.ts',{
    './partner-invite-cache':{cachedPartnerInvite:()=>null,rememberPartnerInvite(){}},
    './widget-sync':{syncWidgetLatestFriend:async(...args)=>widgets.push(args)},'./api':{apiClient:{get:path=>{const request=deferred();gets.push({path,request});return request.promise;},delete:()=>{const request=deferred();deletes.push(request);return request.promise;}}},
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})}}},
    './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value),remove:key=>values.delete(key)}},
    '../shared/storage/keys':Object.fromEntries(['kCommonItems','kConnInsights','kFriendsFeed','kFriendsStatus','kPairingStatus','kSharedBoxState'].map(key=>[key,{name:key}])),
    './connection-analysis-cache':{},'./analysis-refresh-policy':{},'./subscription':{},'./bags-api':{cacheTheirItemsFromFeed(){}},'./remote-items':{mergedItemDictionary:()=>({items:{}})},'./session-lifecycle':lifecycle,
  });
  return {api,gets,deletes,values,widgets,lifecycle,account(){owner='other';epoch++;identities.forEach(fn=>fn());}};
}
test('a pending paired read cannot refill the cleared cache or clear a newer request after remote Unpair',async()=>{
  const h=friendsHarness(),statuses=[];h.api.subscribePairingStatus(value=>statuses.push(value));
  const old=h.api.fetchPairing({force:true});await flush();h.api.invalidatePairingCache();
  assert.equal(h.api.getCachedPairing().paired,false);assert.equal(statuses.at(-1).paired,false);
  const fresh=h.api.fetchPairing({force:true});await flush();
  h.gets[0].request.resolve({success:true,paired:true,partner:{userId:'b',displayName:'B'}});await old;
  assert.equal(h.api.getCachedPairing().paired,false);assert.equal(h.api.fetchPairing({force:true}),fresh);
  h.gets[1].request.resolve({success:true,paired:false,partner:null});await fresh;assert.equal(h.api.getCachedPairing().paired,false);
});
test('Unpair success persists unpaired cache, notifies every mounted consumer and rejects a late paired response',async()=>{
  const h=friendsHarness(),seen=[];h.values.set('kPairingStatus',JSON.stringify({paired:true,partner:{userId:'b'},fetchedAt:Date.now()}));
  const read=h.api.fetchPairing({force:true});await flush();h.api.subscribePairingStatus(status=>seen.push(status));
  const unset=h.api.unsetPairing();await flush();h.deletes[0].resolve({success:true});assert.equal(await unset,true);
  assert.equal(seen.at(-1).paired,false);assert.equal(h.api.getCachedPairing().fetchedAt,0);
  h.gets[0].request.resolve({success:true,paired:true,partner:{userId:'b'}});await read;assert.equal(h.api.getCachedPairing().paired,false);
});
test('a failed post-event refresh and a cold restart both retain the revoked state, not the old five-minute paired cache',async()=>{
  const h=friendsHarness();h.values.set('kPairingStatus',JSON.stringify({paired:true,partner:{userId:'b'},fetchedAt:Date.now()}));
  h.api.invalidatePairingCache();const fresh=h.api.fetchPairing({force:true});await flush();h.gets[0].request.reject(Error('offline'));await fresh;
  assert.equal(h.api.getCachedPairing().paired,false);assert.equal(JSON.parse(h.values.get('kPairingStatus')).paired,false);
});
test('responses from old-account pairing reads and Unpair cannot mutate the current account cache',async()=>{
  const h=friendsHarness();const read=h.api.fetchPairing({force:true}),unset=h.api.unsetPairing();await flush();h.account();
  h.values.set('kPairingStatus',JSON.stringify({paired:true,partner:{userId:'new-partner'}}));
  h.gets[0].request.resolve({success:true,paired:true,partner:{userId:'old-partner'}});h.deletes[0].resolve({success:true});
  await read;assert.equal(await unset,false);assert.equal(h.api.getCachedPairing().partner.userId,'new-partner');
});
test('inflight friend and feed requests cannot restore pair-bound caches after invalidation',async()=>{
  const h=friendsHarness();const status=h.api.fetchFriends({force:true}),feed=h.api.fetchFriendFeedPage(undefined,{force:true});await flush();h.api.invalidatePairingCache();
  h.gets.find(v=>v.path.includes('/status?')).request.resolve({success:true,inviteCode:'OLD123',friends:[],pending:[],sent:[]});
  h.gets.find(v=>v.path.includes('/feed?')).request.resolve({success:true,feed:[{friendUserId:'b',itemIds:[]}]});
  await Promise.all([status,feed]);assert.equal(h.values.has('kFriendsStatus'),false);assert.equal(h.values.has('kFriendsFeed'),false);
});
test('latest global state gates stale callbacks from all shared features; only confirmed re-pairing restores access',()=>{
  const paths=[];let snapshot={data:{profile:{id:'a'},partner:{id:'b'}},pairInvalidated:false};const captured=snapshot.data;
  const gate=load('apps/mobile/src/lib/partner-pairing.ts',{'expo-router':{router:{navigate:path=>paths.push(path)}},'./burrow-store':{getBurrowSnapshot:()=>snapshot},'./session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'a',subscribeSessionIdentity(){}}});
  assert.equal(gate.requirePartner(captured),false);snapshot={data:null,pairInvalidated:true};
  for(const feature of ['Affection','Partner Room','Surprise','Memories','Games','Moments','Home envelope'])assert.equal(gate.requirePartner(captured),true,feature);
  assert.equal(paths.length,7);snapshot={data:{profile:{id:'a'},partner:null},pairInvalidated:false};assert.equal(gate.requirePartner(captured),true);
  snapshot={data:{profile:{id:'a'},partner:{id:'c'}},pairInvalidated:false};assert.equal(gate.requirePartner(captured),false);
});
test('both foreground devices invalidate synchronously on pair_changed, without waiting for an offline refresh',async()=>{
  const fixtures=[];
  for(const id of ['a','b']){
    const h=hooks(),time=clock(),f=friendsHarness(id),channels=[];let data={profile:{id},partner:{id:id==='a'?'b':'a'}},invalidated=false;
    f.values.set('kPairingStatus',JSON.stringify({paired:true,partner:{userId:data.partner.id},fetchedAt:Date.now()}));
    const supabase={auth:{getSession:async()=>({data:{session:{user:{id},access_token:'test'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},realtime:{setAuth:async()=>{}},removeChannel:async()=>{},channel(){const handlers={};const channel={on(_kind,{event},fn){handlers[event]=fn;return channel;},subscribe(){return channel;}};channels.push(handlers);return channel;}};
    const {BurrowSyncGate}=load('apps/mobile/src/components/burrow/burrow-sync-gate.tsx',{
      '@/lib/bunny-identity':{syncBunnyIdentity:async()=>{}},
      '@/lib/adventure-nudge':{resumeAdventureNudges:async()=>{},pauseAdventureNudges(){}},
      '@/lib/surprise-inbox':{notifySurpriseChanged(){}},
      '@/lib/friend-visit-local':{warmFriendVisit:async()=>{},friendVisitLocal:{resume:async()=>{},pause(){}}},
      '@/lib/burrow-foreground-prewarm':{prewarmBurrowPages:()=>()=>{}},'@/lib/use-home-entry':{useHomeEntry:()=>({pending:false})},
      '@/lib/burrow-game-room-cache': { notifyGameRoomChanged() {} },
      '@/lib/burrow-page-entry':{warmBurrowGameOverview:async()=>{}},
      '@/lib/release-room-api':{releaseRoomScope:()=>id,cachedReleaseRoom:()=>null},'@/lib/ui-idle':{afterUiSettles:()=>()=>{}},
      '@/lib/moments-cache':{momentsCache:{prepare:async()=>{},read:()=>({error:false})}},
      react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'@/lib/supabase':{supabase},'@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
      '@/lib/burrow-sync-controller':load('apps/mobile/src/lib/burrow-sync-controller.ts',{},time.globals),
      '@/lib/burrow-store':{useBurrowSnapshot:()=>({data}),burrowClock:()=>0,getBurrowSnapshot:()=>({data,syncError:'offline'}),invalidateBurrowPair(){data=null;invalidated=true;},refreshBurrowAfterCurrent:async()=>{}},
      '@/lib/burrow-memory-local':{subscribeMemoryLocal:()=>()=>{},subscribeMemoryRetry:()=>()=>{}},'@/lib/session-lifecycle':f.lifecycle,'@/lib/friends-api':f.api,
    },time.globals);
    h.render(BurrowSyncGate);await flush();fixtures.push({h,f,channels,invalidated:()=>invalidated});
  }
  for(const fixture of fixtures){fixture.channels[0].pair_changed();assert.equal(fixture.invalidated(),true);assert.equal(fixture.f.api.getCachedPairing().paired,false);fixture.h.unmount();}
});
test('a peer that missed the notification in background clears its Menu cache on the first foreground read',async()=>{
  const h=hooks(),f=friendsHarness('b');let deps,foreground,data={profile:{id:'b'},partner:{id:'a'}},next=data;
  f.values.set('kPairingStatus',JSON.stringify({paired:true,partner:{userId:'a'},fetchedAt:Date.now()}));
  const app={currentState:'active',addEventListener:(_event,fn)=>{foreground=fn;return {remove(){}};}};
  const {BurrowSyncGate}=load('apps/mobile/src/components/burrow/burrow-sync-gate.tsx',{
    '@/lib/bunny-identity':{syncBunnyIdentity:async()=>{}},
    '@/lib/adventure-nudge':{resumeAdventureNudges:async()=>{},pauseAdventureNudges(){}},
    '@/lib/surprise-inbox':{notifySurpriseChanged(){}},
    '@/lib/friend-visit-local':{warmFriendVisit:async()=>{},friendVisitLocal:{resume:async()=>{},pause(){}}},
    '@/lib/burrow-foreground-prewarm':{prewarmBurrowPages:()=>()=>{}},'@/lib/use-home-entry':{useHomeEntry:()=>({pending:false})},
    '@/lib/burrow-game-room-cache': { notifyGameRoomChanged() {} },
      '@/lib/burrow-page-entry':{warmBurrowGameOverview:async()=>{}},
    '@/lib/release-room-api':{releaseRoomScope:()=> 'b',cachedReleaseRoom:()=>null},'@/lib/ui-idle':{afterUiSettles:()=>()=>{}},
    '@/lib/moments-cache':{momentsCache:{prepare:async()=>{},read:()=>({error:false})}},
    react:h.react,'react-native':{AppState:app},'@/lib/supabase':{supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},'@/lib/burrow-sync-controller':{createBurrowSync:options=>{deps=options;return {start(){void deps.refresh();},stop(){},request(){}};}},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data}),burrowClock:()=>0,getBurrowSnapshot:()=>({data}),invalidateBurrowPair:()=>{data=null;},refreshBurrowAfterCurrent:async()=>{data=next;}},
    '@/lib/burrow-memory-local':{readMemoryLocal:()=>({jobs:[]}),recoverMemoryJobs:async()=>true,subscribeMemoryLocal:()=>()=>{},subscribeMemoryRetry:()=>()=>{}},
    '@/lib/session-lifecycle':f.lifecycle,'@/lib/friends-api':f.api,
  });
  h.render(BurrowSyncGate);await flush();app.currentState='background';foreground('background');
  next={profile:{id:'b'},partner:null};assert.equal(f.api.getCachedPairing().paired,true,'offline device cannot yet know the remote mutation');
  app.currentState='active';foreground('active');await flush();assert.equal(data.partner,null);assert.equal(f.api.getCachedPairing().paired,false);h.unmount();
});
test('database Unpair removes both members, notifies both private topics and permits pairing again',async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema realtime;create schema auth;
      create table realtime.messages(id int);create function realtime.topic() returns text language sql as $$select ''::text$$;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table test_broadcasts(payload jsonb,event text,topic text,private boolean);create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into public.test_broadcasts values(payload,event,topic,private)$$;
      create table profiles(id uuid primary key);insert into profiles values('${a}'),('${b}');
      create table pairings(user_id uuid primary key,partner_user_id uuid,relationship text,relationship_since date,created_at timestamptz default now());
      create table friendships(id uuid default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz,unique(user_a,user_b));`);
    const old=fs.readFileSync('supabase/migrations/20260723000027_pairing_reflect_modes.sql','utf8');
    await db.exec(old.slice(old.indexOf('create or replace function public.unset_pairing('),old.indexOf('revoke all on function public.set_pairing(')));
    const instant=fs.readFileSync('supabase/migrations/20260920000098_instant_pairing_and_onboarding_profiles.sql','utf8');await db.exec(instant.slice(instant.indexOf('create or replace function public.pair_immediately(')));
    await db.exec(fs.readFileSync('supabase/migrations/20260820000053_pairing_realtime.sql','utf8'));
    const burrow=fs.readFileSync('supabase/migrations/20260920000129_burrow_sync_and_memory_outbox.sql','utf8');
    await db.exec(burrow.slice(burrow.indexOf('create function public.broadcast_burrow_change()'),burrow.indexOf('-- Business rows only')));
    await db.exec('create trigger burrow_change after insert or update or delete on pairings for each row execute function broadcast_burrow_change()');
    await db.query('select pair_immediately($1,$2)',[a,b]);
    const pairedEvents=(await db.query('select * from test_broadcasts')).rows;
    for(const id of [a,b])for(const [topic,event] of [[`pairing:${id}`,'pairing_changed'],[`burrow:${id}`,'pair_changed']])
      assert.ok(pairedEvents.some(row=>row.topic===topic&&row.event===event&&row.private),`committed pairing signals ${topic}`);
    await db.exec('truncate test_broadcasts');
    await db.query('select unset_pairing($1)',[a]);assert.equal((await db.query('select * from pairings')).rows.length,0);
    const events=(await db.query('select * from test_broadcasts')).rows;
    for(const id of [a,b])for(const topic of [`pairing:${id}`,`burrow:${id}`])assert.ok(events.some(event=>event.topic===topic&&event.private),topic);
    const result=(await db.query('select pair_immediately($1,$2) result',[a,b])).rows[0].result;assert.equal(result.error,null);assert.equal((await db.query('select * from pairings')).rows.length,2);
  }finally{await db.close();}
});
