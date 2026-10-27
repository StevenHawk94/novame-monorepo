const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {status,A,B}=require('./release-room-test-utils.cjs');
const queueModel=load('apps/mobile/src/lib/coin-operation-queue.ts');
class ApiError extends Error{constructor(body,httpStatus=409){super('api');this.body=body;this.httpStatus=httpStatus;}}
const attempt=(key='one')=>({actorId:A,partnerId:B,pairVersion:'a'.repeat(32),monsterId:'overthinking',dialogueId:'r01',choice:0,idempotencyKey:key});
function harness(disk=new Map(),base=status()){
 const time=clock(Date.parse('2026-10-14T12:00:00Z')),requests=[],sent=[],identity=[];let owner=A;
 const queue=queueModel.createCoinOperationQueue({owner:()=>owner,active:()=>true,load:()=>JSON.parse(disk.get('ops')??'[]'),
  save:rows=>disk.set('ops',JSON.stringify(rows)),project(){},send:row=>{const p=deferred();requests.push(p);sent.push(row);
   return p.promise.then(receipt=>{if(receipt.status?.partnerId!==row.payload.partnerId||receipt.status?.pairVersion!==row.payload.pairVersion)throw new ApiError({error:'pair_changed'});return receipt;});},
  confirm(){},reject(){},definitive:e=>e instanceof ApiError,schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
 const api=load('apps/mobile/src/lib/release-room-api.ts',{
  '@novame/api-client':{ApiError},'./api':{apiClient:{get:async()=>base}},'./async-lifecycle':{withDeadline:p=>p},
  './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>1,subscribeSessionIdentity:fn=>identity.push(fn)},
  './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},'../shared/storage/keys':{kReleaseRoomStatus:{name:'status'}},
  './burrow-local-day':load('apps/mobile/src/lib/burrow-local-day.ts'),
  './coin-command-outbox':{coinOperations:queue,enqueueCoinOperation:op=>queue.enqueue({...op,owner}),submitCoinOperation:op=>queue.submit({...op,owner})},
 },time.globals);
 const data={profile:{id:A},partner:{id:B},pairVersion:'a'.repeat(32)},scope=api.releaseRoomScope(data);
 return{api,queue,time,disk,requests,sent,data,scope,base,read:()=>api.cachedReleaseRoom(scope,'UTC'),
  switchUser(){owner='other';queue.reset();identity.forEach(fn=>fn());}};
}
const receipt=(count=1)=>({tamedCount:count,status:status({serverNow:`2026-10-14T12:0${count}:00Z`,tamesToday:count,
 monsters:status().monsters.map(m=>m.id==='overthinking'?{...m,tamedCount:count,lastTamedAt:'2026-10-14T12:00:00Z'}:m)})});
test('durable release intent projects quota/counts immediately, keeps wire unchanged, and restores after restart',async()=>{
 const h=harness();await h.api.fetchReleaseRoom(h.data);const queued=h.api.queueReleaseRoom(attempt(),h.read());
 assert.equal(queued.tamedCount,1);assert.equal(h.read().tamesToday,1);assert.equal(h.read().monsters.find(m=>m.id==='overthinking').tamedCount,1);
 assert.deepEqual({...h.sent[0].payload},attempt());assert.equal('display' in h.sent[0].payload,false);
 const restored=harness(h.disk);assert.equal(restored.read().tamesToday,1);assert.equal(restored.read().monsters.find(m=>m.id==='overthinking').tamedCount,1);
 restored.queue.resume();assert.deepEqual({...restored.sent[0].payload},attempt());
 restored.requests[0].resolve(receipt());await flush();assert.equal(restored.queue.pending().length,0);assert.equal(restored.read().tamesToday,1);
 assert.equal(restored.read().monsters.find(m=>m.id==='overthinking').tamedCount,1,'background receipt populates the cache even without the original screen');
 h.requests[0].resolve(receipt());await queued.confirmed;
});
test('timeout silently retries the same intent; background confirmation updates the cache without double-counting',async()=>{
 const h=harness();await h.api.fetchReleaseRoom(h.data);const queued=h.api.queueReleaseRoom(attempt(),h.read());
 h.requests[0].reject(Error('offline'));await assert.rejects(queued.confirmed);await flush();assert.equal(queued.pending(),true);assert.equal(h.read().tamesToday,1);
 await h.api.fetchReleaseRoom(h.data);assert.equal(h.read().tamesToday,1,'stale revalidation cannot rewind pending quota');
 h.time.advance(2000);assert.deepEqual(h.sent[1].payload,h.sent[0].payload);h.requests[1].resolve(receipt());await flush();
 assert.equal(queued.pending(),false);assert.equal(h.read().tamesToday,1);assert.equal(h.read().monsters.find(m=>m.id==='overthinking').tamedCount,1);
});
test('Plus pending operations reconcile out-of-order receipts, and definitive rejection drops only its projection',async()=>{
 const h=harness(new Map(),status({hasPlus:true,dailyLimit:2}));await h.api.fetchReleaseRoom(h.data);
 const first=h.api.queueReleaseRoom(attempt('one'),h.read()),second=h.api.queueReleaseRoom(attempt('two'),h.read());
 assert.equal(h.read().tamesToday,2);h.requests[1].resolve({...receipt(2),status:{...receipt(2).status,hasPlus:true,dailyLimit:2}});await second.confirmed;
 h.requests[0].resolve(receipt());await first.confirmed;assert.equal(h.read().tamesToday,2);assert.equal(h.read().monsters.find(m=>m.id==='overthinking').tamedCount,2);
 const bad=harness();await bad.api.fetchReleaseRoom(bad.data);const q=bad.api.queueReleaseRoom(attempt(),bad.read());
 bad.requests[0].reject(new ApiError({error:'daily_limit_reached',status:status({tamesToday:1})}));await assert.rejects(q.confirmed);assert.equal(q.pending(),false);
 assert.equal(bad.read().monsters.find(m=>m.id==='overthinking').tamedCount,0);assert.equal(bad.read().tamesToday,1);
});
test('account changes never let a late release receipt or pending projection enter the new scope',async()=>{
 const h=harness();await h.api.fetchReleaseRoom(h.data);const queued=h.api.queueReleaseRoom(attempt(),h.read());h.switchUser();
 await assert.rejects(queued.confirmed);h.requests[0].resolve(receipt());await flush();assert.equal(h.read(),null);
});
