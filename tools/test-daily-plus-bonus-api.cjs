const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred}=require('./lifecycle-test-utils.cjs');
const json=(body,options)=>({body,status:options?.status??200,headers:options?.headers});
test('claim route authenticates the actor, validates real calendar dates and never accepts a client reward amount',async()=>{
  const calls=[];let user='me';
  const {POST}=load('apps/api/src/app/api/vnext/command/route.js',{'@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
    'next/server':{NextResponse:{json}},'@/lib/burrow-reward-wallet.mjs':{},
    '@/lib/app-major-update':{authenticatedUserId:async()=>user,majorUpdateEnabled:async()=>true,commandStatus:error=>error?403:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{applied:true,reward:50}};}})},
  });
  const request=body=>({text:async()=>JSON.stringify(body)});
  user=null;assert.equal((await POST(request({action:'claim_daily_plus_bonus',localDate:'2026-10-12'}))).status,401);assert.equal(calls.length,0);user='me';
  for(const localDate of [undefined,'2026-02-30','2026-13-12','garbage','2026-1-1']) assert.equal((await POST(request({action:'claim_daily_plus_bonus',localDate}))).status,400);
  const result=await POST(request({action:'claim_daily_plus_bonus',localDate:'2026-10-12',userId:'someone-else',amount:99999}));
  assert.equal(result.body.reward,50);assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{name:'claim_daily_plus_bonus_v1',args:{p_user_id:'me',p_local_date:'2026-10-12'}});
});
test('daily claim delegates to the shared optimistic outbox without a second local ledger; stale-account receipts are rejected',async()=>{
  let epoch=1,response;const calls=[],mutations=[],operations=[];
  const {claimDailyPlusBonus}=load('apps/mobile/src/lib/app-major-update-api.ts',{
    ...require('./rating-test-mocks.cjs'),
    'expo-crypto':{},'./api':{apiClient:{post:async(...args)=>{calls.push(args);return typeof response==='function'?response():response;}}},
    './async-lifecycle':{withDeadline:promise=>promise},'./session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity(){}},
    './coin-reward-store':{commandCoinReward:()=>mutations.push('begin'),settleCoinReward:()=>mutations.push('settle'),failCoinReward:()=>mutations.push('fail')},
    './coin-command-outbox':{submitCoinOperation:async operation=>{operations.push(operation);calls.push([operation.path,operation.payload]);return typeof response==='function'?response():response;}},
  });
  response={dailyPlusBonus:{claimed:true,key:'plus-login:2026-10-12',localDate:'2026-10-12'},coinState:{wallet:{balance:1290,version:2}}};
  assert.equal((await claimDailyPlusBonus('2026-10-12')).coinState.wallet.balance,1290);assert.equal(mutations.length,0);
  assert.equal(operations[0].amount,50);assert.equal(operations[0].key,'plus-login:2026-10-12');assert.equal(operations[0].deferred,false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['/api/vnext/command',{action:'claim_daily_plus_bonus',localDate:'2026-10-12'}]);
  const pending=deferred();response=()=>pending.promise;const request=claimDailyPlusBonus('2026-10-12');epoch++;
  pending.resolve({dailyPlusBonus:{claimed:true},coinState:{wallet:{balance:1290}}});await assert.rejects(request,/session_changed/);
  response={dailyPlusBonus:{claimed:true,key:'plus-login:2026-10-11',localDate:'2026-10-11'},coinState:{wallet:{balance:1290}}};
  await assert.rejects(claimDailyPlusBonus('2026-10-12'),/bonus_receipt_missing/);
});
test('bootstrap delivers pending daily status and fails closed while the migration is unavailable',async()=>{
  let missing=false;const calls=[];
  const snapshot={profile:{id:'me'},partner:null,wallet:{balance:1240,version:1}};
  const chain={select(){return this;},eq(){return this;},contains(){return this;},order(){return this;},limit:async()=>({data:[]})};
  const db={from:()=>chain,rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='burrow_bootstrap_v1')return {data:snapshot};
    if(name==='daily_plus_bonus_state_v1')return missing?{error:{code:'PGRST202'}}:{data:{eligible:true,claimed:false,amount:50,localDate:'2026-10-12',key:'plus-login:2026-10-12'}};
    return {data:{enabled:true}};
  }};
  const {GET}=load('apps/api/src/app/api/vnext/bootstrap/route.js',{
    '@/lib/burrow-friend-visits.mjs':load('apps/api/src/lib/burrow-friend-visits.mjs'),
    'next/server':{NextResponse:{json}},'@/lib/app-major-update':{authenticatedUserId:async()=> 'me',appMajorUpdateServiceClient:()=>db,commandStatus:()=>200},
    '@/lib/burrow-unpaired-bootstrap.mjs':{},'@/lib/adventure-bootstrap.mjs':{settleBootstrapAdventure:async(_db,_id,snapshot)=>snapshot},
    '@/lib/burrow-attention.mjs':{readBurrowAttention:async()=>null},'@/lib/burrow-reward-wallet.mjs':{readRewardWallet:async()=>null},
  });
  assert.equal((await GET({})).body.dailyPlusBonus.claimed,false);
  missing=true;const fallback=await GET({});assert.equal(fallback.status,200);assert.equal(fallback.body.dailyPlusBonus,undefined);
  assert.ok(calls.every(([,args])=>(args.p_user_id??args.p_user)==='me'));
  snapshot.friendVisitsVersion=2;snapshot.coupleFriendVisit={version:2,id:'visit',myCompleted:false};
  const legacy=await GET({});assert.equal(legacy.body.friendVisit,null);assert.equal(legacy.body.coupleFriendVisit,undefined);
  const current=await GET({nextUrl:{searchParams:{get:key=>key==='friendVisits'?'2':null}}});
  assert.equal(current.body.friendVisit.id,'visit');assert.equal(current.body.friendVisitsVersion,2);
});
