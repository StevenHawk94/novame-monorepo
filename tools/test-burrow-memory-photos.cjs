const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const id='00000000-0000-0000-0000-000000000001';
const jpeg=()=>Buffer.from([255,216,255,192,0,11,8,2,0,2,0,1,1,17,0,255,218,0,8,1,1,0,0,63,0,42,255,217]).toString('base64');
async function api(options={}) {
  const calls=[],uploads=[],signs=[];
  const helper=await import('../apps/api/src/lib/burrow-photo.mjs');
  const db={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='check_rate_limit')return options.limitError?{error:true}:{data:{allowed:options.allowed!==false}};
    if(options.denied)return {data:{error:'not_found'}};
    if(name==='prepare_memory_photo_v1')return {data:{path:'server/path.jpg',ticketId:'ticket',committed:!!options.committed}};
    if(name==='read_memory_photo_v1')return {data:{path:'server/path.jpg'}};
    return {data:{applied:true}};
  },storage:{from:bucket=>{assert.equal(bucket,'burrow-memory-photos');return {
    upload:async(...args)=>{uploads.push(args);return {error:options.uploadError};},
    createSignedUrl:async(...args)=>{signs.push(args);return {data:{signedUrl:'https://private.invalid/photo'}};},
  };}}};
  const route=load('apps/api/src/app/api/vnext/memory-photo/route.js',{
    'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200,headers:config.headers})}},
    '@/lib/burrow-photo.mjs':helper,'@/lib/app-major-update':{
      authenticatedUserId:async()=>options.auth===false?null:'actor',appMajorUpdateServiceClient:()=>db,
      majorUpdateEnabled:async()=>options.enabled!==false,commandStatus:e=>e==='not_found'?404:e?409:200,
    },
  },{crypto:webcrypto,URL,Uint8Array});
  const body={actorId:'actor',entryId:id,action:'upload',slot:0,expectedPhotoId:null,idempotencyKey:id,base64:jpeg()};
  return {calls,uploads,signs,post:patch=>route.POST(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({...body,...patch})})),
    get:()=>route.GET(new Request(`https://example.invalid?id=${id}`))};
}
test('memory photo upload uses immutable authorized path and digest; read returns only short-lived signed link',async()=>{
  const h=await api();const result=await h.post({path:'attacker/path'});assert.equal(result.status,200);
  const prepare=h.calls.find(x=>x.name==='prepare_memory_photo_v1');assert.equal(prepare.args.p_entry_id,id);assert.equal(prepare.args.p_expected_id,null);
  assert.match(prepare.args.p_digest,/^[a-f0-9]{64}$/);assert.equal(h.uploads[0][0],'server/path.jpg');assert.equal(h.uploads[0][2].upsert,false);
  assert.equal(h.calls.at(-1).name,'complete_memory_photo_v1');assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.equal((await h.get()).body.url,'https://private.invalid/photo');assert.equal(h.signs[0][1],120);
});
test('memory photo authentication, rollout and author denial prevent storage access',async()=>{
  for(const opts of [{auth:false},{enabled:false},{denied:true}]){
    const h=await api(opts);assert.ok((await h.post()).status>=400);assert.ok((await h.get()).status>=400);
    assert.equal(h.uploads.length,0);assert.equal(h.signs.length,0);
  }
});
test('memory upload rejects stale actor, fourth slot, invalid version, action and bytes before storage',async()=>{
  for(const patch of [{actorId:'old'},{slot:3},{slot:-1},{slot:1.1},{expectedPhotoId:'bad'},{action:'other'},{base64:'invalid'}]){
    const h=await api();assert.equal((await h.post(patch)).status,400);assert.equal(h.uploads.length,0);
  }
});
test('memory upload rate limiter fails closed and committed retry never uploads again',async()=>{
  for(const opts of [{limitError:true},{allowed:false}]){const h=await api(opts);assert.ok((await h.post()).status>=400);assert.equal(h.uploads.length,0);}
  const h=await api({committed:true});assert.equal((await h.post()).body.applied,false);assert.equal(h.uploads.length,0);
});
test('memory upload conflict can complete same ticket; transport failure never commits or deletes',async()=>{
  const retry=await api({uploadError:{statusCode:409}});assert.equal((await retry.post()).status,200);
  const failed=await api({uploadError:{statusCode:503}});assert.equal((await failed.post()).status,503);
  assert.equal(failed.calls.some(x=>x.name==='complete_memory_photo_v1'),false);
});
test('photo removal binds actor, entry and exact photo ID, without client-directed storage delete',async()=>{
  const h=await api();assert.equal((await h.post({action:'remove',photoId:id})).status,200);
  assert.equal(h.calls[0].name,'delete_memory_photo_v1');assert.equal(h.calls[0].args.p_entry_id,id);assert.equal(h.calls[0].args.p_photo_id,id);
  assert.equal(h.uploads.length,0);assert.equal((await h.post({action:'remove',photoId:'bad'})).status,400);
});

