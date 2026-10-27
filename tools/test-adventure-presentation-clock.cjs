const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
const {createAdventurePresentationClock}=load('apps/mobile/src/lib/adventure-presentation-clock.ts');
const base=Date.parse('2026-10-20T00:00:00Z'),iso=ms=>new Date(base+ms).toISOString();
const input=(elapsed,patch={})=>({identity:'me:partner:pair:job',adventureId:'pending:job',pending:true,
 startedAt:iso(0),endsAt:iso(60000),now:base+elapsed,clockNow:10000+elapsed,...patch});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const team=(duration,patch={})=>({id:'team',version:1,ruleVersion:5,leaderId:'me',followerId:null,partnerId:'partner',pairVersion:'pair',plus:duration===10800000,
 startedAt:iso(0),progressAt:iso(0),progressFraction:0,endsAt:iso(duration),nudged:false,leaderVariant:'biscuit',followerVariant:'pinky',...patch});
test('confirmed Free/Plus team never shows 6h/3h plus stale clock seconds and starts ticking immediately',()=>{
 const {adventureCountdown}=load('apps/mobile/src/lib/adventure-screen-layout.ts');
 for(const duration of [21600000,10800000]){
  const c=createAdventurePresentationClock(),t=team(duration);
  for(let elapsed=0;elapsed<=8000;elapsed+=1000){
   const s=c.read(input(elapsed,{pending:false,adventureId:'real',startedAt:iso(-3000),endsAt:iso(duration),now:base-3000+elapsed,team:t}));
   assert.equal(s.remaining,duration-elapsed);assert.equal(adventureCountdown(s.remaining),adventureCountdown(duration-elapsed));
  }
 }
});
test('pending to confirmed team uses the same monotonic correction and never adds seconds or rewinds',()=>{
 const c=createAdventurePresentationClock(),duration=21600000;
 c.read(input(0,{endsAt:iso(duration)}));const pending=c.read(input(5000,{endsAt:iso(duration)}));
 const t=team(duration,{startedAt:iso(8000),progressAt:iso(8000),endsAt:iso(duration+8000)});
 let previous=pending;
 for(let elapsed=5000;elapsed<15000;elapsed+=1000){
  const s=c.read(input(elapsed,{pending:false,adventureId:'real',startedAt:iso(8000),endsAt:t.endsAt,team:t}));
  assert.ok(s.remaining<=previous.remaining);assert.ok(s.progress>=previous.progress);assert.equal(s.lifetime,pending.lifetime);previous=s;
 }
});
test('optimistic clock moves immediately through slow prepare, finalize and start requests without a server receipt',()=>{
 const c=createAdventurePresentationClock();
 for(const elapsed of [0,100,1000,5000,10000,17000]){
  const s=c.read(input(elapsed));near(s.progress,elapsed/60000);assert.equal(s.remaining,60000-elapsed);
  near(s.motion.target,59/60);assert.equal(s.motion.duration,59000-elapsed);assert.equal(s.timeline,'1:0');
 }
});
test('pending remount seeks durable intent time; prolonged offline display never reaches zero or reports completion',()=>{
 const c=createAdventurePresentationClock();const s=c.read(input(17000));near(s.progress,17/60);assert.equal(s.remaining,43000);
 const late=c.read(input(300000));assert.equal(late.remaining,1000);near(late.progress,59/60);assert.equal(late.motion.duration,0);
});
test('a backwards server-clock correction just before entry cannot create a new optimistic pre-start pause',()=>{
 const c=createAdventurePresentationClock();assert.equal(c.read(input(0,{now:base-15000})).remaining,60000);
 const s=c.read(input(1000,{now:base-14000}));assert.equal(s.remaining,59000);near(s.progress,1/60);
});
test('late start confirmation corrects quietly, reaches the real deadline and does not restart correction each tick',()=>{
 const c=createAdventurePresentationClock();c.read(input(0));c.read(input(17000));
 const confirmed={adventureId:'real',pending:false,startedAt:iso(17000),endsAt:iso(77000)};
 let s=c.read(input(17000,confirmed));near(s.progress,17/60);assert.equal(s.remaining,43000);
 assert.equal(s.motion.duration,34000);assert.equal(s.motion.afterwards,26000);const revision=s.timeline;
 for(let ms=18000;ms<=51000;ms+=1000){
  const next=c.read(input(ms,confirmed));assert.ok(next.progress>=s.progress);assert.ok(next.remaining<=s.remaining);
  assert.equal(next.timeline,revision,'known correction error must not retrigger timing each second');s=next;
 }
 assert.equal(s.remaining,26000);near(s.progress,34/60);
 assert.equal(c.read(input(60000,confirmed)).remaining,17000);
 assert.equal(c.read(input(77000,confirmed)).remaining,0);
});
test('receipt and full display can arrive separately; alias IDs never create another animation lifetime',()=>{
 const c=createAdventurePresentationClock(),a=c.read(input(0));
 const b=c.read(input(5000,{adventureId:'pending:record'}));assert.equal(b.lifetime,a.lifetime);
 const receipt=c.read(input(17000,{adventureId:'real',pending:false,endsAt:iso(77000)}));
 const display=c.read(input(18000,{adventureId:'real',pending:false,startedAt:iso(17000),endsAt:iso(77000)}));
 assert.equal(receipt.lifetime,a.lifetime);assert.equal(display.lifetime,a.lifetime);
 assert.ok(display.remaining<=receipt.remaining);assert.ok(display.progress>=receipt.progress);
});
test('server clock offset corrections and shortened deadlines converge without reversing path or countdown',()=>{
 const c=createAdventurePresentationClock();c.read(input(0,{pending:false,adventureId:'real'}));
 let s=c.read(input(10000,{pending:false,adventureId:'real'}));
 const correction={pending:false,adventureId:'real',now:base+12000};
 s=c.read(input(10000,correction));assert.equal(s.remaining,50000);
 const r=c.read(input(14000,{...correction,now:base+16000}));assert.equal(r.remaining,44000);
 assert.ok(r.progress>s.progress);
 const shortened=c.read(input(15000,{pending:false,adventureId:'real',endsAt:iso(40000),now:base+17000}));
 assert.ok(shortened.remaining<=r.remaining);assert.ok(shortened.progress>=r.progress);
 assert.equal(c.read(input(38000,{pending:false,adventureId:'real',endsAt:iso(40000),now:base+40000})).remaining,0);
});
test('different owner, pair, intent or actual new journey resets only that display lifetime',()=>{
 for(const change of [{identity:'other:partner:pair:job'},{identity:'me:other:pair2:job'},{identity:'me:partner:pair:nextjob'},{adventureId:'another'}]){
  const c=createAdventurePresentationClock(),old=c.read(input(30000,{pending:false,adventureId:'real'}));
  const next=c.read(input(0,{pending:false,adventureId:'real',...change}));
  assert.notEqual(next.lifetime,old.lifetime);assert.equal(next.progress,0);assert.equal(next.remaining,60000);
 }
});
test('presentation is independent of server state and never mutates dates, status or reward data',()=>{
 const c=createAdventurePresentationClock(),i=input(17000),before=JSON.stringify(i);c.read(i);assert.equal(JSON.stringify(i),before);
 const a=load('apps/mobile/src/lib/adventure-arrival.ts');
 const p=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}});
 for(const journey of [{id:'pending:job'},{id:'real',localStartPending:true}]){
  const data={profile:{id:'me'},activeAdventure:{...journey,status:'in_progress',ends_at:iso(60000)},
   adventurePlan:{adventureId:journey.id,result:{metadata:{encounterV2:true}}},adventureResult:null};
  assert.equal(a.mergeAdventureArrival(null,data,base+300000),data);
  assert.equal(p.adventureHasArrived(data.activeAdventure,base+300000),false);
  assert.equal(p.adventureIsAway(data.activeAdventure,base+300000),true);
 }
});
test('eight-hour prediction starts immediately and absorbs a delayed server confirmation without changing real dates',()=>{
 const duration=8*3600000,c=createAdventurePresentationClock();
 const request=input(0,{endsAt:iso(duration)}),before=JSON.stringify(request);c.read(request);
 const s=c.read({...request,now:base+17000,clockNow:27000});assert.equal(s.remaining,duration-17000);near(s.progress,17000/duration);
 const confirmed={adventureId:'real',pending:false,startedAt:iso(17000),endsAt:iso(duration+17000)};
 const after=c.read(input(17000,confirmed));assert.equal(after.remaining,s.remaining);assert.equal(after.lifetime,s.lifetime);
 const corrected=c.read(input(51000,confirmed));assert.equal(corrected.remaining,duration-34000);
 assert.equal(JSON.stringify(request),before);
});
test('pending expiry never calls server settlement; confirmed receipt alone schedules the actual deadline',()=>{
 const h=hooks(),time=clock(),calls=[];
 let value={receivedAt:10000,data:{profile:{id:'me'},serverNow:iso(0),
  activeAdventure:{id:'real',status:'in_progress',started_at:iso(0),ends_at:iso(60000),localStartPending:true},adventurePlan:{adventureId:'real'}}};
 const {AdventureArrivalGate}=load('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
  '@/lib/burrow-store':{useBurrowSnapshot:()=>value,burrowClock:()=>time.globals.Date.now(),cacheAdventureDisplay(){},
   refreshBurrowAfterCurrent:async()=>{},projectBurrowAdventureArrival:id=>calls.push(['arrive',id])},
  '@/lib/app-major-update-api':{fetchAdventureDisplay(){throw Error('already prepared');},settleAdventure:id=>{calls.push(['settle',id]);return Promise.resolve();}},
  '@/lib/adventure-prefetch':{warmAdventureCompletion:async()=>{}},
  '@/lib/adventure-journal-jobs':{pauseAdventureJournalJobs(){},resumeAdventureJournalJobs(){},restoreAdventureJournalProjection(){}},
  '@/lib/adventure-delivery':{pauseAdventureDelivery(){},resumeAdventureDelivery(){}},'@/lib/session-lifecycle':{sessionEpoch:()=>1},
 },time.globals);
 h.render(AdventureArrivalGate);time.advance(120000);assert.equal(calls.length,0);
 value={...value,data:{...value.data,activeAdventure:{...value.data.activeAdventure,ends_at:iso(180000),localStartPending:undefined}}};
 h.render(AdventureArrivalGate);time.advance(59999);assert.equal(calls.length,0);time.advance(1);
 assert.equal(JSON.stringify(calls),JSON.stringify([['arrive','real'],['settle','real']]));h.unmount();
});
