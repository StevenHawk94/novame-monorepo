const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const photos=load('apps/mobile/src/lib/burrow-toy-photos.ts');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const face=(toyId,id=toyId,ownerId='me')=>({id,ownerId,kind:'doll',toyId,updatedAt:'2026-10-08T12:00:00Z'});

test('toy face selection never borrows a default, legacy or partner crop; quotas/drafts are per toy',()=>{
  const saved=[face('toy-A'),{...face(undefined,'legacy')},face('toy-B','partner','other')];
  assert.equal(photos.toyPhotoFor(saved,'me','toy-A').id,'toy-A');
  assert.equal(photos.toyPhotoFor(saved,'me','toy-B'),undefined);
  saved.push(face('toy-B'));
  assert.equal(photos.toyPhotoFor(saved,'me','toy-B').id,'toy-B');
  assert.equal(photos.toyPhotoFor(saved,'me','toy-A').id,'toy-A');
  assert.equal(photos.toyPhotoChangedToday({profile:{id:'me'},dollPhotoChangesUsed:['toy-A']},'toy-B'),false);
  assert.equal(photos.toyPhotoChangedToday({profile:{id:'me'},dollPhotoChangesUsed:['toy-A']},'toy-A'),true);
  const scoped={profile:{id:'me'},dollPhotoChangeTargetsUsed:[{ownerId:'partner',toyId:'toy-A'}]};
  assert.equal(photos.toyPhotoChangedToday(scoped,'toy-A'),false);
  assert.equal(photos.toyPhotoChangedToday(scoped,'toy-A','partner'),true);
  assert.notEqual(photos.roomPhotoTarget('doll','me','toy-A'),photos.roomPhotoTarget('doll','me','toy-B'));
  assert.equal(photos.roomPhotoTarget('frame','me'),'frame:me');
});
test('current Free and Plus photo usage gates only the exact owner/toy, not newly purchased toys',()=>{
 for(const limit of [1,3]){
  const data={profile:{id:'me'},localDate:'2026-10-27',roomPhotos:[],photoUsage:{localDate:'2026-10-27',doll:{limit,targets:[{ownerId:'me',toyId:'toy-A',used:limit}]}}};
  assert.equal(photos.toyPhotoChangedToday(data,'toy-A'),true);
  assert.equal(photos.toyPhotoChangedToday(data,'toy-B'),false);
  assert.equal(photos.toyPhotoChangedToday(data,'toy-A','partner'),false);
  data.photoUsage.doll.targets.push({ownerId:'me',toyId:'toy-B',used:limit-1});
  assert.equal(photos.toyPhotoChangedToday(data,'toy-B'),false);
  data.roomPhotos.push(face('toy-A','local-plushie-pending'));
  assert.equal(photos.toyPhotoChangedToday(data,'toy-B'),false,'another toy pending upload is not a daily limit');
 }
});
test('server-declared unlimited Plushie policy ignores daily legacy usage but keeps pending-photo protection',()=>{
 const data={profile:{id:'me'},localDate:'2026-10-28',roomPhotos:[],dollPhotoChangesUsed:['toy-A'],
  dollPhotoChangeTargetsUsed:[{ownerId:'me',toyId:'toy-A'}],
  photoUsage:{localDate:'2026-10-28',doll:{limit:null,unlimited:true,targets:[{ownerId:'me',toyId:'toy-A',used:99}]}}};
 assert.equal(photos.toyPhotoChangedToday(data,'toy-A'),false);
 assert.equal(photos.toyPhotoChangedToday(data,'toy-B'),false);
 data.roomPhotos.push(face('toy-A','local-plushie-pending'));
 assert.equal(photos.toyPhotoChangedToday(data,'toy-A'),true);
 assert.equal(photos.toyPhotoChangedToday(data,'toy-B'),false);
 data.photoUsage.localDate='2026-10-27';data.roomPhotos=[];
 assert.equal(photos.toyPhotoChangedToday(data,'toy-A'),false,'policy is not a daily quota reset');
});

