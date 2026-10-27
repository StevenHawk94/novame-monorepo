const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs'),{randomUUID}=require('node:crypto');
const A='11111111-1111-4111-8111-111111111111';
function avatar(){
 const calls=[];let owner=A,fail=false,info={size:100,contentType:'image/jpeg'};
 const storage={createSignedUploadUrl:async path=>({data:{token:'signed'}}),info:async()=>({data:info}),download:async()=>({data:{arrayBuffer:async()=>new ArrayBuffer(4)}}),getPublicUrl:path=>({data:{publicUrl:'https://example.test/'+path}}),upload:async()=>({})};
 const api=load('apps/api/src/app/api/upload-avatar/route.js',{
 '@supabase/supabase-js':{createClient:()=>({storage:{from:()=>storage},rpc:async(name,args)=>{calls.push([name,args]);return fail?{error:{message:'offline'}}:{data:name.startsWith('prepare')?{path:A+'/deadbeef.jpg'}:{avatarUrl:'https://new',superseded:false}};}})},
 '@/lib/auth-guard':{verifyToken:async()=>owner?{id:owner}:null},'@/lib/rate-limit':{rateLimit:async()=>({allowed:true})},
 // Real byte decoding/bomb rejection is in test-security-store-state.cjs.
 '@/lib/profile-avatar-image.mjs':{normalizeProfileAvatar:async()=>Buffer.from([255,216,255,0])},
 },{Response,process:{env:{}},crypto:{randomUUID},atob});
 return{calls,post:body=>api.POST({headers:{get:()=> 'Bearer test'},json:async()=>({userId:A,...body})}),owner:v=>owner=v,fail:()=>fail=true,info:v=>info=v};
}
test('avatar API verifies account ownership before issuing a ticket',async()=>{
 const h=avatar();h.owner('other');assert.equal((await h.post({action:'prepare'})).status,401);assert.equal(h.calls.length,0);
});
test('new stable request keys and old clients without keys are both supported',async()=>{
 const h=avatar(),key=randomUUID();assert.equal((await h.post({action:'prepare',requestKey:key})).status,200);assert.equal(h.calls[0][1].p_key,key);
 assert.equal((await h.post({action:'prepare'})).status,200);assert.ok(h.calls[1][1].p_key);
 assert.equal((await h.post({action:'prepare',requestKey:'invalid'})).status,400);assert.equal(h.calls.length,2);
});
test('complete validates immutable own path, MIME and size before committing',async()=>{
 const h=avatar();assert.equal((await h.post({action:'complete',path:'other/deadbeef.jpg'})).status,400);
 h.info({size:100,contentType:'text/plain'});assert.equal((await h.post({action:'complete',path:A+'/deadbeef.jpg'})).status,400);assert.equal(h.calls.length,0);
 h.info({size:100,contentType:'image/jpeg'});assert.equal((await h.post({action:'complete',path:A+'/deadbeef.jpg'})).status,200);
 assert.equal(h.calls[0][0],'complete_profile_avatar_v1');h.fail();assert.equal((await h.post({action:'complete',path:A+'/deadbeef.jpg'})).status,503);
});
test('legacy Base64 upload retains magic-byte validation and uses same commit lifecycle',async()=>{
 const h=avatar();assert.equal((await h.post({mimeType:'image/jpeg',base64:btoa('not an image')})).status,400);
 assert.equal((await h.post({mimeType:'image/jpeg',base64:Buffer.from([255,216,255,0]).toString('base64')})).status,200);
 assert.equal(h.calls[0][0],'complete_profile_avatar_v1');
});
test('cleanup is authenticated, acknowledges only successful Storage deletion, and keeps tombstones',async()=>{
 for(const failure of ['auth','storage','ack',null]){
  const calls=[];let reads=0;const db={rpc:async()=>({data:reads++?[]:[A+'/deadbeef.jpg']}),storage:{from:()=>({remove:async paths=>{calls.push(['remove',paths]);return{error:failure==='storage'?Error('offline'):null};}})},from:()=>({update:body=>({in:async()=>{calls.push(['ack',body]);return{error:failure==='ack'?Error('offline'):null};}})})};
  const api=load('apps/api/src/app/api/cron/avatar-cleanup/route.js',{'next/server':{NextResponse:Response},'@/lib/app-major-update':{appMajorUpdateServiceClient:()=>db}},{Response,process:{env:{CRON_SECRET:'test'}}});
  const result=await api.GET({headers:{get:()=>failure==='auth'?'wrong':'Bearer test'}});
  assert.equal(result.status,failure==='auth'?401:failure?503:200);
  if(failure==='auth')assert.equal(calls.length,0);if(failure==='storage')assert.equal(calls.length,1);
  if(!failure)assert.ok(calls[1][1].deleted_at);
 }
});
test('account profile GET derives identity from JWT, never query parameters; failures are recoverable',async()=>{
 let args;const api=load('apps/api/src/app/api/update-profile/route.js',{'@supabase/supabase-js':{createClient:()=>({rpc:async(_,a)=>{args=a;return{data:{id:A,has_password:false}};}})},'@/lib/auth-guard':{verifyToken:async()=>({id:A})}},{Response,process:{env:{}}});
 const result=await api.GET({headers:{get:()=> 'Bearer test'},url:'https://test?userId=other'});assert.equal(result.status,200);assert.equal(args.p_user,A);assert.equal(result.headers.get('Cache-Control'),'no-store');
 const failing=load('apps/api/src/app/api/update-profile/route.js',{'@supabase/supabase-js':{createClient:()=>{throw Error('offline');}},'@/lib/auth-guard':{verifyToken:async()=>({id:A})}},{Response,process:{env:{}}});
 assert.equal((await failing.GET({headers:{get:()=> 'Bearer test'}})).status,503);
});
test('pair initiator is identity-based for both viewers, never inferred from left/right or UUID ordering',async()=>{
 const B='22222222-2222-4222-8222-222222222222';
 for(const viewer of [A,B]){
  const queries=[];const api=load('apps/api/src/app/api/friends/pair/route.js',{
   'next/server':{NextResponse:Response},'@/lib/duo-auto':{},'@/lib/auth-guard':{verifyToken:async()=>({id:viewer})},
   '@supabase/supabase-js':{createClient:()=>({from:table=>{const filters=[];const query={select(){return query;},eq:(key,value)=>{filters.push([key,value]);return query;},maybeSingle:async()=>{queries.push([table,filters]);return{data:table==='pairings'?{partner_user_id:viewer===A?B:A,created_at:'2026-10-01T00:00:00Z'}:table==='friendships'?{requested_by:B}:{display_name:'Sam',timezone_name:'UTC'}};}};return query;}})},
  },{Response,URL,process:{env:{}}});
  const result=await api.GET({url:'https://test/api/friends/pair?userId='+viewer,headers:{get:()=> 'Bearer test'}});
  assert.equal(result.status,200);assert.equal((await result.json()).initiatorId,B);
  const filters=queries.find(q=>q[0]==='friendships')[1];assert.deepEqual(Array.from(filters,entry=>Array.from(entry)),[['user_a',A],['user_b',B],['status','accepted']]);
 }
});
