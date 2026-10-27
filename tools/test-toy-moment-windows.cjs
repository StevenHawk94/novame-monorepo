const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,flush}=require('./lifecycle-test-utils.cjs');
const scope={userId:'A',partnerId:'B',pairVersion:'v1'};
const input=(at,patch={})=>({toyId:'toy-a',photoId:'photo-a',localDate:at.slice(0,10),occurredAt:at,...patch});
function harness(restored){
  const time=clock(),calls=[],api=load('apps/mobile/src/lib/toy-interaction-batcher.ts',{},time.globals);let n=0,error=null,active=true;
  const q=api.createToyInteractionBatcher({current:()=>scope,uuid:()=>`ticket-${++n}`,restored,persist(){},confirmed(){},active:()=>active,
    send:async(s,b)=>{calls.push(JSON.parse(JSON.stringify(b)));if(error)throw Error(error);}});
  return {q,calls,time,fail:e=>error=e,active:v=>active=v};
}
test('14:23 first play anchors hour; 15:22 does not slide it; 15:23 starts new window',async()=>{
  const h=harness();
  for(const at of ['2026-10-22T14:23:00Z','2026-10-22T14:59:00Z','2026-10-22T15:22:59Z','2026-10-22T15:23:00Z'])h.q.enqueue(scope,input(at));
  await h.q.flush();h.time.advance(1000);await flush();
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].count,3);assert.equal(h.calls[0].windowStartedAt,'2026-10-22T14:23:00Z');
  assert.equal(h.calls[1].count,1);assert.equal(h.calls[1].windowStartedAt,'2026-10-22T15:23:00Z');
});
test('toy/photo/day changes keep window while splitting eligibility and quest-day batches',async()=>{
  const h=harness();h.q.enqueue(scope,input('2026-10-22T23:50:00Z'));
  h.q.enqueue(scope,input('2026-10-22T23:55:00Z',{toyId:'toy-b',photoId:'photo-b'}));
  h.q.enqueue(scope,input('2026-10-23T00:10:00Z',{toyId:'toy-b',photoId:'photo-b'}));
  await h.q.flush();h.time.advance(1000);await flush();h.time.advance(1000);await flush();
  assert.equal(h.calls.length,3);assert.equal(new Set(h.calls.map(b=>b.windowStartedAt)).size,1);
  assert.deepEqual(h.calls.map(b=>b.localDate),['2026-10-22','2026-10-22','2026-10-23']);
});
test('restart and delayed photo sync keep exact receipt and occurrence time, with no background polling',async()=>{
  const h=harness();h.fail('photo_sync_pending');h.q.enqueue(scope,input('2026-10-22T14:23:00Z'));await h.q.flush();
  h.time.advance(2000);await flush();assert.deepEqual(h.calls[1],h.calls[0]);h.q.pause();h.active(false);
  h.time.advance(60000);assert.equal(h.calls.length,2);
  const restored=harness(JSON.parse(JSON.stringify(h.q.snapshot())));await restored.q.flush();assert.deepEqual(restored.calls[0],h.calls[0]);
  restored.q.enqueue(scope,input('2026-10-22T14:50:00Z'));await restored.q.flush();assert.equal(restored.calls[1].windowStartedAt,h.calls[0].windowStartedAt);
});

test('window API validates proof/times/scope and missing migration never falls back to legacy counters',async()=>{
  const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
  const calls=[];let missing=false;
  const route=load('apps/api/src/app/api/vnext/command/route.js',{
    'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
    '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},'@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,v)=>v},
    '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:e=>e?409:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return missing?{error:{code:'PGRST202'}}:{data:{error:null,count:2}};}})},
  });
  const body={action:'interact_burrow_toy_window',ownerId:A,partnerId:B,pairVersion:'a'.repeat(32),idempotencyKey:B,
    count:2,toyId:'toy-a',photoId:A,windowStartedAt:'2026-10-22T14:23:00Z',occurredAt:'2026-10-22T14:23:00Z',lastOccurredAt:'2026-10-22T14:24:00Z',localDate:'2026-10-22'};
  const send=patch=>route.POST({text:async()=>JSON.stringify({...body,...patch})});
  for(const patch of [{count:0},{count:51},{photoId:'local-plushie-bad'},{localDate:'2026-02-31'},
    {lastOccurredAt:'2026-10-22T15:23:00Z'},{occurredAt:'2026-10-22T14:22:00Z'},{partnerId:'bad'},{pairVersion:'bad'}])assert.equal((await send(patch)).status,400);
  assert.equal((await send({ownerId:B})).status,403);assert.equal(calls.length,0);
  assert.equal((await send({photoId:'local-plushie-'+A})).status,200);assert.equal(calls[0].name,'record_burrow_toy_window_v1');
  assert.equal(calls[0].args.p_photo_id,'local-plushie-'+A);assert.equal(calls[0].args.p_window_started_at,body.windowStartedAt);
  missing=true;assert.equal((await send({})).status,503);assert.ok(calls.every(c=>c.name==='record_burrow_toy_window_v1'));
});
