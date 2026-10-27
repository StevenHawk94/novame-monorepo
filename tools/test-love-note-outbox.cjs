const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {createLoveNoteOutbox}=load('apps/mobile/src/lib/love-note-outbox.ts');
const scope={userId:'A',partnerId:'B',pairVersion:'one'};
const intent=(key='key',body='Love you')=>({...scope,key,body,createdAt:'2026-10-23T10:00:00Z'});
const plain=x=>JSON.parse(JSON.stringify(x));
function harness({disk=new Map(),active=true}={}){
  const time=clock(),calls=[],notices=[],receipts=[];let owner='A',fail=false;
  const q=createLoveNoteOutbox({owner:()=>owner,active:()=>active,
    load:id=>disk.has(id)?JSON.parse(disk.get(id)):null,save:(id,jobs)=>{if(fail)throw Error('disk_full');disk.set(id,JSON.stringify(jobs));},
    send:job=>{const result=deferred();calls.push({job,...result});return result.promise;},
    confirmed:()=>receipts.push(true),rejected:j=>notices.push(j),code:e=>e.body?.error??e.message,
    schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
  q.receive(scope);
  return {q,time,calls,notices,receipts,disk,fail:v=>fail=v,
    active(v){active=v;v?q.resume():q.pause();},account(v){owner=v;q.reset();}};
}
test('Love Note is durable synchronously before network; duplicate taps share exact key/body',async()=>{
  const h=harness();h.q.enqueue(intent());h.q.enqueue(intent());assert.equal(h.calls.length,0);
  assert.deepEqual(JSON.parse(h.disk.get('A')),[intent()]);assert.throws(()=>h.q.enqueue(intent('key','changed')),/idempotency_conflict/);
  h.time.advance(0);await flush();assert.equal(h.calls.length,1);h.calls[0].resolve();await flush();
  assert.equal(h.receipts.length,1);assert.deepEqual(JSON.parse(h.disk.get('A')),[]);
});
test('navigation/relaunch and transient failure replay same immutable recipient/body/key silently',async()=>{
  const a=harness();a.q.enqueue(intent());a.time.advance(0);a.calls[0].reject(Error('offline'));await flush();assert.equal(a.notices.length,0);a.active(false);
  const b=harness({disk:a.disk});b.time.advance(0);await flush();assert.deepEqual(plain(b.calls[0].job),plain(a.calls[0].job));
  b.calls[0].resolve();await flush();assert.equal(b.q.pending().length,0);
});
test('serial delivery never overlaps; timeouts back off without changing key or dropping later notes',async()=>{
  const h=harness();h.q.enqueue(intent());h.q.enqueue(intent('two','Second'));h.time.advance(0);await flush();h.time.advance(10000);assert.equal(h.calls.length,1);
  h.calls[0].reject(Error('timeout'));await flush();h.time.advance(1999);assert.equal(h.calls.length,1);h.time.advance(1);await flush();
  assert.deepEqual(plain(h.calls[1].job),plain(h.calls[0].job));h.calls[1].resolve();await flush();h.time.advance(0);assert.equal(h.calls[2].job.key,'two');h.active(false);
});
for(const [code,seconds] of [['love_note_minute_limit',37],['love_note_daily_limit',7200]])test(`${code} honors server Retry-After silently and preserves receipt key`,async()=>{
  const h=harness();h.q.enqueue(intent());h.time.advance(0);h.calls[0].reject({body:{error:code,retryAfterSeconds:seconds}});await flush();
  h.time.advance(seconds*1000-1);assert.equal(h.calls.length,1);assert.equal(h.notices.length,0);
  h.time.advance(1);assert.equal(h.calls.length,2);assert.equal(h.calls[1].job.key,'key');h.active(false);
});
test('definitive rejection keeps text recoverable; explicit retry keeps immutable key',async()=>{
  const h=harness();h.q.enqueue(intent());h.time.advance(0);h.calls[0].reject(Error('feature_disabled'));await flush();
  assert.equal(h.q.pending().length,0);assert.equal(h.q.recover().body,'Love you');assert.equal(h.notices.length,1);
  h.time.advance(60000);assert.equal(h.calls.length,1);h.q.enqueue(intent());h.time.advance(0);h.calls[1].resolve();await flush();assert.equal(h.q.recover(),undefined);
});
test('disk failure never accepts a note; failed receipt cleanup retries identical key after ambiguous success',async()=>{
  const h=harness();h.fail(true);assert.throws(()=>h.q.enqueue(intent()),/disk_full/);assert.equal(h.calls.length,0);
  h.fail(false);h.q.enqueue(intent());h.time.advance(0);h.fail(true);h.calls[0].resolve();await flush();
  assert.equal(h.receipts.length,0);h.fail(false);h.time.advance(2000);assert.equal(h.calls[1].job.key,'key');h.calls[1].resolve();await flush();assert.equal(h.receipts.length,1);
});
test('account/pair changes fence old callbacks; private text never crosses recipient generation',async()=>{
  const h=harness();h.q.enqueue(intent());h.time.advance(0);h.q.receive({...scope,pairVersion:'two'});h.calls[0].resolve();await flush();
  assert.equal(h.receipts.length,0);h.time.advance(60000);assert.equal(h.calls.length,1);assert.equal(h.q.recover(),undefined);
  h.account('C');h.q.receive({userId:'C',partnerId:'D',pairVersion:'three'});h.time.advance(0);assert.equal(h.calls.length,1);
});
test('corrupt journal fails closed without erasing original bytes',()=>{
  const disk=new Map([['A','{"bad":true}']]);assert.throws(()=>harness({disk}),/note_outbox_unavailable/);assert.equal(disk.get('A'),'{"bad":true}');
});
