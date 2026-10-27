const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
function view(os='ios',height=812,extra={}){
 const h=hooks(),providers=[],legal=[];let closes=0;
 const jsx=(type,props)=>({type,props});
 const api=load('apps/mobile/src/components/auth/connect-account-view.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Pressable','ScrollView','Text','View'].map(x=>[x,x])),
   Platform:{OS:os},StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:height===568?320:375,height}),Linking:{openURL:async url=>legal.push(url)}},
  '@expo/vector-icons':{MaterialCommunityIcons:'Icon',MaterialIcons:'Icon'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},'./account-provider-logo':{GoogleLogo:'GoogleLogo'},
 });
 return {render:()=>h.render(()=>api.ConnectAccountView({onClose:()=>closes++,onProvider:p=>providers.push(p),busy:false,
  children:{type:'EmailForm',props:{}},...extra})),providers,legal,closes:()=>closes};
}
for(const os of ['ios','android'])for(const height of [568,812])test(`${os}/${height}: account UI is scrollable, provider-specific and reveals email only after a tap`,()=>{
 const h=view(os,height);let tree=h.render(),all=nodes(tree);
 assert.equal(all.find(n=>n.type==='ScrollView').props.keyboardShouldPersistTaps,'handled');
 assert.equal(all.find(n=>n.type==='KeyboardAvoidingView').props.behavior,os==='ios'?'padding':'height');
 const apple=all.find(n=>n.props?.accessibilityLabel==='Sign in with Apple');assert.equal(!!apple,os==='ios');
 if(apple)apple.props.onPress();
 all.find(n=>n.props?.accessibilityLabel==='Continue with Google').props.onPress();
 assert.deepEqual(h.providers,os==='ios'?['apple','google']:['google']);
 assert.ok(!all.some(n=>n.type==='EmailForm'));
 const email=all.find(n=>n.type==='Pressable'&&nodes(n).some(v=>v.type==='Text'&&v.props.children==='Connect with Email'));
 email.props.onPress();assert.ok(nodes(h.render()).some(n=>n.type==='EmailForm'));
 all.find(n=>n.props?.accessibilityLabel==='Close account connection').props.onPress();assert.equal(h.closes(),1);
});
test('login reveals the existing smart-connect/restore form; legal links use Burrow, not the reference brand',async()=>{
 const h=view();let all=nodes(h.render());
 all.find(n=>n.type==='Pressable'&&nodes(n).some(v=>v.props?.children==='Already have an account? Log in')).props.onPress();
 all=nodes(h.render());assert.ok(all.some(n=>n.type==='EmailForm'));
 for(const link of all.filter(n=>n.props?.accessibilityRole==='link'))link.props.onPress();
 await flush();assert.deepEqual(h.legal,['https://www.burrow-app.com/terms','https://www.burrow-app.com/privacy']);
});
test('connected state and busy state preserve provider safety',()=>{
 const connected=nodes(view('ios',812,{connectedAs:'qa@example.invalid'}).render());
 assert.ok(connected.some(n=>typeof n.props?.children==='string'&&n.props.children.includes('qa@example.invalid')));
 assert.ok(!connected.some(n=>n.props?.accessibilityLabel==='Continue with Google'));
 const busy=nodes(view('ios',812,{busy:true}).render());
 for(const p of busy.filter(n=>n.type==='Pressable'&&n.props?.accessibilityLabel!=='Close account connection'))assert.equal(p.props.disabled,true);
});
test('post-purchase first dismissal still requires the existing second recommendation; Menu remains freely dismissible',async()=>{
 for(const source of ['post-purchase','menu']){
  const h=hooks(),alerts=[],navigation=[],timers=[];let guard;
  const api=load('apps/mobile/app/(main)/(modals)/connect-account.tsx',{
   react:h.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},
   'react-native':{StyleSheet:{create:x=>x}},'expo-router':{useRouter:()=>({back:()=>navigation.push('back'),replace:path=>navigation.push(path)}),useLocalSearchParams:()=>({source,after:'notification-settings'})},
   '@react-navigation/native':{usePreventRemove:(enabled,handler)=>{guard={enabled,handler};}},
   '@/components/ui/app-dialog':{appAlert:(...args)=>alerts.push(args)},'@/lib/haptics':{haptics:{pageOpen(){},pageClose(){}}},
   '@/components/auth/connect-account-view':{ConnectAccountView:'ConnectAccountView'},
   '@/lib/supabase':{supabase:{auth:{getUser:async()=>({data:{user:{is_anonymous:true}}})}}},
   '@/lib/storage':{storage:{getString:()=>undefined,remove(){},set(){}}},'@/shared/storage/keys':{kConnectedAccount:{name:'connected'}},
   '@/lib/ad-measurement':{},'@/lib/auth':{},
  },{setTimeout:fn=>{timers.push(fn);return 1;}});
  h.render(api.default);await flush();h.render(api.default);
  assert.equal(guard.enabled,source==='post-purchase');
  if(guard.enabled){guard.handler();assert.equal(alerts[0][0],'Keep your account safe');assert.equal(navigation.length,0);
   assert.ok(alerts[0][2].find(x=>x.text==='Keep Connecting'));
   alerts[0][2].find(x=>x.text==='Close Anyway').onPress();h.render(api.default);assert.equal(guard.enabled,false);
   timers.forEach(fn=>fn());assert.deepEqual(navigation,['back']);}
  h.unmount();
 }
 const paywall=fs.readFileSync('apps/mobile/app/(main)/(modals)/subscription-paywall.tsx','utf8');
 assert.match(paywall,/source: 'post-purchase'/);assert.match(paywall,/confirmSkipAccountConnection/);
 assert.doesNotMatch(paywall,/notification-settings|shouldPromptNotifAfterPurchase|markNotifPromptedAfterPurchase/);
 const onboarding=fs.readFileSync('apps/mobile/app/(onboarding)/index.tsx','utf8');
 assert.match(onboarding,/<ConnectAccountView onClose=\{confirmSkipPurchasedAccountConnection\}/);
 assert.doesNotMatch(onboarding,/notification-settings|shouldPromptNotifAfterPurchase|markNotifPromptedAfterPurchase|deferHomeEntryNotification/);
});
