const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {mergeAdventureArrival:merge}=load('apps/mobile/src/lib/adventure-arrival.ts');
const t=Date.parse('2026-10-15T00:00:00Z');
const base=()=>({profile:{id:'me'},partner:{id:'you'},pairVersion:'one',wallet:{balance:0},inventory:[],discoveries:[],
 activeAdventure:{id:'a',status:'in_progress',ends_at:new Date(t+1000).toISOString()},adventureResult:null,
 adventurePlan:{adventureId:'a',version:'one',readAt:new Date(t).toISOString(),result:{id:'plan:1',claim_status:'pending',metadata:{encounterV2:true,treasureReserved:true,dialogue:{id:'intro-1'}}}}});
for(const platform of ['ios','android'])test(`${platform}: exact deadline updates the same snapshot used by Home and Adventure, with zero reward writes`,()=>{
 const data=base();assert.equal(merge(null,data,t+999),data);
 const arrived=merge(data,data,t+1000);assert.equal(arrived.activeAdventure.status,'result_ready');assert.equal(arrived.adventureResult,data.adventurePlan.result);
 assert.equal(arrived.wallet,data.wallet);assert.equal(arrived.inventory,data.inventory);assert.equal(arrived.discoveries,data.discoveries);
 const presentation=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}});
 assert.equal(presentation.adventureIsAway(arrived.activeAdventure,t+1000),false);assert.equal(presentation.adventureNeedsCompletion(arrived.activeAdventure),true);
});
test('restart after the deadline projects a cached personal plan immediately; no plan never fabricates a reward',()=>{
 const data=base();assert.equal(merge(null,data,t+10000).activeAdventure.status,'result_ready');
 delete data.adventurePlan;assert.equal(merge(null,data,t+10000).adventureResult,null);
});
test('late in-progress reads cannot reverse arrival or newer plan versions; a fresh visit-adjusted dialogue supersedes old display text',()=>{
 const initial=base(),arrived=merge(null,initial,t+1000),stale=base();delete stale.adventurePlan;
 assert.equal(merge(arrived,stale,t).activeAdventure.status,'result_ready');
 const fresh=base();fresh.adventurePlan={...fresh.adventurePlan,version:'two',readAt:new Date(t+2000).toISOString(),result:{...fresh.adventurePlan.result,metadata:{encounterV2:true,dialogue:{id:'intro-2'}}}};
 const newer=merge(arrived,fresh,t+2000);assert.equal(newer.adventureResult.metadata.dialogue.id,'intro-2');
 assert.equal(merge(newer,base(),t).adventureResult.metadata.dialogue.id,'intro-2');
});
test('real server results and confirmed treasure/dialogue progress are never replaced with preview state',()=>{
 const data=base(),arrived=merge(null,data,t+1000);
 for(const meta of [{treasureClaimed:true},{dialogueCompleted:true}]){
  const progressed={...arrived,adventureResult:{...arrived.adventureResult,metadata:{...arrived.adventureResult.metadata,...meta}}};
  assert.equal(merge(null,progressed,t+1000).adventureResult,progressed.adventureResult);
 }
 const server={...data,adventureResult:{id:'real',claim_status:'interaction_required',metadata:{encounterV2:true,treasureClaimed:true}}};
 assert.equal(merge(arrived,server,t+1000).adventureResult,server.adventureResult);
});
test('cancellation/completion/new adventure/new pair win, so no previous journey can be resurrected',()=>{
 const arrived=merge(null,base(),t+1000);
 for(const patch of [{activeAdventure:null},{activeAdventure:{...base().activeAdventure,status:'cancelled'}},
  {activeAdventure:{...base().activeAdventure,id:'b'}},{pairVersion:'two'},{partner:{id:'someone-else'}},{profile:{id:'other'}}]){
   const fresh={...base(),adventurePlan:null,...patch};const next=merge(arrived,fresh,t);
   assert.equal(next.adventureResult,null);assert.equal(next.activeAdventure?.status,fresh.activeAdventure?.status);
 }
});
for(const platform of ['ios','android'])test(`${platform}: foreground timer publishes arrival before unresolved settlement; leaving the page cannot cancel that settlement`,async()=>{
 const h=hooks(),time=clock(),settlement=deferred(),calls=[],data=base();data.serverNow=new Date(t).toISOString();
 let value={data,receivedAt:10000};
 const {AdventureArrivalGate}=load('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
  '@/lib/burrow-store':{useBurrowSnapshot:()=>value,burrowClock:()=>time.globals.Date.now(),cacheAdventureDisplay(){},
   refreshBurrowAfterCurrent:async()=>calls.push('refresh'),projectBurrowAdventureArrival:()=>{calls.push('project');value={...value,data:merge(value.data,value.data,t+time.globals.Date.now()-10000)};}},
  '@/lib/app-major-update-api':{fetchAdventureDisplay:()=>{throw Error('should already have plan');},settleAdventure:()=>{calls.push('settle');return settlement.promise;}},
  '@/lib/adventure-prefetch':{warmAdventureCompletion:async d=>calls.push(['warm',d.adventurePlan.version])},
  '@/lib/adventure-journal-jobs':{pauseAdventureJournalJobs(){},resumeAdventureJournalJobs(){},restoreAdventureJournalProjection(){}},
  '@/lib/adventure-delivery':{pauseAdventureDelivery(){},resumeAdventureDelivery(){}},'@/lib/session-lifecycle':{sessionEpoch:()=>1},
 },time.globals);
 h.render(AdventureArrivalGate);assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='warm'));
 time.advance(999);assert.equal(value.data.activeAdventure.status,'in_progress');
 time.advance(1);assert.equal(value.data.activeAdventure.status,'result_ready');assert.deepEqual(calls.slice(-2),['project','settle']);
 h.render(AdventureArrivalGate);settlement.resolve();await flush();assert.equal(calls.at(-1),'refresh');h.unmount();
});
for(const platform of ['ios','android'])test(`${platform}: missing plan recovers during the countdown; resume after deadline paints before network settlement`,async()=>{
 const h=hooks(),time=clock(),read=deferred(),settlement=deferred(),events=[],callbacks=[],data=base();data.serverNow=new Date(t).toISOString();delete data.adventurePlan;
 let value={data,receivedAt:10000},fetches=0;
 const {AdventureArrivalGate}=load('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:(_event,fn)=>{callbacks.push(fn);return{remove(){}};}}},
  '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
  '@/lib/burrow-store':{useBurrowSnapshot:()=>value,burrowClock:()=>time.globals.Date.now(),
   cacheAdventureDisplay:display=>{value={...value,data:{...value.data,adventurePlan:display.adventurePlan}};events.push('cached');},
   refreshBurrowAfterCurrent:async()=>events.push('refresh'),projectBurrowAdventureArrival:()=>{value={...value,data:merge(value.data,value.data,t+time.globals.Date.now()-10000)};}},
  '@/lib/app-major-update-api':{fetchAdventureDisplay:()=>{fetches++;return read.promise;},settleAdventure:()=>settlement.promise},
  '@/lib/adventure-prefetch':{warmAdventureCompletion:async d=>{if(d.adventurePlan)events.push('warm');}},
  '@/lib/adventure-journal-jobs':{pauseAdventureJournalJobs(){},resumeAdventureJournalJobs(){},restoreAdventureJournalProjection(){}},
  '@/lib/adventure-delivery':{pauseAdventureDelivery(){},resumeAdventureDelivery(){}},'@/lib/session-lifecycle':{sessionEpoch:()=>1},
 },time.globals);
 h.render(AdventureArrivalGate);assert.equal(fetches,1);time.advance(250);read.resolve({adventurePlan:base().adventurePlan});await flush();h.render(AdventureArrivalGate);
 assert.ok(events.includes('cached')&&events.includes('warm'));assert.equal(value.data.adventureResult,null);assert.equal(fetches,1);
 callbacks[0]('background');h.render(AdventureArrivalGate);time.advance(5000);assert.equal(value.data.activeAdventure.status,'in_progress');
 callbacks[0]('active');h.render(AdventureArrivalGate);time.advance(0);assert.equal(value.data.activeAdventure.status,'result_ready');
 assert.equal(value.data.inventory.length,0);settlement.resolve();await flush();h.unmount();
});
