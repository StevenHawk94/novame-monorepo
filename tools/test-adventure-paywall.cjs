const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');

function harness(stored=new Map()) {
  let owner='me',identity,broken=false;
  const api=load('apps/mobile/src/lib/adventure-paywall.ts',{
    './storage':{storage:{getString:key=>stored.get(key),set:(key,value)=>{if(broken)throw Error('disk');stored.set(key,value);}}},
    '../shared/storage/keys':{kAdventurePaywall:{keyFor:id=>`adventure-promo:${id}`}},
    './session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:fn=>{identity=fn;}},
  },{console:{warn(){}}});
  const complete=(id,overrides={})=>api.recordAdventurePaywallCompletion({userId:owner,adventureId:id,hasPlus:false,...overrides});
  return {api,stored,complete,state:()=>JSON.parse(stored.get(`adventure-promo:${owner}`)||'null'),
    account:id=>{owner=id;identity();},fail:value=>{broken=value;}};
}

test('Adventure offers are due exactly at 1, 5, 20, then every 20 completions, never the legacy cadence',()=>{
  const h=harness(),offers=[];
  for(let n=1;n<=100;n++){
    h.complete(`adventure-${n}`);
    if(h.api.peekAdventurePaywall()){
      offers.push(n);h.api.consumeAdventurePaywall(h.api.peekAdventurePaywall());
    }
  }
  assert.deepEqual(offers,[1,5,20,40,60,80,100]);
  assert.equal(h.state().count,100);
  for(const value of [-20,0,1.5,NaN,Infinity,3,8,11,21,39])assert.equal(h.api.shouldShowAdventurePaywall(value),false);
});
test('same adventure cannot count twice across double taps, remounts, retries or process restart',()=>{
  const h=harness();h.complete('one');h.complete('one');assert.equal(h.state().count,1);
  const restored=harness(h.stored);assert.equal(restored.api.peekAdventurePaywall(),'one');
  restored.complete('one');assert.equal(restored.state().count,1);
  restored.api.consumeAdventurePaywall('wrong');assert.equal(restored.api.peekAdventurePaywall(),'one');
  restored.api.consumeAdventurePaywall('one');restored.complete('one');
  assert.equal(restored.api.peekAdventurePaywall(),null);assert.equal(restored.state().count,1);
});
test('existing server completion count seeds the cadence while stale snapshots cannot roll it back',()=>{
  const h=harness();h.complete('twentieth',{ordinal:20});assert.equal(h.state().count,20);
  assert.equal(h.api.peekAdventurePaywall(),'twentieth');h.api.consumeAdventurePaywall('twentieth');
  h.complete('twenty-first',{ordinal:20});assert.equal(h.state().count,21);assert.equal(h.api.peekAdventurePaywall(),null);
  h.complete('fortieth',{ordinal:40});assert.equal(h.api.peekAdventurePaywall(),'fortieth');
  const resumed=harness(h.stored);resumed.complete('fortieth',{ordinal:40});assert.equal(resumed.state().count,40);
});
test('Plus/shared Plus and mismatched or signed-out accounts cannot queue a promotion',()=>{
  const h=harness();h.complete('paid',{hasPlus:true});h.complete('other',{userId:'someone-else'});
  assert.equal(h.state(),null);h.complete('mine');h.account('other');
  assert.equal(h.api.peekAdventurePaywall(),null);h.api.consumeAdventurePaywall('mine');
  h.complete('theirs');assert.equal(h.api.peekAdventurePaywall(),'theirs');
  h.account('me');assert.equal(h.api.peekAdventurePaywall(),'mine');assert.equal(h.state().count,1);
  h.account(null);h.complete('signed-out',{userId:'me'});assert.equal(h.api.peekAdventurePaywall(),null);
});
test('promotional storage/listener failures never interrupt reward completion or auth changes',()=>{
  const h=harness();h.fail(true);assert.doesNotThrow(()=>h.complete('one'));assert.equal(h.state(),null);
  h.fail(false);h.api.subscribeAdventurePaywall(()=>{throw Error('unmounted listener');});
  assert.doesNotThrow(()=>h.complete('one'));assert.equal(h.state().count,1);
  assert.doesNotThrow(()=>h.account('other'));assert.equal(h.api.peekAdventurePaywall(),null);
});
