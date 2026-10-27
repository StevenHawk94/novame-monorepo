const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,deferred}=require('./lifecycle-test-utils.cjs');
function harness(stored=new Map()) {
  let user='me',epoch=1,broken=false;const listeners=[];
  const identity={sessionUserId:()=>user,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{listeners.push(fn);return()=>{};}};
  const api=load('apps/mobile/src/lib/official-rating-milestones.ts',{
    './storage':{storage:{getString:key=>stored.get(key),set:(key,value)=>{if(broken)throw Error('disk full');stored.set(key,value);}}},
    '../shared/storage/keys':{kOfficialRatingMilestones:{keyFor:id=>`review:${id}`}},'./session-lifecycle':identity,
  },{console:{warn(){}}});
  return {api,stored,identity,state:()=>JSON.parse(stored.get(`review:${user}`)||'null'),
    record:(kind,id)=>api.recordRatingMilestone(user,kind,id),
    account:id=>{user=id;epoch++;listeners.forEach(fn=>fn());},fail:()=>{broken=true;}};
}
for(const kind of ['affection','purchase'])test(`${kind}: independently requests at 1, 10, 20, 30… successful receipts, not at 11`,()=>{
  const h=harness(),due=[];
  for(let i=1;i<=41;i++){
    h.record(kind,`receipt-${i}`);h.record(kind,`receipt-${i}`);
    const pending=h.api.peekRatingMilestone();if(pending){due.push(i);h.api.consumeRatingMilestone(pending);}
  }
  assert.deepEqual(due,[1,10,20,30,40]);assert.equal(h.state()[kind].length,41);
  assert.equal(h.state()[kind==='purchase'?'affection':'purchase'].length,0);
});
test('Toy review needs a real saved photo and interaction; it is one-time, not once per replacement photo/toy',()=>{
  const h=harness();h.api.recordPhotoToyPlayForRating('me','toy',undefined);assert.equal(h.state(),null);
  h.api.recordPhotoToyPlayForRating('me',undefined,'photo');assert.equal(h.state(),null);
  h.api.recordPhotoToyPlayForRating('me','toy','photo');assert.equal(h.api.peekRatingMilestone().kind,'toy');
  h.api.consumeRatingMilestone(h.api.peekRatingMilestone());
  h.api.recordPhotoToyPlayForRating('me','new-toy','replacement-photo');assert.equal(h.api.peekRatingMilestone(),null);
  const restarted=harness(h.stored);restarted.api.recordPhotoToyPlayForRating('me','toy','photo');assert.equal(restarted.api.peekRatingMilestone(),null);
});
test('Affection inline permission belongs only to the mounted successful Sent screen, not a persisted request',()=>{
 const h=harness();h.record('affection','one');const pending=h.api.peekRatingMilestone();
 assert.equal(h.api.canPresentRatingInline(pending),false);
 const release=h.api.registerInlineAffectionRating('me','one');assert.equal(h.api.canPresentRatingInline(pending),true);
 release();assert.equal(h.api.canPresentRatingInline(pending),false);
 h.api.registerInlineAffectionRating('me','one');h.account('other');assert.equal(h.api.canPresentRatingInline(pending),false);
 h.account('me');assert.equal(h.api.canPresentRatingInline(pending),false);
});
test('restart retains independent counters, unpresented requests and receipt dedupe; unrelated accounts cannot consume them',()=>{
  const h=harness();h.record('affection','a');h.record('purchase','p');
  const restored=harness(h.stored),pending=restored.api.peekRatingMilestone();assert.equal(pending.kind,'purchase');
  restored.record('purchase','p');assert.equal(restored.state().purchase.length,1);
  restored.account('other');assert.equal(restored.api.peekRatingMilestone(),null);restored.api.consumeRatingMilestone(pending);
  restored.record('purchase','other-p');assert.equal(restored.state().purchase.length,1);
  restored.account('me');assert.equal(restored.api.peekRatingMilestone().id,pending.id);
  restored.api.consumeRatingMilestone({...pending,id:'stale'});assert.equal(restored.api.peekRatingMilestone().id,pending.id);
  restored.api.consumeRatingMilestone(pending);assert.equal(restored.api.peekRatingMilestone(),null);
});
test('paid purchase tracking rejects free/no-op/error receipts and ignores late account responses without changing transaction outcomes',async()=>{
  const h=harness();
  for(const [receipt,price,bulk] of [[{},300,false],[{purchaseId:'free'},0,false],[{total:0},undefined,true],[{error:'rejected',purchaseId:'bad'},300,false]]){
    assert.equal(await h.api.trackItemPurchaseForRating(Promise.resolve(receipt),'op',price,bulk),receipt);
  }
  assert.equal(h.state(),null);
  const receipt={purchaseId:'paid',applied:true};await h.api.trackItemPurchaseForRating(Promise.resolve(receipt),'op',300);
  h.api.consumeRatingMilestone(h.api.peekRatingMilestone());
  await h.api.trackItemPurchaseForRating(Promise.resolve({...receipt,applied:false}),'op',300);assert.equal(h.state().purchase.length,1);
  await h.api.trackItemPurchaseForRating(Promise.resolve({total:900,applied:true}),'bulk',undefined,true);
  assert.equal(h.state().purchase.length,2,'one multi-item checkout counts once');
  await h.api.trackItemPurchaseForRating(Promise.resolve({total:900,applied:false}),'bulk',undefined,true);assert.equal(h.state().purchase.length,2);
  const late=deferred(),task=h.api.trackItemPurchaseForRating(late.promise,'late',300);h.account('other');late.resolve({purchaseId:'late'});await task;
  assert.equal(h.state(),null);h.account('me');assert.equal(h.state().purchase.length,2);
  await assert.rejects(h.api.trackItemPurchaseForRating(Promise.reject(Error('declined')),'bad',300),/declined/);
});
test('promotional persistence/listener failure cannot turn a committed purchase into a failure',async()=>{
  const h=harness();h.fail();const receipt={purchaseId:'committed'};
  assert.equal(await h.api.trackItemPurchaseForRating(Promise.resolve(receipt),'op',300),receipt);
  assert.equal(h.state(),null);
  const other=harness();other.api.subscribeRatingMilestones(()=>{throw Error('stale listener');});
  assert.doesNotThrow(()=>other.record('affection','a'));assert.doesNotThrow(()=>other.account('new'));
});

