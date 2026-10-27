const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',session=crypto.randomUUID();
test('real JWT verification pins issuer/audience/algorithm; sensitive actions also check online session',async()=>{
 const jose=await import('../apps/api/node_modules/jose/dist/webapi/index.js');
 const {privateKey,publicKey}=await jose.generateKeyPair('ES256');
 const guard=load('apps/api/src/lib/auth-guard.ts',{jose:{jwtVerify:jose.jwtVerify,createRemoteJWKSet:()=>publicKey}},{URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.test'}}});
 const token=patch=>new jose.SignJWT({role:'authenticated',session_id:session,...patch}).setProtectedHeader({alg:'ES256'}).setSubject(a)
  .setIssuer(patch?.iss??'https://project.test/auth/v1').setAudience(patch?.aud??'authenticated').setExpirationTime('5m').sign(privateKey);
 const valid=await token();assert.equal((await guard.verifyToken(valid)).id,a);
 for(const patch of [{iss:'https://evil.test'},{aud:'service_role'},{role:'service_role'}])assert.equal(await guard.verifyToken(await token(patch)),null);
 const request=new Request('https://api.test',{headers:{Authorization:'Bearer '+valid}});
 let active=true;const db={auth:{getUser:async()=>({data:{user:{id:a}}})},rpc:async()=>({data:active})};
 assert.equal((await guard.verifySensitiveSession(request,db)).sessionId,session);active=false;
 assert.equal(await guard.verifySensitiveSession(request,db),null);
 db.auth.getUser=async()=>({data:{user:{id:b}}});active=true;assert.equal(await guard.verifySensitiveSession(request,db),null);
});
function deletion({guest=false,authFailure=false}={}){
 const calls=[];let challenge,authorized=false,proof,email,removed=0;
 const identity={user:{id:a,is_anonymous:guest,email:'confirmed@example.test',email_confirmed_at:'now'},sessionId:session};
 const db={rpc:async(name,args)=>{
  if(name==='check_rate_limit')return{data:{allowed:true}};
  if(args.p_action==='create'){challenge=args.p_id;proof=args.p_proof;return{data:{success:true}}}
  if(args.p_id!==challenge)return{data:{error:'confirmation_expired'}};
  if(args.p_action==='status')return{data:{authorized}};
  if(args.p_action==='authorize_guest'){authorized=guest;return{data:{success:authorized}}}
  if(args.p_action==='verify'){authorized=args.p_proof===proof;return{data:authorized?{success:true}:{error:'invalid_confirmation'}}}
 },from:table=>({delete:()=>({eq:async(key,id)=>{calls.push([table,key,id]);return{}}})}),auth:{admin:{deleteUser:async id=>{removed++;return{error:authFailure&&removed===1?Error('retry'):null}}}}};
 const boundary=load('apps/api/src/lib/security-boundary.js',{}, {crypto:crypto.webcrypto,TextEncoder,Response});
 const route=load('apps/api/src/app/api/delete-account/route.js',{
  '@supabase/supabase-js':{createClient:()=>db},'@/lib/auth-guard':{verifySensitiveSession:async()=>identity},
  '@/lib/security-boundary':boundary,'node:crypto':crypto,
 },{process:{env:{SUPABASE_SERVICE_ROLE_KEY:'fake-test-key',RESEND_API_KEY:'fake-test-mail'}},crypto:crypto.webcrypto,Response,AbortSignal,
  fetch:async(url,args)=>{email=JSON.parse(args.body);return{ok:true}}});
 const post=body=>route.POST(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({userId:a,...body})}));
 return{post,calls,code:()=>email.text.match(/code is (\d+)/)[1],removed:()=>removed};
}
test('delete API never mutates before proof; code is emailed, never returned, and binds owner',async()=>{
 const h=deletion();assert.equal((await h.post({action:'delete'})).status,409);assert.equal(h.calls.length,0);
 const prepared=await(await h.post({action:'prepare'})).json();assert.equal(prepared.requiresCode,true);assert.equal(prepared.code,undefined);
 assert.equal((await h.post({action:'delete',challengeId:prepared.challengeId,code:'00000000'})).status,409);assert.equal(h.calls.length,0);
 assert.equal((await h.post({userId:b,action:'delete',challengeId:prepared.challengeId,code:h.code()})).status,401);
 assert.equal((await h.post({action:'delete',challengeId:prepared.challengeId,code:h.code()})).status,200);
 assert.deepEqual(h.calls,[['profiles','id',a]]);assert.equal(h.removed(),1);
});
test('anonymous deletion remains available; partial Auth failure is explicit and retryable',async()=>{
 const h=deletion({guest:true,authFailure:true});const prepared=await(await h.post({action:'prepare'})).json();assert.equal(prepared.requiresCode,false);
 assert.equal((await h.post({action:'delete',challengeId:prepared.challengeId})).status,503);
 assert.equal((await h.post({action:'delete',challengeId:prepared.challengeId})).status,200);assert.equal(h.removed(),2);
});
