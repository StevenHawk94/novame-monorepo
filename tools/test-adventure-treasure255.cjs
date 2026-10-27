const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock}=require('./lifecycle-test-utils.cjs');
const {rewardHarness}=require('./adventure-reward-test-utils.cjs');
const {model:motionModel}=require('./motion-test-utils.cjs');
const {adventureTreasureReward:reward}=load('apps/mobile/src/lib/adventure-treasure-reward.ts');
const M=load('apps/mobile/src/lib/adventure-reward-motion.ts').ADVENTURE_REWARD_MOTION;
test('coin display is separate from inventory; legacy snapshots are not silently rewritten',()=>{
 const item={stable_id:'lamp',title:'Lamp'},inventory=[{owner_id:'me',item_id:'lamp'}];
 assert.equal(reward({treasureVersion:4,treasureCoins:50}).coins,50);
 assert.equal(reward({treasureVersion:4,treasureCoins:100}).item,null);
 assert.equal(reward({treasureVersion:4,treasureSnapshot:item},inventory,'me').coins,100);
 assert.equal(reward({treasureVersion:4,treasureSnapshot:item},inventory,'other').item,item);
 assert.equal(reward({treasureVersion:3,treasureSnapshot:item},inventory,'me').coins,0);
 assert.equal(reward({treasureVersion:4,treasureCoins:50,treasureClaimed:true,treasureAwardCoins:100}).coins,100);
 assert.equal(reward({treasureCoins:9999}).coins,0);
});
function wallet(){
 const time=clock(),ledger=load('apps/mobile/src/lib/coin-reward-ledger.ts');
 const api=load('apps/mobile/src/lib/coin-reward-store.ts',{
  react:{useSyncExternalStore:(_subscribe,read)=>read()},'./session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './coin-reward-ledger':ledger,'./burrow-motion':motionModel,
 },{...time.globals,performance:{now:()=>time.globals.Date.now()}});
 api.syncCoinWallet({balance:300,version:1});return api;
}
for(const amount of [50,100])test(`${amount} coins: complete artwork reveal precedes Claim, confirmed top-right animation and auto-dismiss; retries do not replay`,()=>{
 const w=wallet(),x=rewardHarness();x.props.item=null;x.props.coins=amount;x.props.title=`${amount} Coins`;
 let receipt;const key='adventure-treasure:trip';
 x.props.onClaim=()=>{
  const ticket=w.commandCoinReward('claim_adventure_treasure',{adventureId:'trip'});
  receipt={applied:true,reward:amount,coinReward:{key,amount}};
  w.settleCoinReward(ticket,receipt);return Promise.resolve();
 };
 const tree=x.render();assert.ok(tree.some(n=>n.type==='Image'&&n.props.source==='400.webp'));
 assert.equal(w.getCoinRewardSnapshot().batch,null);
 x.button().props.onPress();assert.equal(w.getCoinRewardSnapshot().balance,300);
 x.motion.time.advance(M.opening-1);x.button().props.onPress();
 assert.equal(receipt,undefined,'opening cannot call monetary Claim even if a second press races');
 assert.equal(w.getCoinRewardSnapshot().batch,null,'no coin animation while the image is still emerging');
 x.motion.time.advance(1);assert.equal(x.button().props.disabled,false);
 const art=x.render().find(n=>n.props.testID==='adventure-reward-product');
 assert.equal(art.props.style.at(-1).opacity,1);assert.equal(art.props.style.at(-1).transform[1].scale,1);
 assert.equal(w.getCoinRewardSnapshot().batch,null,'showing a reward alone is not a monetary receipt');
 x.button().props.onPress();const state=w.getCoinRewardSnapshot();
 assert.equal(state.balance,300+amount);assert.equal(state.batch.earned,amount);
 w.finishCoinRewardBatch(state.batch.id,state.batch.revision);assert.equal(w.getCoinRewardSnapshot().batch,null);
 const retry=w.commandCoinReward('claim_adventure_treasure',{adventureId:'trip'});
 w.settleCoinReward(retry,{applied:false,reward:0,coinReward:{key,amount:0}});
 assert.equal(w.getCoinRewardSnapshot().balance,300+amount);assert.equal(w.getCoinRewardSnapshot().batch,null);
 const next=w.commandCoinRewardPlan('claim_adventure_treasure',{adventureId:'another-trip'});
 assert.notEqual(next.id,retry.id);assert.equal(next.key,'adventure-treasure:another-trip');assert.equal(next.amount,0);
 x.h.unmount();
});
test('V4 API uses new start/display and safely falls back on missing migration without inventing coins',async()=>{
 const calls=[];let unavailable=false;
 const route=load('apps/api/src/app/api/vnext/command/route.js',{
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=> 'me',majorUpdateEnabled:async()=>true,commandStatus:e=>e?409:200,
   appMajorUpdateServiceClient:()=>({rpc:async name=>{calls.push(name);return name==='start_adventure_v4'&&unavailable?{error:{code:'PGRST202'}}:{data:{applied:true,adventureId:'trip'}};}})},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>({adventurePlan:{version:'prepared'}})},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_user,result)=>result},
 });
 const req={text:async()=>JSON.stringify({action:'start_adventure',encounterVersion:4,idempotencyKey:'same'})};
 let result=await route.POST(req);assert.equal(calls[0],'start_adventure_v4');assert.equal(result.body.adventureDisplay.adventurePlan.version,'prepared');
 unavailable=true;calls.length=0;result=await route.POST(req);
 assert.deepEqual(calls,['start_adventure_v4','start_adventure_v3']);assert.equal(result.body.success,true);
});
test('coin receipt carries the wallet snapshot and its stable grant key',async()=>{
 const {withRewardWallet}=load('apps/api/src/lib/burrow-reward-wallet.mjs');
 const state={wallet:{balance:450,version:2},credits:[{key:'adventure-treasure:trip',amount:100}]};
 const result=await withRewardWallet({rpc:async()=>({data:state})},'me',{reward:100,coinReward:{key:'adventure-treasure:trip',amount:100}},{action:'claim_adventure_treasure'});
 assert.equal(result.coinState,state);assert.equal(result.coinReward.key,'adventure-treasure:trip');assert.equal(result.coinReward.amount,100);
});