function client(h) {
  let response={};const calls=[];
  const api=load('apps/mobile/src/lib/app-major-update-api.ts',{
    'expo-crypto':{randomUUID:()=> 'generated'},'./api':{apiClient:{post:async(_url,body)=>{calls.push(body);return typeof response==='function'?response():response;}}},
    './async-lifecycle':{withDeadline:p=>p},'./session-lifecycle':h.identity,
    './coin-reward-store':{commandCoinReward(){},settleCoinReward(){},failCoinReward(){}},
    './official-rating-milestones':h.api,
  });
  return {api,calls,reply:value=>{response=value;}};
}
for(const platform of ['ios','android'])test(`${platform}: actual catalog and room checkout APIs count confirmed purchases once, without changing quotes or keys`,async()=>{
  const h=harness(),c=client(h);c.reply({purchaseId:'one',applied:true});
  await c.api.purchaseCatalogItem('lamp','me','safe-key',300);
  assert.equal(h.state().purchase.length,1);assert.equal(c.calls[0].expectedPrice,300);assert.equal(c.calls[0].idempotencyKey,'safe-key');
  c.reply({purchaseId:'one',applied:false});await c.api.purchaseCatalogItem('lamp','me','safe-key',300);assert.equal(h.state().purchase.length,1);
  c.reply({error:'price_changed'});await assert.rejects(c.api.purchaseCatalogItem('lamp','me','retry',300),/price_changed/);assert.equal(h.state().purchase.length,1);
  c.reply({total:600,applied:true});await c.api.purchaseRoomLoadout({lamp:'lamp',chair:'chair'},'bulk-key',undefined,{lamp:300,chair:300});
  assert.equal(h.state().purchase.length,2);assert.equal(c.calls.at(-1).expectedPrices.lamp,300);
  c.reply({applied:true});await c.api.saveRoomLoadout('home',{lamp:'lamp'});assert.equal(h.state().purchase.length,2,'placing owned items does not count');
});
test('new rating receipts are explicitly private registered keys',()=>{
  const keys=fs.readFileSync('apps/mobile/src/shared/storage/keys.ts','utf8');
  assert.match(keys,/kOfficialRatingMilestones = definePrefixKey\('burrow_official_rating_milestones:v1:', 'user'\)/);
});
