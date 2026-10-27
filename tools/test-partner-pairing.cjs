const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const snapshot=()=>({profile:{id:'me',display_name:'Sam',avatar_url:'default-1'},partner:null,pairVersion:undefined});
const partner={userId:'alex',displayName:'Alex',avatarUrl:'https://example.test/alex.jpg',isDefaultAvatar:false};
test('one shared gate is repeatable until paired; confirmed success receipts cannot cross account epochs',()=>{
  const paths=[],listeners=[];let data=snapshot(),owner='me',epoch=1;
  const api=load('apps/mobile/src/lib/partner-pairing.ts',{
    'expo-router':{router:{navigate:path=>paths.push(path)}},'./burrow-store':{getBurrowSnapshot:()=>({data})},
    './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>listeners.push(fn)},
  });
  assert.equal(api.readPartnerConnection(),null);for(let i=0;i<6;i++)assert.equal(api.requirePartner(),true);
  assert.equal(paths.length,6);assert.ok(paths.every(path=>path==='/(main)/pair-partner'));
  data={...data,partner:{id:'alex'}};assert.equal(api.requirePartner(),false);assert.equal(paths.length,6);
  assert.equal(api.rememberPartnerConnection({userId:'other',name:'Other'},{userId:'alex',name:'Alex'}),false);
  assert.equal(api.rememberPartnerConnection({userId:'me',name:'Sam'},{userId:'alex',name:'Alex'}),true);assert.equal(api.readPartnerConnection().partner.name,'Alex');
  owner='other';epoch++;listeners.forEach(fn=>fn());assert.equal(api.readPartnerConnection(),null);
});
test('rooms reveal first; closing their child prompt does not create an immediate reopen loop',()=>{
  const h=hooks(),jobs=[],calls=[];let data=snapshot(),focused=false,epoch=1;
  const {usePartnerEntryGate}=load('apps/mobile/src/lib/use-partner-entry-gate.ts',{
    react:h.react,'@react-navigation/native':{useIsFocused:()=>focused},'./session-lifecycle':{sessionEpoch:()=>epoch},
    './partner-pairing':{requirePartner:current=>calls.push(current.profile.id)},
    './ui-idle':{afterUiSettles:(fn,options)=>{const job={fn,options,cancelled:false};jobs.push(job);return()=>{job.cancelled=true;};}},
  });
  const render=()=>h.render(()=>usePartnerEntryGate(data));render();assert.equal(jobs.length,0,'preloading cannot prompt');
  focused=true;render();assert.equal(calls.length,0);assert.equal(jobs[0].options.delayMs,240);jobs[0].fn();assert.equal(calls.length,1);
  focused=false;render();focused=true;render();assert.equal(jobs.length,1,'returning from X remains on the same room');
  data={...data,pairVersion:'new'};render();epoch++;jobs.at(-1).fn();assert.equal(calls.length,1,'late account work is ignored');h.unmount();
});
function extract(file,name,kind='variable'){
  const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  function visit(node){
    if(kind==='function'&&ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;
    if(kind==='variable'&&ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found=node.initializer;
    if(kind==='attribute'&&ts.isJsxAttribute(node)&&node.name.text===name)found=node.initializer.expression;
    ts.forEachChild(node,visit);
  }visit(ast);assert.ok(found,name);
  const source=kind==='function'?found.getText(ast):`module.exports.callback=${found.getText(ast)}`;
  return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function run(code,globals){const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,...globals});return module.exports;}
test('Partner Room blocks before entry; Moments opens its page first; Home envelope stays gated',()=>{
  const file='apps/mobile/src/components/burrow/burrow-screen.tsx',paths=[];let paired=false;
  const gate=()=>{if(paired)return false;paths.push('pair');return true;};
  const routes=run(extract(file,'openBurrow','function'),{uiWorkPriority:{action(){}},beginInteractionTiming(){},markInteractionTiming(){},enterBurrowPage:(_entry,open)=>open(),burrowPageIsReady:()=>true,requirePartner:gate,router:{push:p=>paths.push(p),navigate:p=>paths.push(p)},dismissToRetainedTab:p=>paths.push(p)});
  routes.openBurrow('partner_room');routes.openBurrow('moments');assert.deepEqual(paths,['pair','/(main)/(tabs)/friends']);
  paired=true;routes.openBurrow('partner_room');assert.equal(paths.at(-1).params.section,'partner_room');routes.openBurrow('moments');assert.equal(paths.at(-1),'/(main)/(tabs)/friends');
  const interaction=run(extract(file,'openHomeInteraction'),{burrowPageIsReady:()=>true,getBurrowSnapshot:()=>({data:snapshot()}),requirePartner:gate,careCoolingDown:()=>false,openPreparedBurrow:p=>paths.push(p)}).callback;
  paired=false;interaction('letter');assert.equal(paths.at(-1),'pair');interaction('toy');assert.equal(paths.at(-1).params.kind,'toy');
});
test('Moments footer navigates first without opening an invitation over Home',()=>{
  const file='apps/mobile/src/components/main/bottom-tab-bar.tsx',calls=[];let paired=false;
  const globals={majorUpdate:true,burrowData:snapshot(),requirePartner:()=>{if(paired)return false;calls.push('pair');return true;},
    uiWorkPriority:{action(){}},
    stopPreloading:{current:()=>calls.push('cancel-preload')},yieldDownloadQueueForInteraction:()=>{},haptics:{pageOpen:()=>{}},
    routesByName:new Map([['friends',{key:'friends-key',name:'friends'}]]),state:{key:'tabs'},CommonActions:{navigate:name=>({type:'NAVIGATE',name})},
    navigation:{emit:()=>{calls.push('event');return {defaultPrevented:false};},dispatch:()=>calls.push('navigate')},
  };
  globals.commitTabPress=run(extract(file,'commitTabPress'),globals).callback;
  globals.enterBurrowPage=(_entry,open)=>open();
  const callback=run(extract(file,'handleTabPress'),globals).callback;
  callback('friends',false);assert.deepEqual(calls,['cancel-preload','event','navigate']);callback('friends',true);assert.equal(calls.at(-1),'event');assert.equal(calls.includes('pair'),false);
});
test('all six Affection options prompt while unpaired; paired users enter their selected interaction normally',()=>{
  const h=hooks(),paths=[],labels=['cuddle','kiss','miss_you','hug','spicy','gratitude'];let data={...snapshot(),affectionInbox:[],unread:{affection:0},serverNow:'2026-10-14T00:00:00Z'};
  const {AffectionHub}=load('apps/mobile/src/components/burrow/affection-hub.tsx',{
    './affection-heart-burst':{AffectionHeartBurst:'AffectionHeartBurst',AFFECTION_BURST_DURATION:960},
    '@/lib/burrow-attention':{useBurrowAttention:()=>({affection:0})},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Button',ScrollView:'Scroll',StyleSheet:{create:s=>s,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
    '@react-navigation/native':{useIsFocused:()=>false},'expo-router':{router:{push:path=>paths.push(path)}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},'./burrow-image':{Image:'Image'},
    '@/lib/burrow-daily-entry':{freeAffectionUsedToday:()=>false},'@/lib/app-major-update-api':{},'@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:1}},
    '@/lib/burrow-store':{burrowClock:()=>100,useBurrowSnapshot:()=>({receivedAt:100})},'@/lib/burrow-ui-assets':{BURROW_AFFECTION_ICONS:{}},'@/lib/haptics':{},
    './affection-gesture':{AFFECTION_COPY:Object.fromEntries(labels.map(type=>[type,{label:type}]))},'./burrow-back-button':{BurrowBackButton:'Back'},'./affection-limit-screen':{AffectionLimitScreen:'Limit'},
    '@/lib/partner-pairing':{requirePartner:current=>{if(current.partner)return false;paths.push('/(main)/pair-partner');return true;}},
  });
  const render=()=>h.render(()=>AffectionHub({data,loading:false}));
  for(const type of labels)nodes(render()).find(node=>node.props?.accessibilityLabel==='Send '+type).props.onPress();
  assert.equal(paths.length,6);assert.ok(paths.every(path=>path==='/(main)/pair-partner'));
  data={...data,partner:{id:'alex',display_name:'Alex'}};nodes(render()).find(node=>node.props?.accessibilityLabel==='Send kiss').props.onPress();assert.equal(paths.at(-1).params.type,'kiss');h.unmount();
});
function modalHarness(options={}){
  const h=hooks(),time=clock(),paths=[],receipts=[],shares=[],copies=[],invites=[],pairCalls=[],refreshes=[],listeners=[],animations=[];let data=snapshot(),owner='me',epoch=1,focused=true,refreshResult;
  const app={currentState:'active',addEventListener:(_name,fn)=>{listeners.push(fn);return {remove(){}};}};
  const intervals=new Set();
  const animated={Value:class{constructor(v){this.v=v;}setValue(v){this.v=v;}stopAnimation(){}interpolate(v){return v;}},View:'AnimatedView',timing(value,options){animations.push(options);return {start(done){value.v=options.toValue;done?.({finished:true});},stop(){}};}};
  const module=load('apps/mobile/app/(main)/pair-partner.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Animated:animated,AppState:app,Keyboard:{dismiss(){}},Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',Share:{share:async content=>shares.push(content.message)},StyleSheet:{create:s=>s,absoluteFill:{}}},
    'expo-router':{router:{canGoBack:()=>true,back:()=>paths.push('back'),replace:path=>paths.push(path)}},'@react-navigation/native':{useIsFocused:()=>focused},
    '@expo/vector-icons':{MaterialIcons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    'expo-clipboard':{setStringAsync:async text=>copies.push(text)},
    '@/components/onboarding/partner-pairing-ui':{PairingCodeSheet:'CodeSheet',PairingInviteCard:'Invite'},
    '@/components/onboarding/partner-connected-screen':{PartnerConnectedScreen:'Connected'},
    '@/lib/friends-api':{getCachedFriends:()=>({inviteCode:options.code??null}),fetchFriends:()=>{const request=deferred();invites.push(request);return request.promise;},addFriend:(...args)=>{const request=deferred();pairCalls.push({args,request});return request.promise;}},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data}),burrowClock:()=>time.globals.Date.now(),refreshBurrowAfterCurrent:async options=>{refreshes.push(options);if(refreshResult)await refreshResult;}},
    '@/lib/partner-pairing':{rememberPartnerConnection:(self,partner)=>{receipts.push({self,partner});return true;}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner},'@/lib/async-lifecycle':{withDeadline:promise=>promise},
    '@/lib/haptics':{haptics:{success:async()=>{}}},'@/lib/overlay-presence':{registerOverlay:()=>()=>{}},
  },{...time.globals,setInterval:fn=>{intervals.add(fn);return fn;},clearInterval:fn=>intervals.delete(fn)});
  const render=()=>h.render(module.default),find=type=>nodes(render()).find(node=>node.type===type),button=label=>nodes(render()).find(node=>node.props?.accessibilityLabel===label);
  return {h,render,find,button,paths,receipts,shares,copies,invites,pairCalls,refreshes,animations,intervals,
    focus:value=>focused=value,account:()=>{owner='other';epoch++;},setData:next=>data=next,refresh:promise=>refreshResult=promise,
    background:value=>{app.currentState=value;listeners.forEach(fn=>fn(value));},
  };
}
test('native invitation uses the real code for copy/share; code sheet is embedded and normalizes pasted codes',async()=>{
  const h=modalHarness();h.render();h.invites[0].resolve({inviteCode:'ABC123'});await flush();
  h.find('Invite').props.copyCode();h.find('Invite').props.shareCode();await flush();assert.deepEqual(h.copies,['ABC123']);assert.ok(h.shares[0].includes('ABC123'));
  h.find('Invite').props.openCode();assert.equal(h.find('CodeSheet').props.embedded,true,'no second native Modal competes with route replacement');
  h.find('CodeSheet').props.onChange('abC-123');assert.equal(h.find('CodeSheet').props.code,'ABC123');assert.ok(h.animations.some(animation=>animation.useNativeDriver&&animation.duration===220));h.h.unmount();
});
test('cached invitation is visible on the very first render and never requests the same code again',()=>{
 for(let visit=0;visit<2;visit++){
  const h=modalHarness({code:'ABC123'});h.render();assert.equal(h.find('Invite').props.inviteCode,'ABC123');
  assert.equal(h.find('Invite').props.loading,false);assert.equal(h.invites.length,0);h.h.unmount();
 }
});
test('retained Moments prompts on each real return, not on modal close or preload; repairing resets the gate',()=>{
 const h=hooks(),calls=[],jobs=[];let data=snapshot(),focused=false;
 const {usePartnerEntryGate}=load('apps/mobile/src/lib/use-partner-entry-gate.ts',{
  react:h.react,'@react-navigation/native':{useIsFocused:()=>focused},'./session-lifecycle':{sessionEpoch:()=>1},
  './partner-pairing':{requirePartner:()=>calls.push('invite')},'./ui-idle':{afterUiSettles:fn=>{jobs.push(fn);return()=>{};}},
 });
 const draw=()=>h.render(()=>usePartnerEntryGate(data));draw();assert.equal(jobs.length,0);
 focused=true;draw();jobs.at(-1)();focused=false;draw();focused=true;draw();assert.equal(jobs.length,1);
 focused=false;draw();focused=true;draw();jobs.at(-1)();assert.equal(calls.length,2);
 data={...data,partner:{id:'partner'},pairVersion:'new'};draw();
 data=snapshot();draw();jobs.at(-1)();assert.equal(calls.length,3);h.unmount();
});
test('Pair Now shows success inside the current route without waiting for background refresh',async()=>{
  const h=modalHarness();h.render();h.find('Invite').props.openCode();h.find('CodeSheet').props.onChange('ABC123');
  const pair=h.find('CodeSheet').props.onPair;pair();pair();assert.equal(h.pairCalls.length,1);assert.deepEqual(plain(h.pairCalls[0].args),['ABC123',{relationship:'Partner',deferRefresh:true}]);
  const slow=deferred();h.refresh(slow.promise);
  h.pairCalls[0].request.resolve({ok:true,partner});await flush();assert.deepEqual(h.paths,[]);assert.equal(h.render().type,'Connected');assert.equal(h.refreshes.length,2);assert.equal(h.receipts[0].self.userId,'me');assert.equal(h.receipts[0].partner.userId,'alex');slow.resolve();h.h.unmount();
});
for(const deferRefresh of [false,true])test(`code mutation waits only for authority; cache refresh can be deferred (${deferRefresh})`,async()=>{
 const response=deferred(),reads=[deferred(),deferred(),deferred()];let calls=0,finished=false,epoch=1;
 const scope={sessionEpoch:()=>epoch,sessionUserId:()=> 'me',supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'me'}}}})}},
  apiClient:{post:()=>response.promise},fetchFriends:()=>{calls++;return reads[0].promise;},fetchPairing:()=>{calls++;return reads[1].promise;},fetchSubscriptionTier:()=>{calls++;return reads[2].promise;}};
 const fn=run(extract('apps/mobile/src/lib/friends-api.ts','addFriend','function'),scope).addFriend;
 const task=fn('ABC123',{deferRefresh}).then(result=>{finished=true;return result;});await flush();assert.equal(finished,false);
 response.resolve({success:true,partner});await flush();assert.equal(calls,3);assert.equal(finished,deferRefresh);
 reads.forEach(read=>read.resolve());assert.equal((await task).partner.userId,'alex');
});
test('a late code response after account switch cannot show success or start refreshes',async()=>{
 const response=deferred();let epoch=1,reads=0;
 const fn=run(extract('apps/mobile/src/lib/friends-api.ts','addFriend','function'),{
  sessionEpoch:()=>epoch,sessionUserId:()=>epoch===1?'me':'other',supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'me'}}}})}},apiClient:{post:()=>response.promise},
  fetchFriends:()=>reads++,fetchPairing:()=>reads++,fetchSubscriptionTier:()=>reads++,
 }).addFriend;
 const task=fn('ABC123',{deferRefresh:true});await flush();epoch++;response.resolve({success:true,partner});
 assert.equal((await task).ok,false);assert.equal(reads,0);
});
test('wrong code keeps the sheet available for retry and never creates a success receipt',async()=>{
  const h=modalHarness();h.render();h.find('Invite').props.openCode();h.find('CodeSheet').props.onChange('BAD123');h.find('CodeSheet').props.onPair();
  h.pairCalls[0].request.resolve({ok:false,error:'wrong_code'});await flush();assert.ok(h.find('CodeSheet').props.error.includes('Double-check'));assert.equal(h.receipts.length,0);assert.equal(h.paths.length,0);
  h.find('CodeSheet').props.onChange('ABC123');h.find('CodeSheet').props.onPair();assert.equal(h.pairCalls.length,2);h.h.unmount();
});
test('closing during pairing still refreshes a late confirmed mutation but never navigates again; account changes reject it',async()=>{
  for(const reason of ['close','account']){
    const h=modalHarness();h.render();h.find('Invite').props.openCode();h.find('CodeSheet').props.onChange('ABC123');h.find('CodeSheet').props.onPair();
    if(reason==='close'){h.button('Close partner invitation').props.onPress();h.h.unmount();}else h.account();
    h.pairCalls[0].request.resolve({ok:true,partner});await flush();assert.equal(h.receipts.length,0);assert.deepEqual(h.paths,reason==='close'?['back']:[]);assert.equal(h.refreshes.length,reason==='close'?2:1);h.h.unmount();
  }
});
test('external pairing uses fresh bootstrap rather than cached friends; background polling is paused',()=>{
  const h=modalHarness();h.render();assert.equal(h.refreshes.length,1);h.background('background');h.intervals.forEach(fn=>fn());assert.equal(h.refreshes.length,1);
  h.background('active');assert.equal(h.refreshes.length,2);h.setData({...snapshot(),partner:{id:'alex',display_name:'Alex',avatar_url:partner.avatarUrl,is_default_avatar:false},pairVersion:'confirmed'});h.render();assert.deepEqual(h.paths,[]);assert.equal(h.render().type,'Connected');h.h.unmount();assert.equal(h.intervals.size,0);
});
test('success Continue waits only when the shared bootstrap needs refresh; repeated or stale continuations cannot pop twice',async()=>{
  for(const reason of ['confirmed','offline','unmount']){
    const h=hooks(),paths=[],request=deferred();let data=snapshot(),refreshes=0;
    const receipt={self:{userId:'me',name:'Sam'},partner:{userId:'alex',name:'Alex'}};
    const module=load('apps/mobile/src/components/onboarding/partner-connected-screen.tsx',{
      react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'@react-navigation/native':{useIsFocused:()=>true},
      'expo-router':{router:{canGoBack:()=>true,back:()=>paths.push('back'),replace:path=>paths.push(path)}},
      './partner-pairing-ui':{PairingConnectedPage:'Connected'},'@/lib/partner-pairing':{readPartnerConnection:()=>receipt},
      '@/lib/burrow-store':{getBurrowSnapshot:()=>({data}),refreshBurrowAfterCurrent:()=>{refreshes++;return request.promise;}},
      '@/lib/session-lifecycle':{sessionEpoch:()=>1},'@/lib/overlay-presence':{registerOverlay:()=>()=>{}},'react-native':{View:'View',Text:'Text',Pressable:'Button'},
    });
    const render=()=>h.render(module.PartnerConnectedScreen),next=render().props.onContinue;next();next();assert.equal(refreshes,1);
    if(reason==='confirmed')data={...data,partner:{id:'alex'}};else if(reason==='unmount')h.unmount();
    request.resolve();await flush();assert.deepEqual(paths,reason==='confirmed'?['back']:[]);
    if(reason==='offline'){assert.equal(render().props.busy,false);assert.ok(render().props.error.includes('Reconnect'));}
    h.unmount();
  }
});
test('inline native pairing success keeps the same route and returns to its exact originating room',()=>{
  const {createRequire}=require('node:module'),path=require('node:path');
  const fromNative=createRequire(require.resolve('@react-navigation/native/package.json',{paths:[path.resolve(__dirname,'../apps/mobile')]}));
  const {StackRouter}=fromNative('@react-navigation/routers'),router=StackRouter({initialRouteName:'surprise-room'});
  const options={routeNames:['surprise-room','pair-partner','partner-connected'],routeParamList:{},routeGetIdList:{}};
  const initial=router.getInitialState(options),origin=initial.routes[0];
  const prompt=router.getStateForAction(initial,{type:'PUSH',payload:{name:'pair-partner'}},options);
  const success=prompt; // Only the route's content switches to Connected.
  assert.deepEqual(success.routes.map(route=>route.name),['surprise-room','pair-partner']);
  assert.doesNotMatch(fs.readFileSync('apps/mobile/app/(main)/pair-partner.tsx','utf8'),/router\.replace\('\/\(main\)\/partner-connected'\)/);
  const back=router.getStateForAction(success,{type:'POP',payload:{count:1}},options);assert.equal(back.routes[0].key,origin.key);assert.equal(back.routes.length,1);
});
test('all six shared entry points use this gate and entry rooms wait until visible; Home-only functions remain available',()=>{
  const read=file=>fs.readFileSync('apps/mobile/'+file,'utf8');
  assert.match(read('src/components/burrow/affection-hub.tsx'),/if \(requirePartner\(data\)\) return/);
  assert.match(read('src/components/burrow/game-room-screen.tsx'),/const begin=[\s\S]*?if\(requirePartner\(burrow\)/);
  assert.doesNotMatch(read('src/components/burrow/surprise-room-screen.tsx'),/usePartnerEntryGate/);
  assert.match(read('src/components/burrow/surprise-room-screen.tsx'),/if\(requirePartner\(data\)\)return/);
  assert.match(read('src/components/burrow/couple-journal-screen.tsx'),/usePartnerEntryGate\(data\)/);
  const layout=read('app/(main)/_layout.tsx');assert.match(layout,/name="pair-partner" options=\{\{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false/);
  const onboarding=read('src/components/onboarding/burrow-onboarding-pages.tsx');assert.match(onboarding,/PairingInviteCard/);assert.match(onboarding,/PairingCodeSheet/);assert.match(onboarding,/PairingConnectedPage/);
});
