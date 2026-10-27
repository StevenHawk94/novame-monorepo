const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function fixture({ancestor=false,fail=false}={}){
 const h=hooks(),options=[],guards=[],routes=[],starts=[],backs=new Set();let reject=fail,job={id:'job'},focused=true,variant='biscuit';
 const navigation={getState:()=>({index:ancestor?2:1,routes:ancestor?[{name:'(tabs)'},{name:'burrow-detail',params:{section:'adventure'}},{name:'reflect-guided'}]:[{name:'(tabs)'},{name:'reflect-typing'}]}),setOptions:opts=>options.push(opts)};
 const router={back:()=>routes.push(['back']),dismiss:n=>routes.push(['dismiss',n]),replace:href=>routes.push(['replace',href])};
 const module=load('apps/mobile/src/components/burrow/adventure-record-completion.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Text:'Text',ScrollView:'Scroll',Pressable:'Button',StyleSheet:{create:x=>x,absoluteFill:{}},
   BackHandler:{addEventListener:(name,fn)=>{assert.equal(name,'hardwareBackPress');backs.add(fn);return{remove:()=>backs.delete(fn)};}}},
  'expo-image':{Image:'Image'},'expo-router':{useRouter:()=>router,useNavigation:()=>navigation},
  '@react-navigation/native':{useIsFocused:()=>focused,usePreventRemove:(blocked,onRemove)=>guards.push({blocked,onRemove}),useFocusEffect:fn=>h.react.useEffect(()=>focused?fn():undefined,[focused,fn])},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>job,requestAdventureJournalStart:id=>{starts.push(id);if(reject)return false;return true;},retryAdventureJournalJob(){}},
  '@/lib/adventure-navigation':load('apps/mobile/src/lib/adventure-navigation.ts'),
  '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
  '@/lib/burrow-onboarding-design':{ONBOARDING_ART:{welcome:'ready-biscuit'}},'@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{}},
  '@/lib/bunny-identity':{useBunnyVariant:()=>variant},
  '@/components/main/reflect-celebration':{ReflectCelebration:'Confetti'},'./adventure-reveal':{AdventureReveal:'Reveal'},
 });
 return{...module,h,options,guards,routes,starts,backs,allowStart:()=>{reject=false;},setVariant:value=>{variant=value;},setJob:value=>{job=value;},focus:value=>{focused=value;},
  ready:props=>h.render(()=>module.AdventureReady({onStart(){},...props})),
  completion:()=>h.render(()=>module.AdventureRecordCompletion({jobId:'job'}))};
}
test('both saved-record entry paths share solid background and account-color ready art above the logged heading',()=>{
 const x=fixture();
 for(const [variant,source]of [['biscuit','ready-biscuit'],['pinky','adventure-ready-pinky']]){
  x.setVariant(variant);const tree=x.ready(),all=nodes(tree);
  assert.equal(tree.props.style.backgroundColor,'#461501');
  assert.equal(all.find(n=>n.type==='Image').props.source,source);
  assert.ok(all.findIndex(n=>n.type==='Image')<all.findIndex(n=>n.props.children==='Your day has been logged!'));
  assert.ok(!all.some(n=>n.props.children==='🎉'));
  const button=all.find(n=>n.type==='Button');assert.equal(button.props.style({pressed:false})[0].backgroundColor,'#FFC746');
 }
 const completion=x.completion();assert.equal(completion.props.style.backgroundColor,'#461501');
 assert.ok(!nodes(completion).some(n=>n.type==='Image'),'no old full-screen backdrop');x.h.unmount();
});
test('logged page has no back affordance; native swipe, Android back and route removal are blocked',()=>{
 const x=fixture();let tree=x.ready();
 assert.equal(x.guards.at(-1).blocked,true);assert.equal(x.options.at(-1).gestureEnabled,false);
 assert.equal(x.options.at(-1).fullScreenGestureEnabled,false);
 assert.equal(x.backs.size,1);assert.equal([...x.backs][0](),true);
 x.guards.at(-1).onRemove({data:{action:{type:'GO_BACK'}}});assert.equal(x.routes.length,0);
 assert.equal(nodes(tree).filter(n=>n.type==='Button').length,1,'Start is the only ordinary action');
 assert.equal(nodes(tree).some(n=>n.type==='Back'),false);
 x.h.unmount();assert.equal(x.backs.size,0);assert.equal(x.options.at(-1).gestureEnabled,true,'ongoing inherits the usual edge-back policy');
});
test('a record becoming ready in a hidden preload cannot trap or reconfigure the visible source',()=>{
 const x=fixture();x.focus(false);x.ready();assert.equal(x.guards.at(-1).blocked,false);assert.equal(x.options.length,0);assert.equal(x.backs.size,0);
 x.focus(true);x.ready();assert.equal(x.guards.at(-1).blocked,true);assert.equal(x.options.at(-1).gestureEnabled,false);assert.equal(x.backs.size,1);x.h.unmount();
});
test('only an explicitly permitted Start releases the removal/system-back guard',()=>{
 const x=fixture();x.ready();x.ready({allowNavigation:true});
 assert.equal(x.guards.at(-1).blocked,false);assert.equal([...x.backs][0](),false);
 assert.equal(x.routes.length,0);x.h.unmount();
});
for(const ancestor of [false,true])test(`Start commits its durable intent once, then navigates only after unlocking (existing Adventure: ${ancestor})`,()=>{
 const x=fixture({ancestor}),first=x.completion();
 assert.equal(nodes(first).some(n=>n.type==='Back'),false);
 const child=nodes(first).find(n=>n.type===x.AdventureReady);assert.equal(child.props.allowNavigation,false);
 child.props.onStart();child.props.onStart();assert.deepEqual(x.starts,['job']);assert.equal(x.routes.length,0);
 const second=x.completion();assert.equal(nodes(second).find(n=>n.type===x.AdventureReady).props.allowNavigation,true);
 assert.equal(x.routes.length,1);assert.equal(x.routes[0][0],ancestor?'dismiss':'replace');
 if(ancestor)assert.equal(x.routes[0][1],1);else assert.equal(x.routes[0][1].params.section,'adventure');
 x.completion();assert.equal(x.routes.length,1);x.h.unmount();
});
test('failed local Start stays on logged page and locked; a later retry can proceed',()=>{
 const x=fixture({fail:true});let tree=x.completion();nodes(tree).find(n=>n.type===x.AdventureReady).props.onStart();
 tree=x.completion();assert.equal(x.routes.length,0);assert.equal(nodes(tree).find(n=>n.type===x.AdventureReady).props.allowNavigation,false);
 assert.ok(nodes(tree).some(n=>n.props.accessibilityRole==='alert'));
 x.allowStart();nodes(tree).find(n=>n.type===x.AdventureReady).props.onStart();x.completion();assert.equal(x.routes.length,1);x.h.unmount();
});
test('background syncing cannot auto-navigate; restored ready records share the same guard and no header back button',()=>{
 const x=fixture();x.completion();x.setJob({id:'job',blocked:true});x.completion();assert.equal(x.routes.length,0);x.h.unmount();
 const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
 assert.match(source,/const adventureLogged=section==='adventure'.*data\.readyRecordId/);
 assert.match(source,/!adventureEntry&&!adventureLogged&&[^\n]*?<View style=\{\[s\.header/);
 assert.match(source,/data\.readyRecordId\?<AdventureReady/);
});
