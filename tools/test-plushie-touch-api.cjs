const {test}=require('node:test'),assert=require('node:assert/strict');const {load}=require('./lifecycle-test-utils.cjs');
const contract=load('packages/domain/src/plushie-touch.ts');
function route(auth='A',failLimit=false){const calls=[];
 const mod=load('apps/api/src/app/api/vnext/plushie-touch/route.js',{'next/server':{NextResponse:Response},
  '@/lib/app-major-update':{authenticatedUserId:async()=>auth,majorUpdateEnabled:async()=>true,appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{success:true,version:1}};}})},
  '@/lib/security-boundary':{securityRateLimit:async()=>{if(failLimit)throw Error('rate_failed');},securityFailure:()=>Response.json({error:'unavailable'},{status:503})},'@novame/domain':contract,
 },{URL,TextEncoder,Response});return{...mod,calls};}
const uuid='11111111-1111-4111-8111-111111111111',pair='a'.repeat(32),body=()=>({action:'send',actorId:'forged-B',partnerId:uuid,key:uuid,photoId:uuid,toyId:'toy',pairVersion:pair,localDate:'2026-10-25',clip:{version:1,durationMs:60000,touches:1,events:[[0,4,0,0,0]]}});
const req=b=>new Request('https://test.invalid/api/vnext/plushie-touch',{method:'POST',body:JSON.stringify(b)});
test('API uses JWT actor, never caller actor; read is non-destructive and seen is explicit',async()=>{
 const r=route();assert.equal((await r.POST(req(body()))).status,200);assert.equal(r.calls[0].args.p_user,'A');assert.equal(r.calls[0].args.p_partner,uuid);
 await r.GET(new Request(`https://test.invalid/api/vnext/plushie-touch?pair=${pair}&id=${uuid}`));assert.equal(r.calls[1].args.p_seen,false);
 await r.POST(req({action:'seen',pairVersion:pair,messageId:uuid}));assert.equal(r.calls[2].args.p_seen,true);
});
test('unauthenticated, unavailable security limiter, malformed/oversized clips and unversioned pairs fail without RPC writes',async()=>{
 const unauth=route(null);assert.equal((await unauth.POST(req(body()))).status,401);assert.equal(unauth.calls.length,0);
 const limit=route('A',true);assert.equal((await limit.POST(req(body()))).status,503);assert.equal(limit.calls.length,0);
 for(const patch of [{pairVersion:'old'},{clip:{...body().clip,touches:999}},{clip:{...body().clip,secret:'x'.repeat(270000)}},{photoId:'../../secret'},{action:'delete'}]){
  const r=route();assert.equal((await r.POST(req({...body(),...patch}))).status,400);assert.equal(r.calls.length,0);}
});
test('Push routes bind the immutable message ID; missing IDs cannot redirect a stale touch to unrelated current content',()=>{
 const {systemNotificationDestination}=load('apps/mobile/src/lib/system-notification-routing.ts');
 assert.equal(systemNotificationDestination({type:'plushie_touch'}),null);
 const destination=systemNotificationDestination({type:'plushie_touch',messageId:uuid});assert.equal(destination.params.messageId,uuid);assert.equal(destination.params.mode,'inbox');
});
test('v2 routes negotiate explicit capability, keep JWT actor and atomic original send receipt; old reads stay v1',async()=>{
 const r=route();await r.GET(new Request(`https://test.invalid/api/vnext/plushie-touch?pair=${pair}&v=2`));assert.equal(r.calls[0].name,'plushie_touch_state_v2');
 await r.GET(new Request(`https://test.invalid/api/vnext/plushie-touch?pair=${pair}&v=2&id=${uuid}`));assert.equal(r.calls[1].name,'read_plushie_touch_v2');assert.equal(r.calls[1].args.p_seen,false);
 await r.POST(req({action:'seen',protocol:2,pairVersion:pair,messageId:uuid}));assert.equal(r.calls[2].name,'read_plushie_touch_v2');assert.equal(r.calls[2].args.p_seen,true);
 const v2={...body(),clip:{...body().clip,version:2}};assert.equal((await r.POST(req(v2))).status,400);
 assert.equal((await r.POST(req({...v2,protocol:2}))).status,200);assert.equal(r.calls.at(-1).name,'send_plushie_touch_v1');assert.equal(r.calls.at(-1).args.p_user,'A');
});
