const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const base=Date.parse('2026-10-26T00:00:00Z'),iso=n=>new Date(n).toISOString();
const model=load('apps/mobile/src/lib/cooperative-adventure.ts');
const team=()=>({id:'party',version:1,ruleVersion:5,leaderId:'b',followerId:null,partnerId:'a',pairVersion:'pair',plus:false,
 startedAt:iso(base-7200000),progressAt:iso(base-7200000),progressFraction:0,endsAt:iso(base+14400000),leaderVariant:'pinky',followerVariant:'biscuit'});
const state=()=>({userId:'a',partnerId:'b',pairVersion:'pair',adventureId:null,team:null,joinable:team(),nudgeAvailable:false});
function harness(){
 let now=10000,owner='a',epoch=1;const requests=[],events=[];
 let snap={receivedAt:now,data:{profile:{id:'a'},partner:{id:'b'},pairVersion:'pair',serverNow:iso(base),activeAdventure:null}};
 const api=load('apps/mobile/src/lib/adventure-team-prefetch.ts',{
  './api':{apiClient:{get:url=>{const d=deferred();requests.push({url,...d});return d.promise;}}},
  './async-lifecycle':{withDeadline:(p,ms)=>{assert.equal(ms,5000);return p;}},
  './burrow-store':{getBurrowSnapshot:()=>snap,burrowClock:()=>now},
  './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>events.push(fn)},
 });
 return{api,requests,advance:n=>now+=n,snapshot:patch=>snap={...snap,...patch},data:patch=>snap={...snap,data:{...snap.data,...patch}},
  change:()=>{owner='c';epoch++;events.forEach(fn=>fn());},reply:(i,value=state())=>requests[i].resolve({success:true,serverNow:iso(base),adventureTeam:value})};
}
test('entry is single-flight, compact read; monotonic hint advances without publishing unrelated Bootstrap data',async()=>{
 const h=harness(),one=h.api.prefetchAdventureTeam(),two=h.api.prefetchAdventureTeam();
 assert.equal(one,two);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/vnext/adventure?coordination=1');
 assert.equal(h.api.preparedAdventureTeam(),undefined);h.reply(0);await one;
 assert.equal(h.api.preparedAdventureTeam().state.joinable.id,'party');h.advance(4000);assert.equal(h.api.preparedAdventureTeam().now,base+4000);
 await h.api.prefetchAdventureTeam();assert.equal(h.requests.length,1);h.advance(12000);const next=h.api.prefetchAdventureTeam();assert.equal(h.requests.length,2);
 h.reply(1,{...state(),joinable:null});await next;assert.equal(h.api.preparedAdventureTeam().state.joinable,null,'fresh negative clears an earlier positive');
 h.advance(60001);assert.equal(h.api.preparedAdventureTeam(),undefined);
});
test('newer Bootstrap negative wins, old pair/identity replies and active trips cannot create new previews',async()=>{
 const h=harness(),request=h.api.prefetchAdventureTeam();h.reply(0);await request;
 h.advance(100);h.snapshot({receivedAt:10100});h.data({adventureTeam:{...state(),joinable:null}});
 assert.equal(h.api.preparedAdventureTeam().state.joinable,null);
 h.advance(16000);const stale=h.api.prefetchAdventureTeam();h.data({pairVersion:'new'});h.reply(1);await stale;
 assert.equal(h.api.preparedAdventureTeam(),undefined);
 const late=h.api.prefetchAdventureTeam();h.change();h.reply(2);await late;assert.equal(h.api.preparedAdventureTeam(),undefined);
 const active=harness();active.data({activeAdventure:{id:'mine'}});await active.api.prefetchAdventureTeam();assert.equal(active.requests.length,0);
});
test('network failure and malformed hints are optional, do not block Start or poison the cache',async()=>{
 const h=harness(),p=h.api.prefetchAdventureTeam();h.requests[0].reject(Error('offline'));await p;assert.equal(h.api.preparedAdventureTeam(),undefined);
 const next=h.api.prefetchAdventureTeam();h.reply(1,{...state(),userId:'other'});await next;assert.equal(h.api.preparedAdventureTeam(),undefined);
});
test('join preview inherits only remaining time/progress, checks exact identity and inclusive ten-minute cutoff',()=>{
 const scope={userId:'a',partnerId:'b',pairVersion:'pair'},s=state(),p=model.previewAdventureJoin(s,scope,base);
 assert.equal(p.followerId,'a');assert.equal(p.progressFraction,1/3);assert.equal(Date.parse(p.endsAt)-base,14400000/1.5);
 assert.equal(s.joinable.followerId,null,'cached eligibility stays immutable');
 for(const patch of [{userId:'c'},{partnerId:'c'},{pairVersion:'new'},{adventureId:'own'}])assert.equal(model.previewAdventureJoin({...s,...patch},scope,base),undefined);
 for(const patch of [{ruleVersion:4},{leaderId:'c'},{partnerId:'c'},{pairVersion:'new'},{followerId:'c'},
  {endsAt:iso(base+600000)},{endsAt:'bad'},{progressAt:'bad'},{progressAt:iso(base+1)},{progressFraction:NaN}])
  assert.equal(model.previewAdventureJoin({...s,joinable:{...s.joinable,...patch}},scope,base),undefined);
 assert.ok(model.previewAdventureJoin({...s,joinable:{...s.joinable,endsAt:iso(base+601000)}},scope,base));
});
test('pending Couple clock starts inherited progress immediately, receipt corrections keep one lifetime and nondecreasing position',()=>{
 const clock=load('apps/mobile/src/lib/adventure-presentation-clock.ts').createAdventurePresentationClock();
 const predicted=model.previewAdventureJoin(state(),{userId:'a',partnerId:'b',pairVersion:'pair'},base);
 const input={identity:'a:b:pair',adventureId:'pending:mine',pending:true,startedAt:iso(base),endsAt:predicted.endsAt,team:predicted,now:base,clockNow:0};
 const first=clock.read(input);assert.equal(first.progress,1/3);assert.equal(first.remaining,9600000);assert.ok(first.motion.target>first.progress);
 const next=clock.read({...input,now:base+1000,clockNow:1000});assert.ok(next.progress>first.progress);assert.equal(next.remaining,first.remaining-1000);
 const accepted=clock.read({...input,adventureId:'own-personal-id',pending:false,team:{...predicted,version:2},now:base+2000,clockNow:2000});
 assert.equal(accepted.lifetime,first.lifetime);assert.ok(accepted.progress>=next.progress);
});
test('only focused foreground input owns bounded refresh; blur/background/unmount release timers and listeners',()=>{
 const h=hooks(),events=new Set(),calls=[];let focused=true,scope='a:b:pair:',enabled=true;const timers=new Map();let seq=0;
 const app={currentState:'active',addEventListener:(_name,fn)=>{events.add(fn);return{remove:()=>events.delete(fn)};}};
 const hook=load('apps/mobile/src/lib/use-adventure-team-prefetch.ts',{
  react:h.react,'react-native':{AppState:app},'@react-navigation/native':{useIsFocused:()=>focused},
  './burrow-store':{useBurrowSelector:()=>scope},'./adventure-team-prefetch':{prefetchAdventureTeam:async()=>calls.push(scope)},
 },{setInterval:(fn,ms)=>{assert.equal(ms,30000);timers.set(++seq,fn);return seq;},clearInterval:id=>timers.delete(id)});
 const render=()=>h.render(()=>hook.useAdventureTeamPrefetch(enabled));render();assert.equal(calls.length,1);assert.equal(timers.size,1);
 app.currentState='background';events.forEach(fn=>fn());assert.equal(timers.size,0);
 app.currentState='active';events.forEach(fn=>fn());assert.equal(calls.length,2);
 focused=false;render();assert.equal(timers.size,0);assert.equal(events.size,0);
 focused=true;scope='a:c:new:';render();assert.equal(calls.at(-1),scope);
 enabled=false;render();assert.equal(timers.size,0);h.unmount();assert.equal(events.size,0);
 for(const file of ['apps/mobile/src/components/burrow/burrow-screen.tsx','apps/mobile/src/components/burrow/adventure-journal-screen.tsx','apps/mobile/app/(main)/reflect-guided.tsx'])
  assert.match(fs.readFileSync(file,'utf8'),/useAdventureTeamPrefetch\(/);
 const entry=fs.readFileSync('apps/mobile/src/lib/burrow-page-entry.ts','utf8');assert.ok(entry.indexOf("if(entry.kind==='adventure')void prefetchAdventureTeam()")<entry.indexOf('if (burrowPageIsReady(entry))'));
});
test('narrow API authenticates/capability-gates/rate-limits and uses same service RPC without exposing personal content',async()=>{
 let owner='a',limited=false;const calls=[];
 const route=load('apps/api/src/app/api/vnext/adventure/route.js',{
  'next/server':{NextResponse:{json:(body,options={})=>({body,...options})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>owner,appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:state()};}}),commandStatus:()=>200},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>{throw Error('must not read private display');}},
  '@/lib/security-boundary':{securityRateLimit:async()=>{if(limited)throw Object.assign(Error('rate'),{status:429});},securityFailure:()=>({status:429})},
 });
 const request=cap=>({nextUrl:{searchParams:new URLSearchParams('coordination=1')},headers:{get:key=>key==='x-burrow-adventure'&&cap?'5':null}});
 assert.equal((await route.GET(request(false))).status,426);assert.equal(calls.length,0);
 const value=await route.GET(request(true));assert.equal(value.headers['Cache-Control'],'no-store');assert.equal(value.body.adventureTeam.userId,'a');
 assert.deepEqual(Object.keys(value.body).sort(),['adventureTeam','serverNow','success']);assert.equal(calls[0][0],'adventure_team_snapshot_v1');assert.equal(calls[0][1].p_user,'a');
 limited=true;assert.equal((await route.GET(request(true))).status,429);assert.equal(calls.length,1);
 owner=null;assert.equal((await route.GET(request(true))).status,401);
});
test('closer following and wider dirt remain bounded with six slots and no per-frame bridge work',()=>{
 const p=load('apps/mobile/src/lib/adventure-digging-path.ts');assert.equal(p.DIGGING_FOLLOWER_DISTANCE,48);
 let maxX=0,minY=0;for(let i=0;i<6;i++)for(let t=0;t<=1;t+=.01){const v=p.diggingDirtParticle(t,i,1);if(v.opacity){maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);}}
 assert.ok(maxX>80&&maxX<100);assert.ok(minY< -25&&minY> -40);
 const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-digging-route.tsx','utf8');
 assert.match(source,/length:6/);assert.doesNotMatch(source,/runOnJS|setInterval|setTimeout|Skia/);
});
