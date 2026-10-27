const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { load, flush, deferred, hooks } = require('./lifecycle-test-utils.cjs');

test('single BGM controller removes old players, loops quietly, and None releases it', async () => {
  const { createBurrowAudioController } = load('apps/mobile/src/lib/burrow-audio-controller.ts');
  const players = [];
  const controller = createBurrowAudioController(async () => {}, key => {
    const p = { key, play() { this.played = true; }, pause() { this.paused = true; }, remove() { this.removed = true; } }; players.push(p); return p;
  }, () => {});
  await controller.select('calm');
  assert.equal(players[0].loop, true); assert.equal(players[0].volume, .35); assert.equal(players[0].played, true);
  await controller.select('dream'); assert.equal(players[0].paused, true); assert.equal(players[0].volume, 0);
  assert.equal(players[0].removed, true); assert.equal(players[1].played, true);
  await controller.select(null); assert.equal(players[1].paused, true); assert.equal(players[1].removed, true);
});
test('background/sign-out while audio mode awaits never starts a stale track', async () => {
  const { createBurrowAudioController } = load('apps/mobile/src/lib/burrow-audio-controller.ts');
  const mode = deferred(); let creates = 0;
  const controller = createBurrowAudioController(() => mode.promise, () => { creates++; return {}; }, () => {});
  const pending = controller.select('calm'); controller.stop(); mode.resolve(); await pending;
  assert.equal(creates, 0);
});
test('rapid track switches discard stale setup and failure allows explicit retry', async () => {
  const { createBurrowAudioController } = load('apps/mobile/src/lib/burrow-audio-controller.ts');
  const first = deferred(); let count = 0; const creates = [], errors = [];
  const controller = createBurrowAudioController(() => ++count === 1 ? first.promise : Promise.resolve(), key => {
    creates.push(key); if (key === 'bad') throw Error('native'); return { play() {}, pause() {}, remove() {} };
  }, error => errors.push(error));
  const pending = controller.select('calm'); await controller.select('dream'); first.resolve(); await pending;
  assert.deepEqual(creates, ['dream']); await controller.select('bad'); assert.equal(errors.at(-1), true);
  await controller.select('calm'); assert.equal(errors.at(-1), false);
});
test('three supplied music files are bounded bundled MP3s, not removed placeholder WAVs', () => {
  for (const name of ['Lo-fi','Lullaby','Jazz']) {
    const mp3 = readFileSync(`apps/mobile/assets/music/${name}.MP3`);
    assert.ok(mp3.toString('ascii',0,3)==='ID3'||(mp3[0]===0xff&&(mp3[1]&0xe0)===0xe0));
    assert.ok(mp3.length>10_000&&mp3.length<2_000_000);
  }
});

function jpeg(width=512,height=512) {
  // Structural fixture, not a renderable photo. Native JPEG codec QA is separate.
  return Buffer.from([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,218,0,8,1,1,0,0,63,0,42,255,217]).toString('base64');
}
test('photo input enforces 201:290 frames and preserves square/5:7 legacy uploads', async () => {
  const { decodeRoomPhoto, readPhotoRequest } = await import('../apps/api/src/lib/burrow-photo.mjs');
  assert.ok(decodeRoomPhoto(jpeg()).length > 0);
  assert.ok(decodeRoomPhoto(jpeg(500,700),'frame').length > 0);
  assert.ok(decodeRoomPhoto(jpeg(603,870),'frame').length > 0);
  assert.ok(decodeRoomPhoto(jpeg(201,290),'frame').length > 0);
  assert.throws(() => decodeRoomPhoto(jpeg(603,869),'frame'));
  assert.throws(() => decodeRoomPhoto(jpeg(603,870),'square'));
  assert.ok(decodeRoomPhoto(jpeg(512,512),'frame').length > 0,'old clients can still upload square frames');
  assert.throws(() => decodeRoomPhoto(jpeg(500,700)));
  assert.throws(() => decodeRoomPhoto(jpeg(500,600),'frame'));
  for (const input of ['not base64', Buffer.from('fake image').toString('base64'), jpeg(2048,2048),jpeg(512,256),jpeg(32,32),'A'.repeat(1_400_000)]) assert.throws(() => decodeRoomPhoto(input));
  assert.deepEqual(await readPhotoRequest(new Request('https://example.invalid', { method:'POST', body:'{"ok":true}' })),{ok:true});
  await assert.rejects(readPhotoRequest(new Request('https://example.invalid', { method:'POST', body:'a'.repeat(1_420_000) })), /invalid_request/);
});

