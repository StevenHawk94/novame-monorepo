const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/shop-gift-model.ts'),version=load('apps/mobile/src/lib/notification-content-version.ts');
function harness(){
 const waiting=deferred(),calls=[];
 const api=load('apps/mobile/src/lib/shop-gift-preparation.ts',{'./shop-gift-model':model,'./notification-content-version':version,
  './burrow-art-assets':{burrowArtForItem:item=>item.asset?.source?{source:item.asset.source,thumbnail:item.asset.thumbnail}:null,HOME_WINDOW_LANDSCAPES:{spring:{day:8,night:9}}},
  './prepared-burrow-images':{retainGiftImages:sources=>calls.push(['retain',...sources]),prepareBurrowImages:sources=>{calls.push(['decode',...sources]);return waiting.promise;}}});
 const data={profile:{id:'A'},partner:{id:'B',display_name:'Babe'},pairVersion:'v1',pairAccessVerified:true,
  gifts:[{id:'one',item_id:'lamp',sender_id:'B',created_at:'2026-10-18'},{id:'two',item_id:'window',sender_id:'B',created_at:'2026-10-19'}],
  catalog:[{stable_id:'lamp',title:'Lamp',category:'lamps',asset:{source:1}},{stable_id:'window',title:'Window',category:'windows',asset:{source:2,thumbnail:3}}]};
 return {api,data,waiting,calls};
}
test('no badge until every product art and seasonal window layer is decoded; claimed subset remains immediately ready',async()=>{
 const h=harness();assert.equal(h.api.shopGiftsPrepared(h.data),false);const pending=h.api.prepareShopGifts(h.data,()=>true);await flush();
 assert.equal(h.api.shopGiftsPrepared(h.data),false);assert.deepEqual([...h.calls[1]],['decode',1,2,3,8,9]);
 h.waiting.resolve();await pending;assert.equal(h.api.shopGiftsPrepared(h.data),true);
 h.data.gifts.shift();assert.equal(h.api.shopGiftsPrepared(h.data),true,'next gift opens without a new network/readiness wait');
 h.data.gifts.push({id:'new',item_id:'lamp',sender_id:'B',created_at:'later'});assert.equal(h.api.shopGiftsPrepared(h.data),false);
  assert.deepEqual([...h.api.preparedShopGiftIds(h.data)],['two'],'arrival does not interrupt an already ready gift');
});
test('catalog holes, corrupt art, stale pair/version and late replies never advertise a ready gift',async()=>{
 const h=harness();let valid=true;const pending=h.api.prepareShopGifts(h.data,()=>valid);valid=false;h.waiting.resolve();await pending;
 assert.equal(h.api.shopGiftsPrepared(h.data),false);
 h.data.catalog.pop();await assert.rejects(h.api.prepareShopGifts(h.data,()=>true),/catalog_not_ready/);
 h.data.catalog.push({stable_id:'window'});await assert.rejects(h.api.prepareShopGifts(h.data,()=>true),/art_not_ready/);
});
