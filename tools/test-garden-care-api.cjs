const{test}=require('node:test'),assert=require('node:assert/strict');
const{load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const plain=v=>JSON.parse(JSON.stringify(v));
function harness(response={data:{applied:true,reward:5}}){
 const calls=[],wallet=[];
 const service=load('apps/api/src/lib/app-major-update.js',{'@supabase/supabase-js':{},'@/lib/auth-guard':{}});
 const route=load('apps/api/src/app/api/vnext/command/route.js',{
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,user,result)=>{wallet.push(user);return result;}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:service.commandStatus,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args:plain(args)});return response;}})},
 });
 return{calls,wallet,post:body=>route.POST(new Request('https://example.test/api/vnext/command',{method:'POST',body:JSON.stringify(body)}))};
}
const intent={action:'complete_room_care_v2',actorId:A,ownerId:B,careAction:'leaf',partnerId:B,pairVersion:'a'.repeat(32),localDate:'2026-10-28',idempotencyKey:key};
test('care API binds authenticated actor and immutable target/action/relationship/day; wallet follows committed receipt',async()=>{
 const h=harness(),r=await h.post(intent);assert.equal(r.status,200);
 assert.deepEqual(h.calls,[{name:'complete_room_care_v2',args:{p_user_id:A,p_owner_id:B,p_action:'leaf',p_partner_id:B,p_pair_version:'a'.repeat(32),p_local_date:'2026-10-28',p_key:key}}]);
 assert.deepEqual(h.wallet,[A]);
});
test('spoofed identity, malformed dates, targets and action never reach care transaction',async()=>{
 const h=harness();for(const patch of [{actorId:B},{ownerId:'not-uuid'},{careAction:'food'},{partnerId:'bad'},{pairVersion:'bad'},{localDate:'2026-02-30'},{localDate:'tomorrow'},{idempotencyKey:'new'}])
  assert.equal((await h.post({...intent,...patch})).status,400,JSON.stringify(patch));
 assert.equal(h.calls.length,0);
});
test('missing v2 RPC stays retryable and never invokes the shared legacy protocol',async()=>{
 const h=harness({error:{code:'PGRST202'}}),r=await h.post(intent);assert.equal(r.status,503);assert.equal(r.body.error,'care_unavailable');assert.equal(h.calls.length,1);assert.equal(h.wallet.length,0);
});
test('server refusal stays definitive and cannot be replaced with a solo or legacy transaction',async()=>{
 const h=harness({data:{error:'care_target_not_allowed'}}),r=await h.post(intent);assert.equal(r.status,403);assert.equal(h.calls.length,1);assert.equal(h.wallet.length,0);
});
test('care capability/read is explicit and validates the complete current-identity DTO',async()=>{
 const contract=load('apps/api/src/lib/room-care-contract.mjs');
 assert.equal(contract.careV2Capable(new Request('https://example.test')),false);
 assert.equal(contract.careV2Capable(new Request('https://example.test',{headers:{'x-burrow-care':'2'}})),true);
 const room=()=>Object.fromEntries(['carrot','water','leaf','fertilizer'].map(k=>[k,{lastAt:null,nextAt:null}]));
 const state={version:2,actorId:A,partnerId:B,pairVersion:'pair',own:room(),partner:room()},snapshot={partner:{id:B},pairVersion:'pair'};
 let data=state;const db={rpc:async()=>({data})};assert.equal(await contract.readRoomCare(db,A,snapshot),state);
 for(const patch of [{actorId:B},{partnerId:null},{pairVersion:'old'},{own:{carrot:{}}},{partner:null}]){
  data={...state,...patch};assert.equal(await contract.readRoomCare(db,A,snapshot),null);
 }
 assert.equal(await contract.readRoomCare({rpc:async()=>({error:{code:'PGRST202'}})},A,snapshot),null);
});