const registry='apps/mobile/src/lib/burrow-art-assets.ts';
const art=load(registry,Object.fromEntries([...fs.readFileSync(registry,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(m=>[m[2],path.resolve(path.dirname(registry),m[2])])));
const rect=load('apps/mobile/src/lib/burrow-doll-face.ts',{'./burrow-art-assets':art,'./room-photo-crop':load('apps/mobile/src/lib/room-photo-crop.ts')});
const toy=(id,ordinal)=>({stable_id:id,category:'couple_dolls',metadata:{slot:'couple_doll',artOrdinal:ordinal}});
const native={View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})};
for(const file of ['home-art-scene','room-scene-art'])test(`${file}: switching A → new B → A restores A; uploading B shows its own face`,()=>{
  const h=hooks();
  const component=load(`apps/mobile/src/components/burrow/${file}.tsx`,{
    ...require('./home-pull-test-mocks.cjs'),
    './burrow-back-button':{BackIcon:'BackIcon'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'@expo/vector-icons':{Feather:'Feather'},
    './burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},'./interactive-doll':{InteractiveDoll:'Doll'},
    './doll-photo-preview':{DollPhotoPreview:'PhotoPreview'},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
    './bunny-actor':{BunnyActor:'Bunny'},'@/lib/burrow-art-assets':art,'@/lib/burrow-doll-face':rect,
    './outfit-bunny':{OutfitBunny:'OutfitBunny'},
    './coin-ui':{CoinIcon:'CoinIcon',CoinAddIcon:'CoinAddIcon'},
    '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',dark:false})},
    './update-badge':{UpdateBadge:'UpdateBadge'},
    './home-love-letter':{HomeLoveLetter:'HomeLoveLetter'},
    '@/lib/bunny-idle-motion':{homeBunnyBox:()=>({width:100,height:120})},
    '@/lib/burrow-toy-photos':photos,'@/lib/burrow-home-layout':load('apps/mobile/src/lib/burrow-home-layout.ts'),
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'expo-status-bar':{StatusBar:'StatusBar'},
  });
  const Component=component.HomeArtScene??component.RoomSceneArt;
  let saved=[face('toy-A')];
  const render=id=>nodes(h.render(()=>Component({balance:0,slots:{couple_doll:toy(id,id==='toy-A'?1:2)},photos:saved,ownerId:'me',onSlot(){}})))
    .find(n=>n.type===(file==='home-art-scene'?'PhotoPreview':'Doll')).props.photo;
  assert.equal(render('toy-A').id,'toy-A');assert.equal(render('toy-B'),undefined);assert.equal(render('toy-A').id,'toy-A');
  saved=[...saved,face('toy-B')];
  assert.equal(render('toy-B').id,'toy-B');assert.equal(render('toy-A').id,'toy-A');h.unmount();
});
for(const file of ['home-art-scene','room-scene-art'])test(`${file}: every Toy uses the same full-canvas box and hit area regardless of silhouette width`,()=>{
 const h=hooks();
 const {HomeArtScene,RoomSceneArt}=load(`apps/mobile/src/components/burrow/${file}.tsx`,{
  ...require('./home-pull-test-mocks.cjs'),
  './burrow-back-button':{BackIcon:'BackIcon'},
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'@expo/vector-icons':{Feather:'Feather'},
  './burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},'./interactive-doll':{InteractiveDoll:'Doll'},
  './doll-photo-preview':{DollPhotoPreview:'PhotoPreview'},'./room-photo-placeholder':{RoomPhotoPlaceholder:'Placeholder'},
  './bunny-actor':{BunnyActor:'Bunny'},'@/lib/burrow-art-assets':art,'@/lib/burrow-doll-face':rect,
  './outfit-bunny':{OutfitBunny:'Bunny'},'./coin-ui':{CoinIcon:'CoinIcon',CoinAddIcon:'CoinAddIcon'},
  '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',dark:false})},'./update-badge':{UpdateBadge:'Badge'},
  './home-love-letter':{HomeLoveLetter:'HomeLoveLetter'},
  '@/lib/bunny-idle-motion':{homeBunnyBox:()=>({width:100,height:120})},'@/lib/burrow-toy-photos':photos,
  '@/lib/burrow-home-layout':load('apps/mobile/src/lib/burrow-home-layout.ts'),
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'expo-status-bar':{StatusBar:'StatusBar'},
 });
 let baseline;
 for(let i=0;i<art.BURROW_ART.couple_dolls.length;i++){
  const asset=art.BURROW_ART.couple_dolls[i],Component=HomeArtScene??RoomSceneArt;
  const tree=nodes(h.render(()=>Component({balance:0,slots:{couple_doll:toy('toy-'+i,i+1)},photos:[],ownerId:'me',onSlot(){}})));
  const target=tree.find(n=>file==='home-art-scene'?n.props?.accessibilityLabel==='Open Toy':n.type==='Doll');
  const box=JSON.parse(JSON.stringify(target.props.style));baseline??=box;assert.deepEqual(box,baseline,asset.name);
  assert.equal(box.width/box.height,asset.width/asset.height);
  if(file==='room-scene-art'){assert.equal(target.props.artStyle.width,box.width);assert.equal(target.props.artStyle.height,box.height);}
 }
 h.unmount();
});
test('collection portrait uses each costume’s actual face bounds, not the previous toy’s crop geometry',()=>{
  const {ToyPortrait}=load('apps/mobile/src/components/burrow/toy-portrait.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'@/lib/burrow-art-assets':art,
    '@/lib/burrow-doll-face':rect,'./burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
  });
  let canvas;
  for(let ordinal=1;ordinal<=art.BURROW_ART.couple_dolls.length;ordinal++){
    const item=toy(`toy-${ordinal}`,ordinal),asset=art.burrowArtForItem(item,'couple_dolls');
    const tree=ToyPortrait({item,photo:face(item.stable_id),width:95,height:160});
    const mask=nodes(tree).find(n=>n.type==='PlushieFaceMask');assert.equal(mask.props.asset,asset);
    assert.equal(mask.props.photo.toyId,item.stable_id);
    const holder=nodes(tree).find(n=>n.props?.children===mask);
    assert.deepEqual(holder.props.style[1],rect.dollFaceRect(asset));
    const stage=tree.props.children.props.style;canvas??=JSON.parse(JSON.stringify(stage));
    assert.deepEqual(JSON.parse(JSON.stringify(stage)),canvas,asset.name);
    assert.equal(stage.width,95);assert.equal(stage.height,95);assert.equal(stage.top,65);
  }
});

