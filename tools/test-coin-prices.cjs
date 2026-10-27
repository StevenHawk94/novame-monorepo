const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,clock,deferred}=require('./lifecycle-test-utils.cjs');
const KEY='burrow_coin_store_prices_v1';
const PRODUCTS=['burrow.coin.200','burrow.coin.400','burrow.coin.1000'];
function harness(seed,shared=new Map()) {
  if(seed!==undefined)shared.set(KEY,JSON.stringify(seed));
  const time=clock(),gate=deferred();let country='USA',queries=0;
  const m=load('apps/mobile/src/lib/coin-store-prices.ts',{
    'react-native':{Platform:{OS:'ios'}},
    'expo-iap':{getStorefront:async()=>country,fetchProducts:async()=>{queries++;return gate.promise;}},
    './storage':{storage:{getString:k=>shared.get(k),set:(k,v)=>shared.set(k,v),remove:k=>shared.delete(k)}},
    '../shared/storage/keys':{kCoinStorePrices:{name:KEY}},
  },time.globals);
  return {m,time,gate,shared,queries:()=>queries,setCountry:c=>{country=c;},
    resolve:(price='$2.99')=>gate.resolve(PRODUCTS.map(id=>({id,displayPrice:price})))};
}
test('startup and shop deduplicate a native product query, before auth and without backend dependency',async()=>{
  const h=harness();h.m.prewarmCoinPrices();const first=h.m.loadCoinPrices(),second=h.m.loadCoinPrices(true);
  assert.equal(first,second);h.resolve();await first;assert.equal(h.queries(),1);
  assert.equal(h.m.cachedCoinPrices()[PRODUCTS[0]],'$2.99');
  assert.match(fs.readFileSync('apps/mobile/src/lib/iap.ts','utf8'),/initialized = true;[\s\S]*prewarmCoinPrices\(\)/);
});
test('official localized prices survive full module restart and are paintable synchronously',async()=>{
  const h=harness();h.resolve('€2,99');await h.m.loadCoinPrices();
  const restarted=harness(undefined,h.shared);
  assert.equal(restarted.m.cachedCoinPrices()[PRODUCTS[0]],'€2,99');
  await restarted.m.loadCoinPrices();assert.equal(restarted.queries(),0);
});
test('stale prices remain visible while silently refreshing; store failure retains usable cache',async()=>{
  const h=harness({platform:'ios',storefront:'USA',savedAt:1,prices:{[PRODUCTS[0]]:'$2.99'}});
  h.time.advance(6*60_000);const pending=h.m.loadCoinPrices();assert.equal(h.m.cachedCoinPrices()[PRODUCTS[0]],'$2.99');
  h.gate.reject(Error('offline'));await assert.rejects(pending);assert.equal(h.m.cachedCoinPrices()[PRODUCTS[0]],'$2.99');
});
test('country switch invalidates cached currency; corrupt, expired, or other-platform cache never becomes price',async()=>{
  const h=harness({platform:'ios',storefront:'GBR',savedAt:1,prices:{[PRODUCTS[0]]:'£2.99'}});
  const pending=h.m.loadCoinPrices();h.resolve();await pending;
  assert.equal(h.queries(),1);assert.equal(h.m.cachedCoinPrices()[PRODUCTS[0]],'$2.99');
  for(const seed of [{platform:'android',storefront:'USA',savedAt:1,prices:{[PRODUCTS[0]]:'$99'}},
    {platform:'ios',storefront:'USA',savedAt:1,prices:{[PRODUCTS[0]]:99}}])assert.deepEqual({...harness(seed).m.cachedCoinPrices()},{});
  h.time.advance(8*24*60*60_000);assert.deepEqual({...h.m.cachedCoinPrices()},{});
});
