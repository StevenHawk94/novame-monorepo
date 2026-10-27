const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const catalog=require('../apps/api/src/data/burrow-game-room-v1.json');
const content=load('apps/mobile/src/lib/burrow-game-room-content.ts',{'../../../api/src/data/burrow-game-room-v1.json':catalog});
const game=content.GAME_ROOM_GAMES[0],id='11111111-1111-4111-8111-111111111111',scope='a:b:v1';
test('free entitlement is durable and nonblocking; a pending receipt never loses answers written meanwhile',async()=>{
 const pending=deferred(),h=harness({unlock:()=>pending.promise});
 let s=h.api.createLocalGame({...game,price:0},undefined,{freeUnlock:true});assert.equal(h.calls.length,0);
 const delivery=h.api.resumeLocalGames();assert.equal(h.calls[0].price,0);s=h.fill(s);s=h.fill(s,'guess');
 assert.equal(h.api.readLocalGame(s.id,scope).session.guesses.length,6);pending.resolve({unlocked:true});await delivery;
 assert.equal(h.calls[1],'start');assert.equal(h.calls[2].own.length,6);assert.equal(h.api.readLocalGame(s.id,scope).confirmed,true);
});
test('free receipt retries after restart/offline and never becomes a paid purchase on price change',async()=>{
 const h=harness({unlock:()=>{throw Error('offline');}}),s=h.api.createLocalGame({...game,price:0},undefined,{freeUnlock:true});
 await h.api.resumeLocalGames();assert.equal(h.api.readLocalGame(s.id,scope).freeUnlock,true);
 const restored=harness({disk:h.disk,unlock:()=>{throw Error('price_changed');}});await restored.api.resumeLocalGames();
 assert.equal(restored.calls[0].price,0);assert.equal(restored.calls.length,1);assert.equal(restored.api.readLocalGame(s.id,scope).blocked,true);
 assert.equal(restored.api.readLocalGame(s.id,scope).session.ownAnswers.length,0);await restored.api.resumeLocalGames();assert.equal(restored.calls.length,1);
});
test('late free entitlement responses cannot create a session for a changed pair',async()=>{
 const pending=deferred(),h=harness({unlock:()=>pending.promise});h.api.createLocalGame({...game,price:0},undefined,{freeUnlock:true});
 const delivery=h.api.resumeLocalGames();h.changePair();pending.resolve({unlocked:true});await delivery;assert.equal(h.calls.length,1);
});
function harness(options={}){
  const time=clock(),disk=options.disk??new Map(),calls=[],identity=[],questFacts=[];
  let user='a',partner='b',version='v1',counter=0;
  const response={id,gameId:game.id,completedAt:null,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:0,partnerGuessCount:0,partnerOwnAnswers:null,partnerGuesses:null,notifyReady:false,result:null};
  const api=load('apps/mobile/src/lib/burrow-game-local.ts',{
    './quest-progress-store':{captureQuestFact:questId=>({scope:`${user}:${partner}:${version}`,day:'2026-10-22',questId}),
      questProgress:{fact:(id,intent,status)=>questFacts.push({id,intent,status})}},
    react:{useSyncExternalStore(){}},'react-native':{AppState:{currentState:'active'}},'expo-crypto':{randomUUID:()=>String(++counter)},
    './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>{if(options.storageFailure)throw Error('disk full');disk.set(key,value);}}},
    '../shared/storage/keys':{kGameLocal:{name:'local'}},
    './session-lifecycle':{sessionUserId:()=>user,subscribeSessionIdentity:fn=>identity.push(fn)},
    './burrow-store':{getBurrowSnapshot:()=>({data:{profile:{id:user},partner:{id:partner},pairVersion:version}}),refreshBurrow:async()=>{}},
    './burrow-game-room-api':{startGame:async()=>{calls.push('start');return options.start?options.start():{sessionId:id};},
      unlockGame:async(id,price)=>{calls.push({unlock:id,price});return options.unlock?options.unlock(id,price):{unlocked:true};},
      gameSession:async()=>options.remote??content.localGameSession(response),
      viewGameResult:async id=>{calls.push({viewed:id});return options.view?options.view(id):{viewedAt:'2026-10-13T12:00:00Z'};},
      submitGame:async(id,own,guesses)=>{calls.push({id,own,guesses});return options.submit?options.submit(id,own,guesses):{session:content.localGameSession(response)};},
      gameOverview:async()=>({paired:true,availableIds:[game.id],sessions:[]})},
    './burrow-game-room-content':content,'./burrow-game-room-cache':{cacheGameOverview(){},cacheGameSession:session=>options.onCacheSession?.(session),getCachedGameOverview:s=>s===scope?options.overview??null:null,getCachedGameSession:(_id,s)=>s===scope?options.cached??null:null},
  },{...time.globals,Error});
  const fill=(session,phase='own')=>{let next=session;for(let i=0;i<6;i++)next=api.saveLocalGameAnswer(next.id,phase,i,0);return next;};
  return {api,time,disk,calls,fill,response,questFacts,changePair(){partner='c';version='v2';},signout(){user=null;identity.forEach(fn=>fn());}};
}
test('game task is optimistic only when both rounds finish; historical results cannot complete today',async()=>{
  const pending=deferred(),h=harness({submit:()=>pending.promise});
  const waiting={...content.localGameSession(h.response),ownAnswers:[],guesses:[],partnerOwnCount:6,partnerGuessCount:6};
  let s=h.fill(h.api.createLocalGame(game,waiting));h.fill(s,'guess');assert.equal(h.questFacts.at(-1).status,'pending');
  assert.equal(JSON.parse(h.disk.get('local')).jobs[0].quest.questId,'play_game');
  const flight=h.api.resumeLocalGames();await flush();pending.resolve({session:{...waiting,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),
    completedAt:'2026-10-22T12:00:00Z',result:{mine:0,partner:0,outcome:'tie'}}});await flight;
  assert.equal(h.questFacts.at(-1).status,'confirmed');
  const other=harness();let solo=other.fill(other.api.createLocalGame(game));other.fill(solo,'guess');
  assert.equal(other.questFacts.length,0,'waiting for partner is not completion');other.api.pauseLocalGames();
  other.api.reconcileLocalGame({...waiting,completedAt:'2026-10-21T12:00:00Z'},scope);
  assert.equal(other.questFacts.length,0,'yesterday history is not a new played-game fact');
});
test('all 12 choices are durably local; only the final choice schedules one full delivery',async()=>{
  const h=harness();let s=h.api.createLocalGame(game);
  assert.equal(h.api.readLocalGame(s.id,scope).session.id,s.id);
  s=h.fill(s);assert.equal(h.calls.length,0);assert.equal(h.time.timers.size,0);
  s=h.fill(s,'guess');assert.equal(h.calls.length,0);
  assert.equal(JSON.parse(h.disk.get('local')).jobs[0].session.guesses.length,6);
  h.time.advance(0);await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].own.length,6);assert.equal(h.calls[1].guesses.length,6);
  assert.equal(h.api.readLocalGame(s.id,scope).confirmed,true); // local alias survives server ID rebinding
  assert.equal(h.api.readLocalGame(id,scope).confirmed,true);
  await h.api.resumeLocalGames();assert.equal(h.calls.length,2);
});
test('ordered immutable answers suppress duplicates and reject changes/out-of-order taps',()=>{
  const h=harness(),s=h.api.createLocalGame(game);h.api.saveLocalGameAnswer(s.id,'own',0,0);
  assert.equal(h.api.saveLocalGameAnswer(s.id,'own',0,0).ownAnswers.length,1);
  assert.throws(()=>h.api.saveLocalGameAnswer(s.id,'own',0,1));
  assert.throws(()=>h.api.saveLocalGameAnswer(s.id,'own',3,0));
  assert.throws(()=>h.api.saveLocalGameAnswer(s.id,'guess',0,0));
  assert.equal(h.calls.length,0);
});
test('offline retries keep the same server session and all answers, never restart or duplicate a delivery',async()=>{
  let attempts=0;const h=harness({submit:()=>{if(++attempts===1)throw Error('offline');return {session:content.localGameSession(h.response)};}});
  let s=h.fill(h.api.createLocalGame(game));s=h.fill(s,'guess');h.time.advance(0);await flush();
  assert.equal(h.api.readLocalGame(s.id,scope).error,'offline');assert.equal(h.api.readLocalGame(s.id,scope).session.guesses.length,6);
  h.time.advance(2000);await flush();assert.equal(h.calls.filter(c=>c==='start').length,1);assert.equal(attempts,2);
  assert.equal(h.api.readLocalGame(s.id,scope).confirmed,true);
});
test('drafts and undelivered submissions resume after process restart',async()=>{
  const h=harness();let s=h.api.createLocalGame(game);s=h.api.saveLocalGameAnswer(s.id,'own',0,0);
  let restored=harness({disk:h.disk});s=restored.api.createLocalGame(game);assert.equal(s.ownAnswers.length,1);
  for(let i=1;i<6;i++)s=restored.api.saveLocalGameAnswer(s.id,'own',i,0);
  restored.fill(s,'guess');restored.api.pauseLocalGames();
  const reboot=harness({disk:h.disk});await reboot.api.resumeLocalGames();assert.equal(reboot.calls.length,2);
  assert.equal(reboot.api.readLocalGame(s.id,scope).confirmed,true);
});
test('a stale poll never rewinds local choices; partner progress merges into the live draft',()=>{
  const h=harness(),s=h.api.createLocalGame(game,{...content.localGameSession(h.response),ownAnswers:[0],guesses:[]});
  h.api.saveLocalGameAnswer(s.id,'own',1,0);
  const remote={...s,ownAnswers:[],partnerOwnCount:6,partnerGuessCount:6};
  assert.equal(h.api.reconcileLocalGame(remote,scope).ownAnswers.length,2);
  assert.equal(h.api.readLocalGame(id,scope).session.partnerGuessCount,6);
});
test('reopening a waiting round does not manufacture another local game',async()=>{
  const h=harness();let s=h.fill(h.api.createLocalGame(game));s=h.fill(s,'guess');await h.api.resumeLocalGames();
  assert.equal(h.api.createLocalGame(game).id,id);assert.equal(h.api.useLocalGames(scope).length,1);
});
test('pair/account changes discard late receipts and cannot mark results seen in another scope',async()=>{
  const receipt=deferred(),h=harness({submit:()=>receipt.promise});let s=h.fill(h.api.createLocalGame(game));h.fill(s,'guess');
  const flight=h.api.resumeLocalGames();await flush();h.changePair();receipt.resolve({session:content.localGameSession(h.response)});await flight;
  assert.equal(h.api.readLocalGame(s.id,scope).confirmed,false);assert.equal(h.api.useLocalGames('a:c:v2').length,0);
  h.api.markGameResultViewed(id,scope);assert.equal(h.api.gameResultViewed(id,'a:c:v2'),false);
  h.signout();assert.equal(h.api.useLocalGames(scope).length,0);
});
test('storage failure cannot acknowledge an answer or advance the flow',()=>{
  const options={},h=harness(options),s=h.api.createLocalGame(game);options.storageFailure=true;
  assert.throws(()=>h.api.saveLocalGameAnswer(s.id,'own',0,0),/disk full/);
  assert.equal(h.api.readLocalGame(s.id,scope).session.ownAnswers.length,0);assert.equal(h.calls.length,0);
});
test('result-viewed state survives restart, remains separate for each pair',()=>{
  const h=harness();h.api.createLocalGame(game);h.api.markGameResultViewed(id,scope);
  const next=harness({disk:h.disk});assert.equal(next.api.gameResultViewed(id,scope),true);
  assert.equal(next.api.gameResultViewed(id,'a:b:v2'),false);
});
test('result-view receipt is durable, instant locally, silently retried after restart, and sent once',async()=>{
  const h=harness();h.api.markGameResultViewed(id,scope);
  assert.equal(h.api.gameResultViewed(id,scope),true);assert.equal(h.calls.length,0,'results do not wait on a request');
  assert.deepEqual(JSON.parse(h.disk.get('local')).pendingViews[scope],[id]);h.api.pauseLocalGames();
  let attempts=0;const reboot=harness({disk:h.disk,view:()=>{if(++attempts===1)throw Error('offline');return {viewedAt:'2026-10-13'};}});
  await reboot.api.resumeLocalGames();assert.equal(reboot.api.gameResultViewed(id,scope),true);
  assert.deepEqual(JSON.parse(reboot.disk.get('local')).pendingViews[scope],[id]);
  reboot.time.advance(2000);await flush();assert.equal(attempts,2);
  assert.deepEqual(JSON.parse(reboot.disk.get('local')).pendingViews[scope],[]);
  await reboot.api.resumeLocalGames();assert.equal(attempts,2);
});
test('remote viewed state is respected and a changed pairing cannot receive a late view acknowledgement',async()=>{
  const server=harness({overview:{sessions:[{id,resultViewedAt:'2026-10-13'}]}});
  assert.equal(server.api.gameResultViewed(id,scope),true);assert.equal(server.api.gameResultViewed(id,'a:b:v2'),false);
  const response=deferred(),h=harness({view:()=>response.promise});h.api.markGameResultViewed(id,scope);
  const delivery=h.api.resumeLocalGames();h.changePair();response.resolve({viewedAt:'2026-10-13'});await delivery;
  assert.equal(h.api.gameResultViewed(id,'a:c:v2'),false);
  assert.deepEqual(JSON.parse(h.disk.get('local')).pendingViews[scope],[id],'late old-pair response cannot acknowledge the new pair');
  h.api.pauseLocalGames();
});
test('opening a cached result archives its score immediately, before the background view receipt',()=>{
  const writes=[],cached={id,gameId:game.id,completedAt:'2026-10-13',result:{mine:4,partner:3,outcome:'win'}};
  const h=harness({cached,onCacheSession:s=>writes.push(s)});h.api.markGameResultViewed(id,scope);
  assert.equal(writes[0].result.outcome,'win');assert.ok(writes[0].resultViewedAt);assert.equal(h.calls.length,0);
  h.api.pauseLocalGames();
});

