const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
test('preview shares two workers with the rail; replaces only queued stale art and tolerates leaving/failure',async()=>{
 const calls=[],pending=[],cache=new Set();
 const api=load('apps/mobile/src/lib/burrow-shop-thumbnails.ts',{
  './burrow-art-assets':{burrowArtForItem:i=>({source:i.stable_id,width:800,height:600})},
  './prepared-burrow-images':{preparedBurrowImage:s=>cache.has(s),prepareBurrowImage:(source,size)=>{
   const d=deferred();calls.push({source,size});pending.push(d);return d.promise;
  }},
 });
 const rail=api.createShopThumbnailWarmer(),preview=api.createShopArtWarmer();
 rail.warm([{stable_id:'card1'},{stable_id:'card2'},{stable_id:'card3'}]);
 preview.warm([{source:'A',size:512},{source:'unused-A',size:512}]);
 preview.warm([{source:'B',size:512}]);assert.equal(calls.length,2);
 pending[0].resolve({});await flush();assert.equal(calls[2].source,'B');
 preview.cancel();pending[1].reject(Error('bad image'));await flush();assert.equal(calls[3].source,'card3');
 rail.cancel();pending[2].resolve({});pending[3].resolve({});await flush();
 assert.deepEqual(calls.map(c=>c.source),['card1','card2','B','card3']);
 cache.add('B');preview.warm([{source:'B',size:512}]);assert.equal(calls.length,4);
});
test('preview input is only current public slot art and one correctly coloured composite, no private/environment/Home work',()=>{
 const thumbnails={dress:{biscuit:101,pinky:102}},calls=[];
 const api=load('apps/mobile/src/lib/decoration-preview-preparation.ts',{
  './burrow-art-assets':{burrowArtForItem:i=>{calls.push(i.stable_id);return{source:i.stable_id,width:800,height:600};}},
  './burrow-outfit-assets':{outfitKey:()=> 'dress'},'./bunny-variant-assets':{BUNNY_THUMBNAILS:thumbnails},
  './burrow-shop-thumbnails':{createShopArtWarmer:()=> 'shared-worker'},
 });
 const slots={outfit:{stable_id:'dress'},lamp:{stable_id:'lamp'},frame:{stable_id:'frame'}};
 const art=api.decorationPreviewArt(slots,'pinky');
 assert.equal(art.length,3);assert.equal(art[0].source,102);assert.equal(art[0].size,512);
 assert.deepEqual(calls,['lamp','frame']);assert.equal(api.createDecorationPreviewWarmer(),'shared-worker');
});
test('focused preview warmup is deferred and cancelled on a newer selection, blur, owner change and unmount',()=>{
 const h=hooks(),jobs=[],warm=[],cancelled=[];let focused=true,variant='biscuit';
 const api=load('apps/mobile/src/components/burrow/home-art-preview.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}}},
  '@react-navigation/native':{useIsFocused:()=>focused},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/app-viewport':{useAppViewport:()=>({width:390,height:844})},'./burrow-image':{Image:'Image'},'./home-art-scene':{HomeArtScene:'Scene'},
  '@/lib/burrow-art-assets':{burrowArtForItem:()=>({source:1})},'@/lib/burrow-home-layout':{decorationPreviewLayout:()=>({artWidth:300,viewportHeight:400})},
  '@/lib/bunny-identity':{useBunnyVariant:()=>variant},'@/lib/ui-idle':{afterUiSettles:run=>{const j={run,cancelled:false};jobs.push(j);return()=>j.cancelled=true;}},
  '@/lib/decoration-preview-preparation':{decorationPreviewArt:(slots,v)=>({slots,v}),createDecorationPreviewWarmer:()=>({warm:x=>warm.push(x),cancel:()=>cancelled.push(true)})},
 });
 let slots={outfit:{stable_id:'A'}},ownerId='A';const render=()=>h.render(()=>api.HomeArtPreview({slots,ownerId}));
 render();assert.equal(warm.length,0);
 slots={outfit:{stable_id:'B'}};render();assert.equal(jobs[0].cancelled,true);jobs[1].run();assert.equal(warm[0].slots,slots);
 focused=false;render();assert.equal(jobs[1].cancelled,true);assert.equal(jobs.length,2);
 focused=true;variant='pinky';ownerId='B';render();jobs[2].run();assert.equal(warm[1].v,'pinky');
 h.unmount();assert.equal(jobs[2].cancelled,true);assert.equal(cancelled.length,3);
});
test('static preview uses one same-canvas bitmap and never checks/loads Skia; other bunny paths keep their layers',()=>{
 const rig=load('apps/mobile/src/lib/bunny-idle-motion.ts',{'./bunny-rig.json':require('../apps/mobile/src/lib/bunny-rig.json'),'./bunny-motion.json':require('../apps/mobile/src/lib/bunny-motion.json')});
 const layers={head:1,body:2,earLeft:3,earRight:4,tail:5};
 const api=load('apps/mobile/src/components/burrow/outfit-bunny.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Platform:{OS:'ios'},TurboModuleRegistry:{get(){throw Error('must not initialize Skia');}}},
  '@/lib/burrow-outfit-assets':{outfitKey:()=> 'dress'},'@/lib/bunny-idle-motion':rig,'./burrow-image':{Image:'Image'},
  '@/lib/bunny-identity':{useBunnyVariant:owner=>owner==='partner'?'pinky':'biscuit'},
  '@/lib/bunny-variant-assets':{bunnyLayers:()=>layers,BUNNY_THUMBNAILS:{dress:{biscuit:101,pinky:102}}},
 });
 const node=api.OutfitBunny({animated:false,staticComposite:true,ownerId:'partner',width:200,height:255});
 const tree=node.type(node.props),image=tree.props.children;assert.equal(image.props.source,102);
 const fit=rig.bunnyViewport(200,255);assert.equal(image.props.style.left,fit.x);assert.equal(image.props.style.width,rig.BUNNY_RIG.sourceCanvas.width*fit.scale);
 const fallback=api.StaticOutfitBunny({width:200,height:255});assert.equal(fallback.props.children.length,5);
 const shop=fs.readFileSync('apps/mobile/src/components/burrow/burrow-shop.tsx','utf8');
 assert.doesNotMatch(shop,/warmDesign|prepareHomeArt\(warm/);
 assert.match(shop,/await prepareHomeArt\(withRoomDesign/,'real apply still prepares Home before reveal');
});
