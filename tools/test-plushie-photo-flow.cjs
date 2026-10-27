const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const plain=value=>JSON.parse(JSON.stringify(value));

function harness({source='library',owner='me',restored=null,denied=false,width=390,height=844}={}){
  const h=hooks(),timer=clock(),picker=deferred(),capture=deferred(),response=deferred();
  const state={saved:0,closed:0,quota:0,epoch:1,draft:restored,picks:[],requests:[],transforms:[],photos:[],alerts:[],pictures:0,respond:()=>response.promise};
  const data={profile:{id:'me'},partner:{id:'partner'},pairVersion:'pair-1',roomPhotos:[]};
  const receipt={photoId:'photo',photo:{id:'photo',kind:'doll',ownerId:owner,toyId:'toy-A',updatedAt:'2026-10-18T12:00:00Z'},photoUsage:{}};
  const {RoomPhotoEditor,uploadRoomPhoto}=load('apps/mobile/src/components/burrow/room-photo.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{ActivityIndicator:'Spinner',AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Alert:{alert:(...a)=>state.alerts.push(a)},
      Modal:'Modal',PanResponder:{create:()=>({panHandlers:{}})},Pressable:'Pressable',ScrollView:'ScrollView',
      StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,right:0,bottom:0,left:0}},Text:'Text',View:'View',useWindowDimensions:()=>({width,height})},
    './burrow-image':{Image:'Image'},'expo-router':{useFocusEffect(){}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},
    'expo-camera':{CameraView:'CameraView',useCameraPermissions:()=>[{granted:!denied},async()=>({granted:!denied})]},
    'expo-image-picker':{launchImageLibraryAsync:async options=>{state.picks.push(options);return picker.promise;}},
    'expo-crypto':{randomUUID:()=> 'one-upload-key'},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:async(...a)=>{state.transforms.push(a);return {uri:'file:///cropped.jpg',base64:'cropped-jpeg-bytes'};}},
    '@/lib/app-major-update-api':{saveRoomPhoto:async(...a)=>{state.requests.push(a);return state.respond();}},
    '@/lib/burrow-room-photo-cache':{cachedRoomPhotoUri:()=>null,loadRoomPhoto:async()=>'',keepRoomPhotoPreview:async()=>{},invalidateRoomPhotoCache(){}},
    '@/lib/burrow-store':{enqueueFramePhoto:async(_data,owner,bytes,key)=>{
      if(state.localFailure)throw state.localFailure;
      state.photos.push({id:'local-frame-'+key,owner,bytes});
    },enqueuePlushiePhoto:async(_data,owner,toy,bytes,key)=>{
      if(state.localFailure){if(state.failRecovery)state.diskFailure=true;throw state.localFailure;}
      state.requests.push([owner,'doll',bytes,key,'me','partner',toy]);state.photos.push({id:'local-plushie-'+key});
    },setBurrowPhotoLocally:(...a)=>state.photos.push(a),scheduleBurrowRefresh(){},refreshBurrowAfterCurrent:async()=>{},burrowClock:()=>0,getBurrowSnapshot:()=>({data})},
    '@/lib/burrow-photo-drafts':{readPhotoDraft:()=>{if(state.diskFailure)throw Error('photo_draft_unavailable');return state.draft;},persistPhotoDraft:(_scope,_target,draft)=>{state.draft=draft;},removePhotoDraft:(_scope,_target,key)=>{if(state.draft?.key===key)state.draft=null;}},
    '@/lib/burrow-doll-face':{dollFaceBounds:()=>[100,100,300,300],dollFaceRect:()=>({})},
    '@/lib/room-photo-errors':load('apps/mobile/src/lib/room-photo-errors.ts'),
    '@/lib/room-photo-crop':load('apps/mobile/src/lib/room-photo-crop.ts'),
    '@/lib/burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
    '@/lib/haptics':{haptics:{medium:async()=>{}}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>state.epoch,subscribeSessionIdentity:()=>()=>{}},
    './burrow-back-button':{BurrowBackButton:'Back'},'./frame-photo-cropper':{FramePhotoCropper:'FramePhotoCropper'},
  },timer.globals);
  const render=()=>h.render(()=>RoomPhotoEditor({data,ownerId:owner,kind:'doll',toyId:'toy-A',toyAsset:{source:1,width:600,height:600},
    captureOnly:true,initialSource:source,onClose:()=>state.closed++,onSaved:()=>state.saved++,onDailyLimit:()=>state.quota++}));
  return {h,timer,picker,capture,response,state,data,receipt,render,uploadRoomPhoto,
    async pick(){render();timer.advance(0);await flush();picker.resolve({canceled:false,assets:[{uri:'file:///native-crop.jpg',width:800,height:800}]});await flush();await flush();
      const cropper=nodes(render()).find(n=>n.type==='PlushiePhotoCropper');assert.ok(cropper);void cropper.props.onConfirm({originX:100,originY:100,width:600,height:600});await flush();await flush();},
    async shoot(){let tree=render();timer.advance(0);await flush();tree=render();
      nodes(tree).find(n=>n.type==='View'&&n.props.onLayout&&!n.props.pointerEvents).props.onLayout({nativeEvent:{layout:{width,height}}});tree=render();
      const stage=nodes(tree).find(n=>n.props?.onLayout&&n.props.pointerEvents==='none'),box=Object.assign({},...stage.props.style);
      stage.props.onLayout({nativeEvent:{layout:{x:box.left,y:box.top,width:box.width,height:box.height}}});tree=render();
      const camera=nodes(tree).find(n=>n.type==='CameraView');camera.props.ref.current={takePictureAsync:()=>{state.pictures++;return capture.promise;}};
      camera.props.onCameraReady();tree=render();const shutter=nodes(tree).find(n=>n.props?.accessibilityLabel==='Take photo');
      shutter.props.onPress();shutter.props.onPress();capture.resolve({uri:'file:///camera.jpg',width:1200,height:1600});await flush();await flush();},
  };
}

