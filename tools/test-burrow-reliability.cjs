const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');
const lib = 'apps/mobile/src/lib/';
const { HOME_BOOTSTRAP_TIMEOUT_MS } = load(lib+'async-lifecycle.ts');
const plain = value => JSON.parse(JSON.stringify(value));
function identity() {
  let user = 'A', epoch = 1; const listeners = new Set();
  return { sessionUserId: () => user, sessionEpoch: () => epoch,
    subscribeSessionIdentity(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    change(next) { user = next; epoch++; listeners.forEach(fn => fn()); } };
}
function disk() {
  const values = new Map();
  return { values, storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value), remove: key => values.delete(key) } };
}
const keys = { kBurrowSnapshot: { name: 'snapshot' }, kBurrowWallet: { name: 'wallet' }, kBurrowActionKeys: { name: 'commands' },
  kBurrowTextDrafts: { prefix: 'text:' }, kBurrowJournal: { keyFor: suffix => `journal:${suffix}` }, kReflectFeed: { name: 'feed' } };
const snapshot = (owner = 'A') => ({ profile: { id: owner }, partner: { id: 'B' }, pairVersion: 'one',
  serverNow: '2026-10-05T12:00:00Z', catalog: [], inventory: [], loadouts: [], musicTrackId: null,
  roomPhotos: [{ id: 'mine', ownerId: owner, kind: 'frame', updatedAt: '2026-10-05T11:00:00Z' }, { id: 'theirs', ownerId: 'B', kind: 'frame' }],
  memoryEntries: [{ author_id: owner, body: 'mine' }, { author_id: 'B', body: 'partner private' }],
  moments: [{ actor_id: owner }, { actor_id: 'B' }], affectionInbox: [{ secret: true }], gifts: [{ secret: true }] });

function bootstrapClientHarness(){
 const time=clock(),session=identity(),requests=[];
 const api=load(lib+'app-major-update-api.ts',{
  ...require('./rating-test-mocks.cjs'),
  'expo-crypto':{},'./session-lifecycle':session,
  './api':{apiClient:{get:(_path,options)=>{const next=deferred();requests.push({...next,options});return next.promise;}}},
  './async-lifecycle':load(lib+'async-lifecycle.ts',{},time.globals),'./coin-reward-store':{},
 },time.globals);
 return {api,time,session,requests};
}
test('the actual bootstrap API wrapper shares its flight and accepts a healthy eight-second response',async()=>{
 const h=bootstrapClientHarness(),controller=new AbortController();
 const read=h.api.fetchMajorUpdateBootstrap({signal:controller.signal});
 assert.equal(h.api.fetchMajorUpdateBootstrap(),read);
 h.time.advance(5000);await flush();assert.equal(h.requests.length,1);
 h.time.advance(3000);h.requests[0].resolve({success:true,...snapshot()});
 const data=await read;assert.equal(data.catalogComplete,true);assert.equal(data.profile.id,'A');
 assert.equal(h.requests[0].options.signal,controller.signal);
});
test('the bootstrap API wrapper remains bounded and rejects old-account responses after a slow read',async()=>{
 const h=bootstrapClientHarness();
 let read=h.api.fetchMajorUpdateBootstrap(),outcome=read.catch(error=>error.message);
 h.time.advance(HOME_BOOTSTRAP_TIMEOUT_MS);assert.equal(await outcome,'Operation timed out');
 read=h.api.fetchMajorUpdateBootstrap();outcome=read.catch(error=>error.message);
 h.time.advance(7000);h.session.change('C');h.requests[1].resolve({success:true,...snapshot()});
 assert.equal(await outcome,'session_changed');
 h.requests[0].resolve({success:true,...snapshot()});await flush();
});

for (const module of ['subscription', 'me-stats', 'reflect-feed-api']) test(`${module}: an old account response cannot repopulate private disk cache`, async () => {
  const session = identity(), store = disk(), pending = deferred(), time = clock();
  const dependencies = { './session-lifecycle': session, './storage': store, './api': { apiClient: { get: () => pending.promise } },
    './async-lifecycle': { withDeadline: value => value }, './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: session.sessionUserId() } } } }) } } },
    './remote-items': { mergedItemDictionary: () => ({ items: {} }) }, '../shared/storage/keys': keys };
  const api = load(lib + module + '.ts', dependencies, time.globals);
  const request = module === 'subscription' ? api.fetchSubscriptionTier('A') : module === 'me-stats' ? api.fetchMeStats('A') : api.fetchReflectFeed();
  const completion = request.catch(error => error.message);
  await flush(); session.change('C'); store.values.clear();
  pending.resolve({ success: true, data: { subscriptionTier: 'plus' }, stats: {}, profile: { displayName: 'private A' },
    days: [{ date: 'today', reflects: [{ id: 'private', body: 'private A', mode: 'typing', hasMemories: false }], itemIds: [] }] });
  await completion;
  assert.equal(store.values.size, 0);
  const cached = module === 'subscription' ? api.getCachedSubscription() : module === 'me-stats' ? api.getCachedMeStats() : api.getCachedFeed();
  assert.ok(cached === null || cached.length === 0);
});

test('Home snapshot is owner-bound, durable, personal-only, and preserves server clock age', () => {
  const store = disk(), time = clock();
  const cache = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  cache.persistBurrowSnapshot(snapshot(), 2000);
  const restarted = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  const value = restarted.readBurrowSnapshot('A');
  assert.equal(value.savedAt, 8000);
  assert.equal(value.data.roomPhotos.length, 1); assert.equal(value.data.memoryEntries.length, 1);
  assert.equal(value.data.moments.length, 1); assert.equal(value.data.affectionInbox.length, 0);
  assert.ok(!store.values.get('snapshot').includes('partner private'));
  assert.equal(restarted.readBurrowSnapshot('B'), null);
  time.advance(8 * 86_400_000); assert.equal(restarted.readBurrowSnapshot('A').data.profile.id, 'A');
});

