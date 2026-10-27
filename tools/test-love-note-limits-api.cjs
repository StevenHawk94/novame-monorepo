const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111';
function harness(error){
 const calls=[];let actor=A;
 const route=load('apps/api/src/app/api/vnext/command/route.js',{
  'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200,headers:config.headers??{}})}},
  '@/lib/adventure-bootstrap.mjs':{},'@/lib/burrow-reward-wallet.mjs':{},
  '@/lib/app-major-update':{authenticatedUserId:async()=>actor,majorUpdateEnabled:async()=>true,commandStatus:code=>code?409:200,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{error,data:null};}})},
 },{console:{error(){},warn(){}}});
 return{calls,unauthenticated(){actor=null;},post:(patch={})=>route.POST(new Request('https://example.invalid/api/vnext/command',{
  method:'POST',body:JSON.stringify({action:'save_memory',body:'💌 Hello',idempotencyKey:'safe-key',...patch})}))};
}
for(const [code,limit,window,seconds] of [['love_note_minute_limit',5,'minute',37],['love_note_daily_limit',100,'day',7200]])test(`${code}: authenticated RPC failure becomes HTTP 429 and Retry-After`,async()=>{
 const h=harness({code:'P0001',message:code,details:JSON.stringify({retryAfterSeconds:seconds})});const result=await h.post();
 assert.equal(result.status,429);assert.deepEqual(JSON.parse(JSON.stringify(result.body)),{error:code,retryAfterSeconds:seconds,limit,window});
 assert.equal(result.headers['Retry-After'],String(seconds));assert.equal(h.calls[0].args.p_user_id,A);
 assert.equal(h.calls[0].args.p_key,'safe-key');assert.equal(h.calls.length,1);
});
test('malformed retry details have bounded safe defaults, never NaN or zero',async()=>{
 for(const detail of ['bad',null,'{}','{"retryAfterSeconds":0}','{"retryAfterSeconds":"Infinity"}']){
  const result=await harness({code:'P0001',message:'love_note_minute_limit',details:detail}).post();
  assert.equal(result.status,429);assert.equal(result.body.retryAfterSeconds,60);
 }
 assert.equal((await harness({code:'P0001',message:'love_note_minute_limit',details:'{"retryAfterSeconds":9999}'}).post()).body.retryAfterSeconds,60);
});
test('unrelated database errors stay failures; quota names alone never bypass authentication',async()=>{
 for(const error of [{code:'XX000',message:'love_note_minute_limit'},{code:'P0001',message:'other_failure'}])assert.equal((await harness(error).post()).status,500);
 const h=harness({code:'P0001',message:'love_note_daily_limit'});h.unauthenticated();assert.equal((await h.post()).status,401);assert.equal(h.calls.length,0);
});
