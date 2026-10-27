const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,flush,deferred}=require('./lifecycle-test-utils.cjs');
const {createAdventureDeliveryQueue}=load('apps/mobile/src/lib/adventure-delivery-queue.ts');
const json=x=>JSON.parse(JSON.stringify(x));
function harness(initial=[]) {
  let context={owner:'me',scope:'me:partner:1'},active=true,disk=json(initial),saveFails=false;
  const calls=[],receipts=[],requests=[],timers=new Map();let settled=0;
  const request=(stage,id,choice)=>{calls.push([stage,id,choice]);const d=deferred();requests.push(d);return d.promise;};
  const queue=createAdventureDeliveryQueue({context:()=>context,active:()=>active,load:()=>disk,
    save:jobs=>{if(saveFails)throw Error('disk_full');disk=json(jobs);},
    treasure:id=>request('treasure',id),respond:(id,choice)=>request('response',id,choice),claim:id=>request('finish',id),
    confirmed:(job,stage,receipt)=>receipts.push([job.owner,stage,receipt.itemId]),settled:()=>settled++,
    schedule:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
  return {queue,calls,receipts,requests,timers,disk:()=>disk,settled:()=>settled,
    context:value=>context=value,active:value=>active=value,saveFails:value=>saveFails=value};
}
test('all rapid local clicks persist immediately while the first API call is pending; stages and receipts stay ordered',async()=>{
  const h=harness();assert.equal(h.queue.enqueue('a',{treasure:true}),true);
  h.queue.enqueue('a',{choiceId:'first'});h.queue.enqueue('a',{choiceId:'second'});h.queue.enqueue('a',{finish:true});
  assert.deepEqual(h.calls.map(x=>x[0]),['treasure']);assert.equal(h.disk()[0].choiceId,'first');assert.equal(h.disk()[0].finish,true);
  assert.equal(h.receipts.length,0,'taps never grant inventory');
  h.requests[0].resolve({itemId:'chair'});await flush();assert.deepEqual(h.calls.map(x=>x[0]),['treasure','response']);assert.equal(h.calls[1][2],'first');
  h.requests[1].resolve({reaction:['reply']});await flush();assert.equal(h.calls[2][0],'finish');
  h.requests[2].resolve({itemId:'friend-gift'});await h.queue.resume();
  assert.deepEqual(h.receipts,[['me','treasure','chair'],['me','response',undefined],['me','finish','friend-gift']]);assert.equal(h.disk().length,0);assert.equal(h.settled(),1);
});
test('ambiguous disconnect retries the same adventure ID; a restart resumes only unsaved stages',async()=>{
  const h=harness();h.queue.enqueue('a',{treasure:true,choiceId:'choice',finish:true});
  h.requests[0].reject(Error('Network request failed'));await flush();assert.equal(h.disk()[0].treasureSaved,false);assert.equal(h.receipts.length,0);
  const retry=[...h.timers.values()][0];assert.equal(retry.ms,2000);retry.fn();await flush();assert.equal(h.calls[1][1],'a');
  h.requests[1].resolve({itemId:'chair'});await flush();h.active(false);h.queue.pause();
  h.requests[2].resolve({});await flush();assert.equal(h.disk()[0].responseSaved,true);assert.equal(h.calls.length,3);
  const resumed=harness(h.disk());void resumed.queue.resume();assert.equal(resumed.calls[0][0],'finish');
  resumed.requests[0].resolve({itemId:'gift'});await resumed.queue.resume();assert.equal(resumed.disk().length,0);
});
test('a late old-account receipt cannot grant inventory; new-account intent drains after the old flight finishes',async()=>{
  const h=harness();h.queue.enqueue('old',{treasure:true});h.context({owner:'new',scope:'new:solo:'});
  h.queue.enqueue('new',{treasure:true});h.requests[0].resolve({itemId:'old-item'});await flush();
  assert.equal(h.receipts.length,0);assert.equal(h.calls[1][1],'new');
  h.requests[1].resolve({itemId:'new-item'});await h.queue.resume();assert.deepEqual(h.receipts,[['new','treasure','new-item']]);
  assert.equal(h.disk().find(x=>x.id==='old').treasureSaved,false);
});
test('protocol rejection pauses without fake award or busy retry; explicit retry preserves the chosen answer',async()=>{
  const h=harness();h.queue.enqueue('a',{finish:true});h.requests[0].resolve({interactionRequired:true});await flush();
  assert.equal(h.disk()[0].failed,true);assert.equal(h.receipts.length,0);assert.equal(h.timers.size,0);
  h.queue.enqueue('a',{choiceId:'a'});assert.equal(h.calls[1][0],'response');
  h.requests[1].resolve({});await flush();h.requests[2].resolve({itemId:'gift'});await h.queue.resume();assert.equal(h.disk().length,0);
});
test('local storage failure refuses visual intent and receipt persistence failure safely replays the server receipt',async()=>{
  const h=harness();h.saveFails(true);assert.equal(h.queue.enqueue('a',{treasure:true}),false);assert.equal(h.queue.get('a'),undefined);assert.equal(h.calls.length,0);
  h.saveFails(false);h.queue.enqueue('a',{treasure:true,finish:true});h.saveFails(true);
  h.requests[0].resolve({itemId:'chair'});await flush();assert.equal(h.receipts.length,0);assert.equal(h.queue.get('a').treasureSaved,false);
  h.saveFails(false);void h.queue.resume();h.requests[1].resolve({itemId:'chair'});await flush();
  h.saveFails(true);h.requests[2].resolve({itemId:'gift'});await flush();assert.equal(h.queue.get('a').finish,true);
  h.saveFails(false);void h.queue.resume();h.requests[3].resolve({itemId:'gift'});await h.queue.resume();assert.equal(h.disk().length,0);
  assert.deepEqual(h.receipts.map(x=>x[1]),['treasure','finish']);
});
test('background cancels timers; deleted/cancelled journeys stop retrying without any award',async()=>{
  const h=harness();h.queue.enqueue('a',{treasure:true});h.requests[0].reject(Error('offline'));await flush();
  h.active(false);h.queue.pause();assert.equal(h.timers.size,0);await h.queue.resume();assert.equal(h.calls.length,1);
  h.active(true);void h.queue.resume();h.requests[1].reject(Error('adventure_cancelled'));await h.queue.resume();assert.equal(h.disk().length,0);assert.equal(h.receipts.length,0);
});
test('HTTP business errors are read from ApiError body instead of retrying an HTTP status forever',async()=>{
  const h=harness();h.queue.enqueue('a',{finish:true});
  h.requests[0].reject({message:'HTTP 409 Conflict',body:{error:'interaction_required'}});await flush();
  assert.equal(h.disk()[0].failed,true);assert.equal(h.timers.size,0);assert.equal(h.receipts.length,0);
});
test('logout clears memory as well as disk scope; even same-account re-login cannot accept the old session receipt',async()=>{
  const h=harness();h.queue.enqueue('old',{treasure:true});h.queue.reset();assert.equal(h.queue.get('old'),undefined);
  h.queue.enqueue('fresh',{treasure:true});h.requests[0].resolve({itemId:'stale'});await flush();assert.equal(h.receipts.length,0);assert.equal(h.calls[1][1],'fresh');
  h.requests[1].resolve({itemId:'fresh'});await h.queue.resume();assert.equal(h.disk().some(x=>x.id==='old'),false);
});