test('storage exhaustion cannot make a successful server command look rejected', () => {
  const cache = load(lib + 'burrow-cache.ts', { './storage': { storage: { set() { throw Error('full'); }, remove() { throw Error('full'); } } }, '../shared/storage/keys': keys });
  assert.doesNotThrow(() => cache.persistBurrowSnapshot(snapshot()));
  assert.doesNotThrow(() => cache.persistBurrowActionKeys('A', new Map([['claim', 'key']])));
  assert.doesNotThrow(() => cache.persistBurrowWallet('A',{balance:1230,version:1}));
  assert.doesNotThrow(() => cache.clearBurrowSnapshot());
});
test('small confirmed wallet journal survives restart without serializing the full room or leaking across owners',()=>{
 const store=disk(),time=clock(),imports={'./storage':store,'../shared/storage/keys':keys};
 const cache=load(lib+'burrow-cache.ts',imports,time.globals),base={...snapshot(),wallet:{balance:1230,version:1}};
 cache.persistBurrowSnapshot(base);const room=store.values.get('snapshot');
 const coinState={wallet:{balance:1240,version:2},credits:[{key:'a',amount:10}],timezone:'UTC',localDate:'2026-10-17'};
 cache.persistBurrowWallet('A',coinState.wallet,coinState);assert.equal(store.values.get('snapshot'),room);
 const restored=load(lib+'burrow-cache.ts',imports,time.globals).readBurrowSnapshot('A');
 assert.equal(restored.data.wallet.balance,1240);assert.equal(restored.data.coinState.credits[0].key,'a');
 for(const [owner,wallet] of [['B',{balance:9999,version:99}],['A',{balance:1200,version:0}],['A',{balance:Number.MAX_SAFE_INTEGER+1,version:99}]]){
  cache.persistBurrowWallet(owner,wallet);assert.equal(cache.readBurrowSnapshot('A').data.wallet.balance,1230);
 }
 cache.persistBurrowWallet('A',{balance:-20,version:3},coinState);
 assert.equal(cache.readBurrowSnapshot('A').data.wallet.balance,-20);assert.equal(cache.readBurrowSnapshot('A').data.coinState,undefined,'do not combine different ledger versions');
 cache.clearBurrowSnapshot();assert.equal(store.values.has('wallet'),false);
});
test('purchased balances above the earning cap survive restart and spending below the display cap restores exact digits',()=>{
 const store=disk(),imports={'./storage':store,'../shared/storage/keys':keys},cache=load(lib+'burrow-cache.ts',imports),format=load(lib+'burrow-motion.ts').formatAnimatedCoins;
 cache.persistBurrowSnapshot({...snapshot(),wallet:{balance:99500,version:1}});
 for(const [balance,version,label] of [[100500,2,'99999+'],[100200,3,'99999+'],[99998,4,'99,998']]){
  cache.persistBurrowWallet('A',{balance,version});
  const fresh=load(lib+'burrow-cache.ts',imports).readBurrowSnapshot('A');
  assert.equal(fresh.data.wallet.balance,balance);assert.equal(fresh.data.wallet.version,version);assert.equal(format(fresh.data.wallet.balance),label);
 }
});

