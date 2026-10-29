const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/adventure-entry-state.ts'),plain=x=>JSON.parse(JSON.stringify(x));
const midnight=Date.parse('2026-10-29T07:00:00Z');
const snapshot=()=>({profile:{id:'me',timezone_name:'Asia/Tokyo'},economicTimezone:'America/Los_Angeles',partner:{id:'partner'},pairVersion:'one',
 localDate:'2026-10-28',serverNow:'2026-10-29T06:50:00Z',dailyAdventureUsed:true,readyRecordId:null,adventureResult:{id:'result',claim_status:'pending',metadata:{encounterV2:true}},
 activeAdventure:{id:'trip',status:'result_ready',started_at:'2026-10-29T01:00:00Z',ends_at:'2026-10-29T07:00:00Z',local_date:'2026-10-28'}});
const job=patch=>({owner:'me',scope:'me:partner:one',id:'trip',treasure:true,finish:false,treasureSaved:false,responseSaved:false,journeyDay:'2026-10-28',...patch});
for(const stage of [{},{treasureSaved:true},{choiceId:'a',responseSaved:true}])test(`cross-day unfinished rewards remain settlement: ${JSON.stringify(stage)}`,()=>{
 const data=snapshot();assert.equal(model.adventureEntryState(data,midnight,[job(stage)]).kind,'settlement');
 data.friendVisit={version:2,myCompleted:false};assert.equal(model.adventureEntryState(data,midnight,[job(stage)]).kind,'settlement');
});
test('durable final click immediately opens a new-day log, without deleting old adventure or granting inventory',()=>{
 const data=snapshot(),before=JSON.stringify(data),rows=[job({finish:true})];
 assert.equal(model.adventureEntryState(data,midnight,rows).kind,'log');assert.equal(JSON.stringify(data),before);
 assert.equal(model.adventureEntryState(data,midnight-1,rows).kind,'napping');
 data.friendVisit={version:2,myCompleted:false};assert.equal(model.adventureEntryState(data,midnight,rows).kind,'log');
});
test('failed final claim reopens the same result; account/pair/ID mismatch cannot hide it',()=>{
 for(const patch of [{failed:true},{owner:'other'},{scope:'me:partner:old'},{id:'another'}])
  assert.equal(model.adventureEntryState(snapshot(),midnight,[job({finish:true,...patch})]).kind,'settlement');
});
test('today used on another device wins; a retained final receipt prevents same-day reuse after bootstrap removes active',()=>{
 const data={...snapshot(),localDate:'2026-10-29',dailyAdventureUsed:true};
 assert.equal(model.adventureEntryState(data,midnight,[job({finish:true})]).kind,'napping');
 Object.assign(data,{dailyAdventureUsed:false,activeAdventure:null,adventureResult:null});
 assert.equal(model.adventureEntryState(data,midnight,[job({finish:true,finishSaved:true,journeyDay:'2026-10-29'})]).kind,'napping');
});
test('orphan result with a durable final intent cannot resurrect a finished flow',()=>{
 const data={...snapshot(),activeAdventure:null};data.adventureResult.adventure_id='trip';
 assert.equal(model.adventureEntryState(data,midnight,[job({finish:true})]).kind,'log');
 assert.equal(model.adventureEntryState(data,midnight,[job({finish:true,failed:true})]).kind,'settlement');
});
test('stale ready records are not reused on a new day; new-day local journal has an explicit date',()=>{
 const data={...snapshot(),activeAdventure:null,adventureResult:null,readyRecordId:'old-record'};
 assert.equal(model.adventureEntryState(data,midnight).kind,'log');data.readyRecordLocalDate='2026-10-29';
 assert.equal(model.adventureEntryState(data,midnight).recordId,'old-record');
});
test('ongoing always wins over day rollover and there is no 24-hour wait; fixed timezone ignores display timezone',()=>{
 const data=snapshot();data.activeAdventure.status='in_progress';data.activeAdventure.ends_at=new Date(midnight+1000).toISOString();
 assert.equal(model.adventureEntryState(data,midnight).kind,'ongoing');
 assert.equal(model.adventureEntryState(data,midnight+1000).kind,'settlement');
 assert.equal(model.adventureDay(data,midnight),'2026-10-29');assert.equal(model.adventureDay(data,midnight-1),'2026-10-28');
});
function durable(initial=[]){
 let disk=JSON.stringify(initial),owner='me',reset,fail=false;
 const state=load('apps/mobile/src/lib/adventure-delivery-state.ts',{
  react:{useSyncExternalStore(){}},'./storage':{storage:{getString:()=>disk,set:(_key,value)=>{if(fail)throw Error('disk_full');disk=value;}}},
  '../shared/storage/keys':{kAdventureDelivery:{name:'delivery'}},'./session-lifecycle':{subscribeSessionIdentity:fn=>reset=fn},
 });
 return{state,disk:()=>JSON.parse(disk),fail:value=>fail=value,reset:()=>{disk='[]';reset();}};
}
test('one shared durable journal publishes only after storage, survives restart and clears identity references',()=>{
 const x=durable();let events=0;x.state.subscribeAdventureDelivery(()=>events++);
 x.fail(true);assert.throws(()=>x.state.saveAdventureDeliveryRows([job({finish:true})]));assert.equal(events,0);assert.equal(x.state.readAdventureDeliveryRows().length,0);
 x.fail(false);x.state.saveAdventureDeliveryRows([job({finish:true})]);assert.equal(events,1);
 assert.equal(model.adventureEntryState(snapshot(),midnight,durable(x.disk()).state.readAdventureDeliveryRows()).kind,'log');
 x.reset();assert.equal(x.state.readAdventureDeliveryRows().length,0);
});
test('red dot uses the same entry state, ignores old seen arrival markers, and comes back on definitive rejection',()=>{
 const x=durable(),disk=new Map([['attention',JSON.stringify({scope:'me:partner:one',seen:{adventureReminders:['trip']}})]]);
 const attention=load('apps/mobile/src/lib/burrow-attention.ts',{
  react:{useSyncExternalStore(){}},'./adventure-delivery-state':x.state,'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},
  '../shared/storage/keys':{kBurrowAttention:{keyFor:()=> 'attention'}},'./session-lifecycle':{sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './burrow-presentation':{},'./burrow-moments-model':{momentKind:()=>null},'./notification-content-version':{notificationContentVersion:()=> 'ready'},
  './notification-readiness':{notificationReadiness:{ready:()=>true,subscribe:()=>()=>{},revision:()=>0}},'./shop-gift-preparation':{preparedShopGiftIds:()=>[]},
 });
 const data={...snapshot(),pairAccessVerified:true,quests:{quests:[]},specialQuests:[],moments:[],memoryEntries:[]};
 assert.equal(attention.burrowAttentionCounts(data,midnight).adventure,1);attention.dismissAdventureReminder(data,midnight);
 assert.equal(attention.burrowAttentionCounts(data,midnight).adventure,1);
 x.state.saveAdventureDeliveryRows([job({finish:true})]);assert.equal(attention.burrowAttentionCounts(data,midnight).adventure,0);
 x.state.saveAdventureDeliveryRows([job({finish:true,failed:true})]);assert.equal(attention.burrowAttentionCounts(data,midnight).adventure,1);
});
test('completion back lock releases only for explicit finish, focus or identity loss; resources clean up',()=>{
 const h=hooks(),guards=[],backs=new Set(),gestures=[];let owner='me',scope='me:partner:one',focused=true;
 const {useAdventureCompletionGuard}=load('apps/mobile/src/lib/use-adventure-completion-guard.ts',{
  react:h.react,'react-native':{BackHandler:{addEventListener:(_n,fn)=>(backs.add(fn),{remove:()=>backs.delete(fn)})}},
  '@react-navigation/native':{useIsFocused:()=>focused,usePreventRemove:blocked=>guards.push(blocked)},
  './use-page-back-gesture':{usePageBackGesture:v=>gestures.push(v)},'./session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:()=>()=>{}},
  './burrow-store':{useBurrowSelector:()=>scope},
 });
 const render=(done=false)=>h.render(()=>useAdventureCompletionGuard(snapshot(),done));
 assert.equal(render(),true);assert.equal([...backs][0](),true);assert.equal(gestures.at(-1),false);
 assert.equal(render(true),false);assert.equal(backs.size,0);assert.equal(render(),true);
 owner='other';assert.equal(render(),false);owner='me';scope='me:partner:new';assert.equal(render(),false);
 scope='me:partner:one';focused=false;assert.equal(render(),false);h.unmount();assert.equal(backs.size,0);
});
test('actual delivery facade persists final intent immediately, orders all receipts before new Start, and restores without replaying awards',async()=>{
 const x=durable(),calls=[],requests=[];let data=snapshot();
 const request=(stage,id)=>{calls.push([stage,id]);const p=deferred();requests.push(p);return p.promise;};
 const imports={
  'react-native':{AppState:{currentState:'active'}},'./adventure-delivery-state':x.state,
  './session-lifecycle':{sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './adventure-delivery-queue':load('apps/mobile/src/lib/adventure-delivery-queue.ts'),
  './app-major-update-api':{claimAdventureTreasure:id=>request('treasure',id),completeFriendInteraction:id=>request('reply',id),claimAdventureResult:id=>request('finish',id)},
  './burrow-store':{getBurrowSnapshot:()=>({data}),confirmBurrowAdventureItemLocally(){},confirmBurrowAdventureInteractionLocally(){},confirmBurrowAdventureClaimLocally(){data={...data,activeAdventure:null,adventureResult:null};},scheduleBurrowRefresh(){}},
 };
 const api=load('apps/mobile/src/lib/adventure-delivery.ts',imports);
 api.queueAdventureDelivery('trip',{treasure:true});api.queueAdventureDelivery('trip',{choiceId:'a',checkpoint:{stage:'reply',line:0,invited:true}});api.queueAdventureDelivery('trip',{finish:true});
 assert.equal(model.adventureEntryState(data,midnight,x.state.readAdventureDeliveryRows()).kind,'log');
 assert.equal(x.disk()[0].journeyDay,'2026-10-28');let allowed=false;
 const wait=api.finishAdventureDeliveryBeforeStart().then(value=>allowed=value);assert.equal(allowed,false);
 requests[0].resolve({});await flush();assert.deepEqual(calls.map(c=>c[0]),['treasure','reply']);assert.equal(allowed,false);
 requests[1].resolve({});await flush();assert.equal(calls[2][0],'finish');requests[2].resolve({});await wait;assert.equal(allowed,true);
 assert.equal(x.disk()[0].finishSaved,true);load('apps/mobile/src/lib/adventure-delivery.ts',imports).resumeAdventureDelivery();await flush();assert.equal(calls.length,3);
});
test('restored dialogue cursor continues intro/reply/gift without resubmitting the frozen choice',()=>{
 const jsx=(type,props)=>({type,props}),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
 const data=snapshot();data.adventureResult.metadata={encounterV2:true,friendSnapshot:{name:'Arlo'},dialogue:{scene:'Scene',lines:['First','Second'],choices:[{id:'a',label:'Answer',reaction:['Reply one','Reply two']}],outro:'Goodbye'},giftSnapshot:{title:'Gift'}};
 let persisted=job({checkpoint:{stage:'intro',line:1,invited:true}}),fail=false;
 function mount(){const h=hooks();const {AdventureEncounterCard}=load('apps/mobile/src/components/burrow/adventure-encounter-card.tsx',{
  ...require('./motion-test-utils.cjs').presentationImports(h),react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',StyleSheet:{create:x=>x}},'@/lib/app-major-update-api':{},'@/lib/burrow-store':{},
  '@/lib/adventure-friend-presentation':load('apps/mobile/src/lib/adventure-friend-presentation.ts'),
  '@/lib/adventure-delivery':{readAdventureDelivery:()=>persisted,queueAdventureDelivery:(_id,intent)=>{if(fail)return false;persisted={...persisted,...intent};return true;}},
  './adventure-encounter-layout':{AdventureEncounterLayout:'Layout'},'./friend-text-panel':{FriendTextPanel:'Panel'},'./friend-dialogue':{FriendDialogue:'Dialogue'},'./adventure-reward-screen':{AdventureRewardScreen:'Gift'},
 });return{h,render:()=>nodes(h.render(()=>AdventureEncounterCard({data,onComplete(){}})))};}
 let page=mount();assert.equal(page.render().find(n=>n.type==='Dialogue').props.children,'First');
 fail=true;page.render().find(n=>n.type==='Dialogue').props.onPress();assert.equal(page.render().find(n=>n.type==='Dialogue').props.children,'First');
 fail=false;page.render().find(n=>n.type==='Dialogue').props.onPress();page.h.unmount();
 page=mount();assert.equal(page.render().find(n=>n.type==='Dialogue').props.children,'Second');
 page.render().find(n=>n.type==='Dialogue').props.onPress();page.render().find(n=>n.type==='Panel').props.onChoice(0);page.h.unmount();
 page=mount();assert.equal(page.render().find(n=>n.type==='Dialogue').props.children,'Reply one');
 for(let i=0;i<3;i++)page.render().find(n=>n.type==='Dialogue').props.onPress();page.h.unmount();
 page=mount();assert.ok(page.render().some(n=>n.type==='Gift'));assert.equal(persisted.choiceId,'a');page.h.unmount();
});
