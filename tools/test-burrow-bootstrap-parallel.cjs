const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
function harness({failures=new Set(),hangs=new Set(),globals={}}={}){
  const care=deferred(),calls=[];let auth='me',careError=false;
  const snapshot={profile:{id:'me',timezone_name:'America/Los_Angeles'},economicTimezone:'UTC',partner:null,localDate:'2026-10-15',wallet:{balance:1}};
  const db={rpc:async(name)=>{
    calls.push(name);
    if(hangs.has(name))return new Promise(()=>{});
    if(failures.has(name))return {error:Error('read failed: '+name)};
    if(name==='burrow_bootstrap_v1'||name==='burrow_bootstrap_v2')return {data:snapshot};
    if(name==='daily_plus_bonus_state_v1')return {data:{eligible:true}};
    if(name==='adventure_collection_v2')return {data:{enabled:true,progress:[]}};
    if(name==='burrow_photo_usage_v1')return {data:{frame:{used:0}}};
    throw Error(name);
  },from:table=>{
    assert.equal(table,'moment_events');let need;
    const q={select:()=>q,eq:()=>q,contains:(_key,value)=>{need=value.need;return q;},order:()=>q,limit:async()=>{
      calls.push(`care:${need}`);await care.promise;return careError?{error:Error('care read failed')}:{data:[{created_at:`${need}-time`}]};
    }};return q;
  }};
  const route=load('apps/api/src/app/api/vnext/bootstrap/route.js',{
    'next/server':{NextResponse:{json:(body,options={})=>({body,...options})}},
    '@/lib/app-major-update':{authenticatedUserId:async()=>auth,appMajorUpdateServiceClient:()=>db,commandStatus:error=>error?400:200},
    '@/lib/burrow-unpaired-bootstrap.mjs':{unpairedBurrowBootstrap:async()=>{throw Error('unexpected fallback');}},
    '@/lib/burrow-reward-wallet.mjs':{readRewardWallet:async()=>{calls.push('wallet');if(failures.has('wallet'))throw Error('wallet supplement failed');return {wallet:{balance:10,version:2}};}},
    '@/lib/burrow-attention.mjs':{readBurrowAttention:async()=>{calls.push('attention');if(failures.has('attention'))throw Error('attention failed');return {moments:[]};}},
    '@/lib/adventure-bootstrap.mjs':{settleBootstrapAdventure:async(_db,_id,data)=>data},
    '@/lib/burrow-friend-visits.mjs':{projectFriendVisitBootstrap:data=>data},
    '@/lib/economic-calendar-contract.mjs':load('apps/api/src/lib/economic-calendar-contract.mjs'),
  },{console:{error(){}},...globals});
  return {route,care,calls,snapshot,setAuth:v=>auth=v,setCareError:v=>careError=v};
}
test('bootstrap starts all independent reads before care completes, then returns one atomic model',async()=>{
  const h=harness(),read=h.route.GET({});await flush();
  for(const expected of ['daily_plus_bonus_state_v1','adventure_collection_v2','wallet','burrow_photo_usage_v1','care:food','care:water','attention'])assert.ok(h.calls.includes(expected),expected);
  let completed=false;read.then(()=>completed=true);await flush();assert.equal(completed,false,'no partial bootstrap response');
  h.care.resolve();const response=await read;assert.equal(response.status,200);assert.equal(response.body.success,true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.lastCareAt)),{food:'food-time',water:'water-time'});
  assert.equal(response.body.wallet.balance,10);assert.equal(response.body.adventureCollection.enabled,true);assert.equal(response.body.dailyPlusBonus.eligible,true);
  assert.equal(response.headers['Cache-Control'],'no-store');
});
test('capable startup explicitly selects the personal DTO; legacy startup remains unchanged',async()=>{
 const h=harness();h.care.resolve();const response=await h.route.GET({headers:{get:name=>name==='x-burrow-rooms'?'personal-v2':null}});
 assert.equal(h.calls[0],'burrow_bootstrap_v2');assert.equal(response.body.roomModel,'personal-v2');
 const old=harness();old.care.resolve();const legacy=await old.route.GET({});assert.equal(old.calls[0],'burrow_bootstrap_v1');assert.equal(legacy.body.roomModel,undefined);
});
test('failed optional care leaves the authoritative core usable without inventing cooldowns',async()=>{
  const h=harness();h.setCareError(true);h.care.resolve();const response=await h.route.GET({});assert.equal(response.status,200);
  assert.equal(response.body.lastCareAt,undefined);assert.equal(response.body.wallet.balance,10);
  assert.equal(response.body.success,true);assert.equal(response.body.dailyPlusBonus.eligible,true);
});
for(const name of ['daily_plus_bonus_state_v1','adventure_collection_v2','burrow_photo_usage_v1'])test(name+' failure does not fail Home or grant defaults',async()=>{
 const h=harness({failures:new Set([name])});h.care.resolve();const response=await h.route.GET({});
 assert.equal(response.status,200);assert.equal(response.body.profile.id,'me');
 const field={daily_plus_bonus_state_v1:'dailyPlusBonus',adventure_collection_v2:'adventureCollection',burrow_photo_usage_v1:'photoUsage'}[name];
 assert.equal(response.body[field],undefined);assert.equal(h.snapshot[field],undefined,'read does not mutate core object');
});
test('an unresponsive supplementary transport is bounded and late completion cannot mutate returned state',async()=>{
 const time=clock(),h=harness({globals:time.globals,hangs:new Set(['adventure_collection_v2'])});
 const read=h.route.GET({});await flush();let done=false;read.then(()=>done=true);
 time.advance(1199);await flush();assert.equal(done,false);
 time.advance(1);const response=await read;assert.equal(response.status,200);assert.equal(response.body.lastCareAt,undefined);
 assert.equal(response.body.adventureCollection,undefined);assert.equal(response.body.wallet.balance,10);
 h.care.resolve();await flush();assert.equal(response.body.lastCareAt,undefined);assert.equal(time.timers.size,0);
});
test('core failure still fails closed instead of inventing an authorized room',async()=>{
 const h=harness({failures:new Set(['burrow_bootstrap_v1'])});const response=await h.route.GET({});
 assert.equal(response.status,500);assert.deepEqual(h.calls,['burrow_bootstrap_v1']);assert.equal(response.body.success,undefined);
});
test('credit metadata failure preserves the authoritative core wallet; attention failure is independent',async()=>{
 const h=harness({failures:new Set(['wallet','attention'])});h.care.resolve();const response=await h.route.GET({});
 assert.equal(response.status,200);assert.equal(response.body.wallet.balance,1);
 assert.equal(response.body.coinState,undefined);assert.equal(response.body.attention,undefined);
 assert.equal(response.body.dailyPlusBonus.eligible,true);
});
test('authentication still precedes every bootstrap/database read',async()=>{
  const h=harness();h.setAuth(null);assert.equal((await h.route.GET({})).status,401);assert.deepEqual(h.calls,[]);
});
test('Home runs beside the production database and timing diagnostics expose no identity or content',async()=>{
 const h=harness();assert.equal(h.route.runtime,'nodejs');assert.equal(h.route.preferredRegion,'pdx1');
 h.care.resolve();const response=await h.route.GET({});
 assert.match(response.headers['Server-Timing'],/core;dur=\d+/);
 assert.match(response.headers['Server-Timing'],/app;dur=\d+/);
 assert.match(response.headers['Server-Timing'],/invocation;desc="first"/);
 assert.doesNotMatch(response.headers['Server-Timing'],/profile|partner|Bearer|userId|wallet|balance/);
 assert.match((await h.route.GET({})).headers['Server-Timing'],/invocation;desc="warm"/);
 const config=JSON.parse(require('node:fs').readFileSync('apps/api/vercel.json','utf8'));
 assert.deepEqual(config.functions['src/app/api/vnext/bootstrap/route.js'].regions,['pdx1']);
});
