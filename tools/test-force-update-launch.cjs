const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
function client({version='1.2.0',os='ios',row={min_version:'1.3.0',platform:'ios',message:'Please update'},error}={}){
 const calls=[];
 const api=load('apps/mobile/src/lib/force-update.ts',{
  'react-native':{Platform:{OS:os}},'expo-application':{nativeApplicationVersion:version},
  './api':{apiClient:{get:async(path,options)=>{calls.push({path,options});if(error)throw error;return {success:true,forceUpdate:row};}}},
 });
 return {api,calls};
}
test('launch update check blocks only installed versions below the matching platform threshold',async()=>{
 for(const [version,required] of [['1.2.0',true],['1.3.0',false],['1.4.0',false],['2.0.0',false]]){
  const h=client({version}),result=await h.api.checkForceUpdate();
  assert.equal(result.required,required);assert.equal(h.calls[0].path,'/api/force-update');
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
 }
 assert.equal((await client({row:{min_version:'1.3.0',platform:'all'}}).api.checkForceUpdate()).required,true);
 assert.equal((await client({row:{min_version:'1.3.0',platform:'android'}}).api.checkForceUpdate()).required,false);
});
test('inactive, offline and invalid version responses fail open rather than trapping users',async()=>{
 for(const options of [{row:null},{error:Error('offline')},{version:null},{version:'broken'},
  {row:{min_version:'broken'}},{row:{min_version:''}}]){
  assert.equal((await client(options).api.checkForceUpdate()).required,false);
 }
});
test('semver comparison uses numeric components, not build numbers or lexical ordering',()=>{
 const {api}=client();
 assert.equal(api.isVersionBelow('1.9.0','1.10.0'),true);
 assert.equal(api.isVersionBelow('1.10.0','1.9.0'),false);
 assert.equal(api.isVersionBelow('1.2.0+123','1.2.0'),false);
});
for(const os of ['ios','android'])test(`hard update wall (${os}) has no dismissal; only opens its OS store`,()=>{
 const urls=[],back=[],h=hooks(),jsx=(type,props)=>({type,props});
 const {ForceUpdateGate}=load('apps/mobile/src/components/main/force-update-gate.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},
  react:h.react,'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/splash':{hideSplashOnce(){}},'../../../assets/burrow-webp/force_update.webp':'force_update.webp',
  'react-native':{Platform:{OS:os},BackHandler:{addEventListener:(_,fn)=>{back.push(fn);return {remove(){}};}},Linking:{openURL:async url=>{urls.push(url);}},
   Image:'Image',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  '@/components/layout/app-modal':{AppModal:'Modal'},'@/lib/haptics':{haptics:{pageOpen:async()=>{}}},
 });
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const tree=h.render(()=>ForceUpdateGate({message:'Required message'})),all=nodes(tree);
 assert.equal(tree.type,'View');assert.equal(tree.props.accessibilityViewIsModal,true);assert.equal(back[0](),true);
 assert.equal(all.filter(n=>n.props?.onPress).length,1);
 assert.ok(all.some(n=>n.type==='Text'&&n.props.children==='Required message'));
 all.find(n=>n.type==='Pressable').props.onPress();
 assert.deepEqual(urls,[os==='ios'?'https://apps.apple.com/app/id6763723281':'https://play.google.com/store/apps/details?id=com.burrow.app']);
 assert.equal(all.find(n=>n.type==='Image').props.source,'force_update.webp');
});
test('hard update check and blocking gate remain mounted in the App root, independent of login and Home',()=>{
 const source=readFileSync('apps/mobile/app/_layout.tsx','utf8');
 assert.match(source,/prepareLaunchNotices\(\)\.catch/);
 assert.match(source,/!isReady \|\| !fontsLoaded \|\| !launchNotices/);
 assert.match(source,/launchNotices.update.required\?<ForceUpdateGate[^\n]+\/>:<MetaPrivacyProvider>/);
});