function cleanup(options={}) {
  const removed=[],acked=[],path=`${id}/${id}.jpg`;
  const db={rpc:async()=>({data:[options.badPath?'../other-bucket':path]}),
    storage:{from:b=>{assert.equal(b,'burrow-memory-photos');return {remove:async keys=>{removed.push(keys);return {error:options.fail};}};}},
    from:t=>{assert.equal(t,'memory_photo_garbage');return {delete:()=>({eq:async(_key,value)=>{acked.push(value);return {};}})};}};
  const route=load('apps/api/src/app/api/cron/memory-photo-cleanup/route.js',{
    'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200})}},'@/lib/app-major-update':{appMajorUpdateServiceClient:()=>db},
  },{process:{env:{CRON_SECRET:'test-secret'}}});
  return {removed,acked,run:(auth=true)=>route.GET(new Request('https://example.invalid',{headers:auth?{authorization:'Bearer test-secret'}:{}}))};
}
test('cleanup requires cron secret, uses queued exact keys and acknowledges only successful storage deletion',async()=>{
  const h=cleanup();assert.equal((await h.run(false)).status,401);assert.equal(h.removed.length,0);
  assert.equal((await h.run()).body.removed,1);assert.equal(h.acked.length,1);
});
test('cleanup storage failure and malformed keys leave queue retryable',async()=>{
  const fail=cleanup({fail:true});assert.equal((await fail.run()).status,503);assert.equal(fail.acked.length,0);
  const bad=cleanup({badPath:true});assert.equal((await bad.run()).status,503);assert.equal(bad.removed.length,0);
});
test('daily memory prompt is deterministic, order independent, rotates without mutating input',()=>{
  const {dailyMemoryPrompt}=load('apps/mobile/src/lib/memory-prompt.ts');const prompts=[{id:'b'},{id:'a'},{id:'c'}];
  assert.equal(dailyMemoryPrompt(prompts,'2026-09-27').id,dailyMemoryPrompt([...prompts].reverse(),'2026-09-27').id);
  assert.notEqual(dailyMemoryPrompt(prompts,'2026-09-27').id,dailyMemoryPrompt(prompts,'2026-09-28').id);
  assert.equal(dailyMemoryPrompt([],'2026-09-27'),null);assert.equal(prompts[0].id,'b');
});

