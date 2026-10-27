const {motionHarness,model:motionModel}=require('./motion-test-utils.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, clock, deferred, hooks, flush } = require('./lifecycle-test-utils.cjs');
const lib = 'apps/mobile/src/lib/';
const model = load(lib + 'coin-reward-ledger.ts');
const state = (balance = 1230, version = 1, credits = []) => ({ wallet: { balance, version },
  credits: credits.map(([key, amount]) => ({ key, amount })), localDate: '1970-01-01', timezone: 'UTC', serverNow: '1970-01-01T00:00:10Z' });
function harness() {
  const time = clock(), listeners = []; let epoch = 1;
  const identity = { sessionEpoch: () => epoch, sessionUserId: () => 'me', subscribeSessionIdentity: fn => listeners.push(fn) };
  const api = load(lib + 'coin-reward-store.ts', { react: { useSyncExternalStore: (_, read) => read() },
    './session-lifecycle': identity, './coin-reward-ledger': model, './burrow-motion': motionModel,
  }, { ...time.globals, performance: { now: () => time.globals.Date.now() } });
  api.syncCoinWallet(state().wallet, state());
  return { ...api, time, identity, snapshot: api.getCoinRewardSnapshot,
    switchAccount() { epoch++; listeners.forEach(fn => fn()); } };
}

test('first wallet is authoritative; a missing baseline cannot invent a total', () => {
  const ledger = new model.CoinRewardLedger();
  assert.equal(ledger.begin('one', 'daily-quest:one', 10), 0);
  assert.equal(ledger.balance, null);
});
test('prepared visit 5/10 rewards project immediately; restart restores silently and the server receipt cannot double count',()=>{
 for(const amount of [5,10]){
  const h=harness(),key=`friend-visit:prepared-${amount}`;
  const ticket=h.beginCoinReward(key,key,amount);
  assert.equal(h.snapshot().balance,1230+amount);assert.equal(h.snapshot().batch.earned,amount);
  const restarted=harness(),restored=restarted.beginCoinReward(key,key,amount,false,true);
  assert.equal(restarted.snapshot().balance,1230+amount);assert.equal(restarted.snapshot().batch,null);
  restarted.settleCoinReward(restored,{reward:0,applied:false,coinReward:{key,amount:0},coinState:state(1230+amount,2,[[key,amount]])});
  assert.equal(restarted.snapshot().balance,1230+amount);assert.equal(restarted.snapshot().batch,null);
  h.failCoinReward(ticket);assert.equal(h.snapshot().balance,1230);
 }
});
test('prepared visit API never starts a second generic coin ticket; ambiguous transport failure belongs to the durable worker',async()=>{
 const h=harness(),response=deferred(),calls=[];
 const api=load(lib+'app-major-update-api.ts',{'expo-crypto':{},'./session-lifecycle':h.identity,
  ...require('./rating-test-mocks.cjs'),
  './api':{apiClient:{post:(url,body)=>{calls.push(body);return response.promise;}}},
  './async-lifecycle':{withDeadline:value=>value},'./coin-reward-store':{commandCoinReward(){throw Error('duplicate ticket');}},
 });
 const pending=api.answerPreparedFriendVisit({visitId:'visit',sessionId:'frozen',pairVersion:'pair'},'B');
 response.reject(Error('offline'));await assert.rejects(pending,/offline/);
 assert.equal(calls[0].action,'respond_friend_visit_v3');assert.equal(calls[0].sessionId,'frozen');assert.equal(calls[0].reward,undefined);
});
test('one snapshot acknowledges A while retaining concurrent optimistic B', () => {
  const ledger = new model.CoinRewardLedger(); ledger.sync(state());
  ledger.begin('a', 'a', 10); ledger.begin('b', 'b', 15);
  assert.equal(ledger.balance, 1255);
  ledger.sync(state(1240, 2, [['a', 10]]));
  assert.equal(ledger.balance, 1255); assert.equal(ledger.pending.size, 1);
  ledger.sync(state(1255, 3, [['a', 10], ['b', 15]]));
  assert.equal(ledger.balance, 1255); assert.equal(ledger.pending.size, 0);
});
test('reverse-order receipts and an older bootstrap never rewind or double the wallet', () => {
  const ledger = new model.CoinRewardLedger(); ledger.sync(state());
  ledger.begin('a', 'a', 10); ledger.begin('b', 'b', 15);
  ledger.sync(state(1255, 3, [['a', 10], ['b', 15]]));
  ledger.settle('a', 'a', 10, 100); ledger.sync(state(1240, 2, [['a', 10]]));
  assert.equal(ledger.balance, 1255); assert.equal(ledger.wallet.version, 3);
});
test('same grant and same operation cannot project twice; invalid amounts do not project', () => {
  const ledger = new model.CoinRewardLedger(); ledger.sync(state());
  assert.equal(ledger.begin('a', 'daily', 10), 10);
  assert.equal(ledger.begin('a', 'daily', 10), 0);
  assert.equal(ledger.begin('b', 'daily', 10), 0);
  for (const amount of [NaN, Infinity, -10, 1.5, 0]) assert.equal(ledger.begin('bad', 'bad', amount), 0);
  assert.equal(ledger.balance, 1240);
});
test('earnings respect the server cap, while refunded signed balances can increase normally', () => {
  const ledger = new model.CoinRewardLedger(); ledger.sync(state(99995));
  assert.equal(ledger.begin('a', 'a', 10), 4); assert.equal(ledger.balance, 99999);
  assert.equal(ledger.begin('b', 'b', 10), 0);
  ledger.sync(state(-20, 2)); assert.equal(ledger.begin('c', 'c', 10), 10);
});
test('old-server compatibility waits for a read begun after every overlapping settlement', () => {
  const ledger = new model.CoinRewardLedger(); ledger.sync(state());
  ledger.begin('a', 'a', 10); ledger.begin('b', 'b', 15);
  ledger.settle('a', 'a', 10, 100);
  ledger.syncLegacy({ balance: 1240, version: 2 }, 110);
  assert.equal(ledger.wallet.balance, 1230); assert.equal(ledger.balance, 1255);
  ledger.settle('b', 'b', 15, 120);
  ledger.syncLegacy({ balance: 1255, version: 3 }, 115); assert.equal(ledger.wallet.balance, 1230);
  ledger.syncLegacy({ balance: 1255, version: 3 }, 121);
  assert.equal(ledger.balance, 1255); assert.equal(ledger.pending.size, 0);
  assert.equal(ledger.begin('repeat-a', 'a', 10), 0, 'a confirmed daily reward remains consumed even with an old-server snapshot');
});
test('rapid rewards merge the same banner and preserve its original count start', () => {
  const h = harness(); h.beginCoinReward('a', 'a', 10);
  const first = h.snapshot().batch;
  h.beginCoinReward('b', 'b', 15);
  assert.equal(h.snapshot().balance, 1255);
  assert.equal(h.snapshot().batch.id, first.id);
  assert.equal(h.snapshot().batch.earned, 25);
  assert.equal(h.snapshot().batch.from, 1230);
  assert.ok(h.snapshot().batch.revision > first.revision);
  h.finishCoinRewardBatch(first.id, first.revision);
  assert.ok(h.snapshot().batch, 'an old exit callback cannot close a newer reward');
  const last = h.snapshot().batch; h.finishCoinRewardBatch(last.id, last.revision);
  assert.equal(h.snapshot().batch, null);
});
test('rapid taps reuse a bounded flight and its frozen origin; only a landed flight may restart',()=>{
  const h=harness();h.setNextCoinRewardOrigin({x:20,y:300});h.beginCoinReward('a','a',10);
  const flight=h.snapshot().batch.flight;
  for(let i=0;i<30;i++){
    h.time.advance(10);h.setNextCoinRewardOrigin({x:50+i,y:400});h.beginCoinReward(`q${i}`,`q${i}`,10);
    assert.equal(h.snapshot().batch.flight,flight,'never remount coins in midair, regardless of tap count');
  }
  assert.equal(flight.origin.x,20);assert.equal(h.snapshot().balance,1540);assert.equal(h.snapshot().batch.earned,310);
  h.time.advance(motionModel.coinArrivalTiming(0).flightEnd-300);h.setNextCoinRewardOrigin({x:200,y:500});h.beginCoinReward('next','next',15);
  assert.notEqual(h.snapshot().batch.flight,flight);assert.equal(h.snapshot().batch.flight.origin.x,200);
});
test('identical visible receipts reuse React snapshots but still notify the durable wallet subscriber',()=>{
  const h=harness();let notices=0;h.subscribeCoinWallet(()=>notices++);
  const initial=h.snapshot();h.syncCoinWallet(state().wallet,state());assert.equal(h.snapshot(),initial);
  const ticket=h.beginCoinReward('a','a',10),projected=h.snapshot();
  assert.equal(h.useCoinBalance(),1240);assert.equal(h.useCoinRewardBusy(),true);
  const before=notices;h.settleCoinReward(ticket,{reward:10,coinState:state(1240,2,[['a',10]])});
  assert.equal(h.snapshot(),projected,'matching authoritative receipt cannot re-render the reward host');
  assert.ok(notices>before);assert.equal(h.getConfirmedCoinWallet().wallet.version,2);
  h.finishCoinRewardBatch(projected.batch.id,projected.batch.revision);
  assert.equal(h.useCoinBalance(),1240);assert.equal(h.useCoinRewardBusy(),false);
});
test('coin source is captured once per claim, survives slow receipt and expires between unrelated actions',()=>{
  const h=harness();h.setNextCoinRewardOrigin({x:80,y:350});const a=h.beginCoinReward('a',null,0);
  h.time.advance(2500);h.settleCoinReward(a,{reward:10,coinReward:{key:'a',amount:10},coinState:state(1240,2,[['a',10]])});
  assert.equal(h.snapshot().batch.origin.x,80);
  h.beginCoinReward('b','b',15);assert.equal(h.snapshot().batch.origin,undefined,'the same tap never leaks into the next claim');
  h.setNextCoinRewardOrigin({x:200,y:400});h.time.advance(2000);h.beginCoinReward('c','c',10);
  assert.equal(h.snapshot().batch.origin,undefined);
  h.setNextCoinRewardOrigin({x:NaN,y:1});h.beginCoinReward('d','d',10);assert.equal(h.snapshot().batch.origin,undefined);
  h.setNextCoinRewardOrigin({x:20,y:20});h.switchAccount();h.syncCoinWallet(state().wallet,state());
  h.beginCoinReward('new','new',10);assert.equal(h.snapshot().batch.origin,undefined);
});
test('failed claim rolls back only itself, not another pending reward', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10);
  h.beginCoinReward('b', 'b', 15); h.failCoinReward(a);
  assert.equal(h.snapshot().balance, 1245); assert.equal(h.snapshot().batch.earned, 15);
});
test('actual amount silently corrects the projected balance and earned amount', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10);
  const celebration = h.snapshot().batch.celebration;
  h.settleCoinReward(a, { reward: 7, coinReward: { key: 'a', amount: 7 }, coinState: state(1237, 2, [['a', 7]]) });
  assert.equal(h.snapshot().balance, 1237); assert.equal(h.snapshot().batch.earned, 7);
  assert.equal(h.snapshot().batch.celebration, celebration, 'a correction must not trigger another confetti burst');
});
test('zero reward is not a new credit; an included replay does not animate twice', () => {
  const h = harness(); h.syncCoinWallet(state(1240, 2).wallet, state(1240, 2, [['a', 10]]));
  const replay = h.beginCoinReward('a', 'a', 10);
  h.settleCoinReward(replay, { reward: 0, applied: false, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().balance, 1240); assert.equal(h.snapshot().batch, null);
  const noReward = h.beginCoinReward('toy', null, 0); h.settleCoinReward(noReward, { reward: 0 });
  assert.equal(h.snapshot().batch, null);
});
test('a replay after a timed-out commit acknowledges its optimistic credit exactly once', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10);
  h.settleCoinReward(a, { reward: 0, applied: false, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().balance, 1240); assert.equal(h.snapshot().batch.earned, 10);
});
test('amount unknown in advance waits for a receipt, not a loading dialog', () => {
  const h = harness(), a = h.beginCoinReward('a', null, 0);
  assert.equal(h.snapshot().batch, null);
  h.settleCoinReward(a, { reward: 10, coinReward: { key: 'a', amount: 10 }, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().balance, 1240); assert.equal(h.snapshot().batch.earned, 10);
});
test('friend visit coins wait for actual 5/10 receipt, are per visit, and replays never celebrate twice',()=>{
  const h=harness();
  const a=h.commandCoinReward('respond_friend_visit_v2',{visitId:'one'});
  assert.equal(h.snapshot().batch,null);
  h.settleCoinReward(a,{applied:true,reward:5,coinReward:{key:'friend-visit:one',amount:5},coinState:state(1235,2,[['friend-visit:one',5]])});
  assert.equal(h.snapshot().batch.earned,5);
  const old=h.snapshot().batch;h.finishCoinRewardBatch(old.id,old.revision);
  const replay=h.commandCoinReward('respond_friend_visit_v2',{visitId:'one'});
  h.settleCoinReward(replay,{applied:false,reward:0,coinReward:{key:'friend-visit:one',amount:0},coinState:state(1235,2,[['friend-visit:one',5]])});
  assert.equal(h.snapshot().batch,null);
  const b=h.commandCoinReward('respond_friend_visit_v2',{visitId:'two'});
  h.settleCoinReward(b,{applied:true,reward:10,coinReward:{key:'friend-visit:two',amount:10},coinState:state(1245,3,[['friend-visit:one',5],['friend-visit:two',10]])});
  assert.equal(h.snapshot().batch.earned,10);assert.equal(h.snapshot().balance,1245);
});
test('affection uses its scene beat, not network completion, to release the shared celebration', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10, true);
  assert.equal(h.snapshot().batch, null); assert.equal(h.snapshot().balance, 1240);
  assert.equal(h.snapshot().displayBalance,1230);
  h.releaseCoinReward('a'); assert.equal(h.snapshot().batch.earned,10);
  const celebration=h.snapshot().batch.celebration;
  h.settleCoinReward(a, { reward: 10, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().batch.earned, 10);
  assert.equal(h.snapshot().batch.celebration,celebration);
});
test('a confirmed affection can finish its delivery later without replaying the gesture', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10, true);
  h.settleCoinReward(a, { reward: 10, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().batch, null); h.releaseCoinReward('a');
  assert.equal(h.snapshot().batch.earned, 10); h.releaseCoinReward('a');
  assert.equal(h.snapshot().batch.earned, 10);
});
test('leaving the foreground hides feedback; late confirmations do not replay on resume', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10);
  h.setCoinRewardForeground(false); assert.equal(h.snapshot().batch, null);
  h.settleCoinReward(a, { reward: 10, coinState: state(1240, 2, [['a', 10]]) });
  h.setCoinRewardForeground(true); assert.equal(h.snapshot().batch, null);
  assert.equal(h.snapshot().balance, 1240);
});
test('account switch rejects old receipts and clears all presentation state', () => {
  const h = harness(), a = h.beginCoinReward('a', 'a', 10); h.switchAccount();
  h.settleCoinReward(a, { reward: 10, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(h.snapshot().balance, null); assert.equal(h.snapshot().batch, null);
});
test('own-room care and repeated daily affection never fabricate reward eligibility', () => {
  const h = harness(); h.commandCoinReward('refill_room_need', { ownerId: 'me', need: 'water', idempotencyKey: 'own' });
  assert.equal(h.snapshot().batch, null);
  h.syncCoinWallet(state().wallet, state(1230, 1, [['affection-first:1970-01-01', 10]]));
  const ticket = h.commandCoinReward('complete_affection', { idempotencyKey: 'second' });
  h.settleCoinReward(ticket, { reward: 0 }); h.releaseCoinReward(ticket.id);
  assert.equal(h.snapshot().batch, null);
});
test('the real command client projects before the network and reconciles returned ledger keys', async () => {
  const h = harness(), response = deferred();
  const api = load(lib + 'app-major-update-api.ts', { 'expo-crypto': { randomUUID: () => 'key' },
    ...require('./rating-test-mocks.cjs'),
    './api': { apiClient: { post: () => response.promise } }, './async-lifecycle': { withDeadline: value => value },
    './session-lifecycle': h.identity, './coin-reward-store': h,
  });
  const pending = api.claimDailyQuest('one');
  assert.equal(h.snapshot().balance, 1240); assert.equal(h.snapshot().batch.earned, 10);
  response.resolve({ success: true, reward: 10, coinState: state(1240, 2, [['daily-quest:one', 10]]) });
  await pending; assert.equal(h.snapshot().balance, 1240);
});
test('confirmed wallet receipts are cached immediately; full room serialization waits beyond the reward beat', async () => {
  const h = harness(), saved = [], receipts = [], jobs = [];
  const baseline = { profile: { id: 'me' }, partner: null, wallet: state().wallet, coinState: state(), roomPhotos: [], loadouts: [] };
  const store = load(lib + 'burrow-store.ts', {
    './adventure-arrival': load(lib + 'adventure-arrival.ts'),
    './async-lifecycle':load(lib+'async-lifecycle.ts',{},h.time.globals),
    react: { useCallback: fn => fn, useRef: value => ({ current: value }), useSyncExternalStore: (_, read) => read() }, 'expo-router': { useFocusEffect() {} },
    '@react-navigation/native': { useIsFocused: () => true },
    'react-native': { AppState: {}, InteractionManager: { runAfterInteractions(fn) { const job={fn,cancel(){}};jobs.push(job);return job; } } }, 'expo-crypto': { randomUUID: () => 'key' },
    './session-lifecycle': h.identity, './coin-reward-store': h,
    './app-major-update-api': { fetchMajorUpdateBootstrap: async () => baseline },
    './burrow-cache': { readBurrowSnapshot: () => ({ data: baseline, savedAt: 10000 }), readBurrowActionKeys: () => [],
      persistBurrowActionKeys() {}, clearBurrowSnapshot() {}, persistBurrowSnapshot: data => saved.push(data),
      persistBurrowWallet: (owner,wallet,coinState) => receipts.push({owner,wallet,coinState}) },
  }, { ...h.time.globals, performance: { now: () => h.time.globals.Date.now() } });
  const ticket = h.beginCoinReward('a', 'a', 10);
  assert.equal(saved.length, 0, 'optimistic money stays out of disk');
  h.settleCoinReward(ticket, { reward: 10, coinState: state(1240, 2, [['a', 10]]) });
  assert.equal(receipts.at(-1).wallet.balance, 1240);
  jobs.at(-1).fn();assert.equal(saved.length,0,'do not stringify the room while native coins are flying');
  assert.equal(store.getBurrowSnapshot().data.wallet.version, 2);
  await store.refreshBurrow({ silent: true });
  jobs.at(-1).fn();assert.equal(saved.length,0);
  h.time.advance(motionModel.coinPresentationTiming(0).total+400);jobs.at(-1).fn();
  assert.equal(saved.at(-1).wallet.balance, 1240, 'an older bootstrap cannot rewind the durable wallet');
  const first=h.snapshot().batch;h.finishCoinRewardBatch(first.id,first.revision);
  const deferred=h.beginCoinReward('later','later',10,true);
  h.settleCoinReward(deferred,{reward:10,coinState:state(1250,3,[['a',10],['later',10]])});jobs.at(-1).fn();
  const written=saved.length;h.time.advance(3300);h.releaseCoinReward('later');
  h.time.advance(100);jobs.at(-1).fn();assert.equal(saved.length,written,'a delayed visual delivery must extend the quiet window');
  h.time.advance(3300);jobs.at(-1).fn();assert.equal(saved.at(-1).wallet.balance,1250);
});
test('supplementary server reconciliation fails open after a committed business operation', async () => {
  const helper = load('apps/api/src/lib/burrow-reward-wallet.mjs');
  const result = { reward: 10, applied: true };
  assert.equal(await helper.withRewardWallet({ rpc: async () => { throw Error('timeout'); } }, 'me', result), result);
  const value = await helper.withRewardWallet({ rpc: async () => ({ data: state(1240, 2, [['daily-quest:a', 10]]) }) },
    'me', result, { action: 'claim_daily_quest', assignmentId: 'a' });
  assert.equal(value.coinReward.key, 'daily-quest:a'); assert.equal(value.coinState.wallet.balance, 1240);
});
test('one global wallet controller is mounted once; page wallets register slots and modal outlets only promote it',()=>{
 const root=fs.readFileSync('apps/mobile/app/_layout.tsx','utf8');
 assert.equal(root.match(/<CoinWalletProvider>/g).length,1);
 assert.equal(root.match(/<CoinRewardBanner\s*\/>/g).length,1);
 const banner=fs.readFileSync('apps/mobile/src/components/burrow/coin-reward-banner.tsx','utf8');
 assert.match(banner,/registry.portal!==\(portal\?\?null\)/);
 assert.match(banner,/BURROW_MOTION.coinParticles/);
 assert.doesNotMatch(banner,/19|count.value = batch.from|setState\(/);
});