function storeHarness({ cached = false, outbox } = {}) {
  const session = identity(), time = clock(), store = disk(), requests = [];
  const cache = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  if (cached) cache.persistBurrowSnapshot(snapshot());
  let key = 0;
  const api = load(lib + 'burrow-store.ts', {
    './adventure-arrival': load(lib + 'adventure-arrival.ts'),
    react: { useCallback: value => value, useSyncExternalStore() {} }, 'expo-router': { useFocusEffect() {} },
    '@react-navigation/native': {useIsFocused:()=>true},
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } }, 'expo-crypto': { randomUUID: () => `key-${++key}` },
    './session-lifecycle': session, './burrow-cache': cache,
    './async-lifecycle':load(lib+'async-lifecycle.ts',{},time.globals),
    './coin-reward-store': { syncCoinWallet() {}, setCoinRewardReconciler() {}, subscribeCoinWallet() {}, getConfirmedCoinWallet: () => null },
    './app-major-update-api': { fetchMajorUpdateBootstrap: options => { const pending = deferred(); pending.options = options; requests.push(pending); return pending.promise; } },
    ...(outbox?{'./coin-command-outbox':outbox}:{}),
  }, { ...time.globals, performance: { now: () => time.globals.Date.now() } });
  return { api, requests, time, session, store };
}
test('pending cooperative display is attached to own pending record, then authoritative solo replaces all preview coordination',async()=>{
 const h=storeHarness(),read=h.api.refreshBurrow();
 h.requests[0].resolve({...snapshot(),localDate:'2026-10-05',activeAdventure:null});await read;
 const team={id:'partner-party',ruleVersion:5,version:1,leaderId:'B',followerId:'A',partnerId:'A',pairVersion:'one',plus:false,
  progressAt:'2026-10-05T12:00:00Z',progressFraction:.3,endsAt:'2026-10-05T14:00:00Z'};
 const p={owner:'A',scope:'A:B:one',localDate:'2026-10-05',recordId:'pending:my-log',startedAt:'2026-10-05T12:00:00Z',endsAt:team.endsAt,team};
 h.api.projectAdventureJournalLocally(p);let data=h.api.getBurrowSnapshot().data;
 assert.equal(data.activeAdventure.id,'pending:pending:my-log');assert.equal(data.activeAdventure.localStartPending,true);
 assert.equal(data.adventureTeam.adventureId,data.activeAdventure.id);assert.equal(data.adventureTeam.team.followerId,'A');
 assert.equal(data.adventureTeam.nudgeAvailable,false);
 h.api.projectAdventureJournalLocally({...p,recordId:'confirmed-log',adventureId:'own-personal-trip',team:{...team,id:'own-party',leaderId:'A',followerId:null,partnerId:'B'}});
 data=h.api.getBurrowSnapshot().data;assert.equal(data.activeAdventure.id,'own-personal-trip');assert.equal(data.activeAdventure.localStartPending,undefined);
 assert.equal(data.adventureTeam.team.followerId,null);assert.equal(data.adventureTeam.adventureId,'own-personal-trip');
});
test('first-pair invalidation retains only a previously solo personal scene; existing-pair invalidation still clears private data',async()=>{
 const h=storeHarness();let read=h.api.refreshBurrow();
 h.requests[0].resolve({...snapshot(),partner:null,pairVersion:undefined,pairAccessVerified:true});await read;
 h.api.invalidateBurrowPair({retainSolo:true});let state=h.api.getBurrowSnapshot();
 assert.equal(state.data.profile.id,'A');assert.equal(state.data.partner,null);assert.equal(state.pairInvalidated,true);assert.equal(state.data.pairAccessVerified,undefined);
 // Both private realtime channels may announce the same transaction.
 h.api.invalidateBurrowPair({retainSolo:true});assert.equal(h.api.getBurrowSnapshot().data.profile.id,'A');
 read=h.api.refreshBurrow({silent:true});h.requests[1].resolve({...snapshot(),pairAccessVerified:true});await read;
 assert.equal(h.api.getBurrowSnapshot().data.partner.id,'B');
 h.api.invalidateBurrowPair({retainSolo:true});state=h.api.getBurrowSnapshot();assert.equal(state.data,null);assert.equal(state.pairInvalidated,true);
});
test('optional Home metadata retains confirmed values only within the same day, tier and relationship',async()=>{
 const optional={dailyPlusBonus:{claimed:true,key:'daily'},photoUsage:{localDate:'today',frame:{remaining:0}},
  lastCareAt:{food:'time',water:null},adventureCollection:{enabled:true,displays:[],progress:[]}};
 const base={...snapshot(),localDate:'today',hasPlus:true,wallet:{balance:10,version:1}};
 for(const change of [{},{localDate:'tomorrow'},{hasPlus:false},{pairVersion:'two'},{partner:{id:'C'}}]){
  const h=storeHarness();let read=h.api.refreshBurrow();h.requests[0].resolve({...base,...optional});await read;
  read=h.api.refreshBurrow({silent:true});h.requests[1].resolve({...base,...change,wallet:{balance:20,version:2}});await read;
  const data=h.api.getBurrowSnapshot().data;
  assert.equal(data.wallet.balance,20,'core wallet never falls back');
  for(const key of Object.keys(optional))assert.deepEqual(plain(data[key]??null),Object.keys(change).length?null:optional[key]);
 }
});
test('cold offline Home restores the personal room immediately and its read ends at the finite Home hard limit',async()=>{
  const h=storeHarness({cached:true});
  const before=h.api.getBurrowSnapshot().data;
  assert.equal(before.profile.id,'A');assert.equal(before.roomPhotos.length,1);
  const read=h.api.refreshBurrow({silent:true});
  h.time.advance(HOME_BOOTSTRAP_TIMEOUT_MS-1);await flush();
  assert.equal(h.requests[0].options.signal.aborted,false);
  h.time.advance(1);await read;
  assert.equal(h.requests[0].options.signal.aborted,true);
  assert.equal(h.api.getBurrowSnapshot().loading,false);
  assert.equal(h.api.getBurrowSnapshot().data,before);
  assert.equal(h.api.getBurrowSnapshot().error,null);
  assert.equal(h.api.getBurrowSnapshot().syncError,'network_error');
  h.requests[0].resolve({...snapshot(),musicTrackId:'late'});await flush();
  assert.equal(h.api.getBurrowSnapshot().data,before,'timed-out response must not overwrite cached display');
});
test('Home with no snapshot stops at its hard limit; silent retries never reopen a spinner',async()=>{
  const h=storeHarness();const read=h.api.refreshBurrow();
  assert.equal(h.api.getBurrowSnapshot().loading,true);
  h.time.advance(HOME_BOOTSTRAP_TIMEOUT_MS);await read;
  assert.equal(h.api.getBurrowSnapshot().loading,false);
  assert.equal(h.api.getBurrowSnapshot().data,null,'fallback artwork must not fabricate authoritative data');
  h.time.advance(2000);await flush();
  assert.equal(h.requests.length,2);
  assert.equal(h.api.getBurrowSnapshot().loading,false);
  const retry=h.api.refreshBurrow({silent:true});
  h.requests[1].resolve(snapshot());await retry;
  assert.equal(h.api.getBurrowSnapshot().data.profile.id,'A');
  assert.equal(h.api.getBurrowSnapshot().syncError,null);
  assert.equal(h.api.getBurrowSnapshot().error,null);
});
test('Home read deadline cannot cancel a pending payment or durable command',async()=>{
  const h=storeHarness({cached:true}),payment=deferred();
  const command=h.api.runBurrowAction('buy',()=>payment.promise,{silent:true});
  const read=h.api.refreshBurrow({silent:true});
  h.time.advance(HOME_BOOTSTRAP_TIMEOUT_MS);await read;
  payment.resolve();assert.equal(await command,true);
});
test('healthy Home at eight seconds succeeds without a five-second Retry or duplicate read',async()=>{
  const h=storeHarness(),read=h.api.refreshBurrow();
  h.time.advance(5000);await flush();
  assert.equal(h.api.getBurrowSnapshot().loading,true);
  assert.equal(h.api.getBurrowSnapshot().error,null);
  assert.equal(h.requests[0].options.signal.aborted,false);
  h.time.advance(3000);h.requests[0].resolve(snapshot());await read;
  assert.equal(h.requests.length,1);
  assert.equal(h.api.getBurrowSnapshot().data.profile.id,'A');
  assert.equal(h.api.getBurrowSnapshot().syncError,null);
  assert.equal(h.api.getBurrowSnapshot().loading,false);
});
test('a slow Home response still cannot restore a discarded pairing',async()=>{
  const h=storeHarness(),read=h.api.refreshBurrow();
  h.time.advance(6000);await flush();h.api.invalidateBurrowPair();
  h.requests[0].resolve(snapshot());await read;
  assert.equal(h.api.getBurrowSnapshot().data,null);
  assert.equal(h.api.getBurrowSnapshot().pairInvalidated,true);
});
test('silent Home 401 retains cache; navigation does not retry, the bounded background retry does',async()=>{
  const h=storeHarness();const first=h.api.refreshBurrow();h.requests[0].resolve(snapshot());await first;
  const resume=h.api.refreshBurrow({silent:true});
  h.requests[1].reject(Object.assign(Error('HTTP 401'),{body:{error:'Unauthorized'},status:401}));await resume;
  assert.equal(h.api.getBurrowSnapshot().data.profile.id,'A');
  assert.equal(h.api.getBurrowSnapshot().error,null);
  assert.equal(h.api.getBurrowSnapshot().syncError,'Unauthorized');
  await h.api.refreshBurrowIfStale();assert.equal(h.requests.length,2);
  h.time.advance(2000);assert.equal(h.requests.length,3);
  h.requests[2].resolve(snapshot());await flush();
  assert.equal(h.api.getBurrowSnapshot().syncError,null);
});
test('session refresh failure rejects token resolution rather than sending an unauthenticated request',async()=>{
  let config;
  load(lib+'api.ts',{
    './session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=>undefined},
    '@novame/api-client':{ApiClient:class{constructor(options){config=options;}}},
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:null},error:Error('network interrupted during auth refresh')})}}},
  },{process:{env:{EXPO_PUBLIC_API_URL:'https://example.invalid'}}});
  await assert.rejects(config.getToken(),/auth_refresh_failed/);
});
test('the real HTTP client never fetches on auth-refresh failure; valid sessions still attach the current token',async()=>{
  const calls=[];let authError=true;
  const client=load('packages/api-client/src/index.ts',{'./error':{ApiError:class extends Error{}}},{
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>'{"success":true}'};},
  });
  const api=load(lib+'api.ts',{
    './session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=>undefined},
    '@novame/api-client':client,
    './supabase':{supabase:{auth:{getSession:async()=>authError?{data:{session:null},error:Error('offline')}
      :{data:{session:{access_token:'current-test-token'}},error:null}}}},
  },{process:{env:{EXPO_PUBLIC_API_URL:'https://example.invalid'}}});
  await assert.rejects(api.apiClient.get('/api/vnext/bootstrap'),/auth_refresh_failed/);assert.equal(calls.length,0);
  authError=false;await api.apiClient.get('/api/vnext/bootstrap');
  assert.equal(calls[0].options.headers.Authorization,'Bearer current-test-token');
});
test('background aborts snapshot reads; resume forces a fresh read even with recent cache, and ignores old failures',async()=>{
  const h=storeHarness();let read=h.api.refreshBurrow();h.requests[0].resolve(snapshot());await read;
  read=h.api.refreshBurrow({silent:true});
  h.api.observeBurrowAppState('background');
  assert.equal(h.requests[1].options.signal.aborted,true);
  h.api.observeBurrowAppState('active');assert.equal(h.requests.length,3);
  h.requests[1].reject(Error('timeout'));await read;
  assert.equal(h.api.getBurrowSnapshot().error,null);assert.equal(h.api.getBurrowSnapshot().syncError,null);
  h.requests[2].resolve({...snapshot(),musicTrackId:'new'});await flush();
  assert.equal(h.api.getBurrowSnapshot().data.musicTrackId,'new');
  assert.equal(h.time.timers.size,0);
});
test('late successful pre-background snapshot cannot overwrite the resumed scene',async()=>{
  const h=storeHarness(),old=h.api.refreshBurrow();
  h.api.observeBurrowAppState('background');h.api.observeBurrowAppState('active');
  h.requests[1].resolve({...snapshot(),musicTrackId:'new'});await flush();
  h.requests[0].resolve({...snapshot(),musicTrackId:'old'});await old;
  assert.equal(h.api.getBurrowSnapshot().data.musicTrackId,'new');
});
test('StoreKit inactive state does not abort reads or payment command settlement',async()=>{
  const h=storeHarness(),read=h.api.refreshBurrow(),payment=deferred();
  const action=h.api.runBurrowAction('payment',()=>payment.promise);
  h.api.observeBurrowAppState('inactive');h.api.observeBurrowAppState('active');
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.signal.aborted,false);
  payment.resolve({});assert.equal(await action,true);
  h.requests[0].resolve(snapshot());await read;
});
test('silent read failure retries with backoff, stops after success, and never polls healthy snapshots',async()=>{
  const h=storeHarness();let read=h.api.refreshBurrow();h.requests[0].resolve(snapshot());await read;
  read=h.api.refreshBurrow({silent:true});h.requests[1].reject(Error('offline'));await read;
  h.time.advance(1999);assert.equal(h.requests.length,2);
  h.time.advance(1);assert.equal(h.requests.length,3);
  h.requests[2].reject(Error('offline'));await flush();
  h.time.advance(3999);assert.equal(h.requests.length,3);
  h.time.advance(1);assert.equal(h.requests.length,4);
  h.requests[3].resolve(snapshot());await flush();h.time.advance(120000);
  assert.equal(h.requests.length,4);assert.equal(h.api.getBurrowSnapshot().syncError,null);
});
test('retry timers stop on background and identity changes; durable command keys survive background',async()=>{
  const h=storeHarness(),used=[];
  const read=h.api.refreshBurrow();h.requests[0].reject(Error('offline'));await read;
  await h.api.runBurrowAction('claim',async key=>{used.push(key);throw Error('offline');},{silent:true});
  h.api.observeBurrowAppState('background');h.time.advance(60000);assert.equal(h.requests.length,1);
  assert.equal(await h.api.runBurrowAction('claim',async key=>used.push(key),{silent:true}),true);
  assert.equal(used[0],used[1]);
  h.api.observeBurrowAppState('active');h.requests[1].reject(Error('offline'));await flush();
  h.session.change('C');h.time.advance(60000);assert.equal(h.requests.length,2);
});
test('initial/manual read errors and pair/feature failures remain visible; cached silent failure preserves action errors',async()=>{
  const h=storeHarness();let read=h.api.refreshBurrow();h.requests[0].reject(Error('offline'));await read;
  assert.equal(h.api.getBurrowSnapshot().error,'network_error');
  read=h.api.refreshBurrow();h.requests[1].resolve(snapshot());await read;
  await h.api.runBurrowAction('buy',async()=>{throw {body:{error:'insufficient_balance'}};});
  read=h.api.refreshBurrow({silent:true});h.requests[2].reject(Error('offline'));await read;
  assert.equal(h.api.getBurrowSnapshot().error,'insufficient_balance');
  read=h.api.refreshBurrow({silent:true});h.requests[3].reject({body:{error:'not_paired'}});await read;
  assert.equal(h.api.getBurrowSnapshot().error,'not_paired');assert.equal(h.api.getBurrowSnapshot().data,null);
  assert.equal(h.time.timers.size,1,'only the existing action reconciliation timer remains, not a fatal-read retry');
});
test('page entry shares one bootstrap; mutations batch into a single followup', async () => {
  const h = storeHarness(), first = h.api.refreshBurrow();
  const entry = h.api.refreshBurrowAfterCurrent();
  assert.equal(first, entry); assert.equal(h.requests.length, 1);
  h.time.advance(1);
  const mutation = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  const duplicate = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  assert.equal(mutation, duplicate);
  h.requests[0].resolve(snapshot()); await first; await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(snapshot()); await mutation;
  await Promise.all(Array.from({ length: 10 }, (_, i) => h.api.runBurrowAction(`tap:${i}`, async () => {}, { silent: true })));
  assert.equal(h.requests.length, 2, 'confirmed taps do not wait on whole-page reads');
  h.time.advance(400); assert.equal(h.requests.length, 3);
  h.requests[2].resolve(snapshot()); await flush();
});
test('uncertain command keeps its key across retries and double taps share a write', async () => {
  const h = storeHarness(), pending = deferred(), used = [];
  const one = h.api.runBurrowAction('claim', key => { used.push(key); return pending.promise; }, { silent: true });
  const two = h.api.runBurrowAction('claim', () => { throw Error('duplicate'); }, { silent: true });
  assert.equal(one, two); pending.reject(Error('offline')); assert.equal(await one, false);
  const retry = await h.api.runBurrowAction('claim', async key => { used.push(key); }, { silent: true });
  assert.equal(retry, true); assert.equal(used[0], used[1]);
});
test('a completed post-command sync satisfies the deferred action refresh; a later partner change still reads',async()=>{
 const h=storeHarness();
 await h.api.runBurrowAction('love-letter:one',async()=>{},{silent:true});const after=h.api.burrowClock();
 h.time.advance(10);const sync=h.api.refreshBurrowAfterCurrent({after});h.requests[0].resolve(snapshot());await sync;
 h.time.advance(390);await flush();assert.equal(h.requests.length,1,'send and realtime reconciliation share a completed authoritative read');
 h.time.advance(1);const changed=h.api.refreshBurrowAfterCurrent({after:h.api.burrowClock()});assert.equal(h.requests.length,2);
 h.requests[1].resolve(snapshot());await changed;
});
test('failed reads, pairing invalidation, and account changes cannot satisfy a later change',async()=>{
 for(const scenario of ['failure','pair','account']){
  const h=storeHarness(),after=h.api.burrowClock();h.time.advance(1);
  const read=h.api.refreshBurrowAfterCurrent({after});
  if(scenario==='failure')h.requests[0].reject(Error('offline'));else h.requests[0].resolve(snapshot());await read;
  if(scenario==='pair')h.api.invalidateBurrowPair();if(scenario==='account')h.session.change('C');
  const next=h.api.refreshBurrowAfterCurrent({after});assert.equal(h.requests.length,2,scenario);
  h.requests[1].resolve(snapshot(scenario==='account'?'C':'A'));await next;
 }
});
test('a completed read with the same coarse timestamp cannot hide a subsequent command',async()=>{
 const h=storeHarness(),read=h.api.refreshBurrow();h.requests[0].resolve(snapshot());await read;
 await h.api.runBurrowAction('love-letter:same-tick',async()=>{},{silent:true});h.time.advance(400);
 assert.equal(h.requests.length,2);h.requests[1].resolve(snapshot());await flush();
});
test('quota failures report the scoped error, keep the receipt key, and never refresh unchanged Home',async()=>{
 for(const code of ['love_note_minute_limit','love_note_daily_limit']){
  const h=storeHarness(),seen=[],used=[];
  assert.equal(await h.api.runBurrowAction('letter',async key=>{used.push(key);throw {body:{error:code}};},{silent:true,onError:e=>seen.push(e.body.error)}),false);
  h.time.advance(1000);await flush();assert.equal(h.requests.length,0);assert.deepEqual(seen,[code]);
  assert.equal(await h.api.runBurrowAction('letter',async key=>used.push(key),{silent:true}),true);assert.equal(used[0],used[1]);
  h.time.advance(400);assert.equal(h.requests.length,1);h.requests[0].resolve(snapshot());await flush();
 }
});
test('uncertain send failures still reconcile; an old-account failure cannot call the current UI callback',async()=>{
 const h=storeHarness(),seen=[],pending=deferred();
 const old=h.api.runBurrowAction('old',()=>pending.promise,{silent:true,onError:e=>seen.push(e)});
 h.session.change('C');pending.reject({body:{error:'love_note_daily_limit'}});assert.equal(await old,false);assert.equal(seen.length,0);
 await h.api.runBurrowAction('uncertain',async()=>{throw Error('offline');},{silent:true,onError:()=>{throw Error('UI failure');}});
 h.time.advance(400);assert.equal(h.requests.length,1);h.requests[0].resolve(snapshot('C'));await flush();
});

