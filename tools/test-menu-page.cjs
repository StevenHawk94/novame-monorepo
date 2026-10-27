const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>type==='Overlay'&&!props.visible?null:typeof type==='function'?type(props):({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>nodes(tree).filter(node=>node.type==='Text').flatMap(node=>node.props.children).filter(value=>typeof value==='string');
const partner={userId:'alex',displayName:'Alex',avatarUrl:'https://example.test/alex.webp',isDefaultAvatar:false};
function harness({paired=false,cachedPaired=paired,initiatorId=null}={}){
  const h=hooks(),paths=[],calls=[],pairingReads=[],unpairs=[],pairingListeners=[],alerts=[];
  const saved=new Map();let failPreferenceWrite=false;
  const preferenceImports={'./storage':{storage:{getString:key=>saved.get(key),set:(key,value)=>{if(failPreferenceWrite)throw Error('full');saved.set(key,value);}}},'../shared/storage/keys':{kInteractionPreferences:{name:'prefs'}}};
  const preferences=load('apps/mobile/src/lib/interaction-preferences.ts',preferenceImports);
  let pairInvalidated=false;
  let owner='me',epoch=1,data={profile:{id:'me'},partner:paired?{id:'alex',display_name:'Alex',avatar_url:partner.avatarUrl}:null};
  let cached={paired:cachedPaired,partner:cachedPaired?partner:null,pairedAt:'2026-10-13T20:00:00Z',initiatorId};
  const screen=load('apps/mobile/app/(main)/(modals)/me.tsx',{
    '@/components/burrow/burrow-back-button':{BackIcon:'BackIcon'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Text:'Text',Pressable:'Button',Switch:'Switch',ScrollView:'Scroll',TextInput:'Input',ActivityIndicator:'Spinner',KeyboardAvoidingView:'KeyboardView',StatusBar:'Status',Platform:{OS:'ios'},StyleSheet:{create:s=>s},Keyboard:{dismiss(){}},Linking:{openSettings:async()=>{}}},
    '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},
    'expo-router':{router:{push:path=>paths.push(path),back:()=>paths.push('back')},useFocusEffect:fn=>h.react.useEffect(fn,[fn])},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    '@expo/vector-icons':{MaterialIcons:'Icon',MaterialCommunityIcons:'Icon'},'expo-image':{Image:'Image'},
    'expo-web-browser':{openBrowserAsync:async()=>{}},'expo-store-review':{hasAction:async()=>false},'expo-constants':{expoConfig:{version:'1.0.24'}},
    '@gorhom/bottom-sheet':{BottomSheetModalProvider:'Provider'},'@novame/core':{PRICING_TIERS:{free:{},plus:{}}},
    '@/components/me/plan-billing-sheet':{PlanBillingSheet:'Billing'},'@/components/notifications/notification-time-picker':{NotificationTimePicker:'NotificationPicker'},
    '@/components/ui/app-dialog':{appAlert:(...args)=>alerts.push(args)},'@/components/ui/grid-background':{GridBackground:'Grid'},
    '@/lib/interaction-preferences':preferences,
    '@/lib/haptics':{haptics:{pageOpen(){},pageClose(){},light(){},warning(){},success(){}}},
    '@/lib/notification-settings':{checkNotificationPermission:async()=>'granted',getNotificationSettings:()=>({hour:9,min:0,enabled:false}),requestNotificationPermission:async()=>'granted'},
    '@/lib/subscription':{fetchSubscriptionTier:async(...args)=>calls.push(['tier',...args])},'@/lib/use-subscription-tier':{useSubscriptionTier:()=>'free'},
    '@/lib/duo-api':{fetchDuoStatus:async()=>({asOwner:null,asMember:null})},
    '@/lib/friends-api':{getCachedPairing:()=>cached,subscribePairingStatus:fn=>{pairingListeners.push(fn);return()=>{};},fetchFriends:async()=>({inviteCode:'ABC123'}),fetchPairing:options=>{const request=deferred();pairingReads.push({options,request});return request.promise;},unsetPairing:()=>{const request=deferred();unpairs.push(request);return request.promise;}},
    '@/lib/me-stats':{getCachedMeStats:()=>({displayName:'Sam',avatarUrl:'default-1'}),fetchMeStats:async()=>{}},'@/lib/onboarding':{getBunnyName:()=>''},'@/lib/avatar':{resolveAvatarSource:url=>url},
    '@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})}}},
    '@/components/privacy/meta-privacy-provider':{useMetaPrivacy:()=>({applies:false})},
    '@/lib/partner-pairing':{showPartnerPairing:()=>paths.push('/(main)/pair-partner')},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data,pairInvalidated}),invalidateBurrowPair:()=>{calls.push('invalidate');data=null;pairInvalidated=true;},refreshBurrowAfterCurrent:async()=>calls.push('refresh')},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner},
  });
  const render=()=>h.render(screen.default),button=label=>nodes(render()).find(node=>node.type==='Button'&&node.props.accessibilityLabel===label);
  const byText=label=>nodes(render()).find(node=>node.type==='Button'&&[node.props.children].flat().some(child=>child?.type==='Text'&&child.props.children===label));
  return {h,render,button,byText,paths,calls,pairingReads,unpairs,preferences,alerts,
    persistedPreferences:()=>load('apps/mobile/src/lib/interaction-preferences.ts',preferenceImports).getInteractionPreferences(),
    failPreferenceWrite:()=>{failPreferenceWrite=true;},
    account(){owner='other';epoch++;},snapshot(value){data=value;},
    remoteUnpair(){data=null;pairInvalidated=true;pairingListeners.forEach(fn=>fn({paired:false,partner:null}));},
    rePair(person){data={profile:{id:owner},partner:{id:person.userId,display_name:person.displayName},pairVersion:'new-version'};pairInvalidated=false;pairingListeners.forEach(fn=>fn({paired:true,partner:person,pairedAt:'2026-10-14T20:00:00Z'}));},
  };
}
test('warm-paper Menu has editable self avatar, white rows and Redeem Code directly below coins',async()=>{
  const h=harness();h.render();await flush();const tree=h.render(),all=nodes(tree);
  assert.ok(text(tree).includes('Sam'));assert.ok(text(tree).join('').includes('Version 1.0.24'));
  const rows=all.filter(node=>node.type==='Button'&&node.props.accessibilityLabel).map(node=>node.props.accessibilityLabel);
  assert.deepEqual(rows.slice(rows.indexOf('Account Management')),['Account Management','Pair with My Partner','Get More Coins','Redeem Code','Connect Account','Rate Us on App Store','Report Bugs','Help Center']);
  assert.equal(h.button('Close menu').props.style.backgroundColor,'#FFFFFF');
  assert.equal(all.find(node=>node.type==='Scroll').props.bounces,false);
  assert.equal(h.button('Edit profile'),undefined);
  h.button('Account Management').props.onPress();h.button('Get More Coins').props.onPress();h.button('Close menu').props.onPress();
  assert.deepEqual(h.paths,['/(main)/(modals)/account-management','/(main)/coin-shop','back']);h.h.unmount();
});
test('sound and haptics are peer rows directly below Help Center, with matching bold labels/icons and centered orange switches',()=>{
 const h=harness(),tree=h.render(),all=nodes(tree);
 const help=all.find(n=>n.type==='Button'&&n.props.accessibilityLabel==='Help Center');
 const group=all.find(n=>n.type==='View'&&[n.props.children].flat().includes(help));assert.ok(group);
 const rows=[group.props.children].flat(Infinity);
 assert.deepEqual(rows.slice(-3).map(n=>text(n)[0]),['Help Center','Music & Sound Effects','Haptic Feedback']);
 const helpLabel=nodes(help).find(n=>n.type==='Text');
 for(const [index,icon]of [[rows.length-2,'volume-high'],[rows.length-1,'vibrate']]){
  const row=rows[index],switchNode=nodes(row).find(n=>n.type==='Switch');
  const style=Object.assign({},...row.props.style.filter(Boolean));
  assert.equal(style.alignItems,'center');assert.equal(style.minHeight,60);
  assert.ok(nodes(row).some(n=>n.type==='Icon'&&n.props.name===icon));
  assert.equal(nodes(row).find(n=>n.type==='Text').props.style,helpLabel.props.style);
  assert.equal(helpLabel.props.style.fontFamily,'Inter_700Bold');
  assert.equal(switchNode.props.style.alignSelf,'center');assert.equal(switchNode.props.trackColor.true,'#C96132');
  assert.equal(switchNode.props.trackColor.false,undefined,'preserve native disabled track styling');
 }
 h.h.unmount();
});
test('self stays left, avatars delegate to the shared initiator palette, and Plus View opens paywall directly',()=>{
 for(const initiatorId of ['me','alex']){
  const h=harness({paired:true,initiatorId}),avatars=nodes(h.render()).filter(n=>n.type==='UserAvatar');
  assert.equal(avatars[0].props.userId,'me');assert.equal(avatars[1].props.userId,'alex');
  const avatar=load('apps/mobile/src/lib/avatar.ts');avatar.configureAvatarPair({id:'me'},{id:'alex'});avatar.configureAvatarPairRole('me','alex',initiatorId);
  for(const node of avatars){assert.equal(node.props.fallbackBackgroundColor,undefined);assert.equal(node.props.fallbackTextColor,undefined);
    assert.equal(avatar.initialAvatar(node.props.userId,node.props.name,node.props.otherUserId).backgroundColor,node.props.userId===initiatorId?'#FFC547':'#83513E');}
  h.byText('View').props.onPress();assert.deepEqual(h.paths,['/(main)/(modals)/subscription-paywall']);h.h.unmount();
 }
});
test('Menu switches persist independently and failed writes keep the previous setting with recovery guidance',()=>{
 const h=harness(),toggle=(label,value)=>nodes(h.render()).find(n=>n.type==='Switch'&&n.props.accessibilityLabel===label).props.onValueChange(value);
 toggle('Haptic Feedback',false);assert.equal(h.preferences.getInteractionPreferences().sound,true);assert.equal(h.preferences.getInteractionPreferences().haptics,false);
 assert.equal(h.persistedPreferences().haptics,false);assert.equal(h.persistedPreferences().sound,true);
 toggle('Music & Sound Effects',false);toggle('Haptic Feedback',true);
 assert.equal(h.preferences.getInteractionPreferences().sound,false);assert.equal(h.persistedPreferences().haptics,true);
 h.failPreferenceWrite();toggle('Haptic Feedback',false);
 assert.equal(h.preferences.getInteractionPreferences().haptics,true);assert.equal(h.preferences.getInteractionPreferences().sound,false);
 assert.equal(h.alerts[0][0],'Could not save setting');assert.equal(h.paths.length,0);h.h.unmount();
});
test('every unpaired row tap opens the existing shared invitation, never a friend share sheet',()=>{
  const h=harness();h.button('Pair with My Partner').props.onPress();h.button('Pair with My Partner').props.onPress();
  assert.deepEqual(h.paths,['/(main)/pair-partner','/(main)/pair-partner']);assert.equal(h.unpairs.length,0);h.h.unmount();
});
test('confirmed bootstrap immediately shows My Paired despite stale unpaired cache; fresh detail supplies the actual pairing date',async()=>{
  const h=harness({paired:true,cachedPaired:false});h.button('My Paired').props.onPress();
  assert.ok(text(h.render()).includes('Status: Paired'));assert.ok(text(h.render()).includes('Alex'));assert.equal(h.paths.length,0);
  assert.equal(h.pairingReads[0].options.force,true);
  h.pairingReads[0].request.resolve({paired:true,partner,pairedAt:'2026-10-13T20:00:00Z'});await flush();
  assert.ok(text(h.render()).includes('October 13, 2026'));assert.ok(h.byText('Unpair'));h.h.unmount();
});
test('unpaired bootstrap overrides an obsolete paired cache and reopens the invitation',()=>{
  const h=harness({paired:false,cachedPaired:true});assert.equal(h.button('My Paired'),undefined);h.button('Pair with My Partner').props.onPress();assert.equal(h.paths.at(-1),'/(main)/pair-partner');h.h.unmount();
});
function confirm(h){h.button('My Paired').props.onPress();h.byText('Unpair').props.onPress();const input=nodes(h.render()).find(node=>node.type==='Input');input.props.onChangeText('Confirm');return h.byText('Unpair').props.onPress;}
test('Unpair requires explicit typed confirmation; Cancel and a disabled submission never send DELETE',()=>{
  const h=harness({paired:true});h.button('My Paired').props.onPress();h.byText('Unpair').props.onPress();const submit=h.byText('Unpair');assert.equal(submit.props.disabled,true);submit.props.onPress();assert.equal(h.unpairs.length,0);
  h.byText('Cancel').props.onPress();assert.ok(text(h.render()).includes('Status: Paired'));h.h.unmount();
});
test('confirmed Unpair submits once, invalidates all shared snapshots, refreshes tier and immediately returns to unpaired row',async()=>{
  const h=harness({paired:true});const submit=confirm(h);submit();submit();assert.equal(h.unpairs.length,1);
  h.unpairs[0].resolve(true);await flush();assert.ok(h.calls.includes('invalidate'));assert.ok(h.button('Pair with My Partner'));assert.equal(h.button('My Paired'),undefined);assert.equal(h.paths.length,0);
  assert.ok(h.calls.some(value=>Array.isArray(value)&&value[0]==='tier'&&value[1]==='me'&&value[2]?.force));h.h.unmount();
});
test('failed Unpair preserves partner details and permits retry without any snapshot invalidation',async()=>{
  const h=harness({paired:true});confirm(h)();h.unpairs[0].resolve(false);await flush();assert.ok(text(h.render()).some(value=>value.includes('We could not end this pairing')));assert.ok(!h.calls.includes('invalidate'));
  h.byText('Unpair').props.onPress();assert.equal(h.unpairs.length,2);h.h.unmount();
});
test('an old-account Unpair completion never clears the new account snapshot',async()=>{
  const h=harness({paired:true});confirm(h)();h.account();h.unpairs[0].resolve(true);await flush();assert.ok(!h.calls.includes('invalidate'));assert.equal(h.paths.length,0);h.h.unmount();
});
test('a remotely ended or changed pairing dismisses the old partner confirmation',()=>{
  for(const partner of [null,{id:'bob',display_name:'Bob'}]){
    const h=harness({paired:true});confirm(h);
    h.snapshot({profile:{id:'me'},partner});h.render();
    assert.equal(nodes(h.render()).filter(node=>node.type==='Overlay'&&node.props.visible).length,0);
    assert.equal(h.unpairs.length,0);h.h.unmount();
  }
});
test('remote Unpair changes an already-open Menu immediately, even if bootstrap refresh is offline',()=>{
  const h=harness({paired:true});h.button('My Paired').props.onPress();h.remoteUnpair();h.render();
  assert.ok(h.button('Pair with My Partner'));assert.equal(h.button('My Paired'),undefined);
  assert.equal(nodes(h.render()).filter(node=>node.type==='Overlay'&&node.props.visible).length,0);
  h.button('Pair with My Partner').props.onPress();assert.equal(h.paths.at(-1),'/(main)/pair-partner');h.h.unmount();
});
test('both open Menus restore My Paired and the new date after pairing again, without old modal state',()=>{
  for(const person of [partner,{...partner,userId:'bob',displayName:'Bob'}])for(const device of ['initiator','recipient']){
    const h=harness({paired:true});h.button('My Paired').props.onPress();h.remoteUnpair();h.render();h.rePair(person);
    assert.equal(h.button('Pair with My Partner'),undefined,device);h.button('My Paired').props.onPress();
    const copy=text(h.render());assert.ok(copy.includes(person.displayName));assert.ok(copy.includes('October 14, 2026'));
    assert.ok(!copy.includes('October 13, 2026'));assert.ok(copy.includes('Status: Paired'));h.h.unmount();
  }
});
