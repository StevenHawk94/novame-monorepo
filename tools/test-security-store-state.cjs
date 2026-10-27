const {test}=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
const a='11111111-1111-4111-8111-111111111111';
function apple(patch={}){
 const tx={bundleId:'com.novame.app',environment:'Production',productId:'novame.plus.monthly',type:'Auto-Renewable Subscription',
  originalTransactionId:'123',transactionId:'456',appAccountToken:a,expiresDate:Date.now()+86400000,signedDate:Date.now(),...patch};
 let status=1,expiry=Date.now()+172800000;
 const sdk={Environment:{PRODUCTION:'Production',SANDBOX:'Sandbox'},Status:{ACTIVE:1,EXPIRED:2,BILLING_RETRY:3,BILLING_GRACE_PERIOD:4,REVOKED:5},
  AppStoreServerAPIClient:class{},SignedDataVerifier:class{
   async verifyAndDecodeTransaction(){return tx}
   async verifyAndDecodeRenewalInfo(){return {originalTransactionId:'123',gracePeriodExpiresDate:expiry}}
  }};
 const m=load('apps/api/src/lib/apple-store-state.mjs',{'@apple/app-store-server-library':sdk},{Buffer,process:{env:{APPLE_APP_ID:'1'}},AbortSignal});
 const client={getAllSubscriptionStatuses:async()=>({bundleId:'com.novame.app',environment:'Production',appAppleId:1,data:[{lastTransactions:[
  {originalTransactionId:'123',status,signedTransactionInfo:'verified',signedRenewalInfo:'renewal'}]}]})};
 return {m,tx,client,status:v=>status=v,grace:v=>expiry=v,read:()=>m.currentAppleSubscription({...tx,expiresDate:Date.now()+86400000},a,client)};
}
test('current Apple API state, not a historic signed expiration, decides Plus',async()=>{
 const h=apple();assert.equal((await h.read()).state,'active');h.status(2);assert.equal((await h.read()).state,'expired');
 h.status(5);assert.equal((await h.read()).state,'revoked');h.status(3);assert.equal((await h.read()).state,'on_hold');
 h.status(4);assert.equal((await h.read()).state,'grace_period');h.grace(Date.now()-1000);assert.equal((await h.read()).state,'expired');
});
test('Apple snapshots fail closed on wrong account, incomplete expiry, unknown state or app',async()=>{
 await assert.rejects(apple({appAccountToken:'22222222-2222-4222-8222-222222222222'}).read(),/purchase_account_conflict/);
 await assert.rejects(apple({expiresDate:undefined}).read(),/incomplete_store_response/);
 const h=apple();h.status(999);await assert.rejects(h.read(),/incomplete_store_response/);
 h.client.getAllSubscriptionStatuses=async()=>({bundleId:'wrong'});await assert.rejects(h.read(),/store_app_mismatch/);
});
test('unbound Apple legacy receipts without account token cannot be claimed by first caller',async()=>{
 const h=apple();let bound=null;const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:bound})})};
 await assert.rejects(h.m.assertAppleOwner(db,{originalTransactionId:'123'},a),/purchase_account_conflict/);
 bound={user_id:a};await h.m.assertAppleOwner(db,{originalTransactionId:'123'},a);
 bound={user_id:null};await assert.rejects(h.m.assertAppleOwner(db,{originalTransactionId:'123',appAccountToken:a},a),/purchase_account_conflict/);
});
test('official Apple SignedDataVerifier rejects a fabricated JWS (no mock cryptography)',async()=>{
 const prior=process.env.APPLE_APP_ID;process.env.APPLE_APP_ID='1';
 try{
  const m=await import('../apps/api/src/lib/apple-store-state.mjs');
  const forged=Buffer.from(JSON.stringify({alg:'ES256',x5c:[]})).toString('base64url')+'.'+Buffer.from(JSON.stringify({environment:'Production',bundleId:'com.novame.app',productId:'novame.plus.monthly'})).toString('base64url')+'.forged';
  await assert.rejects(m.verifyAppleTransaction(forged),/invalid_store_signature/);
 }finally{if(prior==null)delete process.env.APPLE_APP_ID;else process.env.APPLE_APP_ID=prior;}
});
test('Google pending, unknown, on-hold and expired cannot be interpreted as purchased Plus',()=>{
 const {googleSubscriptionSnapshot:read}=load('apps/api/src/lib/store-subscription-state.mjs',{
  './apple-store-state.mjs':{STORE_PRODUCTS:{'novame.plus.monthly':{cycle:'monthly'}},storeFailure:(code,status=503)=>{throw Object.assign(Error(code),{status})}},
 });
 const sub={lineItems:[{productId:'novame.plus.monthly',expiryTime:new Date(Date.now()+86400000).toISOString()}],subscriptionState:'SUBSCRIPTION_STATE_ACTIVE'};
 assert.equal(read(sub,a,'token','now').state,'active');
 for(const state of ['SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED','invented'])assert.throws(()=>read({...sub,subscriptionState:state},a,'token','now'));
 assert.equal(read({...sub,subscriptionState:'SUBSCRIPTION_STATE_ON_HOLD'},a,'token','now').state,'on_hold');
 assert.equal(read({...sub,lineItems:[{...sub.lineItems[0],expiryTime:new Date(Date.now()-1000).toISOString()}]},a,'token','now').state,'expired');
 assert.equal(read({...sub,testPurchase:{}},a,'token','now').environment,'sandbox');
});
test('real limiter denies on outage or exhausted buckets and keeps Retry-After',async()=>{
 const m=load('apps/api/src/lib/security-boundary.js',{}, {crypto:webcrypto,TextEncoder,Response});
 const request=new Request('https://test',{headers:{'x-forwarded-for':'127.0.0.1'}});
 await assert.rejects(m.securityRateLimit({rpc:async()=>({error:Error('offline')})},request,a,'test'),e=>e.status===503);
 let calls=0;await assert.rejects(m.securityRateLimit({rpc:async()=>({data:{allowed:++calls===1,reset_in:30}})},request,a,'test'),e=>e.status===429);
 const failure=m.securityFailure(Object.assign(Error('too_many_requests'),{status:429,retryAfter:30}));assert.equal(failure.headers.get('Retry-After'),'30');
});
test('avatar bytes are really decoded, normalized and stripped, not trusted by extension',async()=>{
 const sharp=require('../apps/api/node_modules/sharp'),{normalizeProfileAvatar}=await import('../apps/api/src/lib/profile-avatar-image.mjs');
 const source=await sharp({create:{width:1600,height:800,channels:3,background:'#ff0000'}}).withMetadata({exif:{IFD0:{Artist:'private metadata'}}}).jpeg().toBuffer();
 const output=await normalizeProfileAvatar(new Uint8Array(source));const meta=await sharp(output).metadata();
 assert.equal(meta.width,1024);assert.equal(meta.height,512);assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);
 for(const bytes of [Buffer.from([255,216,255,0]),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),Buffer.alloc(5*1024*1024+1)])await assert.rejects(normalizeProfileAvatar(bytes));
 const huge=await sharp({create:{width:4097,height:1,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(normalizeProfileAvatar(huge));
});
test('retired Airwallex endpoints are inert for every legacy verb and body',async()=>{
 for(const file of ['book-payment','payment-checkout','payment-result','webhooks/airwallex']){
  const route=load('apps/api/src/app/api/'+file+'/route.js',{}, {Response});
  for(const verb of ['GET','POST']){
   const result=await route[verb]({json(){throw Error('must not reach payment body')}});assert.equal(result.status,410);
  }
 }
});