test('a mutation during the followup read schedules one further authoritative read', async () => {
  const h = storeHarness(), first = h.api.refreshBurrow();
  h.time.advance(1); const followup = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  h.requests[0].resolve(snapshot()); await first; await flush();
  assert.equal(h.requests.length, 2);
  h.time.advance(1); assert.equal(h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() }), followup);
  h.requests[1].resolve(snapshot()); await flush(); assert.equal(h.requests.length, 3);
  h.requests[2].resolve(snapshot()); await followup;
});
test('photo receipt wins over a read begun before upload, but later deletion remains authoritative', async () => {
  const h = storeHarness();
  let read = h.api.refreshBurrow(); h.requests[0].resolve(snapshot()); await read;
  read = h.api.refreshBurrow(); h.time.advance(1);
  const photo = { id: 'mine', ownerId: 'A', kind: 'frame', updatedAt: '2026-10-05T12:00:00Z' };
  h.api.setBurrowPhotoLocally(photo);
  h.requests[1].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.find(row => row.id === 'mine').updatedAt, photo.updatedAt);
  h.time.advance(1); read = h.api.refreshBurrow();
  h.requests[2].resolve({ ...snapshot(), roomPhotos: [] }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.length, 0);
});

test('toy photo receipts preserve other faces, per-toy quotas and restart metadata, including a stale refresh', async () => {
  const h=storeHarness();
  const base={...snapshot(),localDate:'2026-10-08',roomPhotos:[
    {id:'face-A',ownerId:'A',kind:'doll',toyId:'toy-A',updatedAt:'2026-10-08T10:00:00Z'},
    {id:'face-B',ownerId:'A',kind:'doll',toyId:'toy-B',updatedAt:'2026-10-08T10:00:00Z'}],dollPhotoChangesUsed:['toy-A']};
  let read=h.api.refreshBurrow();h.requests[0].resolve(base);await read;
  read=h.api.refreshBurrow({silent:true});h.time.advance(5);
  const updated={...base.roomPhotos[1],updatedAt:'2026-10-08T12:00:00Z'};
  h.api.setBurrowPhotoLocally(updated);
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.length,2);
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.find(p=>p.toyId==='toy-A').id,'face-A');
  assert.deepEqual(plain(h.api.getBurrowSnapshot().data.dollPhotoChangesUsed),['toy-A','toy-B']);
  h.requests[1].resolve(base);await read;
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.find(p=>p.toyId==='toy-B').updatedAt,updated.updatedAt);
  const persisted=JSON.parse(h.store.values.get('snapshot')).data;
  assert.equal(persisted.roomPhotos.find(p=>p.toyId==='toy-B').updatedAt,updated.updatedAt);
  assert.deepEqual(persisted.dollPhotoChangesUsed,['toy-A','toy-B']);
});
test('background reads cannot overwrite the latest local music selection', async () => {
  const h = storeHarness(); let read = h.api.refreshBurrow(); h.requests[0].resolve(snapshot()); await read;
  read = h.api.refreshBurrow(); h.time.advance(1);
  const token = h.api.selectBurrowMusicLocally('calm'); h.api.confirmBurrowMusicLocally(token);
  h.requests[1].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data.musicTrackId, 'calm');
});

