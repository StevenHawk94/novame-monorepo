const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const contract=load('packages/domain/src/plushie-touch.ts');
const model=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function find(node,type){if(!node)return;if(Array.isArray(node))return node.map(n=>find(n,type)).find(Boolean);return node.type===type?node:find(node.props?.children,type);}
function recordingHarness(initial){
 const h=hooks(),saved=[],complete=[],errors=[],ui=[],js=[];let app,focused=true,fail=false,tree;
 const rn={AppState:{currentState:'active',addEventListener(_event,fn){app=fn;return{remove(){}};}},View:'View',Text:'Text'};
 const {PlushieTouchRecording}=load('apps/mobile/src/components/burrow/plushie-touch-recording.tsx',{
  react:h.react,'react/jsx-runtime':jsx,'react-native':rn,'@react-navigation/native':{useIsFocused:()=>focused},
  'react-native-reanimated':{runOnJS:fn=>(...args)=>js.push(()=>fn(...args)),runOnUI:fn=>(...args)=>ui.push(()=>fn(...args)),useReducedMotion:()=>false,useSharedValue:value=>{const r=h.react.useRef(null);return r.current??={value};}},
  '@/lib/plushie-touch-recorder':model,'./plushie-touch-toy':{PlushieTouchToy:'Toy'},'./plushie-touch-heart':{TouchHeartMeter:'Heart',TouchFlyingHearts:'Flying'},
  '@/lib/touch-heart-motion':load('apps/mobile/src/lib/touch-heart-motion.ts'),
 });
 function flush(){for(const f of ui.splice(0))f();for(const f of js.splice(0))f();}
 const render=()=>{tree=h.render(()=>PlushieTouchRecording({asset:{},photo:{id:'p'},size:300,scope:'A:B:pair',initial,
  onComplete:c=>complete.push(c),onInterrupted:()=>errors.push('empty'),onCheckpoint:c=>{if(fail)throw Error('disk_full');saved.push(JSON.parse(JSON.stringify(c)));}}));flush();return tree;};
 return {render,complete,errors,saved,h,fail:v=>fail=v,frame(timestamp){find(tree,'Toy').props.onFrame({feedbackAt:0},{timestamp,timeSincePreviousFrame:16});flush();},
  input(timestamp,events){find(tree,'Toy').props.inputStart.value=timestamp;find(tree,'Toy').props.onInput(events);},
  app(status){rn.AppState.currentState=status;app(status);flush();},focus(v){focused=v;render();},get elapsed(){return find(tree,'Heart').props.clock.value;}};
}
test('real recording component completes on logical 60000, not a second rounded absolute start; single completion survives rerender',()=>{
 const q=recordingHarness();q.render();q.frame(1234.6);q.input(1234.6,[[0,4,0,0,0]]);q.frame(61234.5);assert.equal(q.complete.length,0);
 assert.ok(q.saved.at(-1).elapsedMs<60000,'fractional checkpoint must not round an unfinished minute into completion');
 q.frame(61234.6);assert.equal(q.complete.length,1);assert.equal(q.complete[0].touches,1);assert.equal(q.errors.length,0);assert.equal(q.saved.at(-1).elapsedMs,60000);
 q.render();q.frame(90000);assert.equal(q.complete.length,1);q.h.unmount();
});
test('real recording component ignores background frames and rebases foreground resume, including cancelled held pointers',()=>{
 const q=recordingHarness();q.render();q.input(1000,[[0,4,0,0,0],[100,0,4,500,500]]);q.frame(20000);q.app('inactive');
 const saved=q.saved.at(-1);assert.equal(saved.elapsedMs,19000);assert.equal(saved.events.at(-1)[1],3);
 q.frame(120000);assert.equal(q.complete.length,0);assert.equal(q.elapsed,19000);
 q.app('active');q.frame(150000);q.frame(190999);assert.equal(q.complete.length,0);q.frame(191000);
 assert.equal(q.complete.length,1);assert.equal(q.complete[0].touches,39);assert.ok(contract.validateTouchClip(q.complete[0]));q.h.unmount();
});
test('focus loss and storage failure never invoke interrupted/idle; checkpoint resumes after remount and completed clip remains usable',()=>{
 const q=recordingHarness();q.render();q.input(1000,[[0,5,0,0,0]]);q.frame(18000);q.fail(true);q.focus(false);
 q.frame(100000);assert.equal(q.errors.length,0);assert.equal(q.complete.length,0);q.fail(false);q.focus(true);q.frame(150000);q.frame(193000);
 assert.equal(q.complete.length,1);assert.equal(q.complete[0].touches,1);q.h.unmount();
});
test('v2 held contact counts down and each half-second, including final cancellation; full minute remains required',()=>{
 const q=recordingHarness();q.render();q.input(1000,[[0,0,5,500,500]]);q.frame(61000);
 assert.equal(q.complete.length,1);assert.deepEqual(q.errors,[]);assert.equal(q.saved.at(-1).elapsedMs,60000);assert.equal(q.saved.at(-1).touches,120);assert.ok(contract.validateTouchClip(q.complete[0]));q.h.unmount();
});
function screenHarness(mode='record',options={}){
 const h=hooks(),guards=[],gestures=[],backs=[],writes=[],routes=[],read=[],queued=[];let discarded=0,data={profile:{id:'A'},partner:{id:'B',display_name:'Sam'},pairVersion:'pair',catalog:[{stable_id:'toy'}],roomPhotos:[{id:'photo',ownerId:'A'}]},diskFail=false,scope='A:B:pair',tree;
 const m={id:'msg',sender_id:'B',recipient_id:'A',pair_version:'pair',touches:1,toy:{stable_id:'toy'},clip:{version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]},created_at:'2026-10-25',read_at:options.readAt??null};
 const meta={version:2,items:mode==='record'?[]:[m],hasPlus:false,remaining:1,sameDomain:true,...options.meta},state={scope,meta,jobs:[],seen:[],ready:mode==='record'||options.unprepared?[]:['msg']};
 const {PlushieTouchScreen}=load('apps/mobile/src/components/burrow/plushie-touch-screen.tsx',{
  '@novame/domain':contract,
  '@/lib/haptics':{withSoftPress:action=>action()},
  react:h.react,'react/jsx-runtime':jsx,'react-native':{ActivityIndicator:'Busy',Pressable:'Pressable',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:v=>v,absoluteFillObject:{}},BackHandler:{addEventListener:(_event,fn)=>{backs.push(fn);return{remove:()=>backs.push('removed')};}}},
  '@react-navigation/native':{useIsFocused:()=>true,usePreventRemove:v=>guards.push(v)},'expo-router':{router:{canGoBack:()=>true,back(){routes.push('back');},replace(p){routes.push(p);},push(p){routes.push(p);}},useLocalSearchParams:()=>({mode})},
  '@expo/vector-icons':{Feather:'Icon'},'react-native-reanimated':{useReducedMotion:()=>false,useSharedValue:value=>h.react.useRef({value}).current},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:40,bottom:20})},
  '@/lib/touch-note-runtime':{touchCapabilities:async()=>options.visualOnly?{hasVibrator:false}:null,touchVisualOnly:c=>c?.hasVibrator===false,touchInitialQuality:()=> 'standard',testTouchVibration:async()=>true,touchVibrationVerified:()=>false,confirmTouchVibration(){}},
  '@/lib/app-viewport':{useAppViewport:()=>({width:390,height:844})},'@/lib/burrow-store':{useBurrow:()=>({data})},'@/lib/burrow-presentation':{roomSlots:()=>({couple_doll:{stable_id:'toy'}})},
  '@/lib/burrow-art-assets':{burrowArtForItem:item=>item&&({name:'toy',width:512,height:512})},'@/lib/burrow-toy-photos':{toyPhotoFor:photos=>photos[0]},'@/lib/plushie-touch-recorder':model,
  '@/lib/use-page-back-gesture':{usePageBackGesture:v=>gestures.push(v)},
  '@/lib/plushie-touch-store':{usePlushieTouches:()=>({...state,scope}),touchSnapshot:()=>state,touchDraft:()=>null,touchRecording:()=>null,touchGuideSeen:()=>true,touchMessage:id=>state.ready.includes(id)?m:undefined,pinTouchMessage(){},markTouchPlayed:id=>{read.push(id);state.seen.push(id);},prepareTouchPage:async()=>{},prepareTouchMessage:options.prepare??(async()=>{}),
   refreshPlushieTouch:async()=>{},saveTouchRecording(){},saveTouchDraft:(...args)=>{writes.push(args);if(diskFail)throw Error('disk_full');},discardTouchRecording(){},discardTouchDraft(){discarded++;},queuePlushieTouch:(...args)=>{queued.push(args);return 'send-key';}},
  './burrow-back-button':{BurrowBackButton:'Back'},'./plushie-room-background':{PlushieRoomBackground:'Background'},'./plushie-touch-recording':{PlushieTouchRecording:'Recording'},
  './plushie-touch-playback':{PlushieTouchPlayback:'Playback'},'./plushie-touch-toy':{PlushieTouchToy:'Toy'},'./plushie-touch-heart':{TouchHeartMeter:'Heart'},
  './touch-note-ui':{TouchNoteButton:'Action',TouchNoteDialog:'Dialog',TouchNoteIcon:'TouchIcon',touchNoteStyles:{}},'./burrow-image':{Image:'Image'},
 });
 const render=()=>tree=h.render(PlushieTouchScreen);render();render();
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 return {render,guards,gestures,backs,writes,h,routes,queued,read,state,get discarded(){return discarded;},get tree(){return tree;},button:label=>all(tree).find(n=>n.props?.label===label||n.props?.accessibilityLabel===label),get recording(){return find(tree,'Recording').props;},fail:v=>diskFail=v,useAllowance(){meta.remaining=0;render();},revoke(){data={...data,partner:null};scope='';render();}};
}
test('screen locks only started recording, releases on completion even if saving fails, never drops the completed minute',()=>{
 const q=screenHarness(),record=q.recording;assert.equal(q.guards.at(-1),false);assert.equal(q.gestures.at(-1),true);
 record.onStatus({started:true,count:1,seconds:45});q.render();assert.equal(q.guards.at(-1),true);assert.equal(q.gestures.at(-1),false);assert.equal(q.backs.at(-1)(),true);
 q.fail(true);record.onComplete({version:1,durationMs:60000,touches:1,events:[[0,4,0,0,0]]});const tree=q.render();
 assert.equal(q.guards.at(-1),false);assert.equal(q.gestures.at(-1),true);assert.equal(q.backs.at(-1),'removed');assert.equal(find(tree,'Recording'),undefined);
 assert.equal(find(tree,'Heart').props.count,1);assert.equal(q.writes[0][3],'A:B:pair');q.h.unmount();
});
test('cross-domain server permission reaches recording and durable send; absent permission never mounts a new recorder',()=>{
 const q=screenHarness('record',{meta:{sameDomain:false,sendAllowed:true}});
 assert.ok(q.recording);q.recording.onComplete({version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]});q.render();
 assert.equal(q.button('Send Touch Note').props.disabled,false);q.button('Send Touch Note').props.onPress();q.render();
 assert.equal(q.queued.length,1);assert.equal(q.routes.at(-1),'back');assert.equal(q.state.meta.sameDomain,false);assert.equal(q.state.meta.hasPlus,false);q.h.unmount();
 const denied=screenHarness('record',{meta:{sameDomain:false}});assert.equal(find(denied.tree,'Recording'),undefined);denied.h.unmount();
});
test('identity/relation revocation releases navigation lock and removes recording instead of trapping the user',()=>{
 const q=screenHarness();q.recording.onStatus({started:true,count:1,seconds:45});q.render();assert.equal(q.guards.at(-1),true);
 q.revoke();assert.equal(q.guards.at(-1),false);assert.equal(q.gestures.at(-1),true);q.h.unmount();
});
test('allowance refresh cannot remove a running recorder while its navigation remains locked',()=>{
 const q=screenHarness();q.recording.onStatus({started:true,count:1,seconds:45});q.render();q.useAllowance();assert.ok(q.recording);assert.equal(q.guards.at(-1),true);q.h.unmount();
});
test('completed page stays on outside dismissal, Yes discards without quota/send, Send exits only after durable acceptance',()=>{
 const c={version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]},q=screenHarness();q.recording.onComplete(c);q.render();
 q.button('Close and Leave').props.onPress();q.render();const dialog=find(q.tree,'Dialog'); // Dialog order is guide, discard, haptic.
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const discard=all(q.tree).find(n=>n.type==='Dialog'&&n.props.visible);assert.ok(discard);discard.props.onClose();q.render();assert.ok(q.button('Send Touch Note'));assert.equal(q.discarded,0);assert.equal(q.queued.length,0);
 q.button('Close and Leave').props.onPress();q.render();q.button('Yes').props.onPress();q.render();assert.equal(q.discarded,1);assert.equal(q.queued.length,0);assert.equal(q.routes.at(-1),'back');q.h.unmount();
 const send=screenHarness();send.recording.onComplete(c);send.render();send.fail(true);send.button('Send Touch Note').props.onPress();send.render();assert.equal(send.routes.length,0);assert.equal(send.queued.length,0);
 send.fail(false);send.button('Send Touch Note').props.onPress();assert.equal(send.queued.length,1);assert.equal(send.routes.at(-1),'back');send.h.unmount();
});
test('recipient explicitly tests haptics, plays one note, pauses/continues the same mount, replays, then exits to partner default',async()=>{
 const q=screenHarness('inbox');assert.equal(q.read.length,0);q.button('Feel Sam’s touch').props.onPress();await flush();q.render();
 q.button('Test Vibration').props.onPress();await flush();q.render();assert.equal(q.button('I felt it · Start Playback').props.disabled,false);
 q.button('I felt it · Start Playback').props.onPress();q.render();assert.deepEqual(q.read,['msg']);let view=find(q.tree,'Playback');assert.equal(view.props.paused,false);
 q.button('Stop').props.onPress();q.render();assert.equal(find(q.tree,'Playback').props.paused,true);q.button('Continue').props.onPress();q.render();assert.equal(find(q.tree,'Playback').props.paused,false);
 find(q.tree,'Playback').props.onFinish();q.render();assert.ok(q.button('Replay'));q.button('Replay').props.onPress();q.render();assert.equal(find(q.tree,'Playback').props.paused,false);assert.deepEqual(q.read,['msg']);
 find(q.tree,'Back').props.onPress();assert.equal(q.routes.at(-1).pathname,'/(main)/room-interaction');assert.equal(q.routes.at(-1).params.ownerId,'B');q.h.unmount();
});
test('a delayed rejection for an overwritten Free message cannot paint an error over the new ready message',async()=>{
 const old=deferred(),q=screenHarness('inbox',{unprepared:true,prepare:()=>old.promise});
 q.state.meta.items[0].id='new';q.state.ready=['new'];q.render();old.reject(Error('old message removed'));await flush();q.render();
 assert.ok(q.button('Feel Sam’s touch'));assert.ok(!JSON.stringify(q.tree).includes('Could not open this touch note'));assert.equal(q.read.length,0);q.h.unmount();
});
test('iPad/no-vibrator recipient can play animation, clear unread, Stop/Continue and Replay without a vibration test',async()=>{
 const q=screenHarness('inbox',{visualOnly:true});q.button('Feel Sam’s touch').props.onPress();await flush();q.render();
 assert.equal(q.read.length,0);assert.ok(q.button('Play animation'));q.button('Play animation').props.onPress();q.render();
 assert.deepEqual(q.read,['msg']);assert.equal(find(q.tree,'Playback').props.paused,false);
 q.button('Stop').props.onPress();q.render();q.button('Continue').props.onPress();q.render();assert.equal(find(q.tree,'Playback').props.paused,false);
 find(q.tree,'Playback').props.onFinish();q.render();q.button('Replay').props.onPress();q.render();assert.equal(find(q.tree,'Playback').props.paused,false);
 q.h.unmount();
});
test('read history preview has no unread banner; unopened history keeps it until explicit play',()=>{
 const read=screenHarness('history',{readAt:'2026-10-26T00:00:00Z'});read.button('Replay 1 touches').props.onPress();read.render();
 assert.ok(read.button('Feel Sam’s touch'));assert.ok(!JSON.stringify(read.tree).includes('You have an unread Touch Note'));assert.equal(read.read.length,0);read.h.unmount();
 const fresh=screenHarness('history');fresh.button('Replay 1 touches').props.onPress();fresh.render();
 assert.ok(JSON.stringify(fresh.tree).includes('You have an unread Touch Note'));assert.equal(fresh.read.length,0);fresh.h.unmount();
});
