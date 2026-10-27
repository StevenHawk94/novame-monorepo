const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const version=load('apps/mobile/src/lib/notification-content-version.ts');
function harness(){
 const time=clock(),registry=load('apps/mobile/src/lib/notification-readiness.ts',{},time.globals).notificationReadiness;
 let epoch=1,owner='me',identities=[],overview=null,warmOverview=null,yieldWork=()=>Promise.resolve();
 let data={profile:{id:'me',timezone_name:'UTC'},partner:{id:'you'},pairVersion:'v1',pairAccessVerified:true,
  localDate:'2026-10-19',moments:[],memoryEntries:[],catalog:[],affectionInbox:[],gifts:[],unread:{},serverNow:new Date().toISOString(),
  attention:{scope:'me:you:v1',localDate:'2026-10-19',games:[{id:'round:invite',at:'now'}],journal:[],letters:[],moments:[]}};
 const sessions=new Map(),requests=[],calls=[];const disk=new Map();
 const moments={error:false,page:{rows:[],hasMore:false,next:null},loading:false};let more=async()=>{};
 const attention=load('apps/mobile/src/lib/burrow-attention.ts',{
  react:{useSyncExternalStore(){}},'./notification-content-version':version,'./notification-readiness':{notificationReadiness:registry},
  './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},'../shared/storage/keys':{kBurrowAttention:{keyFor:x=>x}},
  './session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:fn=>identities.push(fn)},
  './burrow-presentation':{adventureHasArrived:()=>false},'./burrow-moments-model':{momentKind:()=>true},
 });
 const api=load('apps/mobile/src/lib/burrow-notification-preparation.ts',{
  './ui-idle':{yieldToUi:()=>yieldWork()},
  'react-native':{AppState:{currentState:'active'}},
  './notification-readiness':{notificationReadiness:registry},'./notification-content-version':version,
  './burrow-store':{getBurrowSnapshot:()=>({data})},'./session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch},
  './burrow-page-entry':{warmBurrowGameOverview:async()=>{calls.push('overview');overview=warmOverview??{sessions:[{id:'round'}]};}},
  './burrow-game-room-api':{gameSession:id=>{const request=deferred();requests.push({id,...request});return request.promise;}},
  './burrow-game-room-cache':{retainNotificationGameSessions:ids=>calls.push(['retain',...ids]),
   cacheGameSession:(value,_at,scope)=>sessions.set(`${scope}:${value.id}`,value),getCachedGameOverview:()=>overview,
   getCachedGameSession:(id,scope)=>sessions.get(`${scope}:${id}`)},
  './burrow-game-local':{reconcileLocalGame:value=>value},'./burrow-attention':attention,
  './couple-journal':{prepareCoupleJournal:async()=>{calls.push('journal');}},
  './use-love-notes':{prepareLoveNotes:async()=>{calls.push('letters');},loveNotesReady:()=>true},
  './moments-cache':{momentsCache:{prepare:async()=>{calls.push('moments');},read:()=>moments,more:async()=>{calls.push('moments-more');await more();}}},
  './friend-visit-local':{warmFriendVisit:async()=>{calls.push('visit');}},
  './adventure-prefetch':{warmAdventureCompletion:async()=>{calls.push('adventure');}},
  './burrow-page-art':{warmBurrowPageArt:async()=>{}},
 });
 return {time,api,attention,registry,sessions,requests,calls,moments,set overview(value){warmOverview=value;},set yieldWork(fn){yieldWork=fn;},set more(fn){more=fn;},get data(){return data;},set data(next){data=next;},
  changeOwner(){epoch++;owner='other';identities.forEach(fn=>fn());registry.reset();}};
}
const invite={id:'round',ownAnswers:[],guesses:[],partnerOwnCount:6,partnerGuessCount:6,partnerOwnAnswers:null,partnerGuesses:null,result:null};
test('a new invitation reuses every unchanged prepared round instead of reading the whole backlog',async()=>{
 const h=harness(),scope='me:you:v1',old={...invite,completedAt:null};h.sessions.set(`${scope}:round`,old);
 h.data.attention.games.push({id:'new:invite',at:'later'});
 h.overview={sessions:[{id:'round',completedAt:null,ownCount:0,guessCount:0,partnerOwnCount:6,partnerGuessCount:6},
  {id:'new',completedAt:null,ownCount:0,guessCount:0,partnerOwnCount:6,partnerGuessCount:6}]};
 const work=h.api.prepareBurrowNotifications(h.data);await flush();assert.deepEqual(h.requests.map(r=>r.id),['new']);
 h.requests[0].resolve({...old,id:'new'});await work;assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,2);
});
test('content publication and red badge wait for the active UI work to settle, never for a click',async()=>{
 const h=harness(),idle=deferred();h.yieldWork=()=>idle.promise;
 const work=h.api.prepareBurrowNotifications(h.data);await flush();h.requests[0].resolve({...invite,completedAt:null});await flush();
 assert.equal(h.sessions.size,0);assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
 idle.resolve();await work;assert.equal(h.sessions.size,1);assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,1);
});
test('own-six alone is not enough for a received invitation',async()=>{
 const h=harness(),work=h.api.prepareBurrowNotifications(h.data);await flush();
 h.requests[0].resolve({...invite,partnerGuessCount:5});await work;
 assert.equal(h.sessions.size,0);assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
});
test('actual badge model stays hidden until the same shared game model and lobby entry are ready; duplicate warmups share reads',async()=>{
 const h=harness(),a=h.api.prepareBurrowNotifications(h.data),b=h.api.prepareBurrowNotifications(h.data);await flush();
 assert.equal(h.requests.length,1);assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
 h.attention.markBurrowUpdatesSeen(h.data,'games');assert.equal(h.attention.unreadBurrowUpdateIds(h.data,'games').length,1,'warming/open intent cannot mark metadata read');
 h.requests[0].resolve(invite);await Promise.all([a,b]);
 assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,1);
 assert.ok(h.sessions.get('me:you:v1:round'));assert.equal(h.attention.unreadBurrowUpdateIds(h.data,'games').length,1);
 await h.api.prepareBurrowNotifications(h.data);assert.equal(h.requests.length,1,'wallet/no-op refresh cannot re-read all notification bodies');
 h.attention.markBurrowUpdatesSeen(h.data,'games');assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
});
test('result notification cannot advertise a sealed/empty result; retry exposes only the full receipt',async()=>{
 const h=harness();h.data.attention.games=[{id:'round:result',at:'now'}];
 const a=h.api.prepareBurrowNotifications(h.data);await flush();h.requests[0].resolve(invite);await a;
 assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
 assert.ok(h.calls.includes('journal')&&h.calls.includes('moments'),'other channels remain independently warm');
 h.time.advance(1100);const b=h.api.prepareBurrowNotifications(h.data);await flush();
 h.requests[1].resolve({...invite,completedAt:'now',ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(0),result:{mine:6,partner:6,outcome:'tie'}});
 await b;assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,1);
});
test('version/pair/account changes reject late bodies, hide old badges, and never acknowledge unread content',async()=>{
 const h=harness(),a=h.api.prepareBurrowNotifications(h.data);await flush();
 h.data={...h.data,partner:{id:'someone-else'},pairVersion:'v2'};
 h.requests[0].resolve(invite);await a;assert.equal(h.sessions.size,0);assert.equal(h.attention.burrowAttentionCounts(h.data).rooms.game_room,0);
 h.changeOwner();assert.equal(h.attention.burrowAttentionCounts(h.data).tabs.index,0);
});
test('business content versions ignore wallet/clock but invalidate on actual answer, note, journey or pair changes',()=>{
 const h=harness(),before=version.notificationContentVersion(h.data,'journal');
 h.data.wallet={balance:200};h.data.serverNow='later';assert.equal(version.notificationContentVersion(h.data,'journal'),before);
 h.data.attention.journal.push({id:'answer:revision',at:'now'});assert.notEqual(version.notificationContentVersion(h.data,'journal'),before);
});
test('a Moments notification waits for its actual record page, not just an empty/history head response',async()=>{
 const h=harness(),pending=deferred();h.data.attention.moments=[{id:'expected:now',at:'now'}];
 h.moments.page={rows:[{id:'own',created_at:'now'}],hasMore:true,next:{id:'cursor',at:'before'}};
 h.more=async()=>{await pending.promise;h.moments.page={rows:[{id:'expected',created_at:'now',record:{body:'Full record',items:[]}}],hasMore:false,next:null};};
 const warm=h.api.prepareBurrowNotifications(h.data);await flush();h.requests[0].resolve(invite);
 assert.equal(h.attention.burrowAttentionCounts(h.data).tabs.friends,0);
 pending.resolve();await warm;assert.equal(h.attention.burrowAttentionCounts(h.data).tabs.friends,1);
 assert.ok(h.calls.includes('moments-more'));
});
