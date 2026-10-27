const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/shop-gift-model.ts');
const version=load('apps/mobile/src/lib/notification-content-version.ts');
const {createShopGiftQueue}=load('apps/mobile/src/lib/shop-gift-queue.ts',{'./shop-gift-model':model,'./notification-content-version':version});
const plain=x=>JSON.parse(JSON.stringify(x));
const gift=(id='one',item='lamp')=>({id,item_id:item,sender_id:'B',created_at:id==='one'?'2026-10-18':'2026-10-19'});
const data=()=>({profile:{id:'A'},partner:{id:'B'},pairVersion:'v1',pairAccessVerified:true,gifts:[gift(),gift('two','rug')],
  unread:{gifts:2,affection:1},inventory:[],loadouts:[{room_type:'home',owner_id:'A',slot:'lamp',item_id:'old'}],catalog:[]});
const intent=(id='one',replace=false)=>({gift:gift(id,id==='one'?'lamp':'rug'),itemId:id==='one'?'lamp':'rug',slot:id==='one'?'lamp':'rug',replace,previousItemId:id==='one'?'old':null});
function harness(disk=new Map()){
 const time=clock(),calls=[],events=[];let active=true,owner='A',full=false;
 const q=createShopGiftQueue({owner:()=>owner,active:()=>active,load:id=>disk.get(id),save:(id,v)=>{if(full)throw Error('disk');disk.set(id,plain(v));},
  send:(job,scope)=>{const wait=deferred();calls.push({job:plain(job),scope,...wait});return wait.promise;},
  definitive:e=>['not_found','pair_changed'].includes(e.message),changed:()=>events.push('change'),confirmed:()=>events.push('confirmed'),
  rejected:(job,error)=>events.push(['rejected',job.gift.id,error.message]),schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
 return {q,time,calls,events,disk,setActive:x=>active=x,setOwner:x=>owner=x,setFull:x=>full=x};
}
test('gift intent is durable before UI advances or network starts; claim taps deduplicate and serialize',async()=>{
 const h=harness();h.q.receive(data(),true);h.q.enqueue(intent());h.q.enqueue(intent());h.q.enqueue(intent('two'));
 assert.equal(h.calls.length,0);assert.equal(h.disk.get('A').jobs.length,2);assert.equal(h.q.project(data()).gifts.length,0);
 assert.equal(h.q.project(data()).unread.gifts,0);assert.equal(h.q.project(data()).inventory.length,2);
 assert.equal(h.q.project(data()).loadouts[0].item_id,'old','unchecked claim never equips');
 await flush();assert.equal(h.calls.length,1);h.calls[0].resolve();await flush();assert.equal(h.calls.length,2);
 h.calls[1].resolve();await flush();assert.equal(h.disk.get('A').jobs.length,0);assert.equal(h.q.project(data()).gifts.length,0);
});
test('replace is immediate and slot-specific; outfit stays personal; later explicit selection wins',()=>{
 const base=data();base.loadouts.push({room_type:'home',owner_id:'A',slot:'table',item_id:'keep'});
 const changed=model.projectShopGift(base,intent('one',true));assert.equal(changed.loadouts.find(r=>r.slot==='lamp').item_id,'lamp');
 assert.equal(changed.loadouts.find(r=>r.slot==='table').item_id,'keep');assert.equal(changed.unread.affection,1);
 changed.loadouts.find(r=>r.slot==='lamp').item_id='newer';assert.equal(model.projectShopGift(changed,intent('one',true)).loadouts.find(r=>r.slot==='lamp').item_id,'newer');
 const outfit={...intent(),itemId:'denim',slot:'outfit',replace:true,previousItemId:null};
 const row=model.projectShopGift(base,outfit).loadouts.find(r=>r.slot==='outfit');assert.equal(row.owner_id,'A');assert.equal(row.room_type,'home');
});
test('uncertain offline response keeps intent; retry after pause/resume and restart uses identical gift/replace',async()=>{
 const h=harness();h.q.receive(data(),true);h.q.enqueue(intent('one',true));await flush();h.calls[0].reject(Error('timeout'));await flush();
 assert.equal(h.disk.get('A').jobs.length,1);h.q.pause();h.setActive(false);h.time.advance(60000);await flush();assert.equal(h.calls.length,1);
 const next=harness(h.disk);next.q.receive(data());next.q.resume();await flush();assert.equal(next.calls.length,0,'restart requires fresh pair authorization');
 next.q.receive(data(),true);next.q.resume();await flush();assert.deepEqual(next.calls[0].job,h.calls[0].job);
 next.calls[0].resolve();await flush();assert.equal(next.disk.get('A').jobs.length,0);
});
test('receipt fences stale snapshots; a newer authoritative read releases projection',async()=>{
 const h=harness();h.q.receive(data(),true);h.q.enqueue(intent());const old=h.q.revision();await flush();h.calls[0].resolve();await flush();
 h.q.receive(data(),true,old);assert.equal(h.q.project(data()).gifts.length,1);
 const fresh=data();fresh.gifts=fresh.gifts.filter(r=>r.id!=='one');fresh.unread.gifts=1;
 h.q.receive(fresh,true,h.q.revision());assert.equal(h.q.project(fresh).gifts.length,1);
});
test('disk-full does not acknowledge the gift or send; definitive denial restores only its own delta',async()=>{
 const h=harness();h.q.receive(data(),true);h.setFull(true);assert.throws(()=>h.q.enqueue(intent()),/intent_not_saved/);
 assert.equal(h.q.project(data()).gifts.length,2);await flush();assert.equal(h.calls.length,0);
 h.setFull(false);h.q.enqueue(intent('one',true));await flush();h.calls[0].reject(Error('not_found'));await flush();
 assert.equal(h.disk.get('A').jobs.length,0);assert.equal(h.events.filter(e=>Array.isArray(e)&&e[0]==='rejected').length,1);
 const restored=model.projectShopGift(model.projectShopGift(data(),intent('one',true)),intent('one',true),true);
 assert.equal(restored.gifts.length,2);assert.equal(restored.loadouts[0].item_id,'old');assert.equal(restored.inventory.length,0);
});
test('pair/account changes discard old jobs and late receipts; no gift art/read markers can grant ownership',async()=>{
 const h=harness();h.q.receive(data(),true);h.q.enqueue(intent());await flush();
 h.q.receive({...data(),pairVersion:'v2'},true);h.calls[0].resolve();await flush();assert.equal(h.events.filter(e=>e==='confirmed').length,0);
 assert.equal(h.q.project(data()).inventory.length,0);h.q.reset();h.setOwner('C');h.q.receive(data(),true);assert.throws(()=>h.q.enqueue(intent()),/session_changed|gift_not_ready/);
 assert.equal(model.pendingShopGifts({...data(),pairAccessVerified:false}).length,0);
});
test('unique gifts are FIFO even when server returns newest first; duplicate bootstrap rows count once',()=>{
 const base=data();base.gifts.reverse();base.gifts.push(gift());assert.deepEqual(plain(model.pendingShopGifts(base)).map(g=>g.id),['one','two']);
});
