const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

function harness(disk = new Map()) {
  let onIdentity, user = 'me',writes=0;const idle=[];
  const cache = load('apps/mobile/src/lib/burrow-game-room-cache.ts', {
    './session-lifecycle': { sessionUserId: () => user, subscribeSessionIdentity: listener => { onIdentity = listener; } },
    './storage': { storage: { getString: key => disk.get(key), set: (key, value) => {writes++;disk.set(key, value);} } },
    './ui-idle':{afterUiSettles(fn){const row={fn,live:true};idle.push(row);return()=>row.live=false;}},
    '../shared/storage/keys': { kGameOverview: {keyFor:scope=>`overview:${scope}`}, kGameHistory: { keyFor: scope => `history:${scope}` }, kGameProgress: { keyFor: scope => `progress:${scope}` } },
  });
  return { ...cache, disk,writes:()=>writes,flushDisplay:()=>{idle.splice(0).filter(row=>row.live).forEach(row=>row.fn());},changeIdentity: () => { user = 'other'; onIdentity(); } };
}

test('Game Room opens recent catalogue and session snapshots without a request', () => {
  const cache = harness();
  const overview = { sessions: [{ id: 'round-1', completedAt: null }] };
  const session = { id: 'round-1', ownAnswers: [1], guesses: [] };
  assert.equal(cache.gameOverviewNeedsRefresh(1000), true);
  cache.cacheGameOverview(overview, 1000);
  cache.cacheGameSession(session, 1000);
  assert.equal(cache.getCachedGameOverview(), overview);
  assert.equal(cache.getCachedGameSession('round-1'), session);
  assert.equal(cache.gameOverviewNeedsRefresh(30_999), false);
  assert.equal(cache.gameSessionNeedsRefresh('round-1', 10_999), false);
  assert.equal(cache.gameSessionNeedsRefresh('round-1', 11_000), true);
  assert.equal(cache.gameOverviewNeedsRefresh(31_000), true);
});
test('a complete overview survives process restart with prices but never answer payloads',()=>{
 const cache=harness(),scope='me:partner:v1';
 const value={paired:true,categories:['daily'],games:[{id:'one',title:'One',questions:['private']}],ownedIds:[],availableIds:[],
   products:{one:{price:300,plus_only:true,active:true}},sessions:[],ownAnswers:['private']};
 cache.cacheGameOverview(value,1000,scope);
 cache.flushDisplay();
 const restored=harness(cache.disk).getCachedGameOverview(scope);
 assert.equal(restored.games[0].id,'one');assert.equal(restored.products.one.price,300);
 assert.equal(restored.products.one.plus_only,true);
 assert.doesNotMatch(cache.disk.get('overview:'+scope),/private|ownAnswers|questions/);
 assert.equal(harness(cache.disk).getCachedGameOverview('me:other:v2'),null);
});
test('private overview/answer caches are pairing scoped and recent answer memory is bounded',()=>{
  const cache=harness(),scope='me:partner:v1',overview={sessions:[]},session={id:'first',ownAnswers:[1],guesses:[]};
  cache.cacheGameOverview(overview,1000,scope);cache.cacheGameSession(session,1000,scope);
  assert.equal(cache.getCachedGameOverview(scope),overview);assert.equal(cache.getCachedGameSession('first',scope),session);
  for(const other of ['me:other:v1','me:partner:v2','other:partner:v1']){
    assert.equal(cache.getCachedGameOverview(other),null);assert.equal(cache.getCachedGameSession('first',other),null);
    assert.equal(cache.gameOverviewNeedsRefresh(1001,other),true,'fresh prior-pair TTL cannot suppress a new-pair read');
  }
  for(let i=0;i<32;i++)cache.cacheGameSession({...session,id:`round-${i}`},1001+i,scope);
  assert.equal(cache.getCachedGameSession('first',scope),null);assert.ok(cache.getCachedGameSession('round-31',scope));
});

test('viewed results are available immediately, persist when idle and never cross account or pair scopes', () => {
  const cache = harness(), scope = 'me:partner:v1', stamp = '2026-10-10T12:00:00Z';
  const session = { id: 'new-round', gameId: 'daily_quirks_01', completedAt: stamp, resultViewedAt:stamp,
    result: { mine: 6, partner: 5, outcome: 'win' }, ownAnswers: [1,1,1,1,1,1], guesses: [0,0,0,0,0,0] };
  cache.cacheGameSession(session, Date.now(), scope);
  assert.equal(cache.getCachedGameHistory(scope).rounds[0].id, session.id);
  cache.flushDisplay();
  const restarted = harness(cache.disk);
  assert.equal(restarted.getCachedGameHistory(scope).rounds[0].result.outcome, 'win');
  assert.equal(restarted.getCachedGameHistory('me:partner:v2'), null);
  assert.equal(restarted.getCachedGameHistory('other:partner:v1'), null);
  assert.equal([...cache.disk.values()].join('').includes('ownAnswers'), false);
  restarted.changeIdentity(); assert.equal(restarted.getCachedGameHistory(scope), null);
});

