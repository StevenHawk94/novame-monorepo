const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
class ApiError extends Error{constructor(body){super('HTTP 409');this.status=409;this.body=body;}}
const subscription={id:'sub-1',productId:'novame.plus.yearly',purchaseToken:'subscription',purchaseState:'purchased'};
const coin={id:'coin-1',productId:'burrow.coin.200',purchaseToken:'coin',purchaseState:'purchased'};
function harness({conflict=false,slow=false,coinsBusy=false,coinsBusyAfterSession=false}={}){
 const time=clock(),gate=deferred(),calls=[],errors=[],complete=[];let update,error,epoch=1,coinBusy=coinsBusy;
 const api=load('apps/mobile/src/lib/iap.ts',{
  'react-native':{Platform:{OS:'ios'}},'./paywall-presentation':{},
  './carrot-iap':{isCarrotProduct:id=>id?.startsWith('burrow.coin.'),handleCarrotPurchase:async p=>{calls.push('coin:'+p.id);return true;},handleCarrotError:()=>false,coinPurchaseBusy:()=>coinBusy,setSubscriptionPurchaseGuard(){}},
  './coin-store-prices':{prewarmCoinPrices:()=>calls.push('prices')},'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},CryptoEncoding:{HEX:'hex'},digestStringAsync:async()=> 'account-hash'},
  './session-lifecycle':{sessionEpoch:()=>epoch},
  'expo-iap':{initConnection:async()=>calls.push('connect'),purchaseUpdatedListener:fn=>{update=fn;return{remove(){}};},purchaseErrorListener:fn=>{error=fn;return{remove(){}};},
   getAvailablePurchases:async()=>[subscription,coin],finishTransaction:async()=>calls.push('finish'),createPurchaseError:x=>x,ErrorCode:{UserCancelled:'cancelled',PurchaseVerificationFailed:'verify'},endConnection:async()=>{},
   isEligibleForIntroOfferIOS:async()=>false,fetchProducts:async()=>[],requestPurchase:async()=>{calls.push('request-subscription');return{id:'active'};}},
  './api':{apiClient:{post:async()=>{calls.push('verify');if(slow)return gate.promise;if(conflict)throw new ApiError({code:'PURCHASE_ACCOUNT_CONFLICT',storeEnvironment:'sandbox'});return{success:true,tier:'plus'};}}},
  '@novame/api-client':{ApiError},'./quota-flag':{clearQuotaExhausted(){}},'./me-stats':{refreshMeStats:async()=>{}},'./auth':{ensureSession:async()=>{if(coinsBusyAfterSession)coinBusy=true;return true;}},
  './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'user-a'}}}})}}},
  './subscription':{clearCachedSubscription(){},fetchSubscriptionTier:async()=>calls.push('tier-refresh'),setCachedSubscription:()=>calls.push('tier-confirmed')},
  './ad-measurement':{},
 },time.globals);
 api.onPurchaseError(e=>errors.push(e));api.onPurchaseComplete(e=>complete.push(e));
 return{api,calls,errors,complete,gate,switchAccount:()=>epoch++,update:p=>update(p),error:e=>error(e)};
}
test('store readiness resolves before stalled subscription recovery; coin lane proceeds independently',async()=>{
 const h=harness({slow:true});await h.api.initIAP();await flush();
 assert.ok(h.calls.includes('verify'));assert.ok(h.calls.includes('coin:coin-1'));
 assert.equal(h.calls.includes('tier-confirmed'),false);
 assert.equal(await h.api.reconcileAvailablePurchases({coinsOnly:true}),true,'coin recovery does not await the subscription verification gate');
 await h.api.initIAP();assert.equal(h.calls.filter(x=>x==='connect').length,1);
 h.gate.resolve({success:true,tier:'plus'});await flush();
 assert.ok(h.calls.includes('tier-confirmed'));assert.equal(h.errors.length,0);assert.equal(h.complete.length,0);
});
test('late subscription verification from the previous identity cannot publish Plus to the next account',async()=>{
 const h=harness({slow:true});await h.api.initIAP();await flush();h.switchAccount();
 h.gate.resolve({success:true,tier:'plus'});await flush();
 assert.equal(h.calls.includes('tier-confirmed'),false);assert.equal(h.calls.includes('tier-refresh'),false);
 assert.equal(h.errors.length,0);assert.equal(h.complete.length,0);
});
test('silent subscription ownership conflict neither interrupts a purchase surface nor counts as restored',async()=>{
 const h=harness({conflict:true});await h.api.initIAP();await flush();
 assert.ok(h.calls.includes('finish'));assert.ok(h.calls.includes('coin:coin-1'));
 assert.equal(h.calls.includes('tier-refresh'),false);assert.equal(h.calls.includes('tier-confirmed'),false);
 assert.equal(h.errors.length,0);assert.equal(h.complete.length,0);
 let late=0;h.api.onPurchaseError(()=>late++);assert.equal(late,0);
 assert.equal(await h.api.reconcileAvailablePurchases(),false);
});
test('an active subscription conflict reports once, releases its lock, and leaves coin recovery available',async()=>{
 const h=harness({conflict:true});await h.api.initIAP();await flush();
 await h.api.purchaseSubscription('novame.plus.yearly');assert.equal(h.api.isSubscriptionPurchaseBusy(),true);
 h.update({...subscription,id:'new-active'});await flush();
 assert.equal(h.api.isSubscriptionPurchaseBusy(),false);assert.equal(h.errors.length,1);
 assert.match(h.errors[0].message,/Sandbox purchase is linked to another/);
 assert.equal(h.complete.length,0);assert.equal(await h.api.reconcileAvailablePurchases({coinsOnly:true}),true);
});
test('both subscription checkout guards retain mutual exclusion with coin-purchase wording',async()=>{
 for(const options of [{coinsBusy:true},{coinsBusyAfterSession:true}]){
  const h=harness(options);
  await assert.rejects(h.api.purchaseSubscription('novame.plus.yearly'),{message:'Please finish your coin purchase first.'});
  assert.equal(h.calls.includes('request-subscription'),false);assert.equal(h.api.isSubscriptionPurchaseBusy(),false);
 }
});
