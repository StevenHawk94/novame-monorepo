const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {createGameReadCoordinator}=load('apps/mobile/src/lib/game-read-coordinator.ts');
test('screen, bootstrap preparation and adjacent callbacks share one read, not writes',async()=>{
 let now=0,calls=0;const api=createGameReadCoordinator(()=>now),pending=deferred(),work=()=>{calls++;return pending.promise;};
 const a=api.read('overview',work),b=api.read('overview',work);await flush();assert.equal(calls,1);
 const value={ready:true};pending.resolve(value);assert.equal(await a,value);assert.equal(await b,value);
 assert.equal(await api.read('overview',work),value);assert.equal(calls,1);
 now=1001;await api.read('overview',work);assert.equal(calls,2);
});
test('invalidation during an old read collapses all callers onto one fresh snapshot',async()=>{
 const api=createGameReadCoordinator(),reads=[];const work=()=>{const d=deferred();reads.push(d);return d.promise;};
 const old=api.read('round',work);await flush();api.invalidate();const fresh=api.read('round',work);await flush();
 reads[0].resolve('stale');await flush();assert.equal(reads.length,2);
 reads[1].resolve('complete');assert.equal(await fresh,'complete');assert.equal(await old,'complete');
});
test('different rounds/owners never share, rejected reads remain retryable',async()=>{
 const api=createGameReadCoordinator();let calls=0;
 await assert.rejects(api.read('epoch1:round',async()=>{calls++;throw Error('offline');}));
 assert.equal(await api.read('epoch1:round',async()=>{calls++;return 'retry';}),'retry');
 assert.equal(await api.read('epoch2:round',async()=>{calls++;return 'other';}),'other');assert.equal(calls,3);
});
test('real Game API shares GETs, invalidates successful submit and refuses late account replay',async()=>{
 const apiReads=createGameReadCoordinator(),requests=[];let epoch=1;
 const api=load('apps/mobile/src/lib/burrow-game-room-api.ts',{
  './game-read-coordinator':{gameReads:apiReads},'expo-crypto':{randomUUID:()=> 'key'},'@novame/api-client':{ApiError:class extends Error{}},
  './async-lifecycle':{withDeadline:p=>p},'./session-lifecycle':{sessionEpoch:()=>epoch},
  './burrow-game-room-content':{GAME_ROOM_CONTENT_VERSION:1,localGameOverview:v=>v,localGameSession:v=>v},
  './api':{apiClient:{get:url=>{const d=deferred();requests.push({url,...d});return d.promise;},post:async()=>({session:{id:'round',result:{mine:6}}})}},
 });
 const a=api.gameSession('round'),b=api.gameSession('round');await flush();assert.equal(requests.length,1);
 await api.submitGame('round',Array(6).fill(0),Array(6).fill(0),'game');requests[0].resolve({id:'round',result:null});await flush();
 assert.equal(requests.length,2);requests[1].resolve({id:'round',result:{mine:6}});assert.equal((await a).result.mine,6);assert.equal((await b).result.mine,6);
 const cached=api.gameSession('round');epoch++;await assert.rejects(cached,/session_changed/);epoch--;
 const old=api.gameOverview();await flush();epoch++;apiReads.invalidate();requests[2].resolve({sessions:[]});await assert.rejects(old,/session_changed/);
 assert.equal(requests.length,3,'an old caller must not silently retry against a new account');
});
