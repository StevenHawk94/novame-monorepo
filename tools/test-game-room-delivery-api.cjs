const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const catalog=require('../apps/api/src/data/burrow-game-room-v1.json');
const scoring=load('apps/api/src/lib/burrow-game-room.mjs');
const id='11111111-1111-4111-8111-111111111111',game=catalog.games[0];
function routeHarness({ready=false,readyError=null}={}){
  const calls=[],afterJobs=[];
  let state={id,gameId:game.id,questions:game.questions,completedAt:null,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),
    partnerOwnCount:0,partnerGuessCount:0,partnerOwnAnswers:null,partnerGuesses:null,result:null};
  const route=load('apps/api/src/app/api/vnext/game-room/route.js',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options.status})},after:fn=>afterJobs.push(fn)},'@/data/burrow-game-room-v1.json':catalog,
    '@/lib/push-notifications':{drainPushNotificationOutbox:async()=>{}},
    '@/lib/burrow-game-room.mjs':scoring,'@/lib/burrow-game-history.mjs':{},
    '@/lib/app-major-update':{authenticatedUserId:async()=> 'a',majorUpdateEnabled:async()=>true,commandStatus:error=>error?400:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});
        if(name==='burrow_game_submit_ready_v1')return readyError?{error:readyError}:{data:ready?{error:null,session:state}:{error:'game_content_update_required'}};
        return {data:name==='burrow_game_state_v1'?state:{error:null},error:null};}})},
  },{URL});
  return {calls,afterJobs,setState:value=>state={...state,...value},post:body=>route.POST({text:async()=>JSON.stringify(body)})};
}
const batch={action:'submit',sessionId:id,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),content:'local',catalogVersion:1};
test('manual Nudge is a separate authenticated command; it cannot submit answers or change notification preferences',async()=>{
 const h=routeHarness();assert.equal((await h.post({action:'nudge',sessionId:id})).status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{name:'burrow_game_nudge_v1',args:{p_user_id:'a',p_session_id:id}}]);
 assert.equal(h.afterJobs.length,1);
 const invalid=routeHarness();assert.equal((await invalid.post({action:'nudge',sessionId:'local:fake'})).status,400);
 assert.equal(invalid.calls.length,0);
});
test('unlock API forwards a displayed zero quote exactly and rejects malformed or negative quotes',async()=>{
 const h=routeHarness(),body={action:'unlock',gameId:game.id,key:id,expectedPrice:0};
 assert.equal((await h.post(body)).status,200);
 assert.equal(h.calls[0].name,'burrow_game_unlock_v2');assert.equal(h.calls[0].args.p_expected_price,0);
 for(const expectedPrice of [-1,.5,'0',1000001])assert.equal((await h.post({...body,expectedPrice})).status,400);
 assert.equal(h.calls.length,1);
});
test('new clients receive a complete second-responder result with one database RPC and server-owned canonical questions',async()=>{
 const h=routeHarness({ready:true});h.setState({completedAt:'2026-10-19',partnerOwnCount:6,partnerGuessCount:6,
  partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1)});
 const result=await h.post({...batch,gameId:game.id});assert.equal(result.status,200);
 assert.equal(result.body.session.result.mine,6);assert.equal(result.body.session.result.partner,0);
 assert.equal(result.body.session.questions,undefined);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,'burrow_game_submit_ready_v1');assert.deepEqual(h.calls[0].args.p_questions,game.questions);
 assert.equal(h.afterJobs.length,1);
});
test('rolling deployment fallback only permits a missing RPC, never permission/network/write errors',async()=>{
 for(const code of ['PGRST202','42883']){const h=routeHarness({readyError:{code}});
  assert.equal((await h.post({...batch,gameId:game.id})).status,200);assert.equal(h.calls.length,4);}
 for(const code of ['42501','ECONNRESET']){const h=routeHarness({readyError:{code}});
  assert.equal((await h.post({...batch,gameId:game.id})).status,500);assert.equal(h.calls.length,1);assert.equal(h.afterJobs.length,0);}
 const h=routeHarness(),conflict=await h.post({...batch,gameId:game.id});
 assert.equal(conflict.body.error,'game_content_update_required');assert.equal(conflict.status,409);
 assert.equal(h.calls.length,1);assert.equal(h.afterJobs.length,0);
});
test('batch API validates the complete payload before invoking any mutation',async()=>{
  for(const patch of [{sessionId:'wrong'},{ownAnswers:[0]},{guesses:[0,0,0,0,0,4]},{guesses:[0,0,0,0,0,.5]},{guesses:[0,0,0,0,0,'0']},{catalogVersion:99}]){
    const h=routeHarness(),result=await h.post({...batch,...patch});assert.ok(result.status>=400);assert.equal(h.calls.length,0);assert.equal(h.afterJobs.length,0);
  }
});
test('catalogue mismatch cannot commit locally interpreted answers',async()=>{
  const h=routeHarness();h.setState({questions:game.questions.map(q=>({...q,options:[...q.options].reverse()}))});
  assert.equal((await h.post(batch)).body.error,'game_content_update_required');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'burrow_game_state_v1');
});
test('one atomic batch receipt remains sealed until both finish, then returns real results without a second mobile HTTP request',async()=>{
  const h=routeHarness();let result=await h.post(batch);assert.equal(result.status,200);assert.equal(result.body.session.result,null);
  assert.equal(result.body.session.questions,undefined);assert.deepEqual(h.calls.map(c=>c.name),['burrow_game_state_v1','burrow_game_submit_v1','burrow_game_state_v1']);
  const call=h.calls.find(c=>c.name==='burrow_game_submit_v1');assert.equal(call.args.p_user_id,'a');assert.equal(call.args.p_own_answers.length,6);
  assert.equal(h.afterJobs.length,1); // delivery begins after response, never per answer
  h.setState({completedAt:'2026-10-12',partnerOwnCount:6,partnerGuessCount:6,partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1)});
  result=await h.post(batch);assert.equal(result.body.session.result.mine,6);assert.equal(result.body.session.result.partner,0);assert.equal(result.body.session.result.outcome,'win');
});

