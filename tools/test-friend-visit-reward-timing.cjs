const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {model:motion}=require('./motion-test-utils.cjs');
const base='apps/mobile/src/lib/';
const prepared={sessionId:'session',visitId:'visit',friendId:'mole',pairVersion:'v1',mode:'independent',type:'Trivia',scene:'Scene',lines:['Hello'],question:'Question',
 choices:[{id:'A',label:'Yes',feedback:['First reply','Second reply'],reward:10},{id:'B',label:'No',feedback:['Try again'],reward:5}]};
function harness({initialRows,initialCoins}={}){
 const time=clock(),identityCallbacks=[],disk=new Map(),requests=[];let owner='me',epoch=1,failCoinSave=false;
 if(initialRows)disk.set('visits',JSON.stringify(initialRows));if(initialCoins)disk.set('coins',JSON.stringify(initialCoins));
 const app={currentState:'active',addEventListener:()=>({remove(){}})};
 const identity={sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>identityCallbacks.push(fn)};
 const storage={getString:key=>disk.get(key),set:(key,value)=>{if(failCoinSave&&key==='coins')throw Error('disk_full');disk.set(key,value);}};
 const wallet=load(base+'coin-reward-store.ts',{
  react:{useSyncExternalStore:(_subscribe,read)=>read()},'./session-lifecycle':identity,
  './coin-reward-ledger':load(base+'coin-reward-ledger.ts'),'./burrow-motion':motion,
 },time.globals);wallet.syncCoinWallet({balance:100,version:1});
 const outbox=load(base+'coin-command-outbox.ts',{
  'react-native':{AppState:app},'./api':{apiClient:{post:(path,body)=>{const d=deferred();requests.push({path,body,...d});return d.promise;}}},
  './async-lifecycle':{withDeadline:x=>x},'./storage':{storage},'../shared/storage/keys':{kCoinOperations:{name:'coins'}},
  './session-lifecycle':identity,'./coin-reward-store':wallet,'./coin-operation-queue':load(base+'coin-operation-queue.ts'),
 },time.globals);
 const api=load(base+'app-major-update-api.ts',{'expo-crypto':{},'./api':{},'./async-lifecycle':{},'./session-lifecycle':identity,
  './coin-reward-store':wallet,'./coin-command-outbox':outbox,...require('./rating-test-mocks.cjs')});
 const data={profile:{id:'me'},partner:{id:'partner'},pairVersion:'v1',pairAccessVerified:true};
 const {friendVisitLocal:visit}=load(base+'friend-visit-local.ts',{
  'react-native':{AppState:app},'./storage':{storage},'../shared/storage/keys':{kFriendVisitLocal:{name:'visits'}},
  './session-lifecycle':identity,'./burrow-store':{getBurrowSnapshot:()=>({data}),projectFriendVisitAnswerLocally(){},scheduleBurrowRefresh(){}},
  './app-major-update-api':{prepareFriendVisit:async()=>prepared,answerPreparedFriendVisit:api.answerPreparedFriendVisit},
  './friend-visit-local-state':load(base+'friend-visit-local-state.ts'),'./prepared-burrow-images':{},'./burrow-art-assets':{},'./burrow-ui-assets':{},
  './coin-reward-store':wallet,
 },time.globals);
 const ready=async choice=>{await visit.prepare('visit','v1');visit.open('visit');visit.answer('visit',choice);};
 const receipt=(amount=10)=>({applied:true,reward:amount,feedback:['Confirmed reply'],coinReward:{key:'friend-visit:visit',amount},
  coinState:{wallet:{balance:100+amount,version:2},credits:[{key:'friend-visit:visit',amount}],timezone:'UTC',localDate:'2026-10-21',serverNow:'2026-10-21T00:00:00Z'}});
 return{visit,wallet,time,disk,requests,ready,receipt,failCoins:v=>failCoinSave=v,pairChange(){data.pairVersion='v2';},logout(){owner='other';epoch++;identityCallbacks.forEach(fn=>fn());}};
}
for(const [choice,amount] of [['A',10],['B',5]])test(`${amount} coins use the real shared outbox; first reply releases the projection without waiting for receipt`,async()=>{
 const h=harness();await h.ready(choice);assert.equal(h.requests.length,1);assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
 assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,100);assert.equal(h.wallet.getCoinRewardSnapshot().balance,100+amount);
 h.visit.rewardReady('visit');const before=h.wallet.getCoinRewardSnapshot().batch;
 assert.equal(before.earned,amount);assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,100+amount);
 h.visit.rewardReady('visit');assert.equal(h.wallet.getCoinRewardSnapshot().batch.celebration,before.celebration);
 h.requests[0].resolve(h.receipt(amount));await flush();
 assert.equal(h.wallet.getCoinRewardSnapshot().balance,100+amount);assert.equal(h.wallet.getCoinRewardSnapshot().batch.celebration,before.celebration);
 h.wallet.finishCoinRewardBatch(before.id,before.revision);h.visit.rewardReady('visit');assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
});
test('fast receipt cannot start the animation before the reply; exiting consumes an unseen delivery silently',async()=>{
 const h=harness();await h.ready('A');h.requests[0].resolve(h.receipt());await flush();
 assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,100);
 h.visit.dismissReward('visit');assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,110);
 h.visit.rewardReady('visit');assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
});
test('unpairing before cleanup cannot strand an already confirmed hidden balance',async()=>{
 const h=harness();await h.ready('A');h.requests[0].resolve(h.receipt());await flush();
 assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,100);h.pairChange();assert.equal(h.visit.read('visit'),undefined);
 h.visit.dismissReward('visit');assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,110);assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
});
test('an old account callback cannot release or dismiss a same-visit ticket belonging to the current account',async()=>{
 const h=harness();await h.ready('A');h.visit.rewardReady('visit','previous-user');h.visit.dismissReward('visit','previous-user');
 assert.equal(h.wallet.getCoinRewardSnapshot().displayBalance,100);assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
 h.visit.rewardReady('visit','me');assert.equal(h.wallet.getCoinRewardSnapshot().batch.earned,10);
 h.requests[0].resolve(h.receipt());await flush();
});
test('a coin-journal failure can retry after reveal without losing or duplicating its visual release',async()=>{
 const h=harness();h.failCoins(true);await h.ready('A');await flush();assert.equal(h.requests.length,0);
 h.visit.rewardReady('visit');assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
 h.failCoins(false);const retry=h.visit.resume();await flush();assert.equal(h.requests.length,1);
 assert.equal(h.wallet.getCoinRewardSnapshot().batch.earned,10);h.requests[0].resolve(h.receipt());await retry;
 assert.equal(h.wallet.getCoinRewardSnapshot().balance,110);assert.equal(h.wallet.getCoinRewardSnapshot().batch.earned,10);
});
test('server rejection rolls back the released credit and its own celebration',async()=>{
 const h=harness();await h.ready('A');h.visit.rewardReady('visit');assert.equal(h.wallet.getCoinRewardSnapshot().balance,110);
 h.requests[0].resolve({error:'visit_expired'});await flush();
 assert.equal(h.wallet.getCoinRewardSnapshot().balance,100);assert.equal(h.wallet.getCoinRewardSnapshot().batch,null);
 assert.equal(h.visit.read('visit').status,'rejected');
});
test('restored pending visits use the same session and choice silently, and old-account replies cannot update a new account',async()=>{
 const a=harness();await a.ready('A');const rows=JSON.parse(a.disk.get('visits')),coins=JSON.parse(a.disk.get('coins'));
 const b=harness({initialRows:rows,initialCoins:coins});void b.visit.resume();await flush();
 assert.equal(b.requests[0].body.sessionId,'session');assert.equal(b.requests[0].body.choiceId,'A');
 b.visit.rewardReady('visit');assert.equal(b.wallet.getCoinRewardSnapshot().batch,null);
 b.requests[0].resolve(b.receipt());await flush();assert.equal(b.wallet.getCoinRewardSnapshot().balance,110);assert.equal(b.wallet.getCoinRewardSnapshot().batch,null);
 a.logout();a.requests[0].resolve(a.receipt());await flush();assert.equal(a.wallet.getCoinRewardSnapshot().balance,null);
});
