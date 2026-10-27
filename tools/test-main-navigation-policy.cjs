const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const edge=load('apps/mobile/src/lib/page-edge-gesture.ts');
const policy=load('apps/mobile/src/lib/main-navigation-options.ts',{'./page-edge-gesture':edge});
const jsx=(type,props,key)=>({type,props,key});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

function layout() {
  const imports={react:{useEffect(){}},'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:{}},'expo-router':{Stack:Object.assign('Stack',{Screen:'Screen'})},
    '@/lib/rating-navigation':{ratingNavigationListeners:()=>({})},
    '@/lib/use-reflect-settlement-recovery':{useReflectSettlementRecovery(){}},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
    '@/lib/main-navigation-options':policy,
    '@/lib/page-edge-gesture':edge,
    '@/lib/auth':{},'@/lib/onboarding':{},'@/lib/avatar-upload-queue':{},
  };
  // Components remain JSX nodes: this test inspects the real layout's options,
  // including per-route functions, without mounting cameras/session gates.
  for(const [path,name] of [['rating/official-rating-gate','OfficialRatingGate'],['main/home-entry-gate','HomeEntryGate'],['burrow/burrow-environment-gate','BurrowEnvironmentGate'],
    ['ui/android-compact-typography','AndroidCompactTypographyProvider'],['burrow/burrow-music','BurrowMusicGate'],
    ['burrow/adventure-arrival-gate','AdventureArrivalGate'],['burrow/burrow-sync-gate','BurrowSyncGate'],['burrow/game-sync-gate','GameSyncGate'],['burrow/surprise-arrival-gate','SurpriseArrivalGate'],['burrow/burrow-page-entry-overlay','BurrowPageEntryOverlay']])
    imports[`@/components/${path}`]={[name]:name};
  const tree=load('apps/mobile/app/(main)/_layout.tsx',imports).default();
  const all=nodes(tree),stack=all.find(node=>node.type===imports['expo-router'].Stack);
  const screens=new Map(all.filter(node=>node.type==='Screen').map(node=>[node.props.name,node.props.options]));
  const resolve=(name,params)=>{const specific=screens.get(name);
    return {...stack.props.screenOptions,...(typeof specific==='function'?specific({route:{params}}):specific)};};
  resolve.names=[...screens.keys()];return resolve;
}

test('one transition owner: root tabs cannot swipe/pop, hierarchical cards use edge-only right transitions',()=>{
  const options=layout();
  assert.equal(options('(tabs)').animation,'none');assert.equal(options('(tabs)').gestureEnabled,false);
  for(const name of ['menu','(modals)','burrow-detail','moment-detail','shop-detail',
    'toy-collection','toy-shop','game-room','gift-library','music-player','tame-enemy']) {
    const result=options(name,{section:'partner_room'});
    assert.equal(result.animation,'slide_from_right',name);
    assert.equal(result.gestureEnabled,true,name);
    assert.equal(result.fullScreenGestureEnabled,false,name);
    assert.equal(result.gestureResponseDistance.end,24,name);
  }
});
test('sheet gestures match their vertical entrance and protected input/consent routes cannot edge-pop',()=>{
  const options=layout();
  for(const name of ['ai-consent','coin-shop','shared-memory-create'])
    assert.equal(options(name).gestureEnabled,false,name);
  assert.equal(options('surprise-room',{receive:'1'}).gestureEnabled,false);
  assert.equal(options('surprise-room',{receive:'1'}).animation,'fade');
});
test('old entry aliases do not run a native entrance before forwarding to cached tabs',()=>{
  const options=layout();
  for(const section of ['burrow','moments','collection','shop','carrot_shop','our_room'])
    assert.equal(options('burrow-detail',{section}).animation,'none',section);
  assert.equal(options('burrow-detail',{section:'shop',giftTo:'partner'}).animation,'slide_from_right');
  for(const name of ['thump','visit-master','quest-pick','quest-custom','quest-write-own','item-sheet','companion-sheet','quiet-wins','new-lens','true-north','friend-add','friends-list','friend-profile','their-patterns','friend-detail','my-logs','reflect-detail','friend-reflect-detail','guess','guesses'])
    assert.equal(options(name).animation,'none',name);
});
test('every right-sliding page, including locally saved Adventure inputs, inherits global edge back',()=>{
  const options=layout();
  for(const name of ['reflect-typing','reflect-guided']){
    assert.equal(options(name).presentation,'card');assert.equal(options(name).animation,'slide_from_right');
    assert.equal(options(name).animationDuration,300);assert.equal(options(name).gestureEnabled,true);
    assert.deepEqual(JSON.parse(JSON.stringify(options(name).gestureResponseDistance)),{start:0,end:24});
  }
  const start=options('burrow-detail',{section:'adventure',adventureFade:'1'});
  assert.equal(start.animation,'slide_from_right');assert.equal(start.animationTypeForReplace,'push');
  assert.equal(options('burrow-detail',{section:'adventure'}).animationDuration,300);
});