test('partner toy receipt keeps owner-specific quota through stale reads without persisting private partner photos',async()=>{
  const h=storeHarness(),base={...snapshot(),localDate:'2026-10-08',dollPhotoChangesUsed:['toy'],
    dollPhotoChangeTargetsUsed:[{ownerId:'A',toyId:'toy'}]};
  let read=h.api.refreshBurrow();h.requests[0].resolve(base);await read;
  read=h.api.refreshBurrow({silent:true});h.time.advance(5);
  const photo={id:'partner-toy',ownerId:'B',kind:'doll',toyId:'toy',updatedAt:'2026-10-08T12:00:00Z'};
  h.api.setBurrowPhotoLocally(photo);
  h.requests[1].resolve(base);await read;
  const updated=h.api.getBurrowSnapshot().data;
  assert.equal(updated.roomPhotos.find(p=>p.id==='partner-toy').updatedAt,photo.updatedAt);
  assert.deepEqual(plain(updated.dollPhotoChangesUsed),['toy']);
  assert.deepEqual(plain(updated.dollPhotoChangeTargetsUsed),[{ownerId:'A',toyId:'toy'},{ownerId:'B',toyId:'toy'}]);
  assert.equal(JSON.parse(h.store.values.get('snapshot')).data.roomPhotos.some(p=>p.ownerId==='B'),false);
});