test('frame helper resolves after local acceptance, not the still-pending upload API',async()=>{
  const q=harness();
  await q.uploadRoomPhoto(q.data,'me','frame',{uri:'file:///picked.jpg',width:1200,height:800});
  assert.equal(q.state.requests.length,0,'no cloud request on crop critical path');
  assert.equal(q.state.photos[0].id,'local-frame-one-upload-key');assert.equal(q.state.draft,null);
  assert.equal(q.state.transforms.length,1);assert.equal(q.state.transforms[0][1][1].resize.width,603);
});
test('frame helper retains cropper error on local disk failure instead of reporting success',async()=>{
  const q=harness();q.state.localFailure=Error('disk_full');
  await assert.rejects(q.uploadRoomPhoto(q.data,'me','frame',{uri:'file:///picked.jpg',width:1200,height:800}),/disk_full/);
  assert.equal(q.state.photos.length,0);assert.equal(q.state.requests.length,0);
});

for(const owner of ['me','partner'])test(`Plushie ${owner}: library opens directly; costume crop completion saves once without another confirmation`,async()=>{
  const q=harness({owner});let tree=q.render();
  assert.equal(nodes(tree).some(n=>n.type==='Modal'||n.type==='ScrollView'),false);
  q.timer.advance(0);await flush();assert.equal(q.state.picks.length,1);
  assert.equal(q.state.picks[0].allowsEditing,false);assert.deepEqual(plain(q.state.picks[0].aspect),[1,1]);
  assert.equal(nodes(q.render()).some(n=>n.type==='Modal'||n.props?.children==='A familiar little face'),false);
  q.picker.resolve({canceled:false,assets:[{uri:'file:///native-crop.jpg',width:800,height:800}]});await flush();await flush();
  assert.equal(q.state.requests.length,0,'selection alone does not submit an unaligned photo');
  const cropper=nodes(q.render()).find(n=>n.type==='PlushiePhotoCropper');assert.ok(cropper);assert.equal(cropper.props.toy.source,1);
  void cropper.props.onConfirm({originX:100,originY:100,width:600,height:600});void cropper.props.onConfirm({originX:100,originY:100,width:600,height:600});await flush();await flush();
  assert.equal(q.state.requests.length,1);assert.equal(q.state.requests[0][0],owner);assert.equal(q.state.requests[0][6],'toy-A');
  assert.equal(q.state.transforms[0][0],'file:///native-crop.jpg');assert.equal(q.state.draft,null);
  tree=q.render();assert.equal(nodes(tree).some(n=>n.props?.children==='Save / retry photo'||n.type==='Modal'),false);
  q.response.resolve(q.receipt);await flush();await flush();
  assert.equal(q.state.saved,1);assert.equal(q.state.closed,1);assert.equal(q.state.photos.length,1);assert.equal(q.state.draft,null);q.h.unmount();
});