test('all registered horizontal cards retain the same edge policy, including route-specific Adventure overrides',()=>{
  const options=layout();
  for(const name of options.names){
    for(const params of [undefined,{section:'adventure'},{section:'adventure',adventureFade:'1'},{section:'partner_room'}]){
      const value=options(name,params);if(value.animation!=='slide_from_right')continue;
      for(const [key,expected] of Object.entries(edge.HORIZONTAL_EDGE_BACK_OPTIONS))assert.deepEqual(value[key],expected,name+':'+key);
    }
  }
  assert.match(fs.readFileSync('apps/mobile/app/(main)/(modals)/_layout.tsx','utf8'),/screenOptions=\{MAIN_CARD_OPTIONS\}/);
});

test('native game route accepts introductions and saved rounds while preserving History as the underlay',()=>{
  let params={gameId:'cuddle-code'};
  const route=load('apps/mobile/app/(main)/game-room.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'expo-router':{Redirect:'Redirect',useLocalSearchParams:()=>params},
    '@/components/burrow/game-room-screen':{GameRoomScreen:'Game'},
    '@/components/burrow/game-history-screen':{GameHistoryScreen:'History'},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
  });
  let tree=route.default();assert.equal(tree.props.initialGameId,'cuddle-code');
  params={sessionId:'saved',source:'history'};tree=route.default();
  assert.equal(tree.props.initialSessionId,'saved');assert.equal(tree.props.fromHistory,true);
  params={history:'1'};assert.equal(route.default().type,'History');
});

test('Music Player is a cached native card, with focused-only status bar and ordinary back',()=>{
  let data={profile:{id:'me'},musicTrackId:'lofi'},focused=true,backs=0;
  const route=load('apps/mobile/app/(main)/music-player.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{StatusBar:'StatusBar',StyleSheet:{create:x=>x},Text:'Text',View:'View'},
    'expo-router':{router:{back:()=>backs++}},'@react-navigation/native':{useIsFocused:()=>focused},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:50})},
    '@/components/burrow/burrow-music':{BurrowMusicPicker:'Music'},'@/components/burrow/burrow-back-button':{BurrowBackButton:'Back'},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data})},
  });
  let all=nodes(route.default()),picker=all.find(n=>n.type==='Music');assert.equal(picker.props.data,data);
  assert.equal(all.filter(n=>n.type==='StatusBar').length,1);picker.props.onClose();assert.equal(backs,1);
  focused=false;assert.equal(nodes(route.default()).some(n=>n.type==='StatusBar'),false,'underlying Music cannot override the next page’s status bar');
  data=null;all=nodes(route.default());assert.equal(all.some(n=>n.type==='Music'),false);all.find(n=>n.type==='Back').props.onPress();assert.equal(backs,2);
  const home=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.doesNotMatch(home,/musicOpen|setMusicOpen|<BurrowMusicPicker/);
  assert.equal((home.match(/router\.push\('\/\(main\)\/music-player'\)/g)??[]).length,3,'all radio entry points push the same native route');
});

