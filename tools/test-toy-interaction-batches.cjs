const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const scope={userId:'11111111-1111-4111-8111-111111111111',partnerId:'22222222-2222-4222-8222-222222222222',pairVersion:'a'.repeat(32),localDate:'2026-10-14'};
function harness(restored=null){
  const time=clock(),api=load('apps/mobile/src/lib/toy-interaction-batcher.ts',{},time.globals),calls=[],saved=[];
  let current=scope,send=async()=>{},confirmed=0,serial=0;
  const realQueue=api.createToyInteractionBatcher({current:()=>current,uuid:()=>`id-${++serial}`,restored,
    send:async(s,b)=>{calls.push({scope:{...s},batch:{...b}});await send(s,b);},
    persist:q=>saved.push(q?JSON.parse(JSON.stringify(q)):null),confirmed:()=>confirmed++});
  const queue={...realQueue,enqueue:s=>realQueue.enqueue(s,{toyId:'toy-a',photoId:'photo-a',localDate:s.localDate,occurredAt:new Date('2026-10-14T14:23:00Z').toISOString()})};
  return {queue,time,calls,saved,setScope:s=>{current=s;},setSend:fn=>{send=fn;},get confirmed(){return confirmed;}};
}
test('100 rapid inputs aggregate into at most 50 per command with one flight and no lost counts',async()=>{
  const h=harness(),first=deferred();h.setSend(()=>first.promise);
  for(let i=0;i<100;i++)h.queue.enqueue(scope);
  assert.equal(h.calls.length,0);h.time.advance(250);assert.equal(h.calls.length,1);assert.equal(h.calls[0].batch.count,50);
  for(let i=0;i<17;i++)h.queue.enqueue(scope);
  h.time.advance(5000);assert.equal(h.calls.length,1,'unfinished request cannot fan out');
  first.resolve();await flush();h.setSend(async()=>{});h.time.advance(1000);await flush();h.time.advance(1000);await flush();
  assert.deepEqual(h.calls.map(c=>c.batch.count),[50,50,17]);assert.equal(h.confirmed,3);
  assert.equal(h.queue.snapshot().pending.length,0);assert.equal(h.queue.snapshot().batch,null);
});
test('uncertain failure, restart and retry use the exact same batch ID/count before later input',async()=>{
  const h=harness();h.setSend(async()=>{throw Error('offline');});
  for(let i=0;i<7;i++)h.queue.enqueue(scope);h.time.advance(250);await flush();
  const saved=h.saved.at(-1);assert.equal(saved.batch.count,7);
  h.time.advance(1999);assert.equal(h.calls.length,1,'no immediate offline retry storm');
  h.time.advance(1);await flush();assert.equal(h.calls.length,2,'background retry uses bounded backoff');
  assert.deepEqual(h.calls[1].batch,h.calls[0].batch,'retry reuses the exact durable payload');
  const restored=harness(saved);restored.queue.enqueue(scope);restored.time.advance(250);await flush();
  assert.deepEqual(restored.calls[0].batch,h.calls[0].batch);restored.time.advance(1000);await flush();
  assert.equal(restored.calls[1].batch.count,1);
});
test('unpair, re-pair and account switches discard old queued input and late acknowledgements',async()=>{
  const h=harness(),old=deferred();h.setSend(()=>old.promise);h.queue.enqueue(scope);h.time.advance(250);
  const next={...scope,pairVersion:'b'.repeat(32)};h.setScope(next);h.queue.enqueue(next);
  old.resolve();await flush();assert.equal(h.confirmed,0);h.setSend(async()=>{});h.time.advance(250);await flush();
  assert.equal(h.confirmed,1);assert.equal(h.calls[1].scope.pairVersion,next.pairVersion);
  h.queue.enqueue(next);h.setScope(null);await h.queue.flush();assert.equal(h.queue.snapshot(),null);
});

function routeHarness(){
  const calls=[];let missing=false;
  const route=load('apps/api/src/app/api/vnext/command/route.js',{'@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
    'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
    '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,value)=>value},
    '@/lib/app-major-update':{authenticatedUserId:async()=>scope.userId,majorUpdateEnabled:async()=>true,commandStatus:error=>error?403:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return missing?{error:{code:'PGRST202'}}:{data:{error:null,count:12}};}})},
  });
  return {calls,setMissing:()=>{missing=true;},post:patch=>route.POST({text:async()=>JSON.stringify({action:'interact_burrow_toy_batch',
    ownerId:scope.userId,partnerId:scope.partnerId,pairVersion:scope.pairVersion,localDate:scope.localDate,
    idempotencyKey:'33333333-3333-4333-8333-333333333333',count:12,...patch})})};
}
test('batch API rejects foreign owners, invalid count/date/scope and never grants a partner-toy fallback',async()=>{
  const h=routeHarness();
  for(const patch of [{count:0},{count:51},{count:1.5},{localDate:'2026-02-31'},{pairVersion:'bad'},{partnerId:'bad'}])assert.equal((await h.post(patch)).status,400);
  assert.equal((await h.post({ownerId:scope.partnerId})).status,403);assert.equal(h.calls.length,0);
  assert.equal((await h.post({})).status,200);assert.equal(h.calls[0].name,'interact_burrow_toy_batch_v1');
  assert.equal(h.calls[0].args.p_count,12);assert.equal(h.calls[0].args.p_pair_version,scope.pairVersion);
  const solo=routeHarness();await solo.post({partnerId:null,pairVersion:null});assert.equal(solo.calls.length,1);
});
test('missing batch RPC has an explicit safe rolling-deployment response',async()=>{
  const h=routeHarness();h.setMissing();const result=await h.post({});
  assert.equal(result.status,503);assert.equal(result.body.error,'toy_batch_unavailable');
});
