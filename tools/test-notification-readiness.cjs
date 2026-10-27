const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
test('content is never ready before hydration; one shared flight and no read acknowledgements',async()=>{
  const {createNotificationReadiness}=load('apps/mobile/src/lib/notification-readiness.ts'),r=createNotificationReadiness();
  const pending=deferred();let calls=0,changes=0;r.subscribe(()=>changes++);
  const a=r.prepare('a:b:v1','games','one',()=>{calls++;return pending.promise;},()=>true);
  const b=r.prepare('a:b:v1','games','one',()=>{calls++;return Promise.resolve();},()=>true);
  await flush();assert.equal(calls,1);assert.equal(a,b);assert.equal(r.ready('a:b:v1','games','one'),false);
  pending.resolve();await a;assert.equal(r.ready('a:b:v1','games','one'),true);assert.ok(changes>0);
  assert.equal(r.ready('a:b:v1','games','two'),false);assert.equal(r.ready('a:c:v2','games','one'),false);
});
test('old version, account and pair replies cannot advertise stale data',async()=>{
  const {createNotificationReadiness}=load('apps/mobile/src/lib/notification-readiness.ts'),r=createNotificationReadiness();
  const old=deferred(),one=r.prepare('a:b:v1','journal','old',()=>old.promise,()=>true);
  await r.prepare('a:b:v1','journal','new',async()=>{},()=>true);old.resolve();await one;
  assert.equal(r.ready('a:b:v1','journal','old'),false);assert.equal(r.ready('a:b:v1','journal','new'),true);
  const late=deferred(),two=r.prepare('a:b:v1','letters','old',()=>late.promise,()=>true);r.reset('a:c:v2');late.resolve();await two;
  assert.equal(r.ready('a:b:v1','letters','old'),false);
  await r.prepare('a:c:v2','letters','current',async()=>{},()=>false);
  assert.equal(r.ready('a:c:v2','letters','current'),false);
});
test('offline work does not discard unread intent; bounded retries do not starve other destinations',async()=>{
  const time=clock(),{createNotificationReadiness}=load('apps/mobile/src/lib/notification-readiness.ts'),r=createNotificationReadiness(()=>time.globals.Date.now());let tries=0;
  const fail=()=>{tries++;throw Error('offline');};
  await r.prepare('a:b:v1','games','one',fail,()=>true);
  await r.prepare('a:b:v1','journal','one',async()=>{},()=>true);
  await r.prepare('a:b:v1','games','one',fail,()=>true);assert.equal(tries,1);
  assert.equal(r.ready('a:b:v1','games','one'),false);assert.equal(r.ready('a:b:v1','journal','one'),true);
  time.advance(1000);await r.prepare('a:b:v1','games','one',async()=>{tries++;},()=>true);assert.equal(tries,2);
  assert.equal(r.ready('a:b:v1','games','one'),true);
});