async function photoApi(options={}) {
  const calls=[],uploads=[],signs=[];
  const photoUsage={localDate:'2026-10-14',frame:{used:1,limit:1,remaining:0},doll:{limit:1,targets:[]}};
  const helper=await import('../apps/api/src/lib/burrow-photo.mjs');
  const db={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='check_rate_limit')return options.limiterFailure?{error:Error('offline')}:{data:{allowed:options.allowed!==false}};
    if(name==='prepare_room_photo_v1'||name==='solo_burrow_prepare_photo_v1')return {data:options.denied?{error:'not_paired'}:{ticketId:'ticket',path:'server/path.jpg',committed:!!options.committed}};
    if(name==='read_room_photo_v1'||name==='solo_burrow_read_photo_v1')return {data:options.denied?{error:'not_found'}:{path:'server/path.jpg'}};
    if(name==='burrow_photo_usage_v1')return options.usageError?{error:Error('usage unavailable')}:{data:photoUsage};
    return {data:{applied:true}};
  },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'photo-id',owner_id:id,kind:'frame',updated_at:'2026-10-14T12:00:00Z'}})}),storage:{from:bucket=>{
    assert.equal(bucket,'burrow-room-photos');
    return {upload:async(path,bytes,config)=>{uploads.push({path,bytes,config});return {error:options.uploadError};},
      createSignedUrl:async(path,ttl)=>{signs.push({path,ttl});return{data:{signedUrl:'https://signed.invalid/temporary'}};}};
  }}};
  const route=load('apps/api/src/app/api/vnext/room-photo/route.js',{
    'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200,headers:config.headers})}},
    '@/lib/burrow-photo.mjs':helper,
    '@/lib/app-major-update':{authenticatedUserId:async()=>options.authorized===false?null:'actor',appMajorUpdateServiceClient:()=>db,
      majorUpdateEnabled:async()=>options.enabled!==false,commandStatus:error=>error==='not_found'?404:error==='not_paired'?403:error?409:200},
  },{crypto:webcrypto,URL,Uint8Array});
  const id='00000000-0000-0000-0000-000000000001';
  const post=()=>route.POST(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({actorId:options.staleActor?'earlier-account':'actor',ownerId:id,kind:'frame',idempotencyKey:id,base64:jpeg(500,700),path:'attacker/path'})}));
  const get=()=>route.GET(new Request(`https://example.invalid?id=${id}&path=attacker/path`));
  return {post,get,calls,uploads,signs,photoUsage};
}
test('photo route binds actor to auth, uploads only authorized immutable path, no public URL',async()=>{
  const h=await photoApi(); const result=await h.post();
  assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.equal(h.calls.find(c=>c.name==='prepare_room_photo_v1').args.p_user_id,'actor');
  assert.match(h.calls.find(c=>c.name==='prepare_room_photo_v1').args.p_digest,/^[a-f0-9]{64}$/);
  assert.equal(h.uploads[0].path,'server/path.jpg');assert.equal(h.uploads[0].config.upsert,false);
  const completion=h.calls.filter(c=>c.name==='complete_room_photo_v1');
  assert.equal(completion.length,1,'one immutable ticket is committed exactly once');
  assert.deepEqual({...completion[0].args},{p_user_id:'actor',p_ticket_id:'ticket'});
  const usage=h.calls.filter(c=>c.name==='burrow_photo_usage_v1');
  assert.equal(usage.length,1);assert.deepEqual({...usage[0].args},{p_user:'actor'});
  assert.ok(h.calls.indexOf(completion[0])<h.calls.indexOf(usage[0]),'daily usage is read after the photo commits');
  assert.deepEqual(result.body.photoUsage,h.photoUsage);assert.equal(result.body.photoId,'photo-id');
  assert.equal(result.body.applied,true);
  assert.deepEqual({...result.body.photo},{id:'photo-id',ownerId:'00000000-0000-0000-0000-000000000001',kind:'frame',updatedAt:'2026-10-14T12:00:00Z'});
  assert.equal(result.body.path,undefined);assert.equal(result.body.url,undefined,'upload receipt never publishes a storage URL');
  const read=await h.get();assert.equal(read.body.url,'https://signed.invalid/temporary');assert.equal(h.signs[0].ttl,120);
});
test('photo auth, rollout and pair denials never upload or sign',async()=>{
  for(const options of [{authorized:false},{enabled:false},{denied:true}]){
    const h=await photoApi(options);assert.ok((await h.post()).status>=400);assert.ok((await h.get()).status>=400);
    assert.equal(h.uploads.length,0);assert.equal(h.signs.length,0);
  }
});
test('photo rate limiting fails closed and committed retries do not upload',async()=>{
  const stale=await photoApi({staleActor:true});assert.equal((await stale.post()).status,400);assert.equal(stale.uploads.length,0);
  for(const options of [{limiterFailure:true},{allowed:false}]){
    const h=await photoApi(options);assert.ok((await h.post()).status>=400);assert.equal(h.uploads.length,0);
  }
  const h=await photoApi({committed:true});assert.equal((await h.post()).body.applied,false);assert.equal(h.uploads.length,0);
  assert.equal(h.calls.some(c=>c.name==='complete_room_photo_v1'),false,'a committed retry cannot commit again');
  assert.equal(h.calls.filter(c=>c.name==='burrow_photo_usage_v1').length,1,'retries still return current daily usage');
});
test('photo usage failure cannot return a false success; committed retry remains upload-free',async()=>{
  const failed=await photoApi({usageError:true});assert.equal((await failed.post()).status,503);
  assert.equal(failed.calls.filter(c=>c.name==='complete_room_photo_v1').length,1);
  const retry=await photoApi({committed:true});const result=await retry.post();
  assert.equal(result.status,200);assert.equal(result.body.applied,false);assert.deepEqual(result.body.photoUsage,retry.photoUsage);
  assert.equal(retry.uploads.length,0);assert.equal(retry.calls.some(c=>c.name==='complete_room_photo_v1'),false);
});
test('storage duplicate on immutable retry can commit; storage failure never commits',async()=>{
  const retry=await photoApi({uploadError:{statusCode:'409'}});assert.equal((await retry.post()).status,200);
  const failed=await photoApi({uploadError:{statusCode:'503'}});assert.equal((await failed.post()).status,503);
  assert.ok(!failed.calls.some(c=>c.name==='complete_room_photo_v1'));
});