test('committed room decoration survives an older read and solo receipts use the personal room', async () => {
  const h = storeHarness(); let read = h.api.refreshBurrow(); h.requests[0].resolve({ ...snapshot(), partner: null }); await read;
  read = h.api.refreshBurrow(); h.time.advance(1); h.api.setBurrowLoadoutLocally({ table: 'new-table' }, 'A');
  h.requests[1].resolve({ ...snapshot(), partner: null }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].item_id, 'new-table');
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].room_type, 'home');
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].owner_id, 'A');
  h.time.advance(1); read = h.api.refreshBurrow(); h.requests[2].resolve({ ...snapshot(), partner: null }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.loadouts.length, 0, 'later authoritative changes still win');
});

test('confirmed toy purchase survives stale reads and restart cache; a later authoritative read replaces its temporary ID', async () => {
  const h = storeHarness(); let read = h.api.refreshBurrow(); h.requests[0].resolve(snapshot()); await read;
  read = h.api.refreshBurrow(); h.time.advance(1);
  h.api.confirmBurrowPurchaseLocally('toy-blue', 'A', 'receipt');
  h.api.confirmBurrowPurchaseLocally('toy-blue', 'A', 'receipt');
  assert.equal(h.api.getBurrowSnapshot().data.inventory.length, 1);
  assert.ok(h.store.values.get('snapshot').includes('toy-blue'));
  h.requests[1].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data.inventory[0].item_id, 'toy-blue');
  h.time.advance(1); read = h.api.refreshBurrow();
  h.requests[2].resolve({ ...snapshot(), inventory: [{ id:'real-inventory-id', owner_id:'A', item_id:'toy-blue', source:'purchase' }] }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.inventory.length, 1);
  assert.equal(h.api.getBurrowSnapshot().data.inventory[0].id, 'real-inventory-id');
  h.session.change('C');
  h.api.confirmBurrowPurchaseLocally('toy-private', 'A', 'old-account');
  assert.equal(h.api.getBurrowSnapshot().data, null);
});
test('server-confirmed adventure claim clears the badge immediately and an older read cannot reopen it',async()=>{
  const h=storeHarness();
  const arrived={...snapshot(),activeAdventure:{id:'journey',status:'result_ready'},adventureResult:{id:'result',claim_status:'pending'}};
  let read=h.api.refreshBurrow();h.requests[0].resolve(arrived);await read;
  read=h.api.refreshBurrow();h.time.advance(1);
  h.api.confirmBurrowAdventureClaimLocally('wrong-journey');assert.ok(h.api.getBurrowSnapshot().data.activeAdventure);
  h.api.confirmBurrowAdventureClaimLocally('journey');
  assert.equal(h.api.getBurrowSnapshot().data.activeAdventure,null);assert.equal(h.api.getBurrowSnapshot().data.adventureResult,null);
  assert.equal(JSON.parse(h.store.values.get('snapshot')).data.activeAdventure,null);
  h.requests[1].resolve(arrived);await read;assert.equal(h.api.getBurrowSnapshot().data.activeAdventure,null);
  h.time.advance(1);read=h.api.refreshBurrow();h.requests[2].resolve({...snapshot(),activeAdventure:{id:'next',status:'in_progress'},adventureResult:null});await read;
  assert.equal(h.api.getBurrowSnapshot().data.activeAdventure.id,'next');
  h.session.change('C');h.api.confirmBurrowAdventureClaimLocally('next');assert.equal(h.api.getBurrowSnapshot().data,null);
});
test('confirmed affection closes today immediately, persists, and cannot be undone by an older read or leak across users',async()=>{
  const h=storeHarness(), before={...snapshot(),lastAffectionAt:null};
  let read=h.api.refreshBurrow();h.requests[0].resolve(before);await read;
  read=h.api.refreshBurrow();h.time.advance(1);
  h.api.confirmBurrowAffectionLocally('wrong');assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,null);
  h.api.confirmBurrowAffectionLocally('A');
  const at=h.api.getBurrowSnapshot().data.lastAffectionAt;
  assert.equal(at,'2026-10-05T12:00:00.001Z');
  assert.equal(JSON.parse(h.store.values.get('snapshot')).data.lastAffectionAt,at);
  h.requests[1].resolve(before);await read;assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,at);
  h.time.advance(1);read=h.api.refreshBurrow();
  h.requests[2].resolve({...before,lastAffectionAt:'2026-10-05T12:00:00Z'});await read;
  assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,'2026-10-05T12:00:00Z');
  h.session.change('C');h.api.confirmBurrowAffectionLocally('A');assert.equal(h.api.getBurrowSnapshot().data,null);
});
test('durable affection reserves Free without falsely confirming it; Plus remains repeatable and late receipts are pair-bound',async()=>{
 const rows=[],listeners=new Set();
 const outbox={coinOperations:{pending:()=>rows,subscribeSettled:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},
  enqueueAffectionCommand:(type,metrics,key)=>{const id='complete_affection:'+key;
   rows.push({id,owner:'A',payload:{action:'complete_affection',affectionType:type,idempotencyKey:key},quest:{scope:'A:B:one',day:'2026-10-05'}});return id;}};
 const h=storeHarness({outbox}),base={...snapshot(),localDate:'2026-10-05',lastAffectionAt:null,hasPlus:false};
 let read=h.api.refreshBurrow();h.requests[0].resolve(base);await read;
 assert.equal(h.api.enqueueBurrowAffection('hug',{durationMs:3000},'one',base),'complete_affection:one');
 assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,null,'only a real receipt confirms the day');
 assert.throws(()=>h.api.enqueueBurrowAffection('kiss',{scale:1.6},'two',base),/daily_limit_reached/);
 read=h.api.refreshBurrow();h.requests[1].resolve({...base,hasPlus:true});await read;
 h.api.enqueueBurrowAffection('kiss',{scale:1.6},'two',base);assert.equal(rows.length,2);
 for(const fn of listeners)fn({operation:rows[0],error:Error('invalid_request')});
 assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,null);
 for(const fn of listeners)fn({operation:rows[1],receipt:{eventId:'verified'}});
 assert.ok(h.api.getBurrowSnapshot().data.lastAffectionAt,'global observer survives the originating page');
 read=h.api.refreshBurrow();h.requests[2].resolve({...base,hasPlus:true,partner:{id:'C'},pairVersion:'two'});await read;
 assert.throws(()=>h.api.enqueueBurrowAffection('hug',{durationMs:3000},'new',base),/pair_changed/);
 for(const fn of listeners)fn({operation:rows[0],receipt:{eventId:'stale'}});
 assert.equal(h.api.getBurrowSnapshot().data.lastAffectionAt,null,'old pair receipt never consumes the new entry');
 h.session.change('D');for(const fn of listeners)fn({operation:rows[0],receipt:{eventId:'old-user'}});
 assert.equal(h.api.getBurrowSnapshot().data,null);
});
test('confirmed intermediate adventure receipt and its furniture survive stale reads and persist for restart',async()=>{
  const h=storeHarness();
  const arrived={...snapshot(),activeAdventure:{id:'journey',status:'result_ready'},adventureResult:{id:'result',claim_status:'pending',metadata:{}}};
  let read=h.api.refreshBurrow();h.requests[0].resolve(arrived);await read;
  read=h.api.refreshBurrow();h.time.advance(1);
  h.api.confirmBurrowAdventureItemLocally('wrong','chair');assert.equal(h.api.getBurrowSnapshot().data.inventory.length,0);
  h.api.confirmBurrowAdventureItemLocally('journey','chair');h.api.confirmBurrowAdventureItemLocally('journey','chair');
  h.api.confirmBurrowAdventureInteractionLocally('journey',true);
  const persisted=JSON.parse(h.store.values.get('snapshot')).data;
  assert.equal(persisted.activeAdventure.status,'interaction_required');assert.equal(persisted.adventureResult.metadata.treasureClaimed,true);
  assert.equal(persisted.inventory.length,1);assert.equal(persisted.inventory[0].source,'adventure');
  h.requests[1].resolve(arrived);await read;
  assert.equal(h.api.getBurrowSnapshot().data.adventureResult.metadata.treasureClaimed,true);
  assert.equal(h.api.getBurrowSnapshot().data.inventory[0].item_id,'chair');
  h.api.confirmBurrowAdventureClaimLocally('journey');
  assert.equal(h.api.getBurrowSnapshot().data.activeAdventure,null);
  assert.equal(h.api.getBurrowSnapshot().data.inventory[0].item_id,'chair');
  h.session.change('C');h.api.confirmBurrowAdventureItemLocally('journey','private-gift');assert.equal(h.api.getBurrowSnapshot().data,null);
});
test('failed optional attention read preserves same-pair metadata, but changing partner drops it',async()=>{
  const h=storeHarness(),attention={scope:'A:B:one',localDate:'2026-10-10',games:[{id:'game:result',at:'today'}],journal:[],moments:[],letters:[]};
  let read=h.api.refreshBurrow();h.requests[0].resolve({...snapshot(),attention});await read;
  read=h.api.refreshBurrow();h.requests[1].resolve(snapshot());await read;assert.deepEqual(plain(h.api.getBurrowSnapshot().data.attention),attention);
  read=h.api.refreshBurrow();h.requests[2].resolve({...snapshot(),partner:{id:'new'},pairVersion:'two'});await read;assert.equal(h.api.getBurrowSnapshot().data.attention,undefined);
});
test('late bootstrap after sign-out cannot display or persist the old Home', async () => {
  const h = storeHarness(), read = h.api.refreshBurrow();
  h.session.change(null); h.store.values.clear(); h.requests[0].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data, null); assert.equal(h.store.values.size, 0);
});

