const{test}=require('node:test'),assert=require('node:assert/strict');
const{load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const domain=load('packages/domain/src/room-care.ts');
function runtime(disk=new Map(),broken=false){
 const time=clock(),calls=[],requests=[],facts=[],tickets=[],identityListeners=[];let owner='me',pending;
 const data={profile:{id:'me'},partner:{id:'partner'},pairVersion:'pair',localDate:'2026-10-28'};
 const identity={sessionUserId:()=>owner,sessionEpoch:()=>1,subscribeSessionIdentity:fn=>identityListeners.push(fn)};
 const rewards=load('apps/mobile/src/lib/coin-reward-store.ts',{react:{useSyncExternalStore:()=>{}},'./session-lifecycle':identity,
  './coin-reward-ledger':load('apps/mobile/src/lib/coin-reward-ledger.ts'),'./burrow-motion':require('./motion-test-utils.cjs').model},time.globals);
 const outbox=load('apps/mobile/src/lib/coin-command-outbox.ts',{
  'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  './api':{apiClient:{post:(path,payload)=>{calls.push(JSON.parse(JSON.stringify(payload)));const d=deferred();requests.push(d);return d.promise;}}},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>{if(broken)throw Error('disk full');disk.set(k,v);}}},
  '../shared/storage/keys':{kCoinOperations:{name:'garden'}},'./session-lifecycle':identity,'./async-lifecycle':{withDeadline:p=>p},
  './burrow-care-cooldown':{configureCarePending:reader=>pending=reader},
  './quest-progress-store':{currentQuestData:()=>data,captureQuestFact:questId=>({scope:'me:partner:pair',day:data.localDate,questId}),
   questProgress:{fact:(...args)=>facts.push(args),rejectPendingFact:(...args)=>facts.push([...args,'rejected'])},subscribeQuestProgress:()=>()=>{}},
  './coin-reward-store':{commandCoinRewardPlan:rewards.commandCoinRewardPlan,coinRewardDefinitelyRejected:rewards.coinRewardDefinitelyRejected,
   beginCoinReward:(...args)=>{tickets.push(args);return args[0];},settleCoinReward(){},failCoinReward(){}},
 },time.globals);
 return{...outbox,data,disk,calls,requests,facts,tickets,time,isPending:(owner,kind)=>pending(data,owner,kind),
  switchAccount(){owner='other';identityListeners.forEach(fn=>fn());}};
}
const payload=(kind,key)=>({actorId:'me',ownerId:domain.roomCareIsOwn(kind)?'me':'partner',careAction:kind,partnerId:'partner',pairVersion:'pair',localDate:'2026-10-28',idempotencyKey:key});
test('all four care intents persist before immediate reward; only owner carrot/water project quest facts',()=>{
 const h=runtime();for(const kind of domain.ROOM_CARE_ACTIONS){h.enqueueRoomCareCommand(payload(kind,kind));assert.equal(h.isPending(domain.roomCareIsOwn(kind)?'me':'partner',kind),true);}
 assert.equal(JSON.parse(h.disk.get('garden')).length,4);assert.equal(h.tickets.length,4);assert.ok(h.tickets.every(t=>t[2]===5));
 assert.deepEqual(h.facts.map(f=>f[1].questId),['feed_partner_bunny','water_partner_flower']);
 assert.equal(h.isPending('partner','carrot'),false);h.data.pairVersion='new';assert.equal(h.isPending('partner','leaf'),false);
});
test('local persistence failure cannot send or project coins/quests/success',()=>{
 const h=runtime(new Map(),true);assert.throws(()=>h.enqueueRoomCareCommand(payload('carrot','full-disk')),/intent_not_saved/);
 assert.equal(h.calls.length,0);assert.equal(h.tickets.length,0);assert.equal(h.facts.length,0);assert.equal(h.coinOperations.pending().length,0);
});
test('ambiguous failure survives relaunch and replays the exact original identity/relationship/day/key, silently',async()=>{
 const h=runtime(),p=payload('leaf','original');h.enqueueRoomCareCommand(p);await flush();h.requests[0].reject(Error('timeout'));await flush();
 assert.equal(h.coinOperations.pending().length,1);const restarted=runtime(h.disk);restarted.coinOperations.resume();await flush();
 assert.deepEqual(restarted.calls,[{action:'complete_room_care_v2',...p}]);assert.equal(restarted.tickets[0][4],true,'relaunch projection is quiet');
 restarted.requests[0].resolve({success:true,reward:5,completedAt:'2026-10-28T10:00:00Z'});await flush();assert.equal(restarted.coinOperations.pending().length,0);
});
test('definitive refusal releases only that pending action; switching accounts fences a late receipt',async()=>{
 const h=runtime();h.enqueueRoomCareCommand(payload('leaf','denied'));await flush();h.requests[0].reject(Error('care_cooldown'));await flush();
 assert.equal(h.isPending('partner','leaf'),false);assert.equal(h.coinOperations.pending().length,0);
 h.enqueueRoomCareCommand(payload('carrot','late'));await flush();const before=h.facts.length;h.switchAccount();h.requests[1].resolve({success:true,reward:5});await flush();
 assert.equal(h.facts.length,before);assert.equal(h.coinOperations.pending().length,0);
});
test('relaunching a legacy helper intent preserves its exact wire payload but never revives the retired helper quest projection',async()=>{
 const legacy={id:'legacy-care',owner:'me',path:'/api/vnext/command',payload:{action:'refill_room_need',ownerId:'partner',need:'food',idempotencyKey:'original-legacy'},
  key:'room-need-reward:food:2026-10-28',amount:5,deferred:false,quest:{scope:'me:partner:pair',day:'2026-10-28',questId:'feed_partner_bunny'}};
 const h=runtime(new Map([['garden',JSON.stringify([legacy])]]));h.coinOperations.resume();await flush();
 assert.deepEqual(h.calls,[legacy.payload]);assert.equal(h.facts[0][2],'rejected');
 h.requests[0].resolve({success:true,reward:5});await flush();assert.equal(h.coinOperations.pending().length,0);
 assert.ok(h.facts.every(f=>f[2]==='rejected'),'confirmed old command cannot invent owner-only quest progress');
});
test('retiring an old pending helper witness never revokes a previously confirmed pre-upgrade quest fact',()=>{
 const {createQuestProgress}=load('apps/mobile/src/lib/quest-progress-model.ts');let saved;
 const intent={scope:'me:partner:pair',day:'2026-10-28',questId:'feed_partner_bunny'};
 const progress=createQuestProgress({load:()=>({facts:[{...intent,id:'pending',status:'pending'},{...intent,id:'committed',status:'confirmed'}]}),save:v=>saved=v,changed(){}});
 progress.rejectPendingFact('pending',intent);progress.rejectPendingFact('committed',intent);
 assert.equal(saved.facts.find(f=>f.id==='pending').status,'rejected');assert.equal(saved.facts.find(f=>f.id==='committed').status,'confirmed');
});