const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function editorHarness({kind='frame',owner='me',used=false,cancel=false}={}) {
  const hook=hooks(),saves=[],queued=[],picks=[],options=[];let closes=0,fail=false,epoch=1,sessionListener;
  const {RoomPhotoEditor}=load('apps/mobile/src/components/burrow/room-photo.tsx',{
    react:hook.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Alert:{alert(){}},Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View',useWindowDimensions:()=>({width:390,height:844}),PanResponder:{create:()=>({panHandlers:{}})},StyleSheet:{create:x=>x,absoluteFillObject:{}}},
'./burrow-image': { Image: 'Image' }, 'expo-image': { Image: 'Image' },'expo-router':{useFocusEffect(){}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'expo-camera':{CameraView:'CameraView',useCameraPermissions:()=>[{granted:true},async()=>({granted:true})]},'expo-crypto':{randomUUID:()=>`key-${picks.length}`},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
    'expo-image-picker':{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),requestCameraPermissionsAsync:async()=>({granted:true}),
      launchImageLibraryAsync:async config=>{picks.push(config);return cancel?{canceled:true}:{canceled:false,assets:[{uri:'local',width:800,height:600}]};}},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:async(...args)=>{options.push(args);return{uri:'cropped',base64:'jpeg-bytes'};}},
    '@/lib/app-major-update-api':{saveRoomPhoto:async(...args)=>{saves.push(args);if(fail)throw Error('network');}},
    '@/lib/burrow-room-photo-cache':{cachedRoomPhotoUri:()=>null,loadRoomPhoto:async()=>'',keepRoomPhotoPreview:async()=>'',invalidateRoomPhotoCache(){}},
    '@/lib/burrow-photo-drafts':{readPhotoDraft:()=>null,persistPhotoDraft(){},removePhotoDraft(){}},
    '@/lib/room-photo-errors':load('apps/mobile/src/lib/room-photo-errors.ts'),
    '@/lib/burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
    '@/lib/haptics':{haptics:{medium:async()=>{}}},
    '@/lib/burrow-doll-face':{dollFaceBounds:()=>null,dollFaceRect:()=>null},'./burrow-back-button':{BurrowBackButton:'BurrowBackButton'},
    '@/lib/room-photo-crop':load('apps/mobile/src/lib/room-photo-crop.ts'),'./frame-photo-cropper':{FramePhotoCropper:'FramePhotoCropper'},
    '@/lib/burrow-store':{refreshBurrow:async()=>{},refreshBurrowAfterCurrent:async()=>{},
      enqueueFramePhoto:async(...args)=>{queued.push(args);if(fail)throw Error('disk_full');}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{sessionListener=fn;return()=>{};}},
  });
  const render=()=>hook.render(()=>RoomPhotoEditor({data:{profile:{id:'me'},dollPhotoChangesUsed:used?['toy-A']:[],roomPhotos:[]},ownerId:owner,kind,toyId:kind==='doll'?'toy-A':undefined,onClose:()=>closes++}));
  const button=label=>nodes(render()).find(n=>n.props?.label===label);
  return{saves,queued,picks,options,render,button,cropper:()=>nodes(render()).find(n=>n.type==='FramePhotoCropper'),fail:(value=true)=>{fail=value;},closeCount:()=>closes,signout:()=>{epoch++;sessionListener();}};
}
test('frame editor queues exact 201:290 crop; local failure stays retryable with the same bytes/key, acceptance closes without upload',async()=>{
  const h=editorHarness();h.button('Photo library').props.onPress();await flush();
  assert.equal(h.picks[0].allowsEditing,false);assert.equal(h.options.length,0);
  await h.cropper().props.onConfirm({originX:100,originY:0,width:402,height:580});await flush();
  assert.equal(h.options[0][1][0].crop.originX,100);
  assert.equal(h.options[0][1][1].resize.width,603);assert.equal(h.options[0][1][1].resize.height,870);assert.equal(h.saves.length,0);
  h.fail();h.button('Save / retry photo').props.onPress();await flush();
  assert.equal(h.closeCount(),0,'a failed local durable commit must not dismiss the editor');
  h.fail(false);h.button('Save / retry photo').props.onPress();await flush();
  assert.equal(h.queued.length,2);assert.equal(h.queued[0][3],h.queued[1][3]);
  assert.equal(h.queued[0][2],'jpeg-bytes');assert.equal(h.queued[1][2],'jpeg-bytes');
  assert.equal(h.queued[1][1],'me');assert.equal(h.options.length,1,'retry does not recrop immutable upload bytes');
  assert.equal(h.saves.length,0,'the editor never waits for a direct upload');assert.equal(h.closeCount(),1);
});
test('partner frame is view-only; doll daily cap removes edit actions; cancel never saves',async()=>{
  assert.equal(editorHarness({owner:'partner'}).button('Photo library'),undefined);
  assert.equal(editorHarness({kind:'doll',used:true}).button('Photo library'),undefined);
  const h=editorHarness({cancel:true});h.button('Photo library').props.onPress();await flush();
  assert.equal(h.button('Save / retry photo'),undefined);assert.equal(h.saves.length,0);
});
test('session change dismisses private photo editor',()=>{
  const h=editorHarness();h.render();h.signout();assert.equal(h.closeCount(),1);
});
