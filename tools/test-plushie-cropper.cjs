const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
test('actual plushie art overlays the exact photo opening; drag/zoom controls save the visible crop once',async()=>{
 const h=hooks(),post=deferred(),saved=[],responders=[];let cancelled=0;
 const {PlushiePhotoCropper}=load('apps/mobile/src/components/burrow/plushie-photo-cropper.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Modal:'Modal',Pressable:'Button',useWindowDimensions:()=>({width:390,height:844}),PanResponder:{create:config=>{responders.push(config);return{panHandlers:{}};}}},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},
  './burrow-image':{Image:'Image'},'@/lib/burrow-doll-face':{dollFaceBounds:()=>[200,150,400,350]},'@/lib/room-photo-crop':load('apps/mobile/src/lib/room-photo-crop.ts'),
 });
 const render=()=>nodes(h.render(()=>PlushiePhotoCropper({asset:{uri:'photo',width:1200,height:800},toy:{source:'current-costume',width:600,height:600},onCancel:()=>cancelled++,onConfirm:async crop=>{saved.push(crop);await post.promise;}})));
 let tree=render();const art=tree.find(n=>n.props?.testID==='plushie-crop-outline');assert.equal(art.props.source,'current-costume');assert.equal(art.props.pointerEvents,'none');
 const stage=tree.find(n=>n.props?.testID==='plushie-crop-stage');assert.ok(art.props.style.width<=stage.props.style.width&&art.props.style.height<=stage.props.style.height);
 tree.find(n=>n.props?.accessibilityLabel==='Zoom in').props.onPress();render();
 responders[0].onPanResponderGrant({nativeEvent:{touches:[{pageX:0,pageY:0}]}});responders[0].onPanResponderMove({nativeEvent:{touches:[{pageX:30,pageY:0}]}},{dx:30,dy:0});
 tree=render();const save=tree.find(n=>n.props?.accessibilityLabel==='Save plushie photo');save.props.onPress();save.props.onPress();assert.equal(saved.length,1);
 assert.ok(saved[0].width<800);assert.ok(saved[0].originX>=0);assert.equal(saved[0].width,saved[0].height);
 tree=render();assert.equal(tree.find(n=>n.props?.accessibilityLabel==='Zoom in').props.disabled,true);tree.find(n=>n.type==='Modal').props.onRequestClose();assert.equal(cancelled,0);
 post.resolve();await flush();h.unmount();
});
