const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {load:baseLoad,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const load=(file,imports={},globals={})=>baseLoad(file,{
  './coin-store-prices':{CARROT_PRODUCTS:['burrow.coin.200','burrow.coin.400','burrow.coin.1000']},...imports,
  './coin-reward-store':{syncCoinWallet:wallet=>walletReceipts.push({...wallet})},
  '@/lib/burrow-reward-wallet.mjs':{readRewardWallet:async()=>null},
  ...(imports['./burrow-store']?{'./burrow-store':{
    burrowClock:()=>10000,refreshBurrowAfterCurrent:async options=>{
      assert.equal(options.silent,true);assert.equal(options.after,10000);
      await imports['./burrow-store'].refreshBurrow();
    },...imports['./burrow-store'],
  }}:{}),
},globals);
const walletReceipts=[];
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const tx={productId:'burrow.coin.200',type:'Consumable',bundleId:'com.novame.app',appAccountToken:a,quantity:1,transactionId:'1000000001',signedDate:Date.now(),environment:'Sandbox'};
function server(extra={}) {return load('apps/api/src/lib/burrow-coins.mjs',{'node:crypto':crypto,'./apple-store-state.mjs':{verifyAppleTransaction:async()=>tx,currentAppleTransaction:async v=>v},'google-auth-library':{GoogleAuth:class{async getAccessToken(){return 'access';}}}},{process:{env:{BURROW_IAP_ENVIRONMENT:'sandbox',GOOGLE_PLAY_SA_EMAIL:'service',GOOGLE_PLAY_SA_PRIVATE_KEY:'key'}},AbortSignal,...extra});}
const google=()=>({productLineItem:[{productId:'burrow.coin.200',productOfferDetails:{quantity:2,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}],purchaseStateContext:{purchaseState:'PURCHASED'},obfuscatedExternalProfileId:a,obfuscatedExternalAccountId:crypto.createHash('sha256').update(`novame:${a}`).digest('hex'),testPurchaseContext:{fopType:'TEST'}});
test('Apple trusts verified quantity/product/account/environment, never caller amounts',()=>{
  const m=server();const args=m.appleCoin(tx,a);assert.equal(args.p_quantity,1);assert.equal(args.p_refunded,0);
  for(const patch of [{appAccountToken:b},{appAccountToken:undefined},{bundleId:'other'},{type:'Auto-Renewable Subscription'},{environment:'Unknown'},{quantity:0},{quantity:101},{productId:'toString'},{signedDate:undefined}])assert.throws(()=>m.appleCoin({...tx,...patch},a));
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
test('receipt environment is store-authoritative; unknown environments fail closed',()=>{
  const m=server({process:{env:{}}});assert.equal(m.appleCoin(tx,a).p_environment,'sandbox');
  assert.equal(m.appleCoin({...tx,environment:'Production'},a).p_environment,'production');
  assert.throws(()=>m.appleCoin({...tx,environment:'Unknown'},a),/store_environment_mismatch/);
});
test('verified sandbox admission always uses the protected database domain, without a tester allowlist',async()=>{
  const enabled=server();
  const calls=[];
  await enabled.verifyAppleCoin({rpc:async(name,args)=>{calls.push({name,args});return{data:{wallet:'room'}};}},'signed',a,'burrow.coin.200');
  assert.equal(calls[0].name,'apply_burrow_coin_purchase_v2');assert.equal(calls[0].args.p_allow_sandbox_room,true);
  assert.equal(calls[0].args.p_environment,'sandbox');assert.equal(calls[0].args.p_user_id,a);
  await assert.rejects(enabled.verifyAppleCoin({rpc:async()=>({data:{error:'production_account_conflict'}})},'signed',a,'burrow.coin.200'),/production_account_conflict/);
});
test('Google grants BEFORE consuming, repeats safely, never consumes when credit fails',async()=>{
  const order=[];
  const m=server({fetch:async(url)=>{if(url.endsWith(':consume')){order.push('consume');return {ok:true};}order.push('verify');return {ok:true,json:async()=>google()};}});
  const db={rpc:async()=>{order.push('credit');return {data:{delta:200}};}};
  assert.equal((await m.verifyGoogleCoin(db,'token',a,'burrow.coin.200')).acknowledgementPending,true);assert.deepEqual(order,['verify','credit']);order.length=0;
  await assert.rejects(m.verifyGoogleCoin({rpc:async()=>({error:'offline'})},'token',a,'burrow.coin.200'),/purchase_credit_unavailable/);assert.deepEqual(order,['verify']);
});
test('Google finish is queued after durable credit and cannot downgrade the successful receipt',async()=>{
  const m=server({fetch:async url=>url.endsWith(':consume')?{ok:false}:{ok:true,json:async()=>google()}});
  const calls=[];const result=await m.verifyGoogleCoin({rpc:async(name,args)=>{calls.push([name,args]);return{data:{delta:200}};}},'token',a);
  assert.equal(result.delta,200);assert.equal(result.acknowledgementPending,true);
  assert.equal(calls[0][0],'credit_google_coin_v3');assert.equal(calls[0][1].p_consume,true);
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
  const time=clock(),calls=[],readinessCalls=[],gate=deferred();let auth=a,identity,epoch=0;
  const m=load('apps/mobile/src/lib/carrot-iap.ts',{'react':{useSyncExternalStore:(_,get)=>get()},'react-native':{Platform:{OS:platform}},'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,v)=>crypto.createHash('sha256').update(v).digest('hex')},'expo-iap':{ErrorCode:{UserCancelled:'cancelled'},requestPurchase:async body=>{calls.push(['request',body]);if(extra.requestError)throw extra.requestError;},fetchProducts:async()=>[],finishTransaction:async()=>{calls.push(['finish']);if(extra.finishError)throw extra.finishError;}},'./supabase':{supabase:{auth:{getSession:async()=>({data:{session:auth?{user:{id:auth}}:null}})}}},'./api':{apiClient:{get:async()=>{readinessCalls.push(epoch);return extra.readiness?extra.readiness():{available:!extra.disabled,environment:extra.environment};},post:async()=>{calls.push(['verify']);return extra.pending?gate.promise:{success:!extra.fail,environment:extra.environment,balance:extra.balance};}}},'./burrow-store':{refreshBurrow:async()=>calls.push(['refresh'])},'./session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}}},time.globals);
  return {m,calls,readinessCalls,gate,time,switchUser:()=>{auth=b;epoch++;identity();}};
}
test('mobile consumable finishes only after successful server credit',async()=>{
  const h=mobile();await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws',purchaseState:'purchased'});
  assert.deepEqual(h.calls.map(x=>x[0]),['verify','refresh','finish']);
  const failed=mobile('ios',{fail:true});assert.equal(await failed.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws'}),false);assert.equal(failed.calls.some(x=>x[0]==='finish'),false);
});
test('sandbox checkout explains test-only currency and reports isolated balance without refreshing real coins',async()=>{
  const h=mobile('ios',{environment:'sandbox',balance:400});
  await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws',purchaseState:'purchased'});
  assert.deepEqual(h.calls.map(x=>x[0]),['verify','finish']);
  assert.match(h.m.useCarrotPurchase().message,/400 coins.*Room balance unchanged/);
});
test('approved sandbox tester refreshes spendable Home coins after verified credit',async()=>{
  const h=mobile('ios',{pending:true,environment:'sandbox'});
  const result=h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'jws',purchaseState:'purchased'});
  h.gate.resolve({success:true,environment:'sandbox',wallet:'room',balance:200});await result;
  assert.deepEqual(h.calls.map(x=>x[0]),['verify','refresh','finish']);
  assert.match(h.m.useCarrotPurchase().message,/Coins added/);
});
test('verified purchase immediately updates versioned Home wallet without waiting for a bootstrap',async()=>{
  const h=mobile('ios',{pending:true,environment:'sandbox'});
  const result=h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'instant',purchaseState:'purchased'});
  h.gate.resolve({success:true,environment:'sandbox',wallet:'room',roomWallet:{balance:200,version:5}});
  await result;assert.deepEqual(walletReceipts.at(-1),{balance:200,version:5});
  assert.match(h.m.useCarrotPurchase().message,/Coins added/);
  const before=walletReceipts.length;
  const isolated=mobile('ios',{pending:true,environment:'sandbox'});
  const other=isolated.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'isolated'});
  isolated.gate.resolve({success:true,environment:'sandbox',wallet:'sandbox',balance:400});await other;
  assert.equal(walletReceipts.length,before);
});
test('same consumable can open another checkout after the previous transaction completes',async()=>{
  const h=mobile();
  for(const token of ['first','second']){
    await h.m.purchaseCarrots('burrow.coin.200');
    await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:token,purchaseState:'purchased'});
    assert.equal(h.m.coinPurchaseBusy(),false);
  }
  assert.equal(h.calls.filter(x=>x[0]==='request').length,2);
  assert.equal(h.calls.filter(x=>x[0]==='finish').length,2);
});
test('readiness requires store configuration and platform, not a global live-or-test switch',async()=>{
  let table,broken=false,scope='production';
  const env={BURROW_COIN_PURCHASES_ENABLED:'true',BURROW_COIN_PURCHASE_PLATFORMS:'ios',APPLE_APP_ID:'1',APPLE_IAP_PRIVATE_KEY:'key',APPLE_IAP_KEY_ID:'id',APPLE_IAP_ISSUER_ID:'issuer'};
  const db={rpc:async()=>({data:scope,error:broken?'missing':null}),from:name=>{
    table=name;return {select:()=>({limit:async()=>({error:broken?'missing':null})})};}};
  const route=load('apps/api/src/app/api/vnext/coins/verify/route.js',{
    'next/server':{NextResponse:{json:body=>body}},
    '@/lib/app-major-update':{authenticatedUserId:async()=>a,appMajorUpdateServiceClient:()=>db,majorUpdateEnabled:async()=>true},
    '@/lib/burrow-coins.mjs':{sandboxCoinRoomEnabled:()=>{
      if(env.BURROW_SANDBOX_COIN_MODE==='room'&&env.BURROW_IAP_ENVIRONMENT!=='sandbox')throw Error('store_not_configured');
      return env.BURROW_SANDBOX_COIN_MODE==='room';
    }},
  },{process:{env},URL});
  assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).available,true);
  assert.equal(table,'burrow_coin_transactions');
  assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).wallet,'room');
  scope='sandbox';assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).environment,'sandbox');
  assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).available,true);
  assert.equal((await route.GET(new Request('https://test.invalid?platform=android'))).available,false);
  broken=true;assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).available,false);
  env.APPLE_IAP_KEY_ID='';broken=false;
  assert.equal((await route.GET(new Request('https://test.invalid?platform=ios'))).available,false);
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
  assert.equal(h.m.useCarrotPurchase().message,null);assert.equal(h.m.useCarrotPurchase().status,'idle');
});
test('direct native cancellation is silent, releases checkout and allows another purchase',async()=>{
 const h=mobile('ios',{requestError:{code:'cancelled'}});
 await h.m.purchaseCarrots('burrow.coin.200');assert.equal(h.m.coinPurchaseBusy(),false);
 assert.equal(h.m.useCarrotPurchase().message,null);assert.equal(h.m.useCarrotPurchase().status,'idle');
 await h.m.purchaseCarrots('burrow.coin.400');assert.equal(h.calls.filter(x=>x[0]==='request').length,2);
});
test('an unknown store handoff error is unconfirmed, not an unpaid failure; late errors cannot downgrade committed success',async()=>{
 const h=mobile('ios',{requestError:Error('connection closed')});
 await h.m.purchaseCarrots('burrow.coin.200');
 assert.equal(h.m.useCarrotPurchase().status,'unconfirmed');assert.equal(h.m.coinPurchaseBusy(),false);
 await h.m.handleCarrotPurchase({productId:'burrow.coin.200',purchaseToken:'confirmed'});
 assert.equal(h.m.useCarrotPurchase().status,'success');
 h.m.handleCarrotError({productId:'burrow.coin.200',code:'failed'});
 assert.equal(h.m.useCarrotPurchase().status,'success');
});
test('committed credit remains success when native finishing fails; replay uses the same credential',async()=>{
 const h=mobile('ios',{finishError:Error('store offline')}),purchase={productId:'burrow.coin.200',purchaseToken:'credited'};
 assert.equal(await h.m.handleCarrotPurchase(purchase),true);
 assert.equal(h.m.useCarrotPurchase().status,'success');assert.equal(h.m.useCarrotPurchase().message,'Coins added to your balance.');
 assert.equal(h.m.coinPurchaseBusy(),false);
 assert.equal(await h.m.handleCarrotPurchase(purchase),true);
 assert.equal(h.m.useCarrotPurchase().status,'success');
});
test('disabled server cannot open store checkout; account switch during readiness cancels checkout',async()=>{
  const h=mobile('ios',{disabled:true});await assert.rejects(h.m.purchaseCarrots('burrow.coin.200'),/not enabled/);assert.equal(h.calls.length,0);
  const next=mobile(),purchase=next.m.purchaseCarrots('burrow.coin.200');next.switchUser();await assert.rejects(purchase,/account changed/);assert.equal(next.calls.length,0);
});
test('mobile environment-conflict responses block checkout before the native payment sheet',async()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../apps/mobile/src/lib/carrot-iap.ts'),'utf8');
  for(const reason of ['sandbox_account_conflict','production_account_conflict']) {
    assert.ok(source.indexOf(`ready.reason==='${reason}'`)<source.indexOf('await requestPurchase('));
  }
});
test('rapid double tap opens only one checkout',async()=>{
  const h=mobile();await Promise.allSettled([h.m.purchaseCarrots('burrow.coin.200'),h.m.purchaseCarrots('burrow.coin.200')]);
  assert.equal(h.calls.filter(x=>x[0]==='request').length,1);h.time.advance(120000);assert.equal(h.m.coinPurchaseBusy(),false);
});
test('shop prewarm removes the authenticated round trip from a recent checkout and coalesces in-flight checks',async()=>{
  const ready=deferred(),h=mobile('ios',{readiness:()=>ready.promise});
  h.m.prewarmCarrotPurchase();h.m.prewarmCarrotPurchase();assert.equal(h.readinessCalls.length,1);
  assert.equal(h.m.coinPurchaseBusy(),false,'warmup does not lock or show checkout');
  const purchase=h.m.purchaseCarrots('burrow.coin.200');assert.equal(h.m.coinPurchaseBusy(),true);
  assert.equal(h.readinessCalls.length,1,'tap joins unfinished warmup');assert.equal(h.calls.length,0);
  ready.resolve({available:true,environment:'production',wallet:'room'});await purchase;
  assert.equal(h.calls.filter(x=>x[0]==='request').length,1);
  h.m.handleCarrotError({code:'cancelled',productId:'burrow.coin.200'});
  h.m.prewarmCarrotPurchase();await flush();assert.equal(h.readinessCalls.length,2,'terminal outcome invalidates wallet readiness');
  await h.m.purchaseCarrots('burrow.coin.400');assert.equal(h.readinessCalls.length,2,'recent authenticated success reused');
});
test('readiness is memory-only, expires after 30 seconds, fails closed and discards old-account responses',async()=>{
  const h=mobile();h.m.prewarmCarrotPurchase();await flush();h.time.advance(30000);
  await h.m.purchaseCarrots('burrow.coin.200');assert.equal(h.readinessCalls.length,2,'expired success rechecked');
  const denied=mobile('ios',{disabled:true});denied.m.prewarmCarrotPurchase();await flush();
  await assert.rejects(denied.m.purchaseCarrots('burrow.coin.200'),/not enabled/);
  assert.equal(denied.readinessCalls.length,2,'failed availability cannot be reused');assert.equal(denied.calls.length,0);
  const first=deferred(),second=deferred();let count=0;
  const swapped=mobile('ios',{readiness:()=>++count===1?first.promise:second.promise});
  swapped.m.prewarmCarrotPurchase();swapped.switchUser();swapped.m.prewarmCarrotPurchase();
  first.resolve({available:true,environment:'production'});await flush();
  const purchase=swapped.m.purchaseCarrots('burrow.coin.200');await flush();assert.equal(swapped.calls.length,0);
  second.resolve({available:false,reason:'sandbox_account_conflict'});
  await assert.rejects(purchase,/separate live account/);assert.equal(swapped.calls.length,0);
  assert.equal(swapped.m.coinPurchaseBusy(),false);
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
  const route=load('apps/api/src/app/api/webhooks/google/route.js',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@supabase/supabase-js':{},'google-auth-library':{OAuth2Client:class{}},'@/lib/google-store-state.mjs':{},'@/lib/burrow-coins.mjs':{verifyGoogleCoin:async()=>calls++}},{process:{env:{}},atob,Response});
  const data=Buffer.from(JSON.stringify({packageName:'com.burrow.app',oneTimeProductNotification:{purchaseToken:'token',sku:'burrow.coin.200'}})).toString('base64');
  const result=await route.POST(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({message:{data}})}));
  assert.equal(result.status,503);assert.equal(calls,0);
});
test('Apple coin webhook verifies inner transaction before credit',async()=>{
  const calls=[];
  const route=load('apps/api/src/app/api/webhooks/apple/route.js',{'@supabase/supabase-js':{createClient:()=>({})},'@/lib/store-subscription-state.mjs':{},'@/lib/apple-store-state.mjs':{verifyAppleNotification:async()=>{calls.push('outer');return {notificationType:'REFUND',signedDate:tx.signedDate,data:{bundleId:'com.novame.app',signedTransactionInfo:'inner'}};},verifyAppleTransaction:async()=>{calls.push('inner');return tx;}},'@/lib/burrow-coins.mjs':{coinProduct:id=>id==='burrow.coin.200',appleCoin:()=>({}),applyCoin:async()=>calls.push('credit')}},{process:{env:{}},Buffer,Response});
  const result=await route.POST(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({signedPayload:'outer'})}));
  assert.equal(result.status,200);assert.deepEqual(calls,['outer','inner','credit']);
});
