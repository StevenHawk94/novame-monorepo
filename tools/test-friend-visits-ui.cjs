const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush,deferred,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?typeof tree.type==='function'?nodes(tree.type(tree.props)):[tree,...nodes(tree.props?.children)]:tree==null||tree===false?[]:[tree];
const copy=tree=>nodes(tree).filter(n=>typeof n==='string').join(' ').replace(/\s+/g,' ').trim();
function harness(){
 const h=hooks(),time=clock(),commands=[];let row,focused=true;
 const conversation={sessionId:'session',visitId:'visit',friendId:'mole',pairVersion:'v1',mode:'independent',type:'Guess',scene:'Scene',lines:['Hello'],question:'Guess your partner',choices:[{id:'A',label:'Love it',feedback:['Reply one','Reply two'],reward:10},{id:'B',label:'Hate it',feedback:['Other reply'],reward:5}]};
 row={candidate:conversation,step:-1};
 const local={subscribe:()=>()=>{},read:()=>row,open:()=>{row={...row,frozen:conversation};return true;},advance:()=>{row={...row,step:row.step+1};return true;},
  answer:(_,id)=>{if(row.choiceId)return false;row={...row,choiceId:id,status:'pending',step:0};commands.push(['answer',id]);return true;},
  finish:()=>{row={...row,done:true};return true;},rewardReady:()=>commands.push('reward'),dismissReward:()=>commands.push('dismiss-reward')};
 const imports={...require('./motion-test-utils.cjs').presentationImports(h),react:{...h.react,useSyncExternalStore:(_,read)=>read()},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{ActivityIndicator:'Spinner',Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:v=>v},useWindowDimensions:()=>({width:428,height:926})},
  'expo-router':{router:{back(){commands.push('back');}}},'./burrow-image':{Image:'Image'},'./coin-ui':{CoinLabel:'Text'},
  '@react-navigation/native':{useIsFocused:()=>focused},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
  '@/lib/friend-visit-local':{friendVisitLocal:local,useLocalFriendVisit:()=>row,warmFriendVisit:async()=>{}},
  '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{friendsRoom:1}},
  './adventure-encounter-layout':{AdventureEncounterLayout:'EncounterLayout'},
  './adventure-stage-transition':{AdventureStageTransition:'Stage'},'./adventure-reveal':{AdventureReveal:'Reveal'},
  './burrow-back-button':{BurrowBackButton:'Back'},
  './friend-room-empty-icon':{FriendRoomEmptyIcon:'EmptyRoomIcon'},
  '@/lib/burrow-store':{refreshBurrowAfterCurrent:async()=>commands.push('refresh')},
 };
 const {CoupleFriendVisitCard}=load('apps/mobile/src/components/burrow/couple-friend-visit-card.tsx',imports,time.globals);
 const data={profile:{id:'me'},partner:{id:'them'},pairVersion:'v1',serverNow:'2026-10-14T00:00:00Z',friendVisitsVersion:2,
  friends:[{stable_id:'mole',name:'Mr Mole'}],friendVisit:{version:2,id:'visit',friend_id:'mole',pairVersion:'v1',myCompleted:false,expiresAt:null,waitingCopy:null}};
 const render=(busy=false)=>h.render(()=>CoupleFriendVisitCard({data,busy}));
 const press=label=>{const button=nodes(render()).find(n=>n.type==='Button'&&(n.props.accessibilityLabel===label||copy(n).includes(label)));assert.ok(button,label);return button.props.onPress();};
 return {data,commands,render,press,h,time,row:()=>row,focus:value=>{focused=value;render();}};
}
test('prepared visitor advances one line at a time, answers instantly, survives sync and exits without a receipt',async()=>{
 const h=harness();assert.match(copy(h.render()),/Talk to Mr Mole/);assert.equal(h.commands.length,0);
 h.press('Talk to');assert.match(copy(h.render()),/Scene/);assert.ok(!copy(h.render()).includes('Hello'));
 h.press('Tap to continue');assert.match(copy(h.render()),/Hello/);assert.ok(!copy(h.render()).includes('Guess your partner'));
 h.press('Tap to continue');assert.match(copy(h.render()),/Guess your partner/);
 h.press('Love it');h.data.friendVisit=null;
 assert.match(copy(h.render()),/Reply one/);assert.ok(!copy(h.render()).includes('Reply two'));
 h.press('Tap to continue');assert.match(copy(h.render()),/Reply two/);
 h.press('Tap to continue');assert.match(copy(h.render()),/Thank you/);
 assert.doesNotMatch(copy(h.render()),/\+10|Mr Mole/,'no reward settlement or persistent name inside dialogue');
 assert.equal(h.commands.filter(x=>Array.isArray(x)&&x[0]==='answer').length,1);
 assert.doesNotMatch(copy(h.render()),/Done/);h.press('Tap to continue');assert.ok(h.commands.includes('back'));assert.equal(h.row().status,'pending');
});
test('completed visit reentry shows the server waiting copy and reply pose, never an empty room or past picks',()=>{
 const h=harness();h.data.friendVisit.myCompleted=true;h.data.friendVisit.waitingCopy='Waiting for Sam';
 const tree=h.render();assert.match(copy(tree),/Waiting for Sam/);
 assert.doesNotMatch(copy(tree),/No visitors|Guess|Talk to/);
 const stage=nodes(tree).find(n=>n.type==='EncounterLayout');assert.equal(stage.props.visitMode,'dialogue');assert.equal(stage.props.answered,true);
 h.data.friendVisit.partnerCompleted=true;assert.match(copy(h.render()),/No visitors right now/);
 h.h.unmount();
});
test('only the visitor welcome centres badge/title/body/action; dialogue stays left aligned and empty stays centred',()=>{
 const h=harness();let tree=nodes(h.render());
 assert.match(copy(h.render()),/VISITOR Mr Mole is here He has a little story to share/);
 assert.equal(tree.find(n=>n.type==='EncounterLayout').props.visitMode,'invite');
 const title=tree.find(n=>n.type==='Text'&&copy(n)==='Mr Mole is here');assert.equal(Object.assign({},...title.props.style).textAlign,'center');assert.equal(Object.assign({},...title.props.style).fontSize,26);
 const talk=tree.find(n=>n.type==='Button'&&copy(n).includes('Talk to'));
 assert.equal(talk.props.style({pressed:false})[0].backgroundColor,'#6B3B24');
 const header=tree.find(n=>n.props?.accessibilityRole==='header');assert.equal(copy(header),"Friend's Room");
 assert.equal(Object.assign({},...header.props.style).fontSize,24);
 const background=tree.find(n=>n.type==='Image');assert.equal(background.props.contentFit,'cover');assert.equal(background.props.style[1].transform[0].translateY,-926*.12);
 h.press('Talk to');tree=nodes(h.render());assert.equal(tree.find(n=>n.type==='EncounterLayout').props.visitMode,'dialogue');
 assert.doesNotMatch(copy(h.render()),/Mr Mole/);
 const block=tree.find(n=>n.props?.testID==='friend-dialogue-block');assert.equal(Object.assign({},...block.props.style).width,300);assert.equal(Object.assign({},...block.props.style).alignSelf,'center');
 const text=tree.find(n=>n.type==='Text'&&copy(n)==='Scene');assert.equal(text.props.style.textAlign,'left');assert.equal(text.props.style.fontSize,18);
 const empty=harness();empty.data.friendVisit=null;tree=nodes(empty.render());
 assert.equal(tree.find(n=>n.type==='EncounterLayout').props.visitMode,'quiet');assert.ok(tree.some(n=>n.type==='EmptyRoomIcon'));
 assert.match(copy(empty.render()),/No visitors right now/);assert.doesNotMatch(copy(empty.render()),/Mr Mole/);
 assert.ok(nodes(empty.render()).some(n=>n.type==='Text'&&copy(n)==="We'll let you know when a friend stops by."));
 for(const label of ['No visitors right now',"We'll let you know when a friend stops by."]){
  const text=tree.find(n=>n.type==='Text'&&copy(n)===label);assert.equal(text.props.style.textAlign,'center');
 }
 const iconWrapper=tree.find(n=>n.type==='View'&&n.props.children?.type==='EmptyRoomIcon');assert.equal(iconWrapper.props.style.alignItems,'center');
 const action=tree.find(n=>n.type==='Text'&&copy(n)==='Back to Burrow');assert.equal(action.props.style[0].textAlign,'center');
 assert.equal(tree.find(n=>n.props?.testID==='friend-dialogue-block').props.style[1].width,300,'centred copy keeps the same padded reading column');
 const legacy=fs.readFileSync('apps/mobile/src/components/burrow/friend-visit-card.tsx','utf8');
 assert.ok(legacy.includes("We'll let you know when a friend stops by."));assert.doesNotMatch(legacy,/The room is quiet/);
});
test('visit reward submission uses a deferred wallet ticket without changing the choice or receipt',async()=>{
 let options;const calls=[],receipt={reward:10,coinState:{wallet:{balance:110,version:2}}};
 load('apps/mobile/src/lib/friend-visit-local.ts',{
  'react-native':{AppState:{currentState:'active'}},'./storage':{storage:{}},'../shared/storage/keys':{kFriendVisitLocal:{name:'visits'}},
  './burrow-store':{},'./session-lifecycle':{subscribeSessionIdentity(){}},
  './app-major-update-api':{answerPreparedFriendVisit:async(...args)=>{calls.push(args);return receipt;}},
  './friend-visit-local-state':{createFriendVisitLocalState:o=>{options=o;return {read:()=>undefined}; }},
  './coin-reward-store':{releaseCoinReward(){}},
  './prepared-burrow-images':{},'./burrow-art-assets':{},'./burrow-ui-assets':{},
 });
 const conversation={visitId:'visit',sessionId:'session',choices:[{id:'A',reward:10}]};
 assert.equal(await options.submit(conversation,'A'),receipt);assert.equal(calls[0][0],conversation);assert.equal(calls[0][1],'A');assert.equal(calls[0][2],false);assert.equal(calls[0][3],true);
});
test('only the first reply reveal releases the reward; intro, answer tap, later lines and Done do not replay it',()=>{
 const h=harness();h.press('Talk to');h.press('Tap to continue');h.press('Tap to continue');h.press('Love it');
 assert.equal(h.commands.includes('reward'),false);
 const visible=nodes(h.render()).find(n=>n.type==='Reveal'&&n.props.onVisible).props.onVisible;
 visible();assert.equal(h.commands.filter(c=>c==='reward').length,1);
 h.press('Tap to continue');assert.equal(nodes(h.render()).some(n=>n.type==='Reveal'&&n.props.onVisible),false);
 h.press('Tap to continue');h.press('Tap to continue');assert.equal(h.commands.filter(c=>c==='reward').length,1);
 h.h.unmount();assert.ok(h.commands.includes('dismiss-reward'));
});
test('a retained hidden visit dismisses any unreleased presentation without waiting for its request',()=>{
 const h=harness();h.press('Talk to');h.press('Tap to continue');h.press('Tap to continue');h.press('Love it');
 h.focus(false);assert.ok(h.commands.includes('dismiss-reward'));assert.equal(h.commands.includes('reward'),false);
 h.h.unmount();
});
test('no local/global saving spinner; shared Adventure layout owns the same 15% overlap',()=>{
 const h=harness();h.render();assert.ok(!nodes(h.render(true)).some(n=>n.type==='Spinner'));
 const layout=nodes(h.render()).find(n=>n.type==='EncounterLayout');assert.equal(layout.props.friendName,'Mr Mole');
 const source=fs.readFileSync('apps/mobile/src/components/burrow/couple-friend-visit-card.tsx','utf8');
 assert.ok(!source.includes('runBurrowAction'));assert.ok(!source.includes('ActivityIndicator'));
 const geometry=load('apps/mobile/src/lib/adventure-encounter-layout.ts');assert.equal(geometry.FRIEND_OVERLAP,.15);
});
test('duplicate outgoing native taps never skip an unread line or pop two navigation screens',()=>{
 const h=harness();h.render();h.press('Talk to');
 const tap=nodes(h.render()).find(n=>n.type==='Button'&&n.props.accessibilityLabel==='Tap to continue').props.onPress;
 tap();tap();assert.equal(h.row().step,1);
 h.press('Tap to continue');h.press('Love it');h.press('Tap to continue');h.press('Tap to continue');
 const done=nodes(h.render()).find(n=>n.type==='Button'&&n.props.accessibilityLabel==='Tap to continue').props.onPress;
 done();done();assert.equal(h.commands.filter(c=>c==='back').length,1);
});
test('expiry requests authoritative refresh; stale active conversation clears, local receipt remains',async()=>{
 const h=harness();h.data.friendVisit.expiresAt='2026-10-14T00:00:01Z';h.render();h.time.advance(1000);await flush();assert.ok(h.commands.includes('refresh'));
 assert.match(copy(h.render()),/No visitors right now/);assert.doesNotMatch(copy(h.render()),/Talk to/);
 h.data.friendVisit=null;h.render();assert.ok(!copy(h.render()).includes('Guess your partner'));
});
test('v2 pending red dot cannot be cleared by merely entering; per-viewer completion/expiry removes it',()=>{
 const at='2026-10-14T00:00:00Z';
 const {burrowAttentionCounts,markBurrowUpdatesSeen}=load('apps/mobile/src/lib/burrow-attention.ts',{
  react:{useSyncExternalStore(){}},'./storage':{storage:{getString:()=>undefined,set(){}}},
  '../shared/storage/keys':{kBurrowAttention:{keyFor:x=>x}},'./session-lifecycle':{sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './burrow-presentation':{adventureHasArrived:()=>false},'./burrow-moments-model':{momentKind:()=>null},
  './notification-readiness':{notificationReadiness:{ready:()=>true,subscribe:()=>()=>{},revision:()=>0}},
 });
 const data={profile:{id:'me'},partner:{id:'them'},pairAccessVerified:true,pairVersion:'v1',serverNow:at,localDate:'2026-10-14',friendVisitsVersion:2,
  friendVisit:{version:2,id:'visit',visit_date:'2026-10-14',myCompleted:false,expiresAt:null},quests:{quests:[]},specialQuests:[],memoryEntries:[]};
 markBurrowUpdatesSeen(data,'visits');assert.equal(burrowAttentionCounts(data).rooms.friends_room,1);
 data.friendVisit.myCompleted=true;assert.equal(burrowAttentionCounts(data).rooms.friends_room,0);
 data.friendVisit.myCompleted=false;data.friendVisit.expiresAt=at;assert.equal(burrowAttentionCounts(data,Date.parse(at)).rooms.friends_room,0);
 assert.ok(!fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8').includes("markBurrowUpdatesSeen(data,'visits')"));
});
test('API v2 sessions require scope/valid choices, always bind to authenticated actor, preserve coin receipt',async()=>{
 const calls=[];
 const route=load('apps/api/src/app/api/vnext/command/route.js',{'@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=> '11111111-1111-4111-8111-111111111111',majorUpdateEnabled:async()=>true,commandStatus:()=>200,
    appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:{feedback:['Answer'],coinReward:{key:'receipt',amount:10}},error:null};}})},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_,__,r)=>({...r,coinState:{wallet:{balance:10,version:1}}})},
 });
 const post=body=>route.POST({text:async()=>JSON.stringify(body)});
 const payload={action:'respond_friend_visit_v2',visitId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333',pairVersion:'a'.repeat(32),choiceId:'A',userId:'forged'};
 for(const bad of [{...payload,pairVersion:'bad'},{...payload,sessionId:'bad'},{...payload,choiceId:'D'}])assert.equal((await post(bad)).status,400);
 assert.equal(calls.length,0);const result=await post(payload);assert.equal(calls[0][1].p_user_id,'11111111-1111-4111-8111-111111111111');assert.equal(result.body.coinReward.amount,10);assert.ok(result.body.coinState);
 const prepared=await post({...payload,action:'respond_friend_visit_v3',reward:99999,feedback:['forged']});
 assert.ok(prepared.body.coinState);assert.equal(calls.at(-1)[0],'respond_friend_visit_v3');
 assert.equal(calls.at(-1)[1].p_user_id,'11111111-1111-4111-8111-111111111111');assert.equal(calls.at(-1)[1].reward,undefined);
 assert.equal((await post({...payload,action:'respond_friend_visit_v3',choiceId:'D'})).status,400);
 await post({...payload,action:'prepare_friend_visit_v3'});assert.equal(calls.at(-1)[0],'prepare_friend_visit_v3');assert.equal(calls.at(-1)[1].p_session_id,undefined);
});
test('rolling deployment keeps old clients safe, while v2 opts into its sanitized bootstrap projection',async()=>{
 const {projectFriendVisitBootstrap}=load('apps/api/src/lib/burrow-friend-visits.mjs');
 const view={version:2,id:'visit',myCompleted:false};const raw={friendVisitsVersion:2,friendVisit:null,coupleFriendVisit:view,wallet:{balance:10}};
 const old=projectFriendVisitBootstrap(raw,false);assert.equal(old.friendVisit,null);assert.equal(old.friendVisitsVersion,undefined);assert.equal(old.coupleFriendVisit,undefined);
 const current=projectFriendVisitBootstrap(raw,true);assert.equal(current.friendVisit.id,'visit');assert.equal(current.friendVisitsVersion,2);assert.equal(current.coupleFriendVisit,undefined);
 const legacy={friendVisit:{content_snapshot:{prompt:'Legacy'}}};assert.equal(projectFriendVisitBootstrap(legacy,true),legacy);
 const calls=[];const api=load('apps/mobile/src/lib/app-major-update-api.ts',{'expo-crypto':{},
   ...require('./rating-test-mocks.cjs'),
   './api':{apiClient:{get:async(url)=>{calls.push(url);return {success:true};}}},'./async-lifecycle':{withDeadline:v=>v},
   './session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity(){}},'./coin-reward-store':{},
 });await api.fetchMajorUpdateBootstrap();assert.equal(calls[0],'/api/vnext/bootstrap?friendVisits=2');
});
