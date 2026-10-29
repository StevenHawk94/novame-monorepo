const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/love-note-model.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const jsx=(type,props)=>({type,props});
const at='2026-10-14T03:42:00Z';
const note=(id='received',author='them',body='Hello\n\nLove you.',created=at)=>({id,author_id:author,body:`💌 ${body}`,created_at:created,updated_at:created,prompt_id:null});
const snapshot=()=>({profile:{id:'me',timezone_name:'America/Los_Angeles'},partner:{id:'them',display_name:'Alex'},pairVersion:'one',memoryEntries:[]});
function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree||typeof tree!=='object')return [];
  if(typeof tree.type==='function')return nodes(tree.type(tree.props));
  const extra=tree.type==='SectionList'?tree.props.sections.flatMap(section=>[
    tree.props.renderSectionHeader({section}),...section.data.map(item=>tree.props.renderItem({item}))]):[];
  return [tree,...nodes(tree.props?.children),...nodes(extra),...nodes(tree.props?.ListEmptyComponent),...nodes(tree.props?.ListFooterComponent)];
}
test('note model excludes journals/other authors, deduplicates newest revisions, and sorts newest first',()=>{
  const data=snapshot(),older=note('older','me','Sent','2026-09-29T00:00:00Z');
  const latest={...note(),updated_at:'2026-10-15T00:00:00Z',body:'💌 Updated'};
  const rows=model.mergeLoveNotes(data,[older,note(),note('stranger','other'),{...note('journal'),body:'Journal'}],[latest]);
  assert.deepEqual(plain(rows.map(row=>row.id)),['received','older']);
  assert.equal(model.loveNoteBody(rows[0]),'Updated');assert.equal(model.notesForTab(data,rows,'sent')[0].id,'older');
  assert.deepEqual(plain(model.loveNoteSections(rows,'America/Los_Angeles').map(section=>section.title)),['October 2026','September 2026']);
  assert.equal(model.loveNoteDate(at,'America/Los_Angeles',true),'Oct 13, 2026 · 8:42 PM');
  assert.equal(model.loveNoteDate('bad',null,true),' · ');
});
test('quota messages distinguish minute/day rejections from uncertain connection failures',()=>{
 assert.match(model.loveNoteLimitMessage({body:{error:'love_note_minute_limit'}}),/5 Love Notes per minute/);
 assert.match(model.loveNoteLimitMessage(Error('love_note_daily_limit')),/100 Love Notes/);
 for(const error of [null,{},Error('offline'),{body:{error:'Internal error'}}])assert.equal(model.loveNoteLimitMessage(error),null);
});
function screenHarness({rows=[],unread=[],compose=false,noteId}={}){
  const h=hooks(),time=clock(),data=snapshot(),paths=[],marks=[],writes=[],clears=[],commands=[],saves=[],backHandlers=[],overlays=new Set(),uiJobs=[];
  let epoch=1,focused=true,readIds=[...unread],draft=null;
  const feed={rows,focused:true,entryReady:true,loading:false,failed:false,loaded:true,hasMore:false,load(){}};
  const module=load('apps/mobile/src/components/burrow/love-note-screen.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Text:'Text',Pressable:'Button',ScrollView:'Scroll',SectionList:'SectionList',TextInput:'Input',KeyboardAvoidingView:'KeyboardView',ActivityIndicator:'Spinner',BackHandler:{addEventListener:(name,fn)=>{backHandlers.push(fn);return{remove(){}};}},Platform:{OS:'ios'},StyleSheet:{create:v=>v,hairlineWidth:1,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}}},
    'expo-router':{router:{push:path=>paths.push(path),replace:path=>paths.push(path),back:()=>paths.push('back'),canGoBack:()=>feed.canGoBack!==false}},
    '@react-navigation/native':{usePreventRemove:(enabled,callback)=>{feed.removal={enabled,callback};}},
    '@expo/vector-icons':{Feather:'Icon',MaterialIcons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
    '@/lib/app-major-update-api':{saveMemoryRoomEntry:(...args)=>{commands.push(args);return Promise.resolve();}},
    '@/lib/burrow-attention':{attentionScope:()=>`me:them:${data.pairVersion}`,useBurrowAttention(){},unreadBurrowUpdateIds:()=>readIds,
      markBurrowUpdatesSeen:(_data,channel,ids)=>{marks.push({channel,ids:plain(ids)});readIds=readIds.filter(id=>!ids.includes(id));}},
    '@/lib/use-love-notes':{useLoveNotes:(_data,options)=>{feed.enabled=options?.enabled;return {...feed,focused};}},'@/lib/love-note-model':model,
    '@/lib/burrow-text-drafts':{readBurrowTextDraft:()=>draft,keepBurrowTextDraft:(scope,target,body)=>{writes.push({scope,target,body});if(draft?.body!==body)draft={body,key:`key-${writes.length}`};return draft;},removeBurrowTextDraft:(...args)=>clears.push(args)},
    '@/lib/burrow-store':{recoverLoveNote:()=>undefined,enqueueLoveNote:(_data,body,key)=>{
      if(feed.localFailure)throw Error('disk_full');
      saves.push({body,key,request:deferred()});
    }},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch},'./burrow-back-button':{BurrowBackButton:'Back'},
    '@/lib/ui-idle':{afterUiSettles:fn=>{const job={fn,live:true};uiJobs.push(job);return()=>{job.live=false;};}},
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:path=>paths.push(path)},
    '@/lib/overlay-presence':{registerOverlay:owner=>{overlays.add(owner);return()=>overlays.delete(owner);}},
  },time.globals);
  const render=()=>h.render(()=>module.LoveNoteScreen({data,compose,noteId,autoFocusReady:feed.entryReady}));
  const history=()=>h.render(()=>module.LoveNoteHistoryScreen({data}));
  return {h,render,history,paths,marks,writes,clears,saves,commands,feed,data,backHandlers,overlays,time,uiJobs,
    settleUi(){uiJobs.splice(0).forEach(job=>{if(job.live)job.fn();});},
    focus(value){focused=value;},changeEpoch(){epoch++;},get draft(){return draft;},button:(tree,label)=>nodes(tree).find(node=>node.type==='Button'&&nodes(node).some(child=>child.type==='Text'&&child.props.children===label))};
}
test('default composer matches header/input/footer and opens native History, not a received-list tab',()=>{
  const h=screenHarness({rows:[note()]});const tree=nodes(h.render());
  assert.equal(tree.find(n=>n.type==='Input').props.maxLength,500);
  assert.equal(tree.find(n=>n.type==='Input').props.placeholder,'Write something from your heart...');
  assert.notEqual(tree.find(n=>n.type==='Input').props.autoFocus,true,'automatic focus is coordinated with the native transition, not input mount');
  assert.equal(h.button(h.render(),'Send Love Note').props.disabled,true);assert.equal(h.feed.enabled,false,'composing must not fetch old letters');
  tree.find(n=>n.props.accessibilityLabel==='Love Note History').props.onPress();
  assert.deepEqual(h.paths,['/(main)/love-note-history']);assert.equal(h.marks.length,0);
  assert.equal(tree.some(n=>n.props.accessibilityRole==='tab'),false);h.h.unmount();
});
test('composer opens immediately but requests the keyboard once only after UI settles; typing never reschedules it',()=>{
 const h=screenHarness({compose:true});let focus=0;
 const editor=nodes(h.render()).find(n=>n.type==='Input');editor.props.ref.current={focus:()=>focus++,isFocused:()=>false};
 assert.equal(focus,0);assert.equal(h.uiJobs.length,1);assert.equal(h.feed.enabled,false);
 h.settleUi();assert.equal(focus,1);
 editor.props.onChangeText('Typing is immediate');h.render();h.settleUi();
 assert.equal(focus,1);assert.equal(nodes(h.render()).find(n=>n.type==='Input').props.value,'Typing is immediate');h.h.unmount();
});
test('idle JS before a native appearance is not enough to open the keyboard; late content uses the route appearance state',()=>{
 const h=screenHarness({compose:true});h.feed.entryReady=false;let focus=0;
 const editor=nodes(h.render()).find(n=>n.type==='Input');editor.props.ref.current={focus:()=>focus++,isFocused:()=>false};
 h.settleUi();assert.equal(focus,0);assert.equal(h.uiJobs.length,0);
 h.feed.entryReady=true;h.render();h.settleUi();assert.equal(focus,1);h.h.unmount();
 const route=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');
 assert.match(route,/const entrySettled=usePageEntrySettled\(kind==='letter'\)/);
 assert.ok(route.indexOf('usePageEntrySettled(kind')<route.indexOf('if(!data)return'));
 assert.match(route,/autoFocusReady=\{entrySettled\}/);
});
test('native entry readiness uses actual appearance, resets on blur/closing, and cleans up listeners',()=>{
 const h=hooks(),events=new Map();let focused=true,enabled=true;
 const navigation={isFocused:()=>focused,addListener:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);}};
 const module=load('apps/mobile/src/lib/use-page-entry-settled.ts',{
  react:h.react,'react-native':{Platform:{OS:'ios'}},'@react-navigation/native':{useNavigation:()=>navigation,useIsFocused:()=>focused},
 });
 const render=()=>h.render(()=>module.usePageEntrySettled(enabled));
 assert.equal(render(),false);events.get('transitionStart')({data:{closing:false}});assert.equal(render(),false);
 events.get('transitionEnd')({data:{closing:true}});assert.equal(render(),false);
 events.get('transitionEnd')({data:{closing:false}});assert.equal(render(),true);
 focused=false;render();assert.equal(render(),false);events.get('transitionEnd')({data:{closing:false}});assert.equal(render(),false);
 focused=true;assert.equal(render(),false);events.get('transitionEnd')({data:{closing:false}});assert.equal(render(),true);
 events.get('transitionStart')({data:{closing:true}});assert.equal(render(),false);
 events.get('gestureCancel')({});assert.equal(render(),true);
 enabled=false;assert.equal(render(),true);assert.equal(events.size,0);h.unmount();assert.equal(events.size,0);
});
for(const reason of ['blur','unmount','account','pair'])test(`pending keyboard work cannot refocus a stale composer after ${reason}`,()=>{
 const h=screenHarness({compose:true});let focus=0;
 nodes(h.render()).find(n=>n.type==='Input').props.ref.current={focus:()=>focus++,isFocused:()=>false};
 if(reason==='blur'){h.focus(false);h.render();}
 else if(reason==='unmount')h.h.unmount();
 else if(reason==='account')h.changeEpoch();
 else {h.data.pairVersion='two';h.render();}
 if(reason==='pair')h.uiJobs.slice(0,-1).forEach(job=>{if(job.live)job.fn();});else h.settleUi();
 assert.equal(focus,0);h.h.unmount();
});
test('received reading pages never queue keyboard work, and an already focused editor is not focused twice',()=>{
 const n=note(),read=screenHarness({rows:[n],unread:[model.loveNoteKey(n)]});read.render();assert.equal(read.uiJobs.length,0);read.h.unmount();
 const h=screenHarness({compose:true});let focus=0;
 nodes(h.render()).find(n=>n.type==='Input').props.ref.current={focus:()=>focus++,isFocused:()=>true};h.settleUi();assert.equal(focus,0);h.h.unmount();
});
test('incoming entry reads one unread note; acknowledgement never jumps to composer or clears other letters',()=>{
  const a=note('a'),b=note('b');const h=screenHarness({rows:[a,b],unread:[model.loveNoteKey(a),model.loveNoteKey(b)]});
  h.render();const tree=nodes(h.render());
  assert.equal(tree.some(n=>n.type==='Input'),false);assert.ok(tree.some(n=>n.props.children==='Hello\n\nLove you.'));
  assert.deepEqual(h.marks,[{channel:'letters',ids:[model.loveNoteKey(a)]}]);assert.equal(h.feed.enabled,true);
  h.button(h.render(),'Write Back').props.onPress();
  assert.deepEqual(plain(h.paths[0]),{pathname:'/(main)/room-interaction',params:{kind:'letter',compose:'1'}});h.h.unmount();
});
test('Write Back forces composer even while other incoming notes remain unread',()=>{
  const a=note(),h=screenHarness({rows:[a],unread:[model.loveNoteKey(a)],compose:true});
  assert.ok(nodes(h.render()).some(n=>n.type==='Input'));assert.equal(h.marks.length,0);h.h.unmount();
});
test('Home incoming note closes directly; native swipe is not intercepted or redirected to History',()=>{
  const a=note(),h=screenHarness({rows:[a],unread:[model.loveNoteKey(a)]}),tree=h.render();
  assert.notEqual(h.feed.removal?.enabled,true,'native pop must remain free');
  nodes(tree).find(n=>n.type==='Back').props.onPress();h.render();
  assert.deepEqual(h.paths,['back']);assert.deepEqual(h.marks,[{channel:'letters',ids:[model.loveNoteKey(a)]}]);h.h.unmount();
});
test('incoming close without a native back stack falls back to retained Home, not History',()=>{
 const a=note(),h=screenHarness({rows:[a],unread:[model.loveNoteKey(a)]});h.feed.canGoBack=false;
 nodes(h.render()).find(n=>n.type==='Back').props.onPress();assert.deepEqual(h.paths,['/(main)/(tabs)']);h.h.unmount();
});
test('arriving letters do not overwrite a composer already in use',()=>{
  const h=screenHarness();nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Still writing');
  h.feed.rows.push(note());
  assert.equal(nodes(h.render()).find(n=>n.type==='Input').props.value,'Still writing');assert.equal(h.feed.enabled,false);h.h.unmount();
});
test('unread opens oldest first and Next Note advances chronologically without auto-skipping the visible note',()=>{
  const older=note('older','them','First letter','2026-10-01T00:00:00Z'),newer=note('newer','them','Second letter','2026-10-10T00:00:00Z');
  const h=screenHarness({rows:[newer,older],unread:[model.loveNoteKey(newer),model.loveNoteKey(older)]});
  h.render();let tree=nodes(h.render());assert.ok(tree.some(n=>n.props.children==='First letter'));
  assert.deepEqual(h.marks.map(m=>m.ids[0]),[model.loveNoteKey(older)]);
  h.button(h.render(),'Next Note').props.onPress();h.render();tree=nodes(h.render());
  assert.ok(tree.some(n=>n.props.children==='Second letter'));assert.equal(h.button(h.render(),'Next Note'),undefined);
  assert.deepEqual(h.marks.map(m=>m.ids[0]),[model.loveNoteKey(older),model.loveNoteKey(newer)]);h.h.unmount();
});
test('a loaded recent unread must not jump ahead of an older unread on a later page',()=>{
  const older=note('old','them','Old first','2026-09-01T00:00:00Z'),newer=note();
  const h=screenHarness({rows:[newer],unread:[model.loveNoteKey(newer),model.loveNoteKey(older)]});
  h.feed.loaded=false;h.feed.hasMore=false;h.render();assert.equal(h.marks.length,0);
  let calls=0;h.feed.loaded=true;h.feed.hasMore=true;h.feed.load=()=>calls++;
  assert.ok(nodes(h.render()).some(n=>n.type==='Spinner'));assert.equal(calls,1);assert.equal(h.marks.length,0);
  h.feed.rows=[newer,older];h.feed.hasMore=false;h.render();
  assert.ok(nodes(h.render()).some(n=>n.props.children==='Old first'));assert.deepEqual(h.marks[0].ids,[model.loveNoteKey(older)]);h.h.unmount();
});
test('oldest selection is stable for ties, exact revisions, missing/deleted bodies and does not mutate History',()=>{
  const a=note('a'),b=note('b'),rows=[b,a],unread=[model.loveNoteKey(b),model.loveNoteKey(a),'deleted:revision'];
  assert.equal(model.oldestUnreadLoveNote(rows,unread),undefined);
  assert.equal(model.oldestUnreadLoveNote(rows,unread,true).id,'a');assert.equal(rows[0].id,'b');
  assert.equal(model.oldestUnreadLoveNote(rows,['a:new-revision']),undefined);
});
test('Send retains native input focus but immediately shows success without a cloud wait',async()=>{
  const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Stay focused');
  h.button(h.render(),'Send Love Note').props.onPress();let input=nodes(h.render()).find(n=>n.type==='Input');
  assert.notEqual(input.props.editable,false);input.props.onChangeText('Ignored during send');
  assert.equal(nodes(h.render()).find(n=>n.type==='Input').props.value,'Stay focused');
  assert.doesNotMatch(fs.readFileSync('apps/mobile/src/components/burrow/love-note-screen.tsx','utf8'),/Keyboard\.dismiss|\.blur\(/);
  h.time.advance(1000);assert.ok(h.button(h.render(),'Love Note Sent ✓'));assert.equal(h.clears.length,1);
  assert.notEqual(input.props.editable,false);h.h.unmount();
});
test('local journal failure keeps draft and key, does not show false success, and can retry',async()=>{
 const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Keep my letter');
 const draft=h.draft;h.feed.localFailure=true;h.button(h.render(),'Send Love Note').props.onPress();
 const tree=nodes(h.render());assert.equal(tree.find(n=>n.type==='Input').props.value,'Keep my letter');
 assert.ok(tree.some(n=>n.props.accessibilityRole==='alert'));
 assert.equal(h.clears.length,0);assert.equal(h.paths.length,0);assert.equal(h.button(h.render(),'Done'),undefined);
 h.feed.localFailure=false;h.button(h.render(),'Send Love Note').props.onPress();assert.equal(h.saves[0].key,draft.key);
 h.time.advance(1000);assert.equal(h.clears.length,1);assert.ok(h.button(h.render(),'Love Note Sent ✓'));h.h.unmount();
});
test('unread metadata fetches the specific body beyond journal pages without clearing unread first',()=>{
  const a=note('missing'),h=screenHarness({unread:[model.loveNoteKey(a)]});
  let calls=0;h.feed.hasMore=true;h.feed.load=more=>{assert.equal(more,true);calls++;};
  let tree=nodes(h.render());assert.ok(tree.some(n=>n.type==='Spinner'));assert.equal(h.marks.length,0);assert.equal(calls,1);
  h.feed.rows=[a];h.feed.hasMore=false;h.render();tree=nodes(h.render());
  assert.ok(tree.some(n=>n.props.children==='Hello\n\nLove you.'));assert.deepEqual(h.marks[0].ids,[model.loveNoteKey(a)]);h.h.unmount();
});
test('History has monthly Received/Sent tabs, preserves unread until detail opens, and never puts body in URL',()=>{
  const a=note(),b=note('sent','me','Private sent note','2026-09-29T00:00:00Z');
  const h=screenHarness({rows:[a,b],unread:[model.loveNoteKey(a)]});
  let tree=nodes(h.history());assert.ok(tree.some(n=>n.props.children==='● New'));assert.equal(h.marks.length,0);
  const list=tree.find(n=>n.type==='SectionList');assert.equal(list.props.bounces,false);
  assert.deepEqual(plain(list.props.sections.map(section=>section.title)),['October 2026']);
  tree.find(n=>n.props.accessibilityLabel?.startsWith('Read received')).props.onPress();
  assert.deepEqual(plain(h.paths[0]),{pathname:'/(main)/love-note-detail',params:{id:'received'}});
  h.button(h.history(),'Sent').props.onPress();tree=nodes(h.history());
  assert.ok(tree.some(n=>n.props.children==='Private sent note'));assert.ok(!tree.some(n=>n.props.children==='● New'));
  assert.equal(h.marks.length,0);h.h.unmount();
});
test('only focused received details acknowledge; sent details do not',()=>{
  for(const author of ['me','them']){
    const a=note('id',author),h=screenHarness({rows:[a],unread:[model.loveNoteKey(a)],noteId:'id'});
    h.focus(false);h.render();assert.equal(h.marks.length,0);
    h.focus(true);h.render();assert.equal(h.marks.length,author==='them'?1:0);h.h.unmount();
  }
});
test('draft is durable, rapid sends share one request, retry reuses receipt, successful send clears only that draft',async()=>{
  const h=screenHarness({compose:true});
  nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('From my heart');
  const send=h.button(h.render(),'Send Love Note');send.props.onPress();send.props.onPress();
  assert.equal(h.saves.length,1);assert.deepEqual(plain(h.saves[0].body),'From my heart');assert.equal(h.saves[0].key,h.draft.key);
  assert.equal(nodes(h.render()).some(n=>n.type==='Modal'),false);assert.equal(h.paths.length,0);
  assert.equal(h.clears.length,1);h.time.advance(1000);assert.equal(h.button(h.render(),'Love Note Sent ✓').props.disabled,true);h.h.unmount();
});
test('local button spins exactly one second, acknowledges without a dialog or network wait, then clears sent text',()=>{
 const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('A little love');
 h.button(h.render(),'Send Love Note').props.onPress();let tree=nodes(h.render());
 assert.ok(tree.some(n=>n.type==='Spinner'&&n.props.accessibilityLabel==='Sending love note'));
 assert.equal(tree.find(n=>n.type==='Input').props.value,'A little love');
 h.time.advance(999);assert.equal(h.button(h.render(),'Love Note Sent ✓'),undefined);
 h.time.advance(1);tree=nodes(h.render());assert.ok(h.button(h.render(),'Love Note Sent ✓'));
 assert.equal(tree.find(n=>n.type==='Input').props.value,'');assert.notEqual(tree.find(n=>n.type==='Input').props.editable,false);
 assert.equal(tree.some(n=>n.props.accessibilityViewIsModal||n.props.testID==='love-note-sent'),false);assert.equal(h.overlays.size,0);assert.equal(h.button(h.render(),'Done'),undefined);
 assert.deepEqual(h.paths,[],'feedback never navigates automatically');assert.equal(h.saves.length,1,'the server request remains unresolved');
 tree.find(n=>n.type==='Input').props.onChangeText('Another note');assert.ok(h.button(h.render(),'Send Love Note'));h.h.unmount();
 assert.equal(h.time.timers.size,0);
});
test('a second typed note creates a separate intent and leaving cancels only local feedback',()=>{
 const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('First');h.button(h.render(),'Send Love Note').props.onPress();
 h.time.advance(1000);nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Second');h.button(h.render(),'Send Love Note').props.onPress();
 assert.deepEqual(h.saves.map(s=>s.body),['First','Second']);assert.notEqual(h.saves[0].key,h.saves[1].key);
 h.h.unmount();assert.equal(h.time.timers.size,0);h.time.advance(5000);assert.equal(h.saves.length,2);assert.deepEqual(h.paths,[]);
});
test('system dismissal also exits Home; stale success callbacks cannot navigate after account/pair changes or unmount',async()=>{
  for(const kind of ['system','account','pair','unmount']){
    const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Love');
    h.button(h.render(),'Send Love Note').props.onPress();h.saves[0].request.resolve(true);await flush();
    h.render();const close=h.backHandlers.at(-1);
    if(kind==='account')h.changeEpoch();else if(kind==='pair'){h.data.pairVersion='new';h.render();}else if(kind==='unmount')h.h.unmount();
    close();assert.deepEqual(h.paths,kind==='system'?['/(main)/(tabs)']:[]);h.h.unmount();
  }
});
test('unpaired save retains its existing behavior and labels success as Saved, not Sent',async()=>{
  const h=screenHarness({compose:true});h.data.partner=null;nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('For later');
  h.button(h.render(),'Save Love Note').props.onPress();h.saves[0].request.resolve(true);await flush();
  h.time.advance(1000);assert.ok(h.button(h.render(),'Love Note Saved ✓'));h.backHandlers.at(-1)();assert.deepEqual(h.paths,['/(main)/(tabs)']);h.h.unmount();
});
test('late account responses do not perform any additional draft cleanup',async()=>{
  const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Keep this');
  h.button(h.render(),'Send Love Note').props.onPress();h.changeEpoch();h.saves[0].request.resolve(true);await flush();
  assert.equal(h.clears.length,1);h.h.unmount();
});
test('leaving a sending screen does not cancel a confirmed send or navigate again',async()=>{
  const h=screenHarness({compose:true});nodes(h.render()).find(n=>n.type==='Input').props.onChangeText('Send me');
  h.button(h.render(),'Send Love Note').props.onPress();h.h.unmount();
  h.saves[0].request.resolve(true);await flush();assert.equal(h.clears.length,1);assert.equal(h.paths.length,0);
});
test('note pagination handles journal-only pages, cache is pair-scoped and late/unfocused responses are rejected',async()=>{
  let h=hooks(),focused=true,epoch=1,owner='me';const requests=[],listeners=[];
  const react=Object.fromEntries(Object.keys(h.react).map(key=>[key,(...args)=>h.react[key](...args)]));
  const api=load('apps/mobile/src/lib/use-love-notes.ts',{
    react,'@react-navigation/native':{useIsFocused:()=>focused},'./burrow-attention':{attentionScope:d=>`${d.profile.id}:${d.partner.id}:${d.pairVersion}`},
    './burrow-history':{fetchBurrowHistory:(...args)=>{const request=deferred();requests.push({args,request});return request.promise;}},
    './love-note-model':model,'./session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner,subscribeSessionIdentity:fn=>listeners.push(fn)},
  });
  let data=snapshot();const render=()=>h.render(()=>api.useLoveNotes(data));
  render();assert.equal(requests.length,1);
  requests[0].request.resolve({rows:[{...note('journal'),body:'Plain journal'}],next:{at,id:'cursor'}});await flush();
  let view=render();assert.equal(view.rows.length,0);assert.equal(view.hasMore,true);
  void view.load(true);void view.load(true);assert.equal(requests.length,2);assert.equal(requests[1].args[2].id,'cursor');
  requests[1].request.resolve({rows:[note('old')],next:null});await flush();assert.equal(render().rows[0].id,'old');
  h.unmount();h=hooks();assert.equal(render().rows[0].id,'old','native detail receives body via scoped in-memory cache');
  data={...data,pairVersion:'two'};view=render();assert.equal(view.rows.length,0);
  requests.at(-1).request.resolve({rows:[note('new')],next:null});await flush();assert.equal(render().rows[0].id,'new');
  focused=false;render();requests[2].request.resolve({rows:[note('late-old')],next:null});await flush();assert.ok(!render().rows.some(row=>row.id==='late-old'));
  focused=true;render();const last=requests.at(-1);epoch++;owner='other';listeners.forEach(fn=>fn());
  last.request.resolve({rows:[note('wrong-account')],next:null});await flush();assert.ok(!render().rows.some(row=>row.id==='wrong-account'));h.unmount();
});
test('disabled composer performs no request; a shared reading request may finish warming history after composer opens',async()=>{
 const h=hooks(),requests=[];let enabled=false;
 const api=load('apps/mobile/src/lib/use-love-notes.ts',{
  react:h.react,'@react-navigation/native':{useIsFocused:()=>true},'./burrow-attention':{attentionScope:()=> 'me:them:one'},
  './burrow-history':{fetchBurrowHistory:()=>{const next=deferred();requests.push(next);return next.promise;}},
  './love-note-model':model,'./session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
 });
 const render=()=>h.render(()=>api.useLoveNotes(snapshot(),{enabled}));
 let view=render();await view.load();assert.equal(requests.length,0);assert.equal(view.loading,false);
 enabled=true;render();assert.equal(requests.length,1);
 enabled=false;render();requests[0].resolve({rows:[note('late')],next:null});await flush();
 view=render();assert.equal(view.rows.length,1,'warm cache survives leaving the reader; it never replaces the composer text');assert.equal(view.loading,false);h.unmount();
});
test('new routes inherit global edge-back policy with their own opaque moving backgrounds',()=>{
  const layout=fs.readFileSync('apps/mobile/app/(main)/_layout.tsx','utf8');
  for(const route of ['love-note-history','love-note-detail']){
    assert.ok(layout.includes(`name="${route}" options={{ contentStyle: { backgroundColor: '#FFFAF2' } }}`));
  }
  assert.match(layout,/screenOptions=\{MAIN_CARD_OPTIONS\}/);
});