test('real native StackRouter pushes a distinct game and pops to the identical retained lobby/history entry',()=>{
  const {createRequire}=require('node:module');
  const fromNative=createRequire(require.resolve('@react-navigation/native/package.json',{paths:[require('node:path').resolve(__dirname,'../apps/mobile')]}));
  const {StackRouter}=fromNative('@react-navigation/routers');
  const options={routeNames:['game-room'],routeParamList:{},routeGetIdList:{}};
  for(const params of [{},{history:'1'}]){
    const router=StackRouter({initialRouteName:'game-room'});
    let state=router.getInitialState(options);
    state.routes[0].params=params;const lobby=state.routes[0];
    state=router.getStateForAction(state,{type:'PUSH',payload:{name:'game-room',params:{gameId:'cuddle-code',sessionId:'round'}}},options);
    assert.equal(state.routes.length,2);assert.equal(state.routes[0],lobby);
    assert.notEqual(state.routes[1].key,lobby.key,'same filename must not replace the lobby');
    state=router.getStateForAction(state,{type:'POP',payload:{count:1}},options);
    assert.equal(state.routes.length,1);assert.equal(state.routes[0],lobby);assert.equal(state.routes[0].params,params);
  }
});

test('Game Room cannot disable global back based on catalogue/question/waiting/results mode',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/game-room-screen.tsx','utf8');
  assert.doesNotMatch(source,/usePageBackGesture|gestureEnabled|setOptions\(/);
  const options=layout()('game-room');
  for(const [key,value] of Object.entries(edge.HORIZONTAL_EDGE_BACK_OPTIONS))assert.deepEqual(options[key],value,key);
});
test('root authentication/onboarding boundary is not a dismissible screen',()=>{
  for(const path of ['app/_layout.tsx','app/(auth)/_layout.tsx','app/(onboarding)/_layout.tsx'])
    assert.match(fs.readFileSync(`apps/mobile/${path}`,'utf8'),/gestureEnabled: false/,path);
});
test('page gesture policy updates before paint and never installs a full-screen recognizer',()=>{
  const h=hooks(),values=[],navigation={setOptions:options=>values.push(options)};
  const api=load('apps/mobile/src/lib/use-page-back-gesture.ts',{react:h.react,
    './page-edge-gesture':edge,
    '@react-navigation/native':{useNavigation:()=>navigation,useIsFocused:()=>true}});
  for(const enabled of [true,false,false,true])h.render(()=>api.usePageBackGesture(enabled));
  assert.deepEqual(values.map(value=>value.gestureEnabled),[true,false,true]);
  assert.ok(values.every(value=>value.fullScreenGestureEnabled===false));h.unmount();
  assert.ok(values.every(value=>value.gestureResponseDistance.start===0&&value.gestureResponseDistance.end===24));
});
test('hidden preloaded pages never set native options; focus applies the current gesture before paint',()=>{
  const h=hooks(),values=[];let focused=false;
  const navigation={setOptions:options=>{assert.ok(focused,'placeholder routes cannot set options');values.push(options);}};
  const api=load('apps/mobile/src/lib/use-page-back-gesture.ts',{react:h.react,'./page-edge-gesture':edge,
    '@react-navigation/native':{useNavigation:()=>navigation,useIsFocused:()=>focused}});
  h.render(()=>api.usePageBackGesture(true));h.render(()=>api.usePageBackGesture(false));assert.equal(values.length,0);
  focused=true;h.render(()=>api.usePageBackGesture(false));assert.equal(values.at(-1).gestureEnabled,false);
  focused=false;h.render(()=>api.usePageBackGesture(true));assert.equal(values.length,1);
  focused=true;h.render(()=>api.usePageBackGesture(true));assert.equal(values.at(-1).gestureEnabled,true);h.unmount();
});
test('native tab handoffs carry unique one-shot motion intent, not a second pushed tabs root',()=>{
  const calls=[];
  const api=load('apps/mobile/src/lib/retained-tab-navigation.ts',{'expo-router':{router:{dismissTo:href=>calls.push(href)}}},{Date});
  api.dismissToRetainedTab('/(main)/(tabs)/collection');api.dismissToRetainedTab('/(main)/(tabs)/collection');
  assert.equal(calls[0].pathname,'/(main)/(tabs)/collection');
  assert.notEqual(calls[0].params.__tabHandoff,calls[1].params.__tabHandoff);
});
