const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {createJournalOutbox}=load('apps/mobile/src/lib/journal-outbox.ts');
function harness(options={}){
 const disk=new Map(),timers=[],sent=[],applied=[];let identity='a',active=true,failDisk=false;
 const deps={load:s=>disk.get(s.owner),persist:(s,v)=>{if(failDisk)throw Error('disk');disk.set(s.owner,JSON.parse(JSON.stringify(v)));},
  current:s=>identity===s.owner,active:()=>active,bind:async()=> 'real',send:async(j,s)=>{sent.push({j,s});return 'receipt';},
  read:async()=>{},apply:(j,r)=>applied.push({j,r}),changed(){},code:e=>e.message,
  schedule:(fn,ms)=>{const task={fn,ms};timers.push(task);return task;},cancel:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},...options};
 const out=createJournalOutbox(deps),scope={owner:'a',pairVersion:'v'};out.receive(scope);
 return{out,deps,disk,timers,sent,applied,scope,setIdentity:x=>identity=x,setActive:x=>active=x,failDisk:()=>failDisk=true,
  async step(){timers.shift()?.fn();await flush();}};
}
const job=(key='k')=>({key,pageId:'page',body:'words',expectedUpdatedAt:null,questionId:'cj_01',date:'2026-10-24'});
test('save intent is durable before dispatch and an immutable key cannot change body',async()=>{
 const h=harness();h.out.enqueue(job());assert.equal(h.disk.get('a').writes.length,1);assert.equal(h.sent.length,0);
 assert.throws(()=>h.out.enqueue({...job(),body:'different'}),/idempotency_conflict/);
 await h.step();assert.equal(h.sent.length,1);assert.equal(h.out.snapshot().writes.length,0);
});
test('offline retries keep original body and receipt key with bounded backoff',async()=>{
 let attempts=0;const h=harness({send:async j=>{attempts++;if(attempts<3)throw Error('offline');return j.key;}});
 h.out.enqueue(job());await h.step();assert.equal(h.timers[0].ms,2000);await h.step();assert.equal(h.timers[0].ms,4000);
 await h.step();assert.equal(h.applied[0].j.key,'k');assert.equal(h.out.snapshot().writes.length,0);
});
test('restart recovers persisted intent without the originating screen',async()=>{
 const h=harness();h.out.enqueue(job());h.out.reset();h.out.receive(h.scope);await h.step();assert.equal(h.applied.length,1);
});
test('identity change discards a late receipt without touching the new account',async()=>{
 const pending=deferred(),h=harness({send:()=>pending.promise});h.out.enqueue(job());await h.step();h.setIdentity('b');h.out.reset();
 pending.resolve('done');await flush();assert.equal(h.applied.length,0);assert.equal(h.disk.get('a').writes.length,1);
});
test('storage failure never reports a reliable save',()=>{
 const h=harness();h.failDisk();assert.throws(()=>h.out.enqueue(job()),/disk/);assert.equal(h.out.snapshot().writes.length,0);
});
test('explicit conflict stops retry, preserves words, and requires explicit recovery',async()=>{
 const h=harness({send:async()=>{throw Error('journal_conflict');}});h.out.enqueue(job());await h.step();
 assert.equal(h.out.snapshot().writes[0].body,'words');assert.equal(h.out.snapshot().writes[0].error,'journal_conflict');assert.equal(h.timers.length,0);
 h.out.discardRejected('k');assert.equal(h.out.snapshot().writes.length,0);
});
test('an apply failure cannot turn a committed response into a rejected save',async()=>{
 let applies=0;const h=harness({apply(){if(!applies++)throw Error('local');}});h.out.enqueue(job());await h.step();
 assert.equal(h.out.snapshot().writes[0].error,undefined);await h.step();assert.equal(h.out.snapshot().writes.length,0);
});
test('provisional pages bind once before sending, never post an invented ID',async()=>{
 const h=harness();h.out.enqueue({...job(),pageId:'local:2026-10-24'});await h.step();assert.equal(h.sent[0].j.pageId,'real');
});
test('background pause preserves intent; foreground resumes; reads merge latest revision',async()=>{
 const read=[],h=harness({read:async j=>read.push(j)});h.setActive(false);h.out.enqueue(job());assert.equal(h.timers.length,0);
 h.out.acknowledge({pageId:'p',answerAt:'2026-10-23'});h.out.acknowledge({pageId:'p',answerAt:'2026-10-24'});
 h.setActive(true);h.out.resume();await h.step();await h.step();assert.equal(read[0].answerAt,'2026-10-24');
});