test('damaged history and unavailable disk never block local completion', () => {
  const cache = harness(new Map([['history:me:partner:v1', 'broken json']]));
  assert.equal(cache.getCachedGameHistory('me:partner:v1'), null);
  cache.cacheGameHistory({ paired:true, rounds:[], nextCursor:null }, Date.now(), 'other:partner:v1');
  assert.equal(cache.disk.size, 1);
});

test('idle catalogue stays fresh longer and private snapshots clear on account change', () => {
  const cache = harness();
  cache.cacheGameOverview({ sessions: [] }, 1000);
  cache.cacheGameSession({ id: 'old-round' }, 1000);
  assert.equal(cache.gameOverviewNeedsRefresh(120_999), false);
  assert.equal(cache.gameOverviewNeedsRefresh(121_000), true);
  cache.changeIdentity();
  assert.equal(cache.getCachedGameOverview(), null);
  assert.equal(cache.getCachedGameSession('old-round'), null);
});

test('history cache separates relationship versions and invalidates after a newly completed round', () => {
  const cache = harness();
  const history = { paired: true, rounds: [{ id: 'old-round' }], nextCursor: null };
  cache.cacheGameHistory(history, 1000, 'me:partner:v1');
  assert.equal(cache.getCachedGameHistory('me:partner:v1'), history);
  assert.equal(cache.getCachedGameHistory('me:partner:v2'), null);
  assert.equal(cache.gameHistoryNeedsRefresh(1001, 'me:partner:v1'), false);
  assert.equal(cache.gameHistoryNeedsRefresh(1001, 'me:partner:v2'), true);
  cache.cacheGameSession({ id: 'new-round', completedAt: 'now',resultViewedAt:'now' }, 61000);
  assert.equal(cache.gameHistoryNeedsRefresh(61000, 'me:partner:v1'), true);
  cache.changeIdentity();
  assert.equal(cache.getCachedGameHistory('me:partner:v1'), null);
});
test('prefetching an unviewed completed result cannot archive it in History',()=>{
  const cache=harness(),scope='me:partner:v1',stamp='2026-10-13T12:00:00Z';
  const session={id:'unread',gameId:'daily_quirks_01',completedAt:stamp,result:{mine:6,partner:0,outcome:'win'}};
  cache.cacheGameSession(session,Date.now(),scope);assert.equal(cache.getCachedGameHistory(scope),null);
  cache.cacheGameSession({...session,resultViewedAt:stamp},Date.now(),scope);
  assert.equal(cache.getCachedGameHistory(scope).rounds[0].resultViewedAt,stamp);
});
test('late snapshots cannot revoke permanent Free unlocks after repricing, but prices and pair scopes remain authoritative',()=>{
 const cache=harness(),scope='me:partner:v1';
 const first={paired:true,ownedIds:['free'],availableIds:['free','shared'],sessions:[],products:{free:{price:0,plus_only:false,active:true}}};
 cache.cacheGameOverview(first,100,scope);
 const stale={...first,ownedIds:[],availableIds:[],products:{free:{price:300,plus_only:false,active:true}}};
 const merged=cache.cacheGameOverview(stale,200,scope);
 assert.deepEqual(Array.from(merged.ownedIds),['free']);assert.deepEqual(Array.from(merged.availableIds),['free','shared']);
 assert.equal(merged.products.free.price,300);
 const next=cache.cacheGameOverview(stale,300,'me:other:v2');assert.equal(next.availableIds.length,0);
 assert.equal(cache.getCachedGameOverview(scope),null);
 cache.cacheGameOverview(first,400,scope);
 assert.equal(cache.cacheGameOverview({...stale,paired:false},500,scope).availableIds.length,0);
});
test('both check circles are monotonic across stale reads, replay, exit and process restart without persisting answers or prices',()=>{
 const scope='me:partner:v1',cache=harness();
 const base={paired:true,ownedIds:['game'],availableIds:['game'],sessions:[],products:{game:{price:0,plus_only:false,active:true}}};
 const row={id:'round',gameId:'game',createdAt:'2026-10-15',completedAt:null,ownCount:6,guessCount:6,partnerOwnCount:0,partnerGuessCount:0};
 cache.cacheGameOverview({...base,sessions:[row]},100,scope);
 let value=cache.cacheGameOverview(base,200,scope);
 assert.equal(value.completion.game.mineFinished,true);assert.equal(value.completion.game.partnerFinished,false);
 cache.cacheGameOverview({...base,sessions:[{...row,partnerOwnCount:6,partnerGuessCount:6}]},300,scope);
 value=cache.cacheGameOverview({...base,sessions:[{...row,ownCount:0,guessCount:0}]},400,scope);
 assert.equal(value.completion.game.mineFinished,true);assert.equal(value.completion.game.partnerFinished,true);
 cache.flushDisplay();const restarted=harness(cache.disk),restored=restarted.getCachedGameOverview(scope);
 assert.equal(restored.completion.game.mineFinished,true);assert.equal(restored.completion.game.partnerFinished,true);
 assert.equal(restored.lastRounds.game.id,'round','restore routing metadata, not private answers');
 assert.deepEqual(Array.from(restored.availableIds),['game']);
 const replay=restarted.cacheGameOverview({...base,sessions:[{...row,id:'replay',ownCount:0,guessCount:0}]},500,scope);
 assert.equal(replay.completion.game.mineFinished,true);assert.equal(replay.completion.game.partnerFinished,true);
 assert.equal(restarted.getCachedGameOverview('me:partner:v2'),null);
 const next=restarted.cacheGameOverview(base,600,'me:partner:v2');assert.equal(next.completion.game,undefined);
 restarted.changeIdentity();assert.equal(restarted.getCachedGameOverview(scope),null);
 const disk=[...cache.disk.entries()].filter(([key])=>key.startsWith('progress:')).map(([,value])=>value).join('');
 assert.doesNotMatch(disk,/ownAnswers|partnerOwnAnswers|guesses|questions|products|price|plus_only/);
 assert.doesNotMatch([...cache.disk.values()].join(''),/ownAnswers|partnerOwnAnswers|guesses|questions/);
});
test('a cold-start completed tile still opens its saved result, rather than starting a new round',()=>{
 const cache=harness(),scope='me:partner:v1';
 const round={id:'done',gameId:'game',createdAt:'2026-10-15',completedAt:'2026-10-15',ownCount:6,guessCount:6,partnerOwnCount:6,partnerGuessCount:6};
 cache.cacheGameOverview({paired:true,ownedIds:['game'],availableIds:['game'],sessions:[round]},100,scope);
 cache.flushDisplay();
 const reboot=harness(cache.disk),restored=reboot.getCachedGameOverview(scope);
 const {gameCardState}=load('apps/mobile/src/lib/burrow-game-card-state.ts');
 const tile=gameCardState({id:'game',price:300},restored,false);
 assert.equal(tile.round.id,'done');assert.equal(tile.mineFinished,true);assert.equal(tile.partnerFinished,true);
 reboot.cacheGameOverview({paired:true,ownedIds:[],availableIds:[],sessions:[{...round,id:'replay',createdAt:'2026-10-16',completedAt:null,ownCount:0,guessCount:0,partnerOwnCount:0,partnerGuessCount:0}]},200,scope);
 assert.equal(gameCardState({id:'game',price:300},reboot.getCachedGameOverview(scope),false).round.id,'done');
});
test('single-party checks from session receipts persist before overview refresh and broadcasts only wake the current account',()=>{
 const cache=harness(),scope='me:partner:v1';let calls=0;
 const off=cache.subscribeGameRoomChanges(()=>calls++);
 cache.notifyGameRoomChanged('other');assert.equal(calls,0);
 cache.notifyGameRoomChanged('me');assert.equal(calls,1);off();cache.notifyGameRoomChanged('me');assert.equal(calls,1);
 cache.cacheGameSession({id:'server',gameId:'game',ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:0,partnerGuessCount:0,completedAt:null},100,scope);
 cache.flushDisplay();
 const restarted=harness(cache.disk),value=restarted.getCachedGameOverview(scope);
 assert.equal(value.completion.game.mineFinished,true);assert.equal(value.completion.game.partnerFinished,false);
 const partner=harness();partner.cacheGameOverview({paired:true,ownedIds:[],availableIds:[],sessions:[{id:'s',gameId:'game',ownCount:0,guessCount:0,partnerOwnCount:6,partnerGuessCount:6,completedAt:null}]},100,scope);
 partner.flushDisplay();
 assert.equal(harness(partner.disk).getCachedGameOverview(scope).completion.game.partnerFinished,true);
});
test('background display writes coalesce while memory is immediate, and sign-out cancels pending private writes',()=>{
 const cache=harness(),scope='me:partner:v1';
 for(let i=0;i<40;i++)cache.cacheGameOverview({paired:true,ownedIds:[],availableIds:[],categories:[],games:[],sessions:[],products:{game:{price:i}}},i,scope);
 assert.equal(cache.writes(),0);assert.equal(cache.getCachedGameOverview(scope).products.game.price,39);
 cache.flushDisplay();assert.equal(cache.writes(),2);assert.equal(JSON.parse(cache.disk.get('overview:'+scope)).value.products.game.price,39);
 cache.cacheGameOverview({paired:true,ownedIds:[],availableIds:[],sessions:[]},50,scope);cache.changeIdentity();cache.flushDisplay();
 assert.equal(cache.writes(),2);
});
