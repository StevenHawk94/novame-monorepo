const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function harness({platform='ios',granted=true,canceled=false,fail=false}={}){
 const h=hooks(),calls=[],alerts=[];let owner='me',epoch=1;
 const picker=async options=>{calls.push(['picker',options]);return{canceled,assets:[{uri:'file:///original'}]};};
 const api=load('apps/mobile/src/components/me/profile-avatar-editor.tsx',{
 react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ActivityIndicator:'Spinner',Modal:'Modal',Platform:{OS:platform},Pressable:'Button',StyleSheet:{create:s=>s},Text:'Text',View:'View',Linking:{openSettings:async()=>{}}},
 '@expo/vector-icons':{MaterialCommunityIcons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:34})},
 'expo-image-picker':{CameraType:{front:'front'},requestCameraPermissionsAsync:async()=>{calls.push(['permission']);return{granted};},launchCameraAsync:picker,launchImageLibraryAsync:picker},
 'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:async(...args)=>{calls.push(['crop',...args]);return{uri:'file:///crop'};}},
 '@/lib/profile-avatar-local':{saveLocalProfileAvatar:async(...args)=>{calls.push(['save',...args]);if(fail)throw Error('disk full');}},
 '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner},'@/components/ui/app-dialog':{appAlert:(...args)=>alerts.push(args)},
 },{requestAnimationFrame:fn=>fn()});
 const render=()=>h.render(()=>api.ProfileAvatarEditor({userId:'me',previousUrl:'https://old',onClose:()=>calls.push(['close'])}));
 const choose=kind=>{const buttons=nodes(render()).filter(n=>n.type==='Button');buttons[kind==='camera'?1:2].props.onPress();};
 return{calls,alerts,choose,render,h,switch:()=>{owner='other';epoch++;},dismiss:()=>nodes(render()).find(n=>n.type==='Modal').props.onDismiss()};
}
test('iOS dismisses sheet before presenting picker; double tap and dismissal cannot duplicate upload',async()=>{
 const h=harness();h.choose('library');h.choose('library');assert.equal(h.calls.length,0);h.dismiss();h.dismiss();await flush();
 assert.equal(h.calls.filter(c=>c[0]==='picker').length,1);assert.equal(h.calls.filter(c=>c[0]==='save').length,1);
 assert.equal(h.calls[0][1].allowsEditing,true);assert.deepEqual(Array.from(h.calls[0][1].aspect),[1,1]);assert.equal(h.calls.at(-1)[0],'close');h.h.unmount();
});
test('Android camera requests permission, defaults front camera and saves processed crop locally',async()=>{
 const h=harness({platform:'android'});h.choose('camera');await flush();assert.equal(h.calls[0][0],'permission');assert.equal(h.calls[1][1].cameraType,'front');assert.equal(h.calls.find(c=>c[0]==='save')[2],'file:///crop');h.h.unmount();
});
test('cancel, permission denial, account change and disk failure preserve old avatar',async()=>{
 for(const options of [{canceled:true},{granted:false},{fail:true},{switch:true}]){
  const h=harness(options);h.choose(options.granted===false?'camera':'library');if(options.switch)h.switch();h.dismiss();await flush();
  if(!options.fail)assert.equal(h.calls.filter(c=>c[0]==='save').length,0);else assert.ok(h.alerts.length);
  h.h.unmount();
 }
});
test('Redeem Code invokes native iOS or official Google Play directly and gates repeated taps',async()=>{
 for(const platform of ['ios','android']){
  const calls=[];const api=load('apps/mobile/src/lib/redeem-offer.ts',{'react-native':{Platform:{OS:platform},Linking:{openURL:async url=>calls.push(url)}},'./iap':{presentOfferCodeRedemption:async()=>calls.push('native')},'@/components/ui/app-dialog':{appAlert(){}}});
  await Promise.all([api.openOfficialRedeemCode(),api.openOfficialRedeemCode()]);assert.deepEqual(calls,[platform==='ios'?'native':'https://play.google.com/redeem']);
 }
});
