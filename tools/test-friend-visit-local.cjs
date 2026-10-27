const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,flush,deferred}=require('./lifecycle-test-utils.cjs');
const {createFriendVisitLocalState}=load('apps/mobile/src/lib/friend-visit-local-state.ts');
const json=x=>JSON.parse(JSON.stringify(x));
const prepared=(mode='independent')=>({sessionId:mode,visitId:'visit',friendId:'mole',pairVersion:'v1',mode,type:'Trivia',scene:'Scene',lines:['Hello'],question:'Question',
 choices:[{id:'A',label:'First',feedback:['Reply one','Reply two'],reward:10},{id:'B',label:'Second',feedback:['Wrong'],reward:5}],expiresAt:null,serverNow:'2026-10-16T00:00Z'});
function harness(initial=[]) {
 let ctx={owner:'me',scope:'me:partner:v1'},active=true,disk=json(initial),fail=false,mode='independent';
 const requests=[],projects=[],confirms=[],rejects=[],timers=new Map(),preparations=[];let settlements=0,prepWait;
 const worker=createFriendVisitLocalState({context:()=>ctx,active:()=>active,load:()=>disk,save:rows=>{if(fail)throw Error('disk_full');disk=json(rows);},
 prepare:async(id,version)=>{preparations.push([id,version]);return prepWait?await prepWait:prepared(mode);},
 submit:(c,choice)=>{const d=deferred();requests.push({c,choice,...d});return d.promise;},
 project:(row,restored)=>projects.push([row.choiceId,restored]),confirm:(row,r)=>confirms.push(r),reject:r=>rejects.push(r),settled:()=>settlements++,
 schedule:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 const ready=async()=>{await worker.prepare('visit','v1');assert.equal(worker.open('visit'),true);};
 return {worker,ready,requests,projects,confirms,rejects,timers,preparations,disk:()=>disk,settlements:()=>settlements,
  mode:v=>mode=v,ctx:v=>ctx=v,active:v=>active=v,fail:v=>fail=v,prepWait:v=>prepWait=v};
}
test('prewarm does not open or award; opening freezes branches; later partner updates cannot rewrite dialogue',async()=>{
 const h=harness();await h.worker.prepare('visit','v1');assert.equal(h.worker.read('visit').frozen,undefined);assert.equal(h.projects.length,0);
 h.mode('followup');await h.worker.prepare('visit','v1',true);assert.equal(h.worker.read('visit').candidate.mode,'followup');
 h.worker.open('visit');h.mode('independent');await h.worker.prepare('visit','v1');assert.equal(h.worker.read('visit').frozen.mode,'followup');
 assert.equal(h.requests.length,0);
});
test('answer and all reading/Done finish immediately while the server is pending; duplicate choice is locked',async()=>{
 const h=harness();await h.ready();assert.equal(h.worker.answer('visit','A'),true);assert.equal(h.worker.answer('visit','B'),false);
 assert.equal(h.disk()[0].choiceId,'A');assert.equal(h.requests.length,1);assert.equal(h.projects[0][1],false);
 h.worker.advance('visit');h.worker.advance('visit');assert.equal(h.worker.finish('visit'),true);assert.equal(h.worker.finish('visit'),false);
 assert.equal(h.worker.read('visit').done,true);assert.equal(h.worker.read('visit').status,'pending');
 h.requests[0].resolve({feedback:['Reply one','Reply two'],reward:10});await h.worker.resume();
 assert.equal(h.worker.read('visit').done,true);assert.equal(h.worker.read('visit').status,'confirmed');assert.equal(h.confirms.length,1);
});
test('ambiguous timeout never rolls back; restart replays same token and choice without replaying celebration',async()=>{
 const h=harness();await h.ready();h.worker.answer('visit','B');h.requests[0].reject(Error('offline'));await flush();
 assert.equal(h.rejects.length,0);assert.equal(h.worker.read('visit').status,'pending');assert.equal(h.timers.size,1);
 const reboot=harness(h.disk());void reboot.worker.resume();assert.equal(reboot.requests[0].choice,'B');assert.equal(reboot.requests[0].c.sessionId,'independent');
 assert.equal(reboot.projects[0][1],true);reboot.requests[0].resolve({feedback:['Wrong'],reward:0,applied:false});await reboot.worker.resume();
 assert.equal(reboot.worker.read('visit').status,'confirmed');assert.equal(reboot.confirms.length,1);
});
test('explicit server rejection corrects projection and stops retrying; background pauses retries',async()=>{
 const h=harness();await h.ready();h.worker.answer('visit','A');h.requests[0].reject({body:{error:'visit_expired'}});await flush();
 assert.equal(h.rejects.length,1);assert.equal(h.worker.read('visit').status,'rejected');assert.equal(h.timers.size,0);
 const b=harness();await b.ready();b.worker.answer('visit','A');b.requests[0].reject(Error('network'));await flush();b.active(false);b.worker.pause();
 assert.equal(b.timers.size,0);await b.worker.resume();assert.equal(b.requests.length,1);
 b.active(true);void b.worker.resume();assert.equal(b.requests.length,2);b.requests[1].resolve({feedback:['Reply'],reward:10});await b.worker.resume();
});
test('old account/pair responses and preparations never update the new scope',async()=>{
 const h=harness();await h.ready();h.worker.answer('visit','A');h.ctx({owner:'other',scope:'other:partner:v2'});
 h.requests[0].resolve({feedback:['Old'],reward:10});await h.worker.resume();assert.equal(h.confirms.length,0);assert.equal(h.worker.read('visit'),undefined);
 const b=harness(),p=deferred();b.prepWait(p.promise);const warm=b.worker.prepare('visit','v1');b.worker.reset();p.resolve(prepared());await warm;assert.equal(b.worker.read('visit'),undefined);
});
test('storage failure cannot display an unsaved answer; receipt persistence failure safely retries committed operation',async()=>{
 const h=harness();await h.ready();h.fail(true);assert.equal(h.worker.answer('visit','A'),false);assert.equal(h.requests.length,0);assert.equal(h.projects.length,0);
 h.fail(false);h.worker.answer('visit','A');h.fail(true);h.requests[0].resolve({feedback:['Reply'],reward:10});await flush();
 assert.equal(h.worker.read('visit').status,'pending');assert.equal(h.confirms.length,0);
 h.fail(false);void h.worker.resume();h.requests[1].resolve({feedback:['Reply'],reward:0,applied:false});await h.worker.resume();assert.equal(h.confirms.length,1);
});
test('late independent warmup cannot overwrite a newer followup candidate; malformed caches cannot restore answers',async()=>{
 const h=harness(),a=deferred();h.prepWait(a.promise);const first=h.worker.prepare('visit','v1');
 const b=deferred();h.prepWait(b.promise);const next=h.worker.prepare('visit','v1',true);
 b.resolve(prepared('followup'));await next;a.resolve(prepared());await first;assert.equal(h.worker.read('visit').candidate.mode,'followup');
 const malformed=harness([{owner:'me',scope:'me:partner:v1',visitId:'visit',candidate:{...prepared(),choices:[{id:'A',label:'Forged',feedback:['x'],reward:999999}]},step:0}]);
 assert.equal(malformed.worker.read('visit'),undefined);
});
