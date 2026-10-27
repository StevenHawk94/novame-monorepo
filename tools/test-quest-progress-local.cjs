const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,flush,deferred}=require('./lifecycle-test-utils.cjs');
const model=()=>load('apps/mobile/src/lib/quest-progress-model.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
// Execute the store's actual sharing function alongside the real WeakMap-
// based quest projector; native store fixtures normally stub this boundary.
function shareSnapshot(){
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const ast=ts.createSourceFile('store.ts',fs.readFileSync('apps/mobile/src/lib/burrow-store.ts','utf8'),ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='shareBurrowSnapshot').getText(ast);
 const context={exports:{}};vm.runInNewContext(ts.transpileModule(fn+';exports.share=shareBurrowSnapshot;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 return context.exports.share;
}
const bootstrap=()=>({profile:{id:'a'},partner:{id:'b'},pairVersion:'v1',localDate:'2026-10-22',
  quests:{localDate:'2026-10-22',quests:[{assignmentId:'assignment-a',questId:'send_affection',target:1,progress:0,completedAt:null,claimedAt:null}]},
  specialQuests:[{questId:'items_collected',stage:1,target:10,progress:25,reward:15}]});
function harness(disk){let saved=disk,changes=0;const m=model(),progress=m.createQuestProgress({load:()=>saved,
  save:v=>saved=plain(v),changed:()=>changes++});const data=bootstrap();
  return {progress,data,intent:progress.capture(data,'send_affection'),get disk(){return saved;},get changes(){return changes;}};}
test('store sharing preserves optimistic row identity, raw-cache stripping and failure rollback',()=>{
 const h=harness(),share=shareSnapshot();h.progress.fact('affection',h.intent,'pending');
 const completed=h.progress.project(h.data),claim=h.progress.captureClaim(completed,'assignment-a');h.progress.claim('claim',claim,'pending');
 h.progress.claim('special',{...claim,assignmentId:undefined,questId:'items_collected',stage:1},'pending');
 const projected=h.progress.project(completed),shown=share(h.data,projected);
 assert.equal(shown.quests.quests[0],projected.quests.quests[0]);
 assert.equal(shown.specialQuests[0],projected.specialQuests[0]);
 const raw=h.progress.unproject(shown);assert.equal(raw.quests.quests[0].progress,0);assert.equal(raw.specialQuests[0].stage,1);
 h.progress.fact('affection',h.intent,'rejected');h.progress.claim('claim',claim,'rejected');
 h.progress.claim('special',{...claim,assignmentId:undefined,questId:'items_collected',stage:1},'rejected');
 const rolled=h.progress.project(shown);assert.equal(rolled.quests.quests[0].claimedAt,null);assert.equal(rolled.quests.quests[0].progress,0);assert.equal(rolled.specialQuests[0].stage,1);
 assert.equal(share(shown,projected),shown,'unchanged projections keep the prior graph');
});
test('valid local completion makes Claim ready synchronously; server request waits for its receipt',()=>{
  const h=harness();h.progress.fact('affection:a',h.intent,'pending');
  const data=h.progress.project(h.data),q=data.quests.quests[0];assert.equal(q.progress,1);assert.ok(q.completedAt);
  const claim=h.progress.captureClaim(data,q.assignmentId);assert.equal(claim.verified,false);
  assert.throws(()=>h.progress.guard(claim,claim),/quest_sync_pending/);
  h.progress.fact('affection:a',h.intent,'confirmed');assert.doesNotThrow(()=>h.progress.guard(claim,claim));
});
test('claimed display survives stale snapshots, tab remount, and process restoration; raw cache excludes predictions',()=>{
  const h=harness();h.progress.fact('affection:a',h.intent,'pending');const shown=h.progress.project(h.data);
  const claim=h.progress.captureClaim(shown,'assignment-a');h.progress.claim('claim:a',claim,'pending');
  assert.ok(h.progress.project(shown).quests.quests[0].claimedAt);
  assert.ok(h.progress.project(plain(h.data)).quests.quests[0].claimedAt);
  assert.equal(h.progress.unproject(h.progress.project(shown)).quests.quests[0].claimedAt,null);
  assert.equal(h.progress.unproject(shown).quests.quests[0].completedAt,null);
  const restored=harness(h.disk);assert.ok(restored.progress.project(restored.data).quests.quests[0].claimedAt);
  assert.throws(()=>restored.progress.guard(claim,claim),/quest_sync_pending/);
});
test('definitive completion failure rolls back both completion and pending reward; a genuine new action can retry',()=>{
  const h=harness();h.progress.fact('affection:a',h.intent,'pending');const shown=h.progress.project(h.data);
  const claim=h.progress.captureClaim(shown,'assignment-a');h.progress.claim('claim:a',claim,'pending');
  h.progress.fact('affection:a',h.intent,'rejected');assert.throws(()=>h.progress.guard(claim,claim),/not_completed/);
  h.progress.claim('claim:a',claim,'rejected');const rolled=h.progress.project(h.progress.project(shown));
  assert.equal(rolled.quests.quests[0].progress,0);assert.equal(rolled.quests.quests[0].claimedAt,null);
  h.progress.fact('affection:b',h.intent,'pending');assert.equal(h.progress.project(rolled).quests.quests[0].progress,1);
});
test('server-completed assignments do not depend on a local fact and repeated projections retain references',()=>{
  const h=harness();h.data.quests.quests[0].completedAt='server';h.data.quests.quests[0].progress=1;
  const claim=h.progress.captureClaim(h.data,'assignment-a');assert.equal(claim.verified,true);h.progress.guard(claim,claim);
  h.progress.claim('claim:a',claim,'confirmed');const shown=h.progress.project(h.data);
  assert.equal(h.progress.project(shown),shown);assert.equal(h.progress.captureClaim(shown,'assignment-a').verified,true);
});
test('day, account and pair boundaries are isolated; yesterday dependency can still settle its exact assignment',()=>{
  const h=harness();h.progress.fact('affection:a',h.intent,'confirmed');const claim=h.progress.captureClaim(h.progress.project(h.data),'assignment-a');
  h.progress.claim('claim:a',claim,'pending');const next=plain(h.data);next.localDate='2026-10-23';
  assert.equal(h.progress.project(next).quests.quests[0].progress,0);
  assert.doesNotThrow(()=>h.progress.guard(claim,{scope:claim.scope,day:'2026-10-23'}));
  next.partner.id='c';assert.equal(h.progress.project(next).quests.quests[0].claimedAt,null);
  assert.throws(()=>h.progress.guard(claim,model().questScope(next)),/pair_changed/);
  next.profile.id='other';assert.equal(h.progress.project(next).quests.quests[0].progress,0);
});
test('no fabricated assignment; confirmed facts cannot be downgraded by a restored pending outbox',()=>{
  const h=harness();assert.throws(()=>h.progress.captureClaim(h.data,'pending:send_affection'),/not_completed/);
  h.progress.fact('a',h.intent,'confirmed');h.progress.fact('a',h.intent,'pending');
  h.progress.guard(h.progress.captureClaim(h.progress.project(h.data),'assignment-a'),h.intent);
  h.progress.reset();assert.equal(h.progress.project(h.data).quests.quests[0].progress,0);
});
test('authoritative refresh releases pending registration and never mistakes a projected row for proof',()=>{
  const h=harness();h.progress.fact('journal',h.intent,'pending');const claim=h.progress.captureClaim(h.progress.project(h.data),'assignment-a');
  assert.throws(()=>h.progress.guard(claim,claim),/quest_sync_pending/);
  const remote=plain(h.data);remote.quests.quests[0].completedAt='server';remote.quests.quests[0].progress=1;
  h.progress.observe(remote);assert.doesNotThrow(()=>h.progress.guard(claim,claim));
  h.progress.reload('other');assert.equal(h.progress.project(h.data).quests.quests[0].progress,0);
  h.progress.reload('a');assert.equal(h.progress.project(h.data).quests.quests[0].progress,1);
});
test('personal bootstrap cache never serializes optimistic completion or optimistic special stages',()=>{
  const h=harness(),values=new Map();h.progress.fact('a',h.intent,'pending');
  const claim=h.progress.captureClaim(h.progress.project(h.data),'assignment-a');h.progress.claim('claim:a',claim,'pending');
  h.progress.claim('special:1',{...claim,assignmentId:undefined,questId:'items_collected',stage:1},'pending');
  const cache=load('apps/mobile/src/lib/burrow-cache.ts',{
    './storage':{storage:{set:(k,v)=>values.set(k,v)}},
    '../shared/storage/keys':{kBurrowSnapshot:{name:'snapshot'},kBurrowWallet:{name:'wallet'},kBurrowActionKeys:{name:'keys'}},
    './quest-progress-store':{questProgress:h.progress},
  });
  cache.persistBurrowSnapshot({...h.progress.project(h.data),roomPhotos:[],memoryEntries:[],moments:[]});
  const saved=JSON.parse(values.get('snapshot')).data;
  assert.equal(saved.quests.quests[0].completedAt,null);assert.equal(saved.quests.quests[0].claimedAt,null);
  assert.equal(saved.specialQuests[0].stage,1);
});
test('special milestones project once, survive stale data, serialize stage claims and roll back safely',()=>{
  const h=harness(),scope=model().questScope(h.data),first={...scope,questId:'items_collected',stage:1,verified:true};
  h.progress.claim('special:1',first,'pending');let shown=h.progress.project(h.data);
  assert.equal(shown.specialQuests[0].stage,2);assert.equal(shown.specialQuests[0].target,20);
  const second={...first,stage:2};h.progress.claim('special:2',second,'pending');
  assert.throws(()=>h.progress.guard(second,scope),/quest_sync_pending/);
  h.progress.claim('special:1',first,'confirmed');assert.doesNotThrow(()=>h.progress.guard(second,scope));
  shown=h.progress.project(shown);assert.equal(shown.specialQuests[0].target,30);assert.equal(h.progress.project(shown),shown);
  h.progress.claim('special:2',second,'rejected');shown=h.progress.project(shown);assert.equal(shown.specialQuests[0].stage,2);
  const third={...first,stage:3};h.progress.claim('special:3',third,'pending');assert.throws(()=>h.progress.guard(third,scope),/not_completed/);
  const remote=plain(h.data);remote.specialQuests[0]={...remote.specialQuests[0],stage:3,target:30};
  h.progress.observe(remote);assert.doesNotThrow(()=>h.progress.guard(third,scope),'cross-device settlement supersedes a rejection tombstone');
});

function outboxHarness(options={}){
  const time=clock(),calls=[],ratings=[],tickets=new Map(),values=options.values??new Map(),listeners=[];let data=bootstrap(),balance=100,rollbacks=0;
  const m=model(),progress=m.createQuestProgress({load:()=>JSON.parse(values.get('quests')??'null'),
    save:v=>values.set('quests',JSON.stringify(v)),changed:()=>{data=progress.project(data);listeners.forEach(fn=>fn());}});
  const projectStore={questProgress:progress,currentQuestData:()=>data,subscribeQuestProgress:fn=>{if(options.wake)listeners.push(fn);return()=>{};},
    captureQuestFact:id=>progress.capture(data,id),guardQuestClaim:intent=>progress.guard(intent,m.questScope(data))};
  data=progress.project(data);
  const coinStore={commandCoinRewardPlan:(action,payload)=>({id:action+':'+(payload.assignmentId??payload.idempotencyKey??payload.questId+':'+payload.stage),
    key:action+':'+(payload.assignmentId??payload.idempotencyKey),amount:action.startsWith('claim_')?10:0,deferred:false}),
    beginCoinReward:(id,key,amount)=>{balance+=amount;const t={id,amount};tickets.set(id,t);return t;},
    settleCoinReward:()=>{},failCoinReward:t=>{balance-=t.amount;rollbacks++;},
    coinRewardDefinitelyRejected:e=>['not_completed','pair_changed','already_full'].includes(e.message)};
  const api=load('apps/mobile/src/lib/coin-command-outbox.ts',{
    './quest-progress-store':projectStore,'./quest-progress-model':m,
    'react-native':{AppState:{currentState:'active',addEventListener(){}}},
    './api':{apiClient:{post:async(path,payload)=>{calls.push(payload.action);return options.send?options.send(payload):{};}}},
    './async-lifecycle':{withDeadline:p=>p},'./storage':{storage:{getString:k=>values.get(k),set:(k,v)=>{
      if(options.diskFull&&k==='coins')throw Error('disk full');values.set(k,v);}}},
    '../shared/storage/keys':{kCoinOperations:{name:'coins'}},
    './session-lifecycle':{sessionUserId:()=>data.profile.id,subscribeSessionIdentity(){}},
    './coin-reward-store':coinStore,'./coin-operation-queue':load('apps/mobile/src/lib/coin-operation-queue.ts',{},time.globals),
    './official-rating-milestones':{recordRatingMilestone:(...args)=>ratings.push(args)},
  },time.globals);
  return {api,time,calls,ratings,progress,values,get data(){return data;},get balance(){return balance;},get rollbacks(){return rollbacks;},
    intent:progress.capture(data,'send_affection')};
}
test('real monetary outbox credits immediately, persists intent before returning, and never sends Claim ahead of its completion',async()=>{
  const delivery=deferred(),h=outboxHarness({send:p=>p.action==='complete_affection'?delivery.promise:{reward:10}});
  const completion=h.api.submitCoinCommand('complete_affection',{idempotencyKey:'a'});
  assert.ok(h.data.quests.quests[0].completedAt);
  assert.equal(h.api.claimQuestOptimistically('claim_daily_quest',{assignmentId:'assignment-a'}),10);
  assert.equal(h.balance,110);assert.ok(h.data.quests.quests[0].claimedAt);assert.ok(h.values.get('coins').includes('claim_daily_quest'));
  await flush();assert.deepEqual(h.calls,['complete_affection']);
  delivery.resolve({});await completion;h.time.advance(2000);await flush();
  assert.deepEqual(h.calls,['complete_affection','claim_daily_quest']);assert.equal(h.balance,110);assert.equal(h.api.coinOperations.pending().length,0);
});
test('ambiguous claim failures retain optimistic coins, claimed state and retry key without duplicate presentation',async()=>{
  let attempts=0;const h=outboxHarness({send:p=>{if(p.action==='claim_daily_quest'&&++attempts===1)throw Error('offline');return {reward:10};}});
  h.progress.fact('a',h.intent,'confirmed');h.api.claimQuestOptimistically('claim_daily_quest',{assignmentId:'assignment-a'});await flush();
  assert.equal(h.balance,110);assert.equal(h.rollbacks,0);assert.ok(h.data.quests.quests[0].claimedAt);
  h.time.advance(2000);await flush();assert.equal(attempts,2);assert.equal(h.balance,110);assert.equal(h.api.coinOperations.pending().length,0);
});
test('server rejection corrects coins and restores the shared task state even after leaving the page',async()=>{
  const h=outboxHarness({send:p=>{if(p.action==='claim_daily_quest')throw Error('not_completed');return {};}});
  h.progress.fact('a',h.intent,'confirmed');h.api.claimQuestOptimistically('claim_daily_quest',{assignmentId:'assignment-a'});
  assert.equal(h.balance,110);await flush();assert.equal(h.balance,100);assert.equal(h.rollbacks,1);
  assert.equal(h.data.quests.quests[0].claimedAt,null);assert.equal(h.data.quests.quests[0].progress,0);
});
test('pending completion and claim restore after relaunch; only confirmed dependency permits the wire claim',async()=>{
  const first=outboxHarness();first.progress.fact('a',first.intent,'pending');first.api.claimQuestOptimistically('claim_daily_quest',{assignmentId:'assignment-a'});await flush();
  const restored=outboxHarness({values:first.values});restored.api.coinOperations.resume();await flush();
  assert.equal(restored.balance,110);assert.equal(restored.calls.length,0);assert.ok(restored.data.quests.quests[0].claimedAt);
  restored.progress.fact('a',restored.intent,'confirmed');restored.time.advance(2000);await flush();
  assert.deepEqual(restored.calls,['claim_daily_quest']);assert.equal(restored.balance,110);
});
test('dependency receipt wakes only waiting Claims without another network-backoff delay',async()=>{
  const h=outboxHarness({wake:true});h.progress.fact('a',h.intent,'pending');
  h.api.claimQuestOptimistically('claim_daily_quest',{assignmentId:'assignment-a'});await flush();
  h.time.advance(0);await flush();assert.equal(h.calls.length,0,'a queued fact is not a receipt');
  h.progress.fact('a',h.intent,'confirmed');h.time.advance(0);await flush();
  assert.deepEqual(h.calls,['claim_daily_quest']);assert.equal(h.balance,110);
});
test('Affection enqueue returns its durable ID immediately while the network stays pending',async()=>{
 const delivery=deferred(),h=outboxHarness({send:()=>delivery.promise}),events=[];
 h.api.coinOperations.subscribeSettled(event=>events.push(event));
 const id=h.api.enqueueAffectionCommand('kiss',{scale:1.6,holdMs:3000},'affection-a');
 assert.equal(id,'complete_affection:affection-a');assert.ok(h.values.get('coins').includes('affection-a'));
 assert.equal(h.data.quests.quests[0].progress,1);await flush();assert.equal(events.length,0);
 delivery.resolve({eventId:'server-event'});await flush();assert.equal(events.length,1);
 assert.equal(events[0].operation.id,id);assert.equal(h.api.coinOperations.pending().length,0);
 assert.deepEqual(h.ratings,[['a','affection','affection-a']]);
});
test('Affection unknown failure retries unchanged and emits the eventual receipt, without a UI waiter',async()=>{
 const payloads=[],events=[];const h=outboxHarness({send:payload=>{
  payloads.push(plain(payload));if(payloads.length===1)throw Error('offline');return {eventId:'late'};
 }});
 h.api.coinOperations.subscribeSettled(event=>events.push(event));
 h.api.enqueueAffectionCommand('cuddle',{turns:10},'same-key');await flush();
 assert.equal(events.length,0);assert.equal(h.api.coinOperations.pending().length,1);
 h.time.advance(2000);await flush();assert.deepEqual(payloads[0],payloads[1]);
 assert.equal(events.length,1);assert.equal(events[0].receipt.eventId,'late');
 assert.deepEqual(h.ratings,[['a','affection','same-key']],'late background receipt still counts after Done');
});
test('Affection cannot pretend to be queued if the local durable commit fails',()=>{
 const h=outboxHarness({diskFull:true});
 assert.throws(()=>h.api.enqueueAffectionCommand('hug',{durationMs:3000},'unsaved'),/intent_not_saved/);
 assert.equal(h.api.coinOperations.pending().length,0);assert.equal(h.calls.length,0);
 assert.equal(h.data.quests.quests[0].progress,0);
});
