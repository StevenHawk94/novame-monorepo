const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness({history=false,canBack=true,width=393,height=852,fontScale=1}={}){
 const h=hooks(),reads=[],routes=[],saved=[],drafts=new Map(),toasts=[],gestures=[],request=deferred();let pageRead=[],identity='me';
 const answer=(id,authorId,body)=>({id,authorId,body,createdAt:'2026-10-24T12:00:00Z',updatedAt:'2026-10-24T12:00:00Z'});
 const today={id:'today',date:'2026-10-24',pageNumber:2,question:'Current question',questionId:'cj_02',answers:[answer('b','you','Their '.repeat(100))]};
 let snapshot={protocol:2,today,history:Array.from({length:8},(_,i)=>({id:'p'+i,pageNumber:i+1,date:'2026-10-23',question:'Past question '+i,answers:[answer('a'+i,'you','Past words')]})),hasMore:false};
 const data={profile:{id:'me',display_name:'Me'},partner:{id:'you',display_name:'You'},pairVersion:'one'};
 const jsx=(type,props)=>({type,props});const journal={subscribeCoupleJournalCache:()=>()=>{},preparedCoupleJournalVersion:()=>undefined,cachedCoupleJournal:()=>snapshot,localCoupleJournal:()=>snapshot,
  cacheCoupleJournal:(_s,next)=>snapshot=next,configureJournal(){},fetchCoupleJournal:()=>request.promise,fetchCoupleJournalPage:async id=>snapshot.history.find(p=>p.id===id),
  acknowledgeJournal:(_s,p)=>pageRead.push(p.id),journalJobs:()=>[],enqueueJournal:(_s,p,body,expected,key)=>{saved.push({p,body,expected,key});snapshot={...snapshot,today:{...p,answers:[...p.answers,answer('new','me',body)]}};},discardRejectedJournal(){}};
 const {CoupleJournalScreen}=load('apps/mobile/src/components/burrow/couple-journal-screen.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},BackHandler:{addEventListener:()=>({remove(){}})},Keyboard:{dismiss(){}},Platform:{OS:'ios',select:x=>x.ios},Pressable:'Pressable',ScrollView:'ScrollView',StatusBar:'StatusBar',StyleSheet:{create:x=>x,absoluteFillObject:{}},Text:'Text',TextInput:'TextInput',View:'View'},
  'expo-router':{router:{canGoBack:()=>canBack,back:()=>routes.push('back'),replace:r=>routes.push(r)}},'@react-navigation/native':{useIsFocused:()=>true},
  '@expo/vector-icons':{Feather:'Feather'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:24,bottom:20})},'@/lib/app-viewport':{useAppViewport:()=>({width,height,fontScale})},
  '@/lib/memories-room-layout':load('apps/mobile/src/lib/memories-room-layout.ts'),
  '@/lib/burrow-store':{useBurrowSelector:select=>select({data})},'@/lib/use-partner-entry-gate':{usePartnerEntryGate(){}},'@/lib/use-page-back-gesture':{usePageBackGesture:x=>gestures.push(x)},
  '@/lib/burrow-text-drafts':{readBurrowTextDraft:(_s,p)=>drafts.get(p),keepBurrowTextDraft:(_s,p,body,expected)=>{const d={body,expectedUpdatedAt:expected,key:'k'};drafts.set(p,d);return d;},rebaseBurrowTextDraft(){}},
  '@/lib/couple-journal':journal,'@/lib/couple-journal-questions':{localJournalPageId:d=>'local:'+d},
  '@/lib/burrow-attention':{subscribeAttention:()=>()=>{},attentionRevision:()=>0,unreadBurrowUpdateIds:()=>['p0'],hasJournalHistoryReminder:()=>true,journalRenderedAttentionIds:(_d,p)=>[p.id],markBurrowUpdatesSeen:(_d,_c,ids)=>reads.push(...ids),dismissJournalHistoryReminder(){}},
  '@/lib/notification-content-version':{notificationContentVersion:()=> 'one'},'@/lib/session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=>identity},'@/lib/burrow-toast':{showBurrowToast:x=>toasts.push(x)},
  '@/lib/room-header-typography':{ROOM_TITLE_STYLE:{}},'@/components/layout/app-modal':{AppModal:'Modal'},'@/components/ui/user-avatar':{UserAvatar:'Avatar'},'./burrow-back-button':{BurrowBackButton:'Back'},'./burrow-image':{Image:'Image'},'../../../assets/burrow-webp/memories-room.webp':'background',
 });
 const render=()=>h.render(()=>CoupleJournalScreen({historyPage:history}));
 const find=(t,label)=>nodes(t).find(n=>n.props?.accessibilityLabel===label);
 return{render,find,h,reads,pageRead,routes,saved,drafts,toasts,gestures,request,setIdentity:value=>identity=value,get snapshot(){return snapshot;}};
}
test('saved previews truncate without changing original; both answers open full text',()=>{
 const s=harness();let tree=s.render();const text=nodes(tree).find(n=>n.props?.ellipsizeMode==='tail'&&String(n.props.children).startsWith('Their'));
 assert.equal(text.props.numberOfLines,4);s.find(tree,'Read full answer').props.onPress();tree=s.render();
 assert.equal(nodes(tree).find(n=>n.type==='Modal').props.visible,true);assert.ok(nodes(tree).some(n=>n.props?.selectable&&n.props.children===s.snapshot.today.answers[0].body));
 s.find(tree,'Close answer').props.onPress();assert.equal(nodes(s.render()).find(n=>n.type==='Modal').props.visible,false);s.h.unmount();
});
test('typing keeps draft, immediate Save queues without waiting and only own answer has Edit',async()=>{
 const s=harness();let tree=s.render();assert.equal(s.find(tree,'Edit your answer'),undefined);
 await s.find(tree,'Write your answer').props.onPress();tree=s.render();s.find(tree,'Your journal answer').props.onChangeText('My saved words');tree=s.render();
 assert.equal(s.drafts.get('today').body,'My saved words');s.find(tree,'Save journal answer').props.onPress();tree=s.render();
 assert.equal(s.saved.length,1);assert.deepEqual(s.toasts,['Saved']);assert.ok(s.find(tree,'Edit your answer'));assert.equal(s.gestures.at(-1),true);
 s.find(tree,'Back').props.onPress();s.find(tree,'Back').props.onPress();assert.deepEqual(s.routes,['back']);s.h.unmount();
});
test('editing can leave in one Back; draft retained and missing navigation stack has safe fallback',async()=>{
 const s=harness({canBack:false});let tree=s.render();await s.find(tree,'Write your answer').props.onPress();tree=s.render();
 s.find(tree,'Your journal answer').props.onChangeText('Keep me');tree=s.render();s.find(tree,'Back').props.onPress();
 assert.deepEqual(s.routes,['/(main)/(tabs)/burrow']);assert.equal(s.drafts.get('today').body,'Keep me');s.h.unmount();
});
test('History is paginated, opens page detail, and never acknowledges Today behind it',()=>{
 const s=harness({history:true});let tree=s.render();assert.deepEqual(s.pageRead,[]);
 const rows=nodes(tree).filter(n=>n.props?.accessibilityLabel?.startsWith('Open page '));assert.equal(rows.length,4,'four rows fit inside the paper, not five based on the full screen');
 s.find(tree,'Next history page').props.onPress();tree=s.render();assert.equal(nodes(tree).filter(n=>n.props?.accessibilityLabel?.startsWith('Open page ')).length,4);
 s.find(tree,'Previous history page').props.onPress();tree=s.render();s.find(tree,'Open page 1, Past question 0').props.onPress();tree=s.render();
 assert.ok(s.pageRead.includes('p0'));assert.ok(!s.pageRead.includes('today'));assert.ok(s.find(tree,'Read full answer'));s.h.unmount();
});
test('switching identity immediately hides an open private answer before effects run',()=>{
 const s=harness();let tree=s.render();s.find(tree,'Read full answer').props.onPress();tree=s.render();
 assert.equal(nodes(tree).find(n=>n.type==='Modal').props.visible,true);s.setIdentity('other');tree=s.render();
 assert.equal(nodes(tree).find(n=>n.type==='Modal').props.visible,false);s.h.unmount();
});
test('Today and History share artwork-aligned bounds and native root resize cannot push them off the paper',()=>{
 const geometry=load('apps/mobile/src/lib/memories-room-layout.ts');
 for(const history of [false,true])for(const [width,height,fontScale] of [[320,568,1],[393,852,1],[414,896,1],[430,932,1],[393,852,1.8],[852,393,1]]){
  const s=harness({history,width,height,fontScale});let tree=s.render();
  const paper=nodes(tree).find(n=>n.props?.testID==='memories-paper-content'),bounds=paper.props.style[1];
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)),JSON.parse(JSON.stringify(geometry.memoriesRoomLayout(width,height,fontScale).page)));
  assert.ok(bounds.left>=width*130/841);assert.ok(bounds.left+bounds.width<=width*710/841);
  assert.ok(bounds.top>=height*350/1870);assert.ok(bounds.top+bounds.height<=height*1550/1870);
  assert.equal(paper.props.contentInsetAdjustmentBehavior,'never');assert.equal(paper.props.automaticallyAdjustContentInsets,false);
  assert.equal(paper.props.style[0].overflow,'hidden');
  assert.equal(paper.props.contentContainerStyle.paddingLeft,undefined,'no second, independent screen inset');
  tree.props.onLayout({nativeEvent:{layout:{width:width-10,height:height-40}}});tree=s.render();
  const resized=nodes(tree).find(n=>n.props?.testID==='memories-paper-content');
  assert.equal(resized.props.style[1].width,geometry.memoriesRoomLayout(width-10,height-40,fontScale).page.width);s.h.unmount();
 }
});
test('History capacity uses bounded paper height and respects large fonts instead of overflowing the background',()=>{
 const {memoriesRoomLayout:layout}=load('apps/mobile/src/lib/memories-room-layout.ts');
 assert.equal(layout(393,852).historyPageSize,4);assert.equal(layout(430,1100).historyPageSize,5);
 assert.ok(layout(320,568).historyPageSize<4);assert.ok(layout(393,852,1.8).historyPageSize<4);
});