test('latest selection queue serializes writes and skips intermediate taps', async () => {
  const { createLatestSelectionQueue } = load(lib + 'latest-selection-queue.ts');
  const calls = [], pending = deferred(), failures = [];
  const queue = createLatestSelectionQueue(value => { calls.push(value); return value === 'A' ? pending.promise : Promise.resolve(); }, value => failures.push(value));
  const done = queue.select('A'); queue.select('B'); queue.select('C');
  assert.deepEqual(calls, ['A']); pending.resolve(); await done;
  assert.deepEqual(calls, ['A', 'C']); assert.deepEqual(failures, []);
});
test('queue reset prevents an old-owner failure from rolling back the new selection', async () => {
  const { createLatestSelectionQueue } = load(lib + 'latest-selection-queue.ts');
  const old = deferred(), calls = [], failures = [];
  const queue = createLatestSelectionQueue(value => { calls.push(value); return value === 'A' ? old.promise : Promise.resolve(); }, value => failures.push(value));
  const done = queue.select('A'); queue.reset(); await queue.select('C'); old.reject(Error('offline')); await done;
  assert.deepEqual(calls, ['A', 'C']); assert.deepEqual(failures, []);
});
test('journal/letter drafts survive restart, reuse a retry key, and reject another account', () => {
  const session = identity(), store = disk(); let key = 0;
  const imports = { './storage': store, '../shared/storage/keys': keys, './session-lifecycle': session, 'expo-crypto': { randomUUID: () => `key-${++key}` } };
  const drafts = load(lib + 'burrow-text-drafts.ts', imports);
  const original = drafts.keepBurrowTextDraft('A:one', 'page', 'A memory', 'version-1');
  const restarted = load(lib + 'burrow-text-drafts.ts', imports);
  assert.deepEqual(plain(restarted.readBurrowTextDraft('A:one', 'page')), plain(original));
  assert.equal(restarted.keepBurrowTextDraft('A:one', 'page', 'A memory', 'version-2').key, original.key);
  const edited = restarted.keepBurrowTextDraft('A:one', 'page', 'Edited', 'version-2');
  assert.notEqual(edited.key, original.key);
  restarted.removeBurrowTextDraft('A:one', 'page', original.key); assert.ok(restarted.readBurrowTextDraft('A:one', 'page'));
  assert.throws(() => restarted.rebaseBurrowTextDraft('A:one', 'page', original.key, 'version-3'), /draft_changed/);
  restarted.rebaseBurrowTextDraft('A:one', 'page', edited.key, 'version-3');
  const rebased = restarted.readBurrowTextDraft('A:one', 'page');
  assert.equal(rebased.body, 'Edited'); assert.equal(rebased.expectedUpdatedAt, 'version-3');
  assert.notEqual(rebased.key, edited.key, 'explicit retry after conflict must use a fresh receipt key');
  session.change('B'); assert.equal(restarted.readBurrowTextDraft('A:one', 'page'), null);
  assert.throws(() => restarted.rebaseBurrowTextDraft('A:one', 'page', rebased.key, 'version-4'), /draft_changed/);
});
test('solo history omits partner but binds reads to the active auth epoch', async () => {
  const session = identity(), pending = deferred(); let url;
  const api = load(lib + 'burrow-history.ts', { './api': { apiClient: { get: path => { url = path; return pending.promise; } } }, './session-lifecycle': session, './async-lifecycle': { withDeadline: value => value } }, { URLSearchParams });
  const read = api.fetchBurrowHistory('moments', undefined, null, '');
  assert.equal(url, '/api/vnext/history?kind=moments');
  session.change('B'); pending.resolve({ success: true, rows: [] }); await assert.rejects(read, /session_changed/);
});
