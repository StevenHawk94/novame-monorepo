const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const id='11111111-1111-4111-8111-111111111111';
const json=(body,options={})=>({body,status:options.status??200,headers:options.headers});
const request=body=>({text:async()=>JSON.stringify(body)});
function harness(){
 let owner='me',display={userId:'me',adventurePlan:{version:'frozen'}},fail=false,result={applied:true,adventureId:id,endsAt:'2026-10-15T00:01:00Z'};
 const calls=[],common={
  'next/server':{NextResponse:{json}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>owner,appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:result};}}),
   majorUpdateEnabled:async()=>true,commandStatus:error=>error?409:200},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async(_db,user,adventure)=>{calls.push(['display',user,adventure]);if(fail)throw Error('read failure');return display;}},
 };
 const get=load('apps/api/src/app/api/vnext/adventure/route.js',common,{console:{error(){}}});
 const post=load('apps/api/src/app/api/vnext/command/route.js',{...common,'@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,data)=>data}},{console:{error(){},warn(){}}});
 return {get,post,calls,setOwner:v=>owner=v,setDisplay:v=>display=v,setFail:v=>fail=v,setResult:v=>result=v};
}
test('start and idempotent replay both attach the frozen display; read failure never turns a committed start into failure',async()=>{
 const h=harness(),body={action:'start_adventure',recordId:id,idempotencyKey:'same-key',encounterVersion:3};
 let response=await h.post.POST(request(body));assert.equal(response.status,200);assert.equal(response.body.adventureDisplay.adventurePlan.version,'frozen');
 assert.equal(h.calls[0][1],'start_adventure_v3');assert.deepEqual(h.calls[1],['display','me',id]);
 h.setResult({applied:false,adventureId:id});response=await h.post.POST(request(body));assert.equal(response.body.adventureDisplay.adventurePlan.version,'frozen');
 h.setFail(true);response=await h.post.POST(request(body));assert.equal(response.body.success,true);assert.equal(response.body.adventureId,id);assert.equal(response.body.adventureDisplay,undefined);
});
test('lightweight recovery is authenticated, UUID-validated, scoped to the caller and never cached publicly',async()=>{
 const h=harness(),req=value=>({nextUrl:new URL(`https://example.com/api/vnext/adventure?adventureId=${value}`)});
 h.setOwner(null);assert.equal((await h.get.GET(req(id))).status,401);assert.equal(h.calls.length,0);
 h.setOwner('me');assert.equal((await h.get.GET(req('bad'))).status,400);assert.equal(h.calls.length,0);
 const response=await h.get.GET(req(id));assert.equal(response.body.success,true);assert.equal(response.headers['Cache-Control'],'no-store');assert.deepEqual(h.calls,[['display','me',id]]);
 h.setDisplay({error:'adventure_cancelled'});assert.equal((await h.get.GET(req(id))).body.error,'adventure_cancelled');
 h.setDisplay(null);assert.equal((await h.get.GET(req(id))).status,503);h.setFail(true);assert.equal((await h.get.GET(req(id))).status,500);
});