test('cancelling library/crop leaves the existing face and daily allowance untouched',async()=>{
  const q=harness();q.render();q.timer.advance(0);await flush();q.picker.resolve({canceled:true});await flush();
  assert.equal(q.state.closed,1);assert.equal(q.state.requests.length,0);assert.equal(q.state.saved,0);assert.equal(q.state.quota,0);assert.equal(q.state.draft,null);q.h.unmount();
});

for(const source of ['library','camera'])test(`${source}: local disk failure retains exact crop/key; retry does not encode or ask for another confirmation`,async()=>{
  const q=harness({source});q.state.localFailure=Error('photo_disk_unavailable');await(source==='library'?q.pick():q.shoot());
  assert.equal(q.state.requests.length,0);const bytes=q.state.draft.base64,key=q.state.draft.key,transforms=q.state.transforms.length;
  const retry=nodes(q.render()).find(n=>n.props?.label==='Retry saving photo');assert.ok(retry);
  q.state.localFailure=null;
  retry.props.onPress();retry.props.onPress();await flush();await flush();
  assert.equal(q.state.requests.length,1);assert.equal(q.state.requests[0][2],bytes);assert.equal(q.state.requests[0][3],key);
  assert.equal(q.state.transforms.length,transforms);assert.equal(q.state.draft,null);
  assert.equal(q.state.closed,1);assert.equal(q.state.saved,1);q.h.unmount();
});

test('restored submitted draft offers only recovery and never reopens the picker',async()=>{
  const q=harness({restored:{base64:'previous-bytes',key:'previous-key',submitted:true,savedAt:1,expectedPhotoId:null}});
  q.render();q.timer.advance(1000);await flush();assert.equal(q.state.picks.length,0);
  const tree=q.render();assert.equal(nodes(tree).some(n=>n.props?.children==='A familiar little face'),false);
  nodes(tree).find(n=>n.props?.label==='Retry saving photo').props.onPress();await flush();
  assert.equal(q.state.requests[0][2],'previous-bytes');assert.equal(q.state.requests[0][3],'previous-key');
  q.response.resolve(q.receipt);await flush();await flush();assert.equal(q.state.closed,1);assert.equal(q.state.draft,null);q.h.unmount();
});

test('library photo is displayed and editor closes while the cloud response is still pending',async()=>{
  const q=harness();await q.pick();
  assert.equal(q.state.closed,1);assert.equal(q.state.saved,1);assert.equal(q.state.photos.length,1);
  assert.equal(q.state.quota,0);assert.equal(q.state.alerts.length,0);assert.equal(q.state.draft,null);q.h.unmount();
});

test('a daily limit reached while retrying is reported once and closes the direct flow',async()=>{
  const q=harness({restored:{base64:'previous-bytes',key:'previous-key',submitted:true,savedAt:1,expectedPhotoId:null}});
  q.state.localFailure={body:{error:'daily_limit_reached'}};
  q.render();const retry=nodes(q.render()).find(n=>n.props?.label==='Retry saving photo');retry.props.onPress();retry.props.onPress();
  await flush();await flush();
  assert.equal(q.state.requests.length,0);assert.equal(q.state.closed,1);assert.equal(q.state.quota,1);assert.equal(q.state.alerts.length,1);q.h.unmount();
});

test('a local save failure with unreadable recovery draft reports an error without an unhandled rejection',async()=>{
  const q=harness();q.state.localFailure=Error('photo_disk_unavailable');q.state.failRecovery=true;await q.pick();await flush();await flush();
  assert.ok(nodes(q.render()).some(n=>n.props?.accessibilityRole==='alert'&&n.props.children.includes('could not be recovered')));
  assert.equal(q.state.closed,0);assert.equal(q.state.saved,0);q.h.unmount();
});

