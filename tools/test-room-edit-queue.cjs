const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {createRoomEditQueue}=load('apps/mobile/src/lib/room-edit-queue.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
const scope={owner:'A',partner:'B',pairVersion:'one'};
const base={lamp:'old-lamp',vase:'old-vase',outfit:'default'};
const prices={'old-lamp':0,'old-vase':0,default:0,lamp:100,vase:80,denim:300};
const edit=(id,changes,total=100)=>({id,changes,total,prices,purchased:total?Object.values(changes):[],name:id});
function harness(disk=new Map()){
 const time=clock(),calls=[],events=[];let owner='A',active=true,full=false;
 const q=createRoomEditQueue({owner:()=>owner,active:()=>active,load:id=>disk.get(id),
  save:(id,value)=>{if(full)throw Error('disk full');disk.set(id,plain(value));},
  send:(wire,scope)=>{const wait=deferred();calls.push({wire:plain(wire),scope:plain(scope),...wait});return wait.promise;},
  definitive:error=>['price_changed','insufficient_balance','pair_changed'].includes(error.message),
  changed:()=>events.push('project'),confirmed:(e,r)=>events.push(['confirmed',e.id,r]),rejected:(e,r)=>events.push(['rejected',e.id,r.message]),
  schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
 return {q,time,calls,events,disk,setOwner:x=>owner=x,setActive:x=>active=x,setFull:x=>full=x,
  receive:(remote=true,next=base,context=scope,revision=q.revision())=>q.receive(context,next,remote,revision),
  resolve:(i,total=100)=>calls[i].resolve({success:true,total}),reject:(i,code)=>calls[i].reject(Error(code))};
}
test('small durable intent and projection precede all I/O; duplicate taps do not submit another checkout',async()=>{
 const h=harness();h.receive();h.q.enqueue(edit('one',{lamp:'lamp'}));
 assert.equal(h.calls.length,0);assert.equal(h.disk.get('A').edits[0].id,'one');
 assert.equal(h.q.slots().lamp,'lamp');assert.equal(h.events[0],'project');
 h.q.enqueue(edit('one',{lamp:'lamp'}));assert.equal(h.q.enqueue(edit('double-tap',{lamp:'lamp'})),'');
 await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].wire.idempotencyKey,'one');
 assert.deepEqual(h.calls[0].wire.expectedPrices,{'lamp':100});
 h.resolve(0);await flush();assert.equal(h.q.pending().length,0);assert.equal(h.q.slots().lamp,'lamp');
});
test('owned replacements, new purchases and outfit changes share one atomic serialized command',async()=>{
 const h=harness();h.receive();h.q.enqueue(edit('free',{vase:'vase'},0));h.q.enqueue(edit('paid',{lamp:'lamp',outfit:'denim'},400));
 await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].wire.action,'purchase_room_changes');
 h.resolve(0,0);await flush();assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls[1].wire.slots,{lamp:'lamp'});assert.equal(h.calls[1].wire.outfitItemId,'denim');
 assert.equal(h.q.slots().outfit,'denim');h.resolve(1,400);await flush();assert.equal(h.q.pending().length,0);
});
for(const code of ['price_changed','insufficient_balance'])test(`${code}: rollback only the failed delta; later selections rebase without silently repurchasing it`,async()=>{
 const h=harness();h.receive();h.q.enqueue(edit('one',{lamp:'lamp'}));h.q.enqueue(edit('two',{vase:'vase'},80));
 await flush();h.reject(0,code);await flush();
 assert.deepEqual(plain(h.q.slots()),{lamp:'old-lamp',vase:'vase',outfit:'default'});
 assert.deepEqual(h.calls[1].wire.slots,{vase:'vase'});
 assert.ok(!h.q.acquired().includes('lamp'));h.resolve(1,80);await flush();
 assert.equal(h.events.filter(e=>e[0]==='rejected').length,1);
});
test('timeout after a server debit replays the exact frozen wire/key before subsequent edits and debits only once',async()=>{
 const h=harness(),ledger=new Map();let balance=1000;
 h.receive();h.q.enqueue(edit('pay',{lamp:'lamp'}));h.q.enqueue(edit('next',{vase:'vase'},80));await flush();
 const wire=plain(h.calls[0].wire);ledger.set(wire.idempotencyKey,100);balance-=100;
 h.reject(0,'Operation timed out');await flush();
 assert.equal(h.q.pending().length,2);assert.equal(h.q.slots().lamp,'lamp');assert.equal(h.calls.length,1);
 h.time.advance(2000);await flush();assert.deepEqual(h.calls[1].wire,wire);
 if(!ledger.has(h.calls[1].wire.idempotencyKey))balance-=100;
 h.resolve(1);await flush();assert.equal(balance,900);assert.equal(h.calls[2].wire.idempotencyKey,'next');
 h.resolve(2,80);await flush();assert.equal(h.q.pending().length,0);
});
test('process death restores pending room immediately, but requires fresh same-pair authorization before replay',async()=>{
 const disk=new Map(),a=harness(disk);a.receive();a.q.enqueue(edit('pay',{lamp:'lamp'}));await flush();
 a.reject(0,'offline');await flush();a.q.reset();
 const b=harness(disk);b.receive(false);assert.equal(b.q.slots().lamp,'lamp');b.q.resume();await flush();assert.equal(b.calls.length,0);
 b.receive(true);b.q.resume();await flush();assert.equal(b.calls[0].wire.idempotencyKey,'pay');
 assert.deepEqual(b.calls[0].wire,a.calls[0].wire);b.resolve(0);await flush();
});
test('stale remote reads cannot undo a committed room, while a newer authoritative read may reflect another device',async()=>{
 const h=harness();h.receive();h.q.enqueue(edit('pay',{lamp:'lamp'}));const old=h.q.revision();await flush();h.resolve(0);await flush();
 h.receive(true,base,scope,old);assert.equal(h.q.slots().lamp,'lamp');assert.equal(h.q.projecting(),true);
 h.receive(true,{...base,lamp:'other-device'});assert.equal(h.q.slots().lamp,'other-device');assert.equal(h.q.projecting(),false);
});
test('background pause leaves intents intact; resume cannot submit until fresh authorization',async()=>{
 const h=harness();h.receive();h.setActive(false);h.q.enqueue(edit('one',{lamp:'lamp'}));await flush();assert.equal(h.calls.length,0);
 h.q.pause();h.setActive(true);h.q.resume();await flush();assert.equal(h.calls.length,0);
 h.receive();h.q.resume();await flush();assert.equal(h.calls.length,1);h.resolve(0);await flush();
});
test('identity/pair changes revoke old queued writes and late receipts without touching the next room',async()=>{
 for(const identity of [true,false]){
  const h=harness();h.receive();h.q.enqueue(edit('one',{lamp:'lamp'}));await flush();
  if(identity)h.setOwner('C');
  const next=identity?{owner:'C',partner:null,pairVersion:null}:{...scope,partner:'C',pairVersion:'two'};
  h.receive(true,{lamp:'new-room'},next);h.resolve(0);await flush();
  assert.equal(h.q.slots().lamp,'new-room');assert.equal(h.events.some(e=>e[0]==='confirmed'),false);assert.equal(h.q.pending().length,0);
 }
});
test('disk-full failure never projects or sends an unpersisted purchase',async()=>{
 const h=harness();h.receive();h.setFull(true);assert.throws(()=>h.q.enqueue(edit('one',{lamp:'lamp'})),/intent_not_saved/);
 await flush();assert.equal(h.q.slots().lamp,'old-lamp');assert.equal(h.calls.length,0);assert.equal(h.events.length,0);
});
test('failed receipt cleanup remains replay-safe after restart, without false purchase failure',async()=>{
 const disk=new Map(),a=harness(disk);a.receive();a.q.enqueue(edit('one',{lamp:'lamp'}));await flush();a.setFull(true);a.resolve(0);await flush();
 assert.equal(a.q.pending().length,0);assert.equal(a.events.some(e=>e[0]==='rejected'),false);a.q.reset();
 const b=harness(disk);b.receive(true);b.q.resume();await flush();assert.deepEqual(b.calls[0].wire,a.calls[0].wire);b.resolve(0);await flush();
});
test('a rejected payment is not announced until journal cleanup is durable; disk-full retries cleanup, not payment',async()=>{
 const h=harness();h.receive();h.q.enqueue(edit('one',{lamp:'lamp'}));await flush();h.setFull(true);
 h.reject(0,'insufficient_balance');await flush();assert.equal(h.events.some(e=>e[0]==='rejected'),false);
 h.time.advance(2000);await flush();assert.equal(h.calls.length,1);assert.equal(h.q.pending().length,1);
 h.setFull(false);h.time.advance(4000);await flush();
 assert.equal(h.events.filter(e=>e[0]==='rejected').length,1);assert.equal(h.disk.get('A').edits.length,0);assert.equal(h.q.slots().lamp,'old-lamp');
});
test('rapid alternation preserves FIFO latest choice through an ambiguous earlier response',async()=>{
 const h=harness();h.receive();
 for(let n=0;n<20;n++)h.q.enqueue(edit('edit-'+n,{lamp:n%2?'old-lamp':'lamp'},n%2?0:100));
 await flush();assert.equal(h.calls.length,1);assert.equal(h.q.slots().lamp,'old-lamp');
 h.reject(0,'network_error');await flush();h.time.advance(2000);await flush();h.resolve(1);await flush();
 for(let i=2;i<=20;i++){assert.equal(h.calls.length,i+1);h.resolve(i,0);await flush();}
 assert.equal(h.q.pending().length,0);assert.equal(h.q.slots().lamp,'old-lamp');
});