function editor({mine=true,cancel=false,waitPick=false}={}) {
  const h=hooks(),saves=[],deletes=[],picks=[],transforms=[],waiting=deferred();let epoch=1,identity,closed=0,fail=false;
  const state={memory:{entryId:'entry',slot:1,photo:{id:'opened',updatedAt:'old'},canEdit:mine}};
  const modules={
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Modal:'Modal',Text:'Text',View:'View',Pressable:'Pressable',ScrollView:'ScrollView',AppState:{},
      Alert:{alert:(_t,_m,buttons)=>buttons?.find(b=>b.style==='destructive')?.onPress()},StyleSheet:{create:x=>x}},
    'expo-image':{Image:'Image'},'expo-router':{useFocusEffect(){}},'expo-crypto':{randomUUID:()=>`key-${picks.length}`},
    'expo-image-picker':{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),requestCameraPermissionsAsync:async()=>({granted:true}),
      launchImageLibraryAsync:async options=>{picks.push(options);return waitPick?waiting.promise:cancel?{canceled:true}:{canceled:false,assets:[{uri:'local',width:900,height:600}]};}},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:async(...args)=>{transforms.push(args);return {uri:'crop',base64:'bytes'};}},
    '@/lib/app-major-update-api':{saveMemoryPhoto:async(...args)=>{saves.push(args);if(fail)throw Error('network');},deleteMemoryPhoto:async(...args)=>deletes.push(args)},
    '@/lib/burrow-photo-drafts':{readPhotoDraft:()=>null,persistPhotoDraft(){},removePhotoDraft(){}},
    '@/lib/burrow-store':{refreshBurrow:async()=>{}},'@/lib/session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;return()=>{};}},
  };
  const {RoomPhotoEditor}=load('apps/mobile/src/components/burrow/room-photo.tsx',modules);
  const render=()=>h.render(()=>RoomPhotoEditor({data:{profile:{id:'me'},roomPhotos:[]},kind:'frame',ownerId:mine?'me':'partner',memory:state.memory,onClose:()=>closed++}));
  return {state,saves,deletes,picks,transforms,waiting,closed:()=>closed,fail:()=>fail=true,render,
    button:label=>nodes(render()).find(n=>n.props?.label===label),signOut:()=>{epoch++;identity();}};
}
test('memory editor crops and previews, retries same key, keeps opened version despite background refresh',async()=>{
  const h=editor();h.button('Photo library').props.onPress();await flush();assert.equal(h.saves.length,0);
  assert.equal(h.picks[0].allowsEditing,true);assert.equal(h.picks[0].exif,false);assert.equal(h.transforms[0][1][1].resize.width,512);
  h.state.memory={...h.state.memory,photo:{id:'newer',updatedAt:'now'}};h.fail();h.button('Save / retry photo').props.onPress();await flush();
  h.button('Save / retry photo').props.onPress();await flush();assert.equal(h.saves.length,2);
  assert.equal(h.saves[0][2],'opened');assert.equal(h.saves[0][4],h.saves[1][4]);assert.equal(h.closed(),0);
});
test('memory editor is read-only for partner; cancelled picker never saves',async()=>{
  const read=editor({mine:false});assert.equal(read.button('Photo library'),undefined);assert.equal(read.button('Delete photo'),undefined);
  const h=editor({cancel:true});h.button('Photo library').props.onPress();await flush();assert.equal(h.button('Save / retry photo'),undefined);
});
test('memory editor deletion targets opened photo and preserves words',async()=>{
  const h=editor();h.button('Delete photo').props.onPress();await flush();assert.deepEqual(h.deletes,[['entry','opened','me']]);assert.equal(h.closed(),1);
});
test('signout while native picker is open discards late image without uploading',async()=>{
  const h=editor({waitPick:true});h.button('Photo library').props.onPress();await flush();h.signOut();
  h.waiting.resolve({canceled:false,assets:[{uri:'old-account',width:512,height:512}]});await flush();
  assert.equal(h.closed(),1);assert.equal(h.transforms.length,0);assert.equal(h.saves.length,0);assert.equal(h.button('Save / retry photo'),undefined);
});
test('album defers private image reads until opened and exposes edit rights only for author',()=>{
  const h=hooks();let registered=0;const {MemoryPhotos}=load('apps/mobile/src/components/burrow/memory-photos.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Modal:'Modal',Text:'Text',View:'View',Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:x=>x}},
    '@/lib/overlay-presence':{registerOverlay:()=>{registered++;return()=>registered--; }},'./room-photo':{RoomPhoto:'RoomPhoto',RoomPhotoEditor:'RoomPhotoEditor'},
  });
  const props={data:{profile:{id:'me'}},entry:{id:'entry',author_id:'partner',photos:[{id:'photo',slot:0,updatedAt:'now'}]}};
  const render=()=>h.render(()=>MemoryPhotos(props));let tree=render();assert.equal(nodes(tree).filter(n=>n.type==='RoomPhoto').length,0);
  nodes(tree).find(n=>n.type==='Pressable').props.onPress();tree=render();assert.equal(registered,1);
  const buttons=nodes(tree).filter(n=>n.type==='Pressable');assert.equal(buttons.length,3,'open, one view-photo and Done; no add buttons for partner');
  buttons[1].props.onPress();tree=render();assert.equal(nodes(tree).find(n=>n.type==='RoomPhotoEditor').props.memory.canEdit,false);
  h.unmount();assert.equal(registered,0);
});
test('private memory viewer clears on background and identity change, rejects stale links and disables image cache',async()=>{
  const h=hooks(),requests=[];let app,identity;
  const {RoomPhoto}=load('apps/mobile/src/components/burrow/room-photo.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{currentState:'active',addEventListener:(_e,fn)=>{app=fn;return {remove(){}};}},
      Pressable:'Pressable',Text:'Text',StyleSheet:{create:x=>x}},'expo-image':{Image:'Image'},
    'expo-router':{useFocusEffect:fn=>h.react.useEffect(fn,[fn])},'expo-crypto':{},'expo-image-picker':{},'expo-image-manipulator':{},
    '@/lib/app-major-update-api':{fetchMemoryPhoto:()=>{const d=deferred();requests.push(d);return d.promise;}},
    '@/lib/burrow-photo-drafts':{readPhotoDraft:()=>null,persistPhotoDraft(){},removePhotoDraft(){}},
    '@/lib/burrow-store':{},'@/lib/session-lifecycle':{subscribeSessionIdentity:fn=>{identity=fn;return()=>{};}},
  },{setInterval:()=>1,clearInterval(){}});
  const render=()=>h.render(()=>RoomPhoto({photo:{id:'photo',updatedAt:'now'},memory:true}));
  render();app('background');requests[0].resolve('stale');await flush();assert.notEqual(render().type,'Image');
  app('active');requests[1].resolve('fresh');await flush();let tree=render();assert.equal(tree.type,'Image');assert.equal(tree.props.cachePolicy,'none');
  identity();assert.notEqual(render().type,'Image');h.unmount();
});