test('unmounted or changed-account picker results cannot upload or change the face',async()=>{
  for(const unmount of [true,false]){
    const q=harness();q.render();q.timer.advance(0);await flush();if(unmount)q.h.unmount();else q.state.epoch++;
    q.picker.resolve({canceled:false,assets:[{uri:'stale',width:800,height:800}]});await flush();
    assert.equal(q.state.requests.length,0);assert.equal(q.state.closed,0);assert.equal(q.state.photos.length,0);
  }
});

for(const [width,height] of [[320,568],[390,844],[428,926]])test(`${width}×${height}: camera shutter is centered independently of safe areas; capture applies directly`,async()=>{
  const q=harness({source:'camera',width,height});let tree=q.render();
  const shutter=nodes(tree).find(n=>n.props?.accessibilityLabel==='Take photo');
  const actions=nodes(tree).find(n=>n.props?.children===shutter);const style=Object.assign({},...actions.props.style);
  assert.equal(style.position,'absolute');assert.equal(style.left,0);assert.equal(style.right,0);assert.equal(style.justifyContent,'center');assert.equal(style.bottom,0);
  await q.shoot();assert.equal(q.state.pictures,1);assert.equal(q.state.requests.length,1);
  assert.equal(q.state.closed,1,'local crop completes without waiting for cloud');
  const crop=q.state.transforms[0][1][0].crop;
  assert.equal(crop.width,crop.height);assert.ok(crop.originX>=0&&crop.originY>=0);
  assert.ok(crop.originX+crop.width<=1200&&crop.originY+crop.height<=1600);
  assert.notEqual(crop.width,1200,'camera saves the aligned face region, not the entire camera canvas');
  q.response.resolve(q.receipt);await flush();await flush();
  assert.equal(q.state.saved,1);assert.equal(q.state.closed,1);q.h.unmount();
});

test('camera permission denial closes capture without uploading',async()=>{
  const q=harness({source:'camera',denied:true});q.render();q.timer.advance(0);await flush();
  assert.equal(q.state.closed,1);assert.equal(q.state.alerts.length,1);assert.equal(q.state.requests.length,0);q.h.unmount();
});
test('camera defaults front, flips back without mirroring, ignores old ready callbacks, and cannot switch during capture',async()=>{
 const q=harness({source:'camera'});q.render();q.timer.advance(0);await flush();
 let camera=nodes(q.render()).find(n=>n.type==='CameraView');assert.equal(camera.props.facing,'front');assert.equal(camera.props.mirror,true);
 const oldReady=camera.props.onCameraReady;oldReady();let tree=q.render();
 const flip=nodes(tree).find(n=>n.props?.accessibilityLabel==='Flip camera');flip.props.onPress();flip.props.onPress();oldReady();
 camera=nodes(q.render()).find(n=>n.type==='CameraView');assert.equal(camera.props.facing,'back');assert.equal(camera.props.mirror,false);
 oldReady();assert.equal(nodes(q.render()).find(n=>n.props?.accessibilityLabel==='Take photo').props.disabled,true);
 camera.props.onCameraReady();assert.equal(nodes(q.render()).find(n=>n.props?.accessibilityLabel==='Take photo').props.disabled,false);
 camera.props.ref.current={takePictureAsync:()=>q.capture.promise};nodes(q.render()).find(n=>n.props?.accessibilityLabel==='Take photo').props.onPress();
 nodes(q.render()).find(n=>n.props?.accessibilityLabel==='Flip camera').props.onPress();assert.equal(nodes(q.render()).find(n=>n.type==='CameraView').props.facing,'back');
 q.capture.resolve(null);await flush();q.h.unmount();
});
test('cancel custom costume crop never uploads or consumes quota',async()=>{
 const q=harness();q.render();q.timer.advance(0);await flush();q.picker.resolve({canceled:false,assets:[{uri:'original',width:1200,height:800}]});await flush();
 const cropper=nodes(q.render()).find(n=>n.type==='PlushiePhotoCropper');assert.ok(cropper);cropper.props.onCancel();
 assert.equal(q.state.closed,1);assert.equal(q.state.requests.length,0);assert.equal(q.state.photos.length,0);assert.equal(q.state.quota,0);q.h.unmount();
});
