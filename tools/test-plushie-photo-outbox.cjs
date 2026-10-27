const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {createPlushiePhotoOutbox}=load('apps/mobile/src/lib/plushie-photo-outbox.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
const scope={userId:'A',partnerId:'B',pairVersion:'v1'};
const photo={id:'confirmed',ownerId:'A',toyId:'toy',kind:'doll',updatedAt:'2026-10-19T10:00:00Z'};
const job=(key='key',toyId='toy')=>({...scope,key,ownerId:'A',toyId,base64:'same-encoded-bytes',previous:{...photo,toyId},
  preview:{...photo,id:'local-plushie-'+key,toyId,updatedAt:'2026-10-20T10:00:00Z'}});
const snapshot=(photos=[photo])=>({profile:{id:'A'},partner:{id:'B'},pairVersion:'v1',roomPhotos:photos});
function harness({disk=new Map(),active=true,account='A'}={}){
  const time=clock(),calls=[],notices=[],retired=[],confirmed=[];let data=snapshot();
  const q=createPlushiePhotoOutbox({owner:()=>account,active:()=>active,
    load:owner=>disk.has(owner)?JSON.parse(disk.get(owner)):null,save:(owner,jobs)=>disk.set(owner,JSON.stringify(jobs)),
    send:j=>{const r=deferred();calls.push({job:plain(j),...r});return r.promise;},
    confirmed:(j,r)=>{confirmed.push(r);data={...data,roomPhotos:[...data.roomPhotos.filter(p=>p.toyId!==j.toyId),r.photo]};},
    changed:()=>{data=q.project(data);},rejected:(_j,code)=>notices.push(code),retire:p=>retired.push(p.id),
    code:e=>e.body?.error??e.message??'unavailable',schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
  q.receive(scope);
  return {q,time,calls,notices,retired,confirmed,disk,get data(){return data;},read:d=>{data=q.project(d);},
    account:v=>{account=v;q.reset();},active:v=>{active=v;v?q.resume():q.pause();}};
}
test('local intent is durable and visible before any network; one target cannot submit twice',async()=>{
  const h=harness();h.q.enqueue(job());assert.equal(h.calls.length,0);
  assert.equal(h.data.roomPhotos[0].id,'local-plushie-key');assert.equal(JSON.parse(h.disk.get('A'))[0].base64,'same-encoded-bytes');
  h.q.enqueue(job());assert.throws(()=>h.q.enqueue(job('different')),/photo_sync_pending/);
  h.time.advance(0);await flush();assert.equal(h.calls.length,1);
  h.calls[0].resolve({photo:{...photo,updatedAt:'2026-10-20T10:00:01Z'}});await flush();
  assert.equal(h.confirmed.length,1);assert.equal(h.data.roomPhotos[0].id,'confirmed');assert.deepEqual(JSON.parse(h.disk.get('A')),[]);
  assert.equal(h.notices.length,0);
});
test('offline response/relaunch replays immutable bytes and ticket; no picker/crop or quota replay',async()=>{
  const a=harness();a.q.enqueue(job());a.time.advance(0);a.calls[0].reject(Error('network'));await flush();
  assert.equal(a.notices.length,0);assert.equal(a.data.roomPhotos[0].id,'local-plushie-key');a.active(false);
  const b=harness({disk:a.disk,active:false});b.read(snapshot());assert.equal(b.data.roomPhotos[0].id,'local-plushie-key');
  b.time.advance(60000);assert.equal(b.calls.length,0);b.active(true);b.time.advance(0);await flush();
  assert.deepEqual(b.calls[0].job,a.calls[0].job);b.calls[0].resolve({photo});await flush();assert.equal(b.confirmed.length,1);
});
test('transient failures back off; active requests never overlap or change bytes',async()=>{
  const h=harness();h.q.enqueue(job());h.q.enqueue(job('second','toy-2'));h.time.advance(0);await flush();
  h.time.advance(10000);assert.equal(h.calls.length,1);h.calls[0].reject(Error('timeout'));await flush();
  h.time.advance(1999);assert.equal(h.calls.length,1);h.time.advance(1);await flush();assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[1].job,h.calls[0].job);h.calls[1].resolve({photo});await flush();h.time.advance(0);await flush();
  assert.equal(h.calls[2].job.toyId,'toy-2');h.active(false);
});

test('server hourly rate limit is respected silently instead of hammering the endpoint',async()=>{
 const h=harness();h.q.enqueue(job());h.time.advance(0);h.calls[0].reject({body:{error:'upload_limit'}});await flush();
 h.time.advance(3599999);assert.equal(h.calls.length,1);assert.equal(h.notices.length,0);h.time.advance(1);await flush();
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].job,h.calls[1].job);h.active(false);
});
for(const code of ['daily_limit_reached','item_not_owned','pair_changed','upload_expired'])test(`${code}: definitive rejection restores prior photo without another quota mutation`,async()=>{
  const h=harness();h.q.enqueue(job());h.time.advance(0);h.calls[0].reject({body:{error:code}});await flush();
  assert.equal(h.data.roomPhotos[0].id,photo.id);assert.deepEqual(h.notices,[code]);h.time.advance(600000);assert.equal(h.calls.length,1);
  const next=job('new');h.q.enqueue(next);assert.equal(h.data.roomPhotos[0].id,next.preview.id);assert.ok(h.retired.includes('local-plushie-key'));h.active(false);
});
test('late old reads cannot hide local selection; rejection uses the latest real remote photo',async()=>{
  const h=harness();h.q.enqueue(job());h.read(snapshot());assert.equal(h.data.roomPhotos[0].id,'local-plushie-key');
  h.read(snapshot([{...photo,id:'other-device',updatedAt:'2026-10-20T10:00:02Z'}]));
  assert.equal(h.data.roomPhotos[0].id,'local-plushie-key');h.time.advance(0);h.calls[0].reject({body:{error:'daily_limit_reached'}});await flush();
  assert.equal(h.data.roomPhotos[0].id,'other-device');
});
test('bad/mismatched receipt retries without closing local preview or committing a false quota',async()=>{
  const h=harness();h.q.enqueue(job());h.time.advance(0);h.calls[0].resolve({photo:{...photo,toyId:'different'}});await flush();
  assert.equal(h.confirmed.length,0);assert.equal(h.data.roomPhotos[0].id,'local-plushie-key');assert.equal(h.notices.length,0);h.active(false);
});
test('account / pair changes ignore late callbacks; old intents are never sent as a different user',async()=>{
  const h=harness();h.q.enqueue(job());h.time.advance(0);h.account('C');
  h.q.receive({userId:'C',partnerId:'D',pairVersion:'new'});h.calls[0].resolve({photo});await flush();
  assert.equal(h.confirmed.length,0);h.time.advance(60000);assert.equal(h.calls.length,1);
  const paired=harness();paired.q.enqueue(job());paired.time.advance(0);paired.q.receive({...scope,pairVersion:'new'});
  paired.calls[0].resolve({photo});await flush();assert.equal(paired.confirmed.length,0);
  paired.read({...snapshot(),pairVersion:'new'});assert.equal(paired.data.roomPhotos[0].id,'confirmed');
});
test('unreadable outbox fails closed on every read, not just the first attempt',()=>{
  const h=harness();h.account('C');h.disk.set('C','{"corrupt":true}');
  for(let i=0;i<2;i++)assert.throws(()=>h.q.receive({userId:'C',partnerId:'',pairVersion:''}),/photo_outbox_unavailable/);
  assert.equal(h.disk.get('C'),'{"corrupt":true}');assert.equal(h.calls.length,0);
});
