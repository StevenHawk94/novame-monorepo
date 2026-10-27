const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const draft={draftId:'draft',reflectId:'record',userId:'me',matchedItems:[{itemId:'laundry',label:'Doing Laundry'}]};
function jobsHarness({stored=new Map(),failStorage=false,hint}={}) {
  const time=clock(),requests={prepare:[],finish:[],start:[]},calls=[],projections=[],holds=[],clears=[],staged=[],released=[],cancelled=[],questFacts=[];
  let owner='me',epoch=1,identity,active=true,count=0;
  let snap={receivedAt:10000,data:{profile:{id:'me'},partner:{id:'partner'},pairVersion:'p1',localDate:'2026-10-12',serverNow:'2026-10-12T00:00:00Z',
    adventureTeam:{userId:'me',partnerId:'partner',pairVersion:'p1',adventureId:null,team:null,joinable:null,nudgeAvailable:false}}};
  const api=load('apps/mobile/src/lib/adventure-journal-jobs.ts',{
    './adventure-team-prefetch':{preparedAdventureTeam:()=>hint},
    './quest-progress-store':{captureQuestFact:questId=>({questId,scope:'me:partner:p1',day:'2026-10-12'}),
      questProgress:{fact:(id,intent,status)=>questFacts.push({id,intent,status})}},
    react:{useSyncExternalStore:(_s,read)=>read()},'react-native':{AppState:{get currentState(){return active?'active':'background';}}},
    'expo-crypto':{randomUUID:()=>`key-${++count}`},'./storage':{storage:{getString:key=>stored.get(key),set:(key,value)=>{if(failStorage)throw Error('disk_full');stored.set(key,value);}}},
    '../shared/storage/keys':{kAdventureJournalJobs:{name:'jobs'}},
    './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner,subscribeSessionIdentity:fn=>{identity=fn;}},
    './coin-command-outbox':{stageCoinOperationReward:(...args)=>staged.push(args),cancelStagedCoinOperationReward:id=>cancelled.push(id)},
    './coin-reward-store':{releaseCoinReward:id=>released.push(id)},
    './reflect-api':{prepareReflect:input=>{calls.push(['prepare',input]);const d=deferred();requests.prepare.push(d);return d.promise;},
      finalizeReflect:(d,memories,presentation)=>{calls.push(['finish',d,memories,presentation]);const p=deferred();requests.finish.push(p);return p.promise;}},
    './reflect-settlement-outbox':{holdReflectSettlement:id=>holds.push(['hold',id]),releaseReflectSettlement:id=>holds.push(['release',id])},
    './app-major-update-api':{startAdventure:(id,key)=>{calls.push(['start',id,key]);const d=deferred();requests.start.push(d);return d.promise;}},
    './burrow-store':{burrowClock:()=>time.globals.Date.now(),getBurrowSnapshot:()=>snap,cacheAdventureDisplay:display=>calls.push(['display',display]),
      projectAdventureJournalLocally:p=>projections.push(p),refreshBurrowAfterCurrent:async()=>calls.push(['refresh'])},
    './burrow-text-drafts':{removeBurrowTextDraft:(...args)=>clears.push(args)},
  },time.globals);
  const queue=()=>api.queueAdventureJournal({promptId:9,mode:'typing',body:'Kept day',idempotencyKey:'save-key',shareToPartner:false},{scope:'me:journal',target:'today',key:'draft-key'});
  return {api,time,requests,calls,stored,projections,holds,clears,staged,released,cancelled,questFacts,queue,
    background:()=>{active=false;api.pauseAdventureJournalJobs();},
    foreground:()=>{active=true;return api.resumeAdventureJournalJobs();},
    account:()=>{owner='other';epoch++;snap={...snap,data:{...snap.data,profile:{id:owner}}};identity();},
    snapshot:value=>snap={...snap,data:{...snap.data,...value}}};
}
test('prefetched partner trip paints Couple before prepare/finalize/Start replies, persists immutable display estimate',async()=>{
 const now=Date.parse('2026-10-12T02:00:00Z'),iso=n=>new Date(n).toISOString();
 const candidate={id:'partner-team',ruleVersion:5,version:1,leaderId:'partner',followerId:null,partnerId:'me',pairVersion:'p1',plus:false,
  startedAt:iso(now-2*3600000),progressAt:iso(now-2*3600000),progressFraction:0,endsAt:iso(now+4*3600000),leaderVariant:'pinky',followerVariant:'biscuit'};
 const hint={now,state:{userId:'me',partnerId:'partner',pairVersion:'p1',adventureId:null,joinable:candidate}};
 const h=jobsHarness({hint}),id=h.queue();h.api.requestAdventureJournalStart(id);
 const projected=h.projections.at(-1),saved=JSON.parse(h.stored.get('jobs'))[0];
 assert.equal(projected.team.followerId,'me');assert.equal(projected.team.leaderId,'partner');
 assert.equal(projected.team.progressFraction,1/3);assert.equal(Date.parse(projected.endsAt)-now,4*3600000/1.5);
 assert.equal(projected.adventureId,undefined,'never borrow partner personal Adventure ID');
 assert.equal(h.requests.start.length,0);assert.deepEqual(saved.previewTeam,JSON.parse(JSON.stringify(projected.team)));
 hint.now+=10000;h.api.requestAdventureJournalStart(id);assert.deepEqual(JSON.parse(h.stored.get('jobs'))[0].previewTeam,saved.previewTeam);
 h.requests.prepare[0].resolve({ok:true,draft});await flush();h.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record'}});await flush();
 h.requests.start[0].resolve({adventureId:'mine',endsAt:iso(now+6*3600000),team:{...candidate,id:'own-solo',leaderId:'me',partnerId:'partner',followerId:null}});await flush();
 assert.equal(h.projections.at(-1).team.followerId,null,'authoritative solo overrides an expired/raced optimistic join');
 assert.equal(h.projections.at(-1).adventureId,'mine');h.background();
});
test('Save acknowledges durable local input instantly; early Start is ordered prepare→finalize→start, not a UI wait',async()=>{
  const h=jobsHarness(),id=h.queue();assert.equal(id,'save-key');
  assert.equal(JSON.parse(h.stored.get('jobs'))[0].input.body,'Kept day');
  assert.equal(h.projections.at(-1).recordId,'pending:save-key');
  h.api.requestAdventureJournalStart(id);h.api.requestAdventureJournalStart(id);
  assert.ok(h.projections.at(-1).startedAt);assert.equal(h.requests.start.length,0);
  assert.equal(h.calls[0][1].localDate,'2026-10-12');assert.equal(h.calls[0][1].shareToPartner,false);
  h.requests.prepare[0].resolve({ok:true,draft});await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='finish')[2])),[{itemId:'laundry',text:'Doing Laundry',source:'manual',visible:true,edited:true}]);
  h.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record'}});await flush();
  assert.equal(h.requests.start.length,1);assert.deepEqual(h.calls.find(c=>c[0]==='start').slice(1),['record','key-1']);
  assert.deepEqual(h.clears,[['me:journal','today','draft-key']]);
  h.requests.start[0].resolve({adventureId:'adventure',endsAt:'2026-10-12T00:01:10Z',adventureDisplay:{adventurePlan:{version:'one'}}});await flush();
  assert.equal(h.projections.at(-1).adventureId,'adventure');assert.ok(h.holds.some(c=>c[0]==='release'));
  assert.equal(h.api.readAdventureJournalJob(id).receipt.id,'adventure');
  assert.equal(h.calls.find(c=>c[0]==='display')[1].adventurePlan.version,'one');
  assert.equal(JSON.parse(h.stored.get('jobs'))[0].receipt.display.adventurePlan.version,'one');
  const restored=jobsHarness({stored:h.stored});restored.snapshot({activeAdventure:{id:'adventure',status:'in_progress'}});
  restored.api.restoreAdventureJournalProjection();assert.equal(restored.calls.find(c=>c[0]==='display')[1].adventurePlan.version,'one');
  assert.equal(restored.requests.start.length,0,'restoring a plan is not a second start');restored.background();
});
test('a v5 intent waits in background for server capability, never falls through an older API as v1',async()=>{
 const h=jobsHarness();h.snapshot({adventureTeam:undefined});const id=h.queue();h.api.requestAdventureJournalStart(id);
 h.requests.prepare[0].resolve({ok:true,draft});await flush();h.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record'}});await flush();
 assert.equal(h.requests.start.length,0);assert.equal(h.api.readAdventureJournalJob(id).error,'adventure_protocol_unavailable');
 const original=JSON.parse(h.stored.get('jobs'))[0].startKey;
 h.snapshot({adventureTeam:{userId:'me',partnerId:'partner',pairVersion:'p1',team:null}});h.time.advance(2000);await flush();
 assert.equal(h.requests.start.length,1);assert.equal(h.calls.find(c=>c[0]==='start')[2],original);h.background();
});
test('journal completion projects before network, but Claim dependency confirms only after quest registration, not just saved text',async()=>{
  const h=jobsHarness();h.queue();assert.equal(h.questFacts.at(-1).status,'pending');
  assert.equal(h.questFacts.at(-1).intent.questId,'write_adventure_record');
  assert.ok(JSON.parse(h.stored.get('jobs'))[0].quest,'dependency context survives relaunch');
  h.requests.prepare[0].resolve({ok:true,draft});await flush();
  h.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record',adventureRecordRegistered:false}});await flush();
  assert.equal(h.questFacts.at(-1).status,'pending','supplementary registration failure cannot race Claim');h.background();
  const ready=jobsHarness();ready.queue();ready.requests.prepare[0].resolve({ok:true,draft});await flush();
  ready.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record',adventureRecordRegistered:true}});await flush();
  assert.equal(ready.questFacts.at(-1).status,'confirmed');ready.background();
  const rejected=jobsHarness();rejected.queue();rejected.requests.prepare[0].resolve({ok:false,error:'day_changed'});await flush();
  assert.equal(rejected.questFacts.at(-1).status,'rejected');rejected.background();
});
test('logged heading releases the staged reward before prepare/finalize replies, only once across remount/restart',async()=>{
 const h=jobsHarness(),id=h.queue();
 assert.equal(h.staged[0][0],'record:journal:save-key');assert.equal(h.staged[0][1],'record-first:2026-10-12');
 assert.equal(h.staged[0][2],10);assert.deepEqual(h.released,[]);
 h.api.presentAdventureJournalReward(id);h.api.presentAdventureJournalReward(id);
 assert.deepEqual(h.released,['record:journal:save-key']);assert.equal(h.requests.finish.length,0);
 assert.equal(JSON.parse(h.stored.get('jobs'))[0].rewardPresented,true);
 h.requests.prepare[0].resolve({ok:true,draft});await flush();
 assert.equal(h.calls.find(c=>c[0]==='finish')[3].operationId,'record:journal:save-key');
 assert.equal(h.calls.find(c=>c[0]==='finish')[3].deferred,true);
 h.background();const restored=jobsHarness({stored:h.stored});
 restored.api.presentAdventureJournalReward(id);assert.deepEqual(restored.released,[]);
});
test('a blocked recording rolls back its staged prediction; no later heading can release it',async()=>{
 const h=jobsHarness(),id=h.queue();h.requests.prepare[0].resolve({ok:false,error:'day_changed'});await flush();
 assert.deepEqual(h.cancelled,['record:journal:save-key']);h.api.presentAdventureJournalReward(id);
 assert.deepEqual(h.released,[]);h.background();
});
test('a changed pairing cancels only the obsolete local reward reservation',()=>{
 const h=jobsHarness();h.queue();h.snapshot({pairVersion:'new-pair'});void h.api.resumeAdventureJournalJobs();
 assert.ok(h.cancelled.includes('record:journal:save-key'));h.background();
});
test('optimistic production deadline is tier-correct, durable, and fixed at Start until the authoritative receipt',()=>{
 for(const hasPlus of [false,true]){
  const h=jobsHarness();h.snapshot({hasPlus});const id=h.queue();h.api.requestAdventureJournalStart(id);
  const first=h.projections.at(-1),duration=Date.parse(first.endsAt)-Date.parse(first.startedAt);assert.equal(duration,hasPlus?10800000:21600000);
  h.snapshot({hasPlus:!hasPlus});h.time.advance(5000);h.api.requestAdventureJournalStart(id);assert.equal(h.projections.at(-1).endsAt,first.endsAt);
  const restored=jobsHarness({stored:h.stored});restored.api.restoreAdventureJournalProjection();assert.equal(restored.projections.at(-1).endsAt,first.endsAt);
 }
});
test('offline requests replay the same Save and Start keys without losing words or starting twice',async()=>{
  const h=jobsHarness(),id=h.queue();h.api.requestAdventureJournalStart(id);
  h.requests.prepare[0].resolve({ok:false,error:'network'});await flush();
  assert.equal(h.api.readAdventureJournalJob(id).input.body,'Kept day');
  h.time.advance(2000);assert.equal(h.requests.prepare.length,2);
  assert.equal(h.calls.filter(c=>c[0]==='prepare')[0][1].idempotencyKey,h.calls.filter(c=>c[0]==='prepare')[1][1].idempotencyKey);
  h.requests.prepare[1].resolve({ok:true,draft});await flush();h.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record'}});await flush();
  h.requests.start[0].reject({body:{error:'network_error'}});await flush();h.time.advance(4000);
  assert.equal(h.requests.start.length,2);assert.equal(h.calls.filter(c=>c[0]==='start')[0][2],h.calls.filter(c=>c[0]==='start')[1][2]);
  h.background();
});
test('restart restores a pending Start and resumes from confirmed finalize without preparing a duplicate journal',async()=>{
  const first=jobsHarness(),id=first.queue();first.api.requestAdventureJournalStart(id);
  first.requests.prepare[0].resolve({ok:true,draft});await flush();first.requests.finish[0].resolve({ok:true,snapshot:{reflectId:'record'}});await flush();first.background();
  const second=jobsHarness({stored:first.stored});second.api.restoreAdventureJournalProjection();
  assert.ok(second.projections.at(-1).startedAt);void second.api.resumeAdventureJournalJobs();
  assert.equal(second.requests.prepare.length,0);assert.equal(second.requests.finish.length,0);assert.equal(second.requests.start.length,1);
  assert.equal(first.calls.find(c=>c[0]==='start')[2],second.calls.find(c=>c[0]==='start')[2]);second.background();
});
test('a late response after account/pair change cannot clear a draft or project/navigate another account',async()=>{
  const h=jobsHarness();h.queue();const before=h.projections.length;h.account();
  h.requests.prepare[0].resolve({ok:true,draft});await flush();
  assert.equal(h.projections.length,before);assert.equal(h.clears.length,0);assert.equal(h.requests.finish.length,0);
  assert.equal(h.api.readAdventureJournalJob('save-key'),undefined);
});
test('local storage failure never acknowledges a Save or sends background work',()=>{
  const h=jobsHarness({failStorage:true});assert.throws(h.queue);assert.equal(h.requests.prepare.length,0);assert.equal(h.projections.length,0);
});
test('semantic failures retain a retryable local receipt without an unbounded request loop',async()=>{
  const h=jobsHarness(),id=h.queue();h.requests.prepare[0].resolve({ok:false,error:'selection_unavailable'});await flush();
  assert.equal(h.api.readAdventureJournalJob(id).blocked,true);h.time.advance(600000);assert.equal(h.requests.prepare.length,1);
  h.api.retryAdventureJournalJob(id);assert.equal(h.requests.prepare.length,2);h.background();
});
test('returning to a server-confirmed saved day also starts locally and uses the durable worker',()=>{
  const h=jobsHarness();h.snapshot({readyRecordId:'server-record'});
  assert.equal(h.api.startPendingAdventureJournal('server-record'),true);
  assert.ok(h.projections.at(-1).startedAt);assert.equal(h.requests.prepare.length,0);
  assert.deepEqual(h.calls.find(c=>c[0]==='start').slice(1),['server-record','key-2']);h.background();
});
test('logged screen/confetti paint before any network receipt; Start synchronously routes with one native fade',()=>{
  const h=hooks(),starts=[],routes=[],rewards=[];
  const {AdventureRecordCompletion,AdventureReady}=load('apps/mobile/src/components/burrow/adventure-record-completion.tsx',{
    '@react-navigation/native':{usePreventRemove(){},useFocusEffect(){}},
    '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
    './adventure-reveal':{AdventureReveal:'Reveal'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Button',ScrollView:'Scroll',StyleSheet:{create:x=>x,absoluteFill:{}}},
    'expo-image':{Image:'Image'},'expo-router':{useRouter:()=>({back(){},dismiss(){throw Error('no existing Adventure');},replace:r=>routes.push(r)}),useNavigation:()=>({getState:()=>({index:1,routes:[{name:'(tabs)'},{name:'reflect-typing'}]})})},
    '@/lib/adventure-navigation':load('apps/mobile/src/lib/adventure-navigation.ts'),
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>({id:'job'}),presentAdventureJournalReward:id=>rewards.push(id),requestAdventureJournalStart:id=>{starts.push(id);return true;},retryAdventureJournalJob(){}},
    '@/lib/burrow-onboarding-design':{ONBOARDING_ART:{}},'@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{}},
    '@/components/main/reflect-celebration':{ReflectCelebration:'Confetti'},'./burrow-back-button':{BurrowBackButton:'Back'},
  });
  const tree=h.render(()=>AdventureRecordCompletion({jobId:'job'}));
  assert.equal(nodes(tree).find(n=>n.type==='Confetti').props.active,true);
  const ready=nodes(tree).find(n=>n.type===AdventureReady);assert.ok(ready);
  assert.deepEqual(rewards,[]);ready.props.onLoggedVisible();assert.deepEqual(rewards,['job']);
  assert.equal(nodes(tree).find(n=>n.type==='Confetti').props.onComplete,undefined,'confetti never owns reward release');
  ready.props.onStart();ready.props.onStart();
  h.render(()=>AdventureRecordCompletion({jobId:'job'}));
  assert.deepEqual(starts,['job']);assert.equal(routes.length,1);assert.equal(routes[0].params.adventureFade,'1');
  assert.ok(!nodes(tree).some(n=>n.type==='Spinner'));h.unmount();
});
test('Save UI has no network gate for Adventure; deprecated Save Journal/Saving screens are absent',()=>{
  const tap=fs.readFileSync('apps/mobile/app/(main)/reflect-guided.tsx','utf8');
  const write=fs.readFileSync('apps/mobile/src/components/burrow/adventure-journal-screen.tsx','utf8');
  assert.doesNotMatch(tap,/Save Journal/);assert.match(tap,/queueAdventureJournal/);assert.match(tap,/<AdventureRecordCompletion jobId=\{journalJobId\}/);
  assert.doesNotMatch(write,/ActivityIndicator|await prepareReflect|Saving your day/);assert.match(write,/<AdventureRecordCompletion jobId=\{jobId\}/);
  assert.doesNotMatch(fs.readFileSync('apps/mobile/src/components/burrow/adventure-record-completion.tsx','utf8'),/ActivityIndicator|Saving your day/);
});
test('due arrival continues its silent settlement after switching from ongoing to its frozen treasure, never navigates offscreen',async()=>{
  const h=hooks(),time=clock(),work=deferred(),calls=[];
  let value={receivedAt:10000,data:{profile:{id:'me'},serverNow:'2026-10-12T00:00:00Z',activeAdventure:{id:'real',status:'in_progress',ends_at:'2026-10-12T00:00:01Z'}}};
  const {AdventureArrivalGate}=load('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>value,burrowClock:()=>time.globals.Date.now(),projectBurrowAdventureArrival:id=>{calls.push(['project',id]);value={...value,data:{...value.data,activeAdventure:{...value.data.activeAdventure,status:'result_ready'}}};},refreshBurrowAfterCurrent:async()=>calls.push(['refresh'])},
    '@/lib/app-major-update-api':{settleAdventure:id=>{calls.push(['settle',id]);return work.promise;}},
    '@/lib/adventure-journal-jobs':{pauseAdventureJournalJobs(){},resumeAdventureJournalJobs(){},restoreAdventureJournalProjection(){}},
    '@/lib/adventure-delivery':{pauseAdventureDelivery(){},resumeAdventureDelivery(){}},'@/lib/adventure-prefetch':{warmAdventureCompletion:async()=>{}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>1},
  },time.globals);
  h.render(AdventureArrivalGate);const before=calls.length;time.advance(1050);h.render(AdventureArrivalGate);
  assert.deepEqual(calls.slice(before),[['project','real'],['settle','real']]);work.resolve();await flush();
  assert.equal(calls.at(-1)[0],'refresh','projecting the treasure must not cancel its server settlement');
  h.unmount();
});