test('confirmed completion cannot be rewound by an older lobby snapshot',async()=>{
  const h=harness({submit:()=>({session:content.localGameSession({...h.response,completedAt:'2026-10-12',partnerOwnCount:6,partnerGuessCount:6,result:{mine:6,partner:6,outcome:'tie'}})})});
  let s=h.fill(h.api.createLocalGame(game));h.fill(s,'guess');await h.api.resumeLocalGames();
  const old={sessions:[{id,gameId:game.id,createdAt:'2026-10-12',completedAt:null,ownCount:6,guessCount:6,partnerOwnCount:0,partnerGuessCount:0}]};
  const row=h.api.projectGameOverview(old,scope).sessions[0];assert.equal(row.completedAt,'2026-10-12');assert.equal(row.partnerGuessCount,6);
});

test('a completed result from another device uses its real guesses and preserves the superseded local draft',()=>{
  const h=harness(),s=h.api.createLocalGame(game,{...content.localGameSession(h.response),ownAnswers:[0],guesses:[]});
  const remote={...h.response,questions:game.questions,completedAt:'2026-10-12',ownAnswers:Array(6).fill(1),result:{mine:0,partner:6,outcome:'lose'}};
  assert.equal(h.api.reconcileLocalGame(remote,scope).ownAnswers[0],1);
  const job=h.api.readLocalGame(id,scope);assert.equal(job.confirmed,true);assert.equal(job.supersededDraft.ownAnswers[0],0);
});

test('an already-completed server round recovers the authoritative result after a lost or competing delivery',async()=>{
  const remote={id,gameId:game.id,questions:game.questions,completedAt:'2026-10-12',ownAnswers:Array(6).fill(1),guesses:Array(6).fill(1),
    partnerOwnCount:6,partnerGuessCount:6,partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(0),notifyReady:false,result:{mine:0,partner:0,outcome:'tie'}};
  const h=harness({remote,submit:()=>{throw Error('already_done');}});let s=h.fill(h.api.createLocalGame(game));h.fill(s,'guess');await h.api.resumeLocalGames();
  const job=h.api.readLocalGame(s.id,scope);assert.equal(job.confirmed,true);assert.equal(job.session.result.outcome,'tie');assert.equal(job.supersededDraft.guesses[0],0);
});
