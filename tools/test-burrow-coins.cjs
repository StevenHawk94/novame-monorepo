const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const tx={productId:'burrow.coin.200',type:'Consumable',bundleId:'com.novame.app',appAccountToken:a,quantity:1,transactionId:'1000000001',signedDate:Date.now(),environment:'Sandbox'};
function server(extra={}) {return load('apps/api/src/lib/burrow-coins.mjs',{'node:crypto':crypto,'app-store-server-api':{decodeTransaction:async()=>tx},'google-auth-library':{GoogleAuth:class{async getAccessToken(){return 'access';}}}},{process:{env:{BURROW_IAP_ENVIRONMENT:'sandbox',GOOGLE_PLAY_SA_EMAIL:'service',GOOGLE_PLAY_SA_PRIVATE_KEY:'key'}},AbortSignal,...extra});}
const google=()=>({productLineItem:[{productId:'burrow.coin.200',productOfferDetails:{quantity:2,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}],purchaseStateContext:{purchaseState:'PURCHASED'},obfuscatedExternalProfileId:a,obfuscatedExternalAccountId:crypto.createHash('sha256').update(`novame:${a}`).digest('hex'),testPurchaseContext:{fopType:'TEST'}});
test('Apple trusts verified quantity/product/account/environment, never caller amounts',()=>{
  const m=server();const args=m.appleCoin(tx,a);assert.equal(args.p_quantity,1);assert.equal(args.p_refunded,0);
  for(const patch of [{appAccountToken:b},{appAccountToken:undefined},{bundleId:'other'},{type:'Auto-Renewable Subscription'},{environment:'Production'},{quantity:0},{quantity:101},{productId:'toString'},{signedDate:undefined}])assert.throws(()=>m.appleCoin({...tx,...patch},a));
});
test('Apple refund and reversal use verified notification ordering',()=>{
  const m=server(),signedDate=tx.signedDate+2000;
  assert.equal(m.appleCoin(tx,a,{notificationType:'REFUND',signedDate}).p_refunded,1);
  const result=m.appleCoin({...tx,revocationDate:signedDate-1000},a,{notificationType:'REFUND_REVERSED',signedDate});
  assert.equal(result.p_refunded,0);assert.equal(result.p_signed_at,new Date(signedDate).toISOString());
});
test('Google verifies account hash, item and quantities, pending is not credited',()=>{
  const m=server(),data=google(),args=m.googleCoin(data,'secret',a,'burrow.coin.200');
  assert.equal(args.p_refunded,1);assert.equal(args.p_quantity,2);assert.notEqual(args.p_credential,'secret');
  for(const patch of [{obfuscatedExternalProfileId:b},{obfuscatedExternalAccountId:'wrong'},{purchaseStateContext:{purchaseState:'PENDING'}},{productLineItem:[]},{productLineItem:[...data.productLineItem,...data.productLineItem]}])assert.throws(()=>m.googleCoin({...data,...patch},'token',a));
  data.productLineItem[0].productOfferDetails.refundableQuantity=3;assert.throws(()=>m.googleCoin(data,'token',a));
});
test('verification fails closed when receipt environment is not configured',()=>{
  assert.throws(()=>server({process:{env:{}}}).appleCoin(tx,a),/store_not_configured/);
});
test('Google grants BEFORE consuming, repeats safely, never consumes when credit fails',async()=>{
  const order=[];
  const m=server({fetch:async(url)=>{if(url.endsWith(':consume')){order.push('consume');return {ok:true};}order.push('verify');return {ok:true,json:async()=>google()};}});
  const db={rpc:async()=>{order.push('credit');return {data:{delta:200}};}};
  await m.verifyGoogleCoin(db,'token',a,'burrow.coin.200');assert.deepEqual(order,['verify','credit','consume']);order.length=0;
  await assert.rejects(m.verifyGoogleCoin({rpc:async()=>({error:'offline'})},'token',a,'burrow.coin.200'),/purchase_credit_unavailable/);assert.deepEqual(order,['verify']);
});
test('Google consume failure stays retryable after durable credit',async()=>{
  const m=server({fetch:async url=>url.endsWith(':consume')?{ok:false}:{ok:true,json:async()=>google()}});
  await assert.rejects(m.verifyGoogleCoin({rpc:async()=>({data:{delta:200}})},'token',a),/purchase_acknowledgement_pending/);
});
test('verified Google pending webhook is acknowledged without credit',async()=>{
  const data=google();data.purchaseStateContext.purchaseState='PENDING';let calls=0;
  const m=server({fetch:async()=>({ok:true,json:async()=>data})});
  const result=await m.verifyGoogleCoin({rpc:async()=>{calls++;}},'token',null,null,true);assert.equal(result.pending,true);assert.equal(calls,0);
});
test('verify endpoint authenticates, validates product and ignores client amount',async()=>{
  let user=null,args=null;
  const route=load('apps/api/src/app/api/vnext/coins/verify/route.js',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@/lib/app-major-update':{authenticatedUserId:async()=>user,appMajorUpdateServiceClient:()=>({})},'@/lib/burrow-coins.mjs':{coinProduct:id=>id==='burrow.coin.200',verifyAppleCoin:async(...x)=>{args=x;return {delta:200};}}});
  const request=body=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await route.POST(request({}))).status,401);user=a;
  assert.equal((await route.POST(request({productId:'bad'}))).status,400);
  assert.equal((await route.POST(request({productId:'burrow.coin.200',platform:'ios',purchaseToken:'signed',amount:999999,userId:b}))).body.delta,200);
  assert.equal(args[2],a);assert.equal(args.length,4);
});
function mobile(platform='ios',extra={}){
  const time=clock(),calls=[],gate=deferred();let auth=a,identity,epoch=0;
  const m=load('apps/mobile/src/lib/carrot-iap.ts',{'react':{useSyncExternalStore:(_,get)=>get()},'react-native':{Platform:{OS:platform}},'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,v)=>crypto.createHash('sha256').update(v).digest('hex')},'expo-iap':{ErrorCode:{UserCancelled:'cancelled'},requestPurchase:async body=>calls.push(['request',body]),fetchProducts:async()=>[],finishTransaction:async()=>calls.push(['finish'])},'./supabase':{supabase:{auth:{getSession:async()=>({data:{session:auth?{user:{id:auth}}:null}})}}},'./api':{apiClient:{get:async()=>({available:!extra.disabled}),post:async()=>{calls.push(['verify']);return extra.pending?gate.promise:{success:!extra.fail};}}},'./burrow-store':{refreshBurrow:async()=>calls.push(['refresh'])},'./session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}}},time.globals);
  return {m,calls,gate,time,switchUser:()=>{auth=b;epoch++;identity();}};
}
test('mobile consumable finishes only after successful server credit',async()=>{
  const h=mobile();await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws',purchaseState:'purchased'});
  assert.deepEqual(h.calls.map(x=>x[0]),['verify','finish','refresh']);
  const failed=mobile('ios',{fail:true});assert.equal(await failed.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws'}),false);assert.equal(failed.calls.some(x=>x[0]==='finish'),false);
});
test('mobile pending transactions never grant or finish, Google does not double consume',async()=>{
  const h=mobile('android');await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'t',purchaseState:'pending'});assert.equal(h.calls.length,0);
  await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'t',purchaseState:'purchased'});assert.deepEqual(h.calls.map(x=>x[0]),['verify','refresh']);
});
test('duplicate listeners share one verification and one finish operation',async()=>{
  const h=mobile('ios',{pending:true}),p={productId:'burrow.coin.200',purchaseToken:'same'};
  const one=h.m.handleCarrotPurchase(p),two=h.m.handleCarrotPurchase(p);h.gate.resolve({success:true});await Promise.all([one,two]);
  assert.equal(h.calls.filter(x=>x[0]==='verify').length,1);assert.equal(h.calls.filter(x=>x[0]==='finish').length,1);
});
test('request binds both stores to signed-in identity and cancellation clears busy state',async()=>{
  const h=mobile();await h.m.purchaseCarrots('burrow.coin.200');const request=h.calls[0][1];
  assert.equal(request.type,'in-app');assert.equal(request.request.apple.appAccountToken,a);assert.equal(request.request.google.obfuscatedProfileId,a);
  assert.equal(h.m.coinPurchaseBusy(),true);h.m.handleCarrotError({code:'cancelled',productId:'burrow.coin.200'});assert.equal(h.m.coinPurchaseBusy(),false);
});
test('disabled server cannot open store checkout; account switch during readiness cancels checkout',async()=>{
  const h=mobile('ios',{disabled:true});await assert.rejects(h.m.purchaseCarrots('burrow.coin.200'),/not enabled/);assert.equal(h.calls.length,0);
  const next=mobile(),purchase=next.m.purchaseCarrots('burrow.coin.200');next.switchUser();await assert.rejects(purchase,/account changed/);assert.equal(next.calls.length,0);
});
test('rapid double tap opens only one checkout',async()=>{
  const h=mobile();await Promise.allSettled([h.m.purchaseCarrots('burrow.coin.200'),h.m.purchaseCarrots('burrow.coin.200')]);
  assert.equal(h.calls.filter(x=>x[0]==='request').length,1);h.time.advance(120000);assert.equal(h.m.coinPurchaseBusy(),false);
});
test('subscription checkout acquiring ownership during coin readiness blocks coin sheet',async()=>{
  const h=mobile();let busy=false;h.m.setSubscriptionPurchaseGuard(()=>busy);
  const pending=h.m.purchaseCarrots('burrow.coin.200');busy=true;
  await assert.rejects(pending,/subscription purchase first/);assert.equal(h.calls.length,0);
  assert.equal(h.m.coinPurchaseBusy(),false);
  await assert.rejects(h.m.purchaseCarrots('burrow.coin.400'),/subscription purchase first/);
});
test('late verification failure from old identity cannot clear a new account checkout',async()=>{
  const h=mobile('ios',{pending:true});
  const old=h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'old'});
  await flush();assert.ok(h.calls.some(x=>x[0]==='verify'));h.switchUser();await h.m.purchaseCarrots('burrow.coin.400');
  h.gate.reject(Error('old request failed'));await old;
  assert.equal(h.m.coinPurchaseBusy(),true);assert.equal(h.m.useCarrotPurchase().message,'Waiting for the store…');
});
test('late same-account verification cannot clear a newer checkout; subscription errors are not swallowed',async()=>{
  const h=mobile('ios',{pending:true});
  const old=h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'old'});
  await flush();assert.ok(h.calls.some(x=>x[0]==='verify'));await h.m.purchaseCarrots('burrow.coin.400');
  assert.equal(h.m.handleCarrotError({productId:'novame.plus.monthly',code:'failed'}),false);
  h.gate.resolve({success:true});await old;
  assert.equal(h.m.coinPurchaseBusy(),true);assert.equal(h.m.useCarrotPurchase().message,'Waiting for the store…');
});
test('Google coin RTDN rejects unauthenticated configuration before verification',async()=>{
  let calls=0;
  const route=load('apps/api/src/app/api/webhooks/google/route.js',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@supabase/supabase-js':{},'google-auth-library':{OAuth2Client:class{}},'@/lib/burrow-coins.mjs':{verifyGoogleCoin:async()=>calls++}},{process:{env:{}},atob});
  const data=Buffer.from(JSON.stringify({packageName:'com.burrow.app',oneTimeProductNotification:{purchaseToken:'token',sku:'burrow.coin.200'}})).toString('base64');
  const result=await route.POST(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({message:{data}})}));
  assert.equal(result.status,503);assert.equal(calls,0);
});
test('Apple coin webhook verifies inner transaction before credit',async()=>{
  const calls=[];
  const route=load('apps/api/src/app/api/webhooks/apple/route.js',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@supabase/supabase-js':{createClient:()=>({})},'app-store-server-api':{decodeNotificationPayload:async()=>{calls.push('outer');return {notificationType:'REFUND',signedDate:tx.signedDate,data:{bundleId:'com.novame.app',signedTransactionInfo:'inner'}};},decodeTransaction:async()=>{calls.push('inner');return tx;}},'@/lib/burrow-coins.mjs':{coinProduct:id=>id==='burrow.coin.200',appleCoin:()=>({}),applyCoin:async()=>calls.push('credit')}},{process:{env:{}},Buffer});
  const result=await route.POST(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({signedPayload:'outer'})}));
  assert.equal(result.status,200);assert.deepEqual(calls,['outer','inner','credit']);
});