function routeHarness({committed=false,mismatch=false,allowed=true}={}){
  const user='11111111-1111-4111-8111-111111111111',calls=[],uploads=[];
  const db={rpc:async(name,args)=>{
    calls.push([name,args]);
    return {data:name==='check_rate_limit'?{allowed}:name==='prepare_toy_photo_v1'
      ?{path:'immutable-toy.jpg',ticketId:user,toyId:args.p_toy_id,committed}:{applied:true}};
  },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:user,owner_id:user,kind:'doll',toy_id:mismatch?'toy-A':'toy-B',updated_at:'now'}})}),
    storage:{from:()=>({upload:async(...args)=>{uploads.push(args);return {};}})}};
  const route=load('apps/api/src/app/api/vnext/room-photo/route.js',{
    'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
    '@/lib/app-major-update':{authenticatedUserId:async()=>user,appMajorUpdateServiceClient:()=>db,majorUpdateEnabled:async()=>true,commandStatus:()=>409},
    '@/lib/burrow-photo.mjs':{PHOTO_BUCKET:'photos',photoUUID:value=>value===user,readPhotoRequest:req=>req.body,decodeRoomPhoto:()=>new Uint8Array([1,2,3])},
  },{crypto:webcrypto});
  const post=overrides=>route.POST({body:{actorId:user,ownerId:user,kind:'doll',toyId:'toy-B',idempotencyKey:user,base64:'jpeg',...overrides}});
  return {post,calls,uploads,user};
}
test('photo API passes the exact toy to the ticket and returns that toy in its verified receipt',async()=>{
  const h=routeHarness(),result=await h.post();
  assert.equal(result.status,200);assert.equal(result.body.photo.toyId,'toy-B');
  assert.equal(h.calls.find(c=>c[0]==='prepare_toy_photo_v1')[1].p_toy_id,'toy-B');
  assert.equal(h.calls.find(c=>c[0]==='prepare_toy_photo_v1')[1].p_owner_id,h.user);
  assert.equal(h.calls.at(-2)[0],'complete_toy_photo_v1');assert.equal(h.calls.at(-1)[0],'burrow_photo_usage_v1');assert.equal(h.uploads.length,1);
  const retry=routeHarness({committed:true});assert.equal((await retry.post()).status,200);assert.equal(retry.uploads.length,0);
});
test('Plushie API hourly upload guard is 10 per actor across toys; frame guard stays 20 and fails closed',async()=>{
 const h=routeHarness();await h.post();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='check_rate_limit')[1])),{p_bucket:`burrow-photo:doll:${h.user}`,p_limit:10,p_window_seconds:3600});
 const f=routeHarness();await f.post({kind:'frame',toyId:undefined});
 assert.equal(f.calls.find(c=>c[0]==='check_rate_limit')[1].p_limit,20);
 const blocked=routeHarness({allowed:false});assert.equal((await blocked.post()).status,429);
 assert.equal(blocked.uploads.length,0);assert.deepEqual(blocked.calls.map(c=>c[0]),['check_rate_limit']);
});
test('photo API rejects mismatched toy receipts and malformed toy IDs; frame endpoint cannot carry a toy',async()=>{
  assert.equal((await routeHarness({mismatch:true}).post()).status,409);
  for(const toyId of [23,'','../toy-B','x'.repeat(161)]){
    const h=routeHarness();assert.equal((await h.post({toyId})).status,400);assert.equal(h.calls.length,0);
  }
  assert.equal((await routeHarness().post({kind:'frame'})).status,400);
});
