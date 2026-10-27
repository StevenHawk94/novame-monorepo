const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {domain,status,A,B}=require('./release-room-test-utils.cjs');
function route(options={}){
 const calls=[],db={rpc:async(name,args)=>{calls.push({name,args});return options.result??{data:name==='release_room_status_v1'?status():{status:status(),carrotsAwarded:10,coinReward:{key:'release:key',amount:10}},error:null};}};
 const api=load('apps/api/src/app/api/vnext/release-room/route.js',{
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>options.unauthorized?null:A,appMajorUpdateServiceClient:()=>db,majorUpdateEnabled:async()=>!options.disabled},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_user,result)=>result},'@novame/domain':domain,
 });
 const post=body=>api.POST({text:async()=>typeof body==='string'?body:JSON.stringify(body)});
 return {calls,post,get:()=>api.GET({})};
}
const attempt=()=>({actorId:A,partnerId:B,pairVersion:'a'.repeat(32),monsterId:'overthinking',dialogueId:'r50',choice:3,idempotencyKey:'key'});
test('status and completion bind to authenticated actor, validate all 400 dialogue IDs, and forbid client currency amounts',async()=>{
 const h=route(),read=await h.get();assert.equal(read.status,200);assert.equal(read.headers['Cache-Control'],'private, no-store');assert.equal(h.calls[0].args.p_user_id,A);
 const response=await h.post({...attempt(),amount:99999,userId:B});assert.equal(response.status,200);
 assert.deepEqual({...h.calls[1].args},{p_user_id:A,p_partner_id:B,p_pair_version:'a'.repeat(32),p_monster_id:'overthinking',p_dialogue_id:'r50',p_choice:3,p_key:'key'});
 for(const [monsterId,rows]of Object.entries(domain.RELEASE_ROOM_DIALOGUES))for(const row of rows){const result=await h.post({...attempt(),monsterId,dialogueId:row.id});assert.equal(result.status,200);}
});
test('forged identity, invalid dialogue/choice/scope and malformed bodies never reach the RPC',async()=>{
 for(const invalid of [{actorId:B},{monsterId:'__proto__'},{dialogueId:'r51'},{dialogueId:'r00'},{choice:4},{choice:'1'},{idempotencyKey:''},{partnerId:'bad'},{pairVersion:'bad'},{partnerId:null}]){
  const h=route();assert.equal((await h.post({...attempt(),...invalid})).status,400);assert.equal(h.calls.length,0);
 }
 for(const body of ['{bad', 'x'.repeat(5001)]){const h=route();assert.equal((await h.post(body)).status,400);assert.equal(h.calls.length,0);}
 for(const options of [{unauthorized:true},{disabled:true}]){const h=route(options);assert.ok((await h.post(attempt())).status>=400);assert.ok((await h.get()).status>=400);assert.equal(h.calls.length,0);}
 const solo=route();assert.equal((await solo.post({...attempt(),partnerId:null,pairVersion:null})).status,200);
});
test('quota errors are authoritative and RPC failures cannot claim success',async()=>{
 const quota=route({result:{data:{error:'daily_limit_reached',status:status({tamesToday:1})}}});assert.equal((await quota.post(attempt())).status,409);
 const failed=route({result:{error:Error('offline')}});assert.equal((await failed.post(attempt())).status,503);
});
class ApiError extends Error{constructor(body){super('api');this.body=body;}}
function client(options={}){
 let epoch=1,identity;const disk=options.disk??new Map(),calls=[],reads=[],coins=[],post=deferred(),get=deferred();
 const api=load('apps/mobile/src/lib/release-room-api.ts',{
  '@novame/api-client':{ApiError},'./api':{apiClient:{get:(path,options)=>{reads.push({path,options});return get.promise;},post:async(path,body)=>{calls.push({path,body});return post.promise;}}},
  './async-lifecycle':{withDeadline:promise=>promise},'./session-lifecycle':{sessionUserId:()=>epoch===1?A:'other',sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kReleaseRoomStatus:{name:'release'}},
  './burrow-local-day':load('apps/mobile/src/lib/burrow-local-day.ts',{}, {Date,Intl}),
  './coin-reward-store':{beginCoinReward:(...args)=>{coins.push(['begin',...args]);return{};},settleCoinReward:(_ticket,receipt)=>coins.push(['settle',receipt]),failCoinReward:()=>coins.push(['fail'])},
 });
 const data={profile:{id:A},partner:{id:B},pairVersion:'a'.repeat(32)};
 return {api,calls,reads,coins,post,get,data,disk,switch:()=>{epoch++;identity();}};
}
test('completion coins are 10 per request key, deferred until UI release; retries use no daily reward key',async()=>{
 const h=client(),value=attempt(),work=h.api.submitReleaseRoom(value);await flush();
 assert.deepEqual(h.coins[0],['begin','release-ui:key','release:key',10,true]);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body)),value);
 const receipt={status:status(),tamedCount:1,coinReward:{key:'release:key',amount:10}};h.post.resolve(receipt);
 assert.equal((await work).rewardId,'release-ui:key');assert.equal(h.coins.filter(x=>x[0]==='settle').length,1);
});
test('failed/late completions roll back presentation and cannot populate another account or pair cache',async()=>{
 for(const mode of ['failure','account','pair']){
  const h=client(),work=h.api.submitReleaseRoom(attempt());if(mode==='account')h.switch();
  if(mode==='failure')h.post.reject(new ApiError({error:'daily_limit_reached',status:status({tamesToday:1})}));
  else h.post.resolve({status:status(mode==='pair'?{pairVersion:'b'.repeat(32)}:{})});
  await assert.rejects(work);assert.equal(h.coins.at(-1)[0],'fail');assert.equal(!!h.api.cachedReleaseRoom(h.api.releaseRoomScope(h.data)),mode==='failure');
 }
});
test('status rejects stale pairing and signout, while successful cache remains account/pair scoped',async()=>{
 for(const mode of ['ok','pair','account']){
  const h=client(),work=h.api.fetchReleaseRoom(h.data);if(mode==='account')h.switch();
  h.get.resolve(status(mode==='pair'?{partnerId:null,pairVersion:null}:{}));
  if(mode==='ok'){await work;assert.ok(h.api.cachedReleaseRoom(h.api.releaseRoomScope(h.data)));assert.equal(h.api.cachedReleaseRoom('other'),null);h.switch();assert.equal(h.api.cachedReleaseRoom(h.api.releaseRoomScope(h.data)),null);}
  else await assert.rejects(work);
 }
});
test('wallet enrichment preserves a server per-completion key instead of replacing it with rage-first',async()=>{
 const {withRewardWallet}=await import('../apps/api/src/lib/burrow-reward-wallet.mjs');
 const state={wallet:{balance:20,version:2},credits:[{key:'release:one',amount:10},{key:'release:two',amount:10}],localDate:'2026-10-14'};
 const receipt={carrotsAwarded:10,coinReward:{key:'release:two',amount:10}};
 const result=await withRewardWallet({rpc:async()=>({data:state})},A,receipt,{action:'rage'});
 assert.deepEqual(result.coinReward,receipt.coinReward);assert.deepEqual(result.coinState,state);
});
test('cancelled subscribers never receive results or cancel a shared prewarm; confirmed cache remains scoped',async()=>{
 for(const alreadyCancelled of [true,false]){
  const h=client(),controller=new AbortController();if(alreadyCancelled)controller.abort();
  const work=h.api.fetchReleaseRoom(h.data,controller.signal);
  if(alreadyCancelled)assert.equal(h.reads.length,0);
  else {assert.equal(h.reads[0].options,undefined);controller.abort();h.get.resolve(status());}
  await assert.rejects(work,error=>error.code==='read_cancelled');
  assert.equal(!!h.api.cachedReleaseRoom(h.api.releaseRoomScope(h.data)),!alreadyCancelled);assert.equal(h.coins.length,0);
 }
});
test('confirmed display survives restart, projects day/tier changes and never crosses relationships',async()=>{
 const h=client(),scope=h.api.releaseRoomScope(h.data),now=new Date();
 const snapshot=status({localDate:now.toISOString().slice(0,10),serverNow:now.toISOString(),tamesToday:1});
 const read=h.api.fetchReleaseRoom(h.data);h.get.resolve(snapshot);await read;
 const restarted=client({disk:h.disk});assert.equal(restarted.api.cachedReleaseRoom(scope,'UTC',false).tamesToday,1);
 assert.equal(restarted.api.cachedReleaseRoom(scope,'UTC',true).dailyLimit,2);assert.equal(restarted.api.cachedReleaseRoom(scope+':other','UTC'),null);
 assert.equal(restarted.api.releaseStatusCurrent(snapshot,'UTC',now.getTime()+86400000),false);
 const saved=JSON.parse(h.disk.get('release'));assert.equal(saved.value.monsters[0].partnerTamedCount,snapshot.monsters[0].partnerTamedCount);
});
test('prewarm and entry coalesce; an older read cannot rewind a confirmed completion quota',async()=>{
 const h=client(),a=h.api.fetchReleaseRoom(h.data),b=h.api.fetchReleaseRoom(h.data);assert.equal(h.reads.length,1);
 const work=h.api.submitReleaseRoom(attempt());
 h.post.resolve({status:status({serverNow:'2026-10-14T12:01:00Z',tamesToday:1}),tamedCount:1});await work;
 h.get.resolve(status());assert.equal((await a).tamesToday,1);assert.equal((await b).tamesToday,1);
});
