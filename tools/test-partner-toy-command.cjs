const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function harness(result={error:null}){
 const calls=[];
 const route=load('apps/api/src/app/api/vnext/command/route.js',{'@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,value)=>value},
  '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:error=>error?403:200,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='solo_burrow_toy_v1'?{error:null}:result};}})},
 });return {calls,post:patch=>route.POST({text:async()=>JSON.stringify({action:'interact_burrow_toy',idempotencyKey:B,...patch})})};
}
test('partner/foreign toy commands are rejected before any RPC; omitted owner remains self-scoped',async()=>{
 const denied=harness();assert.equal((await denied.post({ownerId:B})).status,403);assert.equal(denied.calls.length,0);
 assert.equal((await denied.post({ownerId:'bad'})).status,400);assert.equal(denied.calls.length,0);
 for(const body of [{},{ownerId:A}]){
  const h=harness();assert.equal((await h.post(body)).status,200);assert.equal(h.calls[0].name,'interact_burrow_toy_v2');
  assert.equal(h.calls[0].args.p_owner_id,A);assert.equal(h.calls[0].args.p_user_id,A);
 }
});
test('unpaired own toy retains self-only fallback; a forged owner cannot reach it',async()=>{
 const h=harness({error:'not_paired'});assert.equal((await h.post({ownerId:A})).status,200);
 assert.equal(h.calls[1].name,'solo_burrow_toy_v1');assert.equal(h.calls[1].args.p_user_id,A);
 const denied=harness({error:'not_paired'});assert.equal((await denied.post({ownerId:B})).status,403);assert.equal(denied.calls.length,0);
});