for(const [type,nudge,eligible] of [['game_invite',false,true],['game_ready',false,true],['game_invite',true,true],['game_invite',true,false]])test(type+(nudge?' manual nudge eligible='+eligible:'')+' notification validates readiness and deep-links to the saved game',async()=>{
  const sent=[],updates=[];
  const row={id:'row',recipient_user_id:'b',event_type:type,event_key:'event',payload:{sessionId:id,...(nudge?{nudge:true}:{})},attempts:0};
  const db={rpc:async name=>({data:name==='burrow_game_nudge_eligible_v1'?eligible:{allowed:true,partnerName:'Alex'}}),from:table=>{
    let update;
    const q={select(){return q;},in(){return q;},eq(){return q;},lt(){return q;},lte(){return q;},not(){return q;},order(){return q;},limit(){return q;},
      update(value){update=value;updates.push(value);return q;},maybeSingle:async()=>({data:{id:'row'}}),
      then(resolve,reject){return Promise.resolve({data:table==='device_push_tokens'?[{id:'token',expo_push_token:'ExponentPushToken[TEST]',platform:'ios'}]:update?[]:[row],error:null}).then(resolve,reject);}};
    return q;
  }};
  const push=load('apps/api/src/lib/push-notifications.js',{'./app-major-update':{majorUpdateEnabled:async()=>true}},
    {process:{env:{}},fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({data:[{status:'ok'}]})};}});
  const result=await push.drainPushNotificationOutbox(db);
  if(!eligible){assert.equal(result.sent,0);assert.equal(sent.length,0);assert.ok(updates.some(u=>u.last_error==='notification_no_longer_eligible'));return;}
  assert.equal(result.sent,1);assert.equal(sent.length,1);
  assert.equal(sent[0][0].title,'Game Room');assert.equal(sent[0][0].data.type,type);assert.equal(sent[0][0].data.sessionId,id);assert.equal(sent[0][0].data.route,'game_room');
  assert.match(sent[0][0].body,type==='game_invite'?/your turn to play/:/results are ready/);assert.ok(updates.some(u=>u.status==='sent'));
});
