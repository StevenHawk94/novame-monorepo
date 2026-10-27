const {test}=require('node:test');const assert=require('node:assert/strict');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
function harness(options={}){
  const h=hooks(),timer=clock(),listeners=[],saves=[],processed=[];let epoch=1,asks=0,reads=0,vibrations=0,settings=0,focusCleanup;
  let permission=options.permission??{granted:true,canAskAgain:true};
  const app={currentState:'active',addEventListener:(_,fn)=>{listeners.push(fn);return{remove(){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}};}};
  const request=async()=>{asks++;permission=options.request?await options.request:{granted:true,canAskAgain:true};return permission;};
  const get=async()=>{reads++;return permission;};
  const {SurpriseCamera}=load('apps/mobile/src/components/burrow/surprise-camera.tsx',{
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    'react-native':{ActivityIndicator:'Spinner',AppState:app,Linking:{openSettings:async()=>{settings++;}},PanResponder:{create:()=>({panHandlers:{}})},Pressable:'Button',StyleSheet:{create:x=>x,absoluteFillObject:{}},Text:'Text',View:'View',useWindowDimensions:()=>({width:390,height:844})},
    'expo-router':{useFocusEffect:fn=>h.react.useEffect(()=>{focusCleanup=fn();return()=>focusCleanup?.();},[fn])},
    'expo-camera':{CameraView:'Camera',useCameraPermissions:()=>[permission,request,get]},
    'expo-image-picker':{launchImageLibraryAsync:()=>options.pick??Promise.resolve({canceled:true})},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:(...args)=>{processed.push(args);return options.process??Promise.resolve({uri:'cropped.jpg'});}},
    './burrow-image':{Image:'Image'},'./surprise-art':{SurprisePortrait:'Portrait'},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch},'@/lib/surprise-photo-geometry':load('apps/mobile/src/lib/surprise-photo-geometry.ts'),
    '@/lib/surprise-frame-geometry.json':require('../apps/mobile/src/lib/surprise-frame-geometry.json'),
    '@/lib/haptics':{haptics:{medium:async()=>vibrations++}},'@/lib/async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts',{},timer.globals),
    '@expo/vector-icons':{Feather:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  },timer.globals);
  const render=()=>h.render(()=>SurpriseCamera({frame:'santa',onBack(){},onDone:async uri=>{saves.push(uri);if(options.save)await options.save;}}));
  const action=(tree,label)=>nodes(tree).find(n=>n.props?.accessibilityLabel===label);
  const camera=tree=>nodes(tree).find(n=>n.type==='Camera');
  const ready=tree=>{const native=camera(tree);native.props.ref.current={takePictureAsync:()=>options.picture??Promise.resolve({uri:'captured.jpg',width:1200,height:2000})};native.props.onCameraReady();};
  const state=value=>{app.currentState=value;listeners.slice().forEach(fn=>fn(value));};
  return {h,timer,render,action,camera,ready,state,saves,processed,asks:()=>asks,reads:()=>reads,vibrations:()=>vibrations,settings:()=>settings,
    changeAccount:()=>epoch++,blur:()=>focusCleanup?.(),grant:()=>{permission={granted:true,canAskAgain:true};}};
}
test('camera back button shares the circular control and balances the flip action',()=>{
 const h=harness(),tree=h.render(),back=h.action(tree,'Back'),flip=h.action(tree,'Flip camera');
 assert.equal(back.type,'BackButton');assert.equal(back.props.light,true);assert.equal(back.props.style,undefined);
 assert.equal(flip.props.style.width,44);assert.equal(flip.props.style.height,44);h.h.unmount();
});
test('camera requests permission on entry once, then mounts a full-sized mirrored front preview before enabling shutter',async()=>{
  const prompt=deferred(),h=harness({permission:{granted:false,canAskAgain:true},request:prompt.promise});
  let tree=h.render();assert.equal(h.asks(),1);assert.equal(h.camera(tree),undefined);
  assert.ok(h.action(tree,'Allow camera access'));h.render();assert.equal(h.asks(),1);
  h.state('inactive');prompt.resolve({granted:true,canAskAgain:true});await flush();h.state('active');tree=h.render();
  const native=h.camera(tree);assert.equal(native.props.facing,'front');assert.equal(native.props.mirror,true);
  assert.equal(native.props.mode,'picture');assert.equal(native.props.active,true);
  assert.equal(h.action(tree,'Take photo').props.disabled,true);
  h.ready(tree);tree=h.render();assert.equal(h.action(tree,'Take photo').props.disabled,false);h.h.unmount();
});
test('permission denial exposes Settings and photo upload above the frame, never a permanently disabled hidden prompt',async()=>{
  const h=harness({permission:{granted:false,canAskAgain:false}});let tree=h.render();
  assert.equal(h.asks(),0);assert.equal(h.camera(tree),undefined);
  h.action(tree,'Allow camera access').props.onPress();await flush();assert.equal(h.settings(),1);
  assert.equal(h.action(tree,'Upload photo').props.disabled,false);
  h.grant();tree=h.render();assert.equal(h.camera(tree).props.facing,'front');h.h.unmount();
});
test('shutter acknowledges immediately, keeps live camera until capture resolves, freezes photo while crop/save finish, then advances',async()=>{
  const picture=deferred(),crop=deferred(),save=deferred();const h=harness({picture:picture.promise,process:crop.promise,save:save.promise});
  let tree=h.render();h.ready(tree);tree=h.render();const press=h.action(tree,'Take photo').props.onPress;press();press();tree=h.render();
  assert.equal(h.vibrations(),1);assert.ok(h.camera(tree),'do not unmount while the native capture is in flight');
  assert.ok(h.action(tree,'Processing your photo'));assert.equal(h.action(tree,'Take photo').props.disabled,true);
  picture.resolve({uri:'frozen.jpg',width:1200,height:2000});await flush();tree=h.render();
  assert.equal(h.camera(tree),undefined);assert.equal(nodes(tree).find(n=>n.type==='Image').props.source.uri,'frozen.jpg');
  assert.ok(h.action(tree,'Processing your photo'));assert.equal(h.saves.length,0);assert.equal(h.processed.length,1);
  crop.resolve({uri:'cropped.jpg'});await flush();assert.deepEqual(h.saves,['cropped.jpg']);
  tree=h.render();assert.ok(h.action(tree,'Processing your photo'));save.resolve();await flush();tree=h.render();
  assert.equal(h.action(tree,'Processing your photo'),undefined);h.h.unmount();
});
test('camera failure/8s startup timeout offers retry, and flip ignores readiness callbacks from the previous lens',()=>{
  const h=harness();let tree=h.render();const oldCamera=h.camera(tree);
  h.action(tree,'Flip camera').props.onPress();tree=h.render();assert.equal(h.camera(tree).props.facing,'back');
  oldCamera.props.onCameraReady();tree=h.render();assert.equal(h.action(tree,'Take photo').props.disabled,true);
  h.timer.advance(8000);tree=h.render();assert.equal(h.camera(tree),undefined);assert.ok(h.action(tree,'Retry camera'));
  h.action(tree,'Retry camera').props.onPress();tree=h.render();assert.ok(h.camera(tree));
  h.camera(tree).props.onMountError();tree=h.render();assert.ok(h.action(tree,'Retry camera'));h.h.unmount();
});
for(const cause of ['unmount','account','blur','background'])test('late capture cannot save after '+cause,async()=>{
  const picture=deferred(),h=harness({picture:picture.promise});let tree=h.render();h.ready(tree);tree=h.render();h.action(tree,'Take photo').props.onPress();
  if(cause==='unmount')h.h.unmount();else if(cause==='account')h.changeAccount();else if(cause==='blur')h.blur();else h.state('background');
  picture.resolve({uri:'stale.jpg',width:1200,height:2000});await flush();assert.equal(h.saves.length,0);assert.equal(h.processed.length,0);
  if(cause!=='unmount')h.h.unmount();
});
test('background releases the camera, foreground mounts a fresh preview and refreshes Settings permission',async()=>{
  const h=harness();let tree=h.render();h.ready(tree);tree=h.render();const old=h.camera(tree);const reads=h.reads();
  h.state('background');tree=h.render();assert.equal(h.camera(tree),undefined);
  h.state('active');tree=h.render();assert.ok(h.camera(tree));assert.ok(h.reads()>reads);
  old.props.onCameraReady();tree=h.render();assert.equal(h.action(tree,'Take photo').props.disabled,true);h.h.unmount();
});
test('photo library survives the native picker inactive state and keeps drag/zoom confirmation without auto-saving',async()=>{
  const picked=deferred(),h=harness({pick:picked.promise});let tree=h.render();h.action(tree,'Upload photo').props.onPress();h.state('inactive');h.render();
  picked.resolve({canceled:false,assets:[{uri:'library.jpg',width:1200,height:2000}]});await flush();h.state('active');tree=h.render();
  assert.equal(nodes(tree).find(n=>n.type==='Image').props.source.uri,'library.jpg');assert.equal(h.saves.length,0);
  h.action(tree,'Use this photo').props.onPress();await flush();assert.deepEqual(h.saves,['cropped.jpg']);h.h.unmount();
});
test('a hung native capture times out and unlocks shutter retry instead of an infinite processing screen',async()=>{
  const h=harness({picture:deferred().promise});let tree=h.render();h.ready(tree);tree=h.render();h.action(tree,'Take photo').props.onPress();h.render();
  h.timer.advance(10000);await flush();tree=h.render();assert.equal(h.action(tree,'Processing your photo'),undefined);
  assert.equal(h.action(tree,'Take photo').props.disabled,false);assert.equal(h.saves.length,0);h.h.unmount();
});
