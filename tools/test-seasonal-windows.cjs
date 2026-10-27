const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {load}=require('./lifecycle-test-utils.cjs');
const file='apps/mobile/src/lib/burrow-art-assets.ts',source=fs.readFileSync(file,'utf8');
const art=load(file,Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(file),m[2])])));
const layout=load('apps/mobile/src/lib/burrow-home-layout.ts'),model=load('apps/mobile/src/lib/burrow-map-model.ts');
const jsx=(type,props,key)=>({type,props,key});
test('39 named frame products exclude all eight landscape assets and resolve by stable frame identity',()=>{
 assert.equal(art.BURROW_ART.windows.length,39);assert.equal(art.BURROW_ART.windows[0].windowFrameKey,'Cross_Dark_Wood');
 const folder='apps/mobile/assets/burrow-webp/room decoration/windows',files=fs.readdirSync(folder).filter(f=>f.endsWith('.webp'));
 const frames=art.BURROW_ART.windows;
 assert.equal(new Set(frames.map(a=>a.windowFrameKey)).size,39);
 assert.deepEqual(Array.from(frames,a=>path.basename(a.source)).sort(),files.filter(f=>!/^(Spring|Summer|Autumn|Winter)_(Day|Night)\.webp$/.test(f)).sort());
 for(const frame of frames){
  assert.equal(frame.name,frame.windowFrameKey.replaceAll('_',' '));assert.equal(frame.width,512);assert.equal(frame.height,512);
  assert.equal(art.burrowArtForItem({category:'windows',metadata:{windowFrameKey:frame.windowFrameKey,artOrdinal:999}}),frame);
 }
 assert.equal(new Set(Object.values(art.HOME_WINDOW_LANDSCAPES).flatMap(Object.values)).size,8);
});
test('both 512-square layers share one unchanged window anchor on short, ordinary and wide phone screens',()=>{
 const components=load('apps/mobile/src/components/burrow/window-artwork.tsx',{
  react:{memo:x=>x},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{absoluteFillObject:{position:'absolute',left:0,top:0,right:0,bottom:0}}},
  './burrow-image':{Image:'Image'},'@/lib/burrow-art-assets':art,'@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',period:'day'})},
 });
 const placement=layout.HOME_ART_PLACEMENTS.find(p=>p.slot==='window');
 assert.equal(placement.x,121);assert.equal(placement.anchorY,836);assert.equal(placement.visibleWidth,252);assert.equal(placement.anchor,'bottom');
 for(const scale of [320/900,390/900,430/900])for(const frame of art.BURROW_ART.windows){
  const style=layout.homeAnchoredBox(frame,placement,scale),ratio=style.width/frame.width;
  assert.ok(Math.abs(style.top+frame.bounds[3]*ratio-836*scale)<1e-9);
  assert.ok(Math.abs(style.left+frame.bounds[0]*ratio-121*scale)<1e-9);
  const tree=components.WindowArtwork({asset:frame,landscape:art.HOME_WINDOW_LANDSCAPES.autumn.day,style});
  assert.equal(tree.props.style,style);assert.equal(style.width,style.height);
  const [back,front]=tree.props.children;assert.equal(back.props.source,art.HOME_WINDOW_LANDSCAPES.autumn.day);assert.equal(front.props.source,frame.source);
  assert.equal(back.props.style,front.props.style);assert.equal(back.props.contentFit,'fill');assert.equal(front.props.contentFit,'fill');
 }
});
test('all 312 original-pixel combinations cover every hole without spilling beyond the frame silhouette',async()=>{
 const sharp=createRequire(require.resolve('next/package.json',{paths:[path.resolve('apps/api')]}))('sharp');
 async function alpha(file){const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,512);assert.equal(info.height,512);return Uint8Array.from({length:512*512},(_,i)=>data[i*4+3]);}
 const scenes=await Promise.all(Object.values(art.HOME_WINDOW_LANDSCAPES).flatMap(Object.values).map(alpha));
 for(const a of scenes)assert.deepEqual(a,scenes[0],'all eight scenes must have identical transparent geometry');
 for(const frame of art.BURROW_ART.windows){const a=await alpha(frame.source),outside=new Uint8Array(a.length),queue=[];
  const add=i=>{if(!outside[i]&&a[i]<10){outside[i]=1;queue.push(i);}};
  for(let x=0;x<512;x++){add(x);add(511*512+x);}for(let y=0;y<512;y++){add(y*512);add(y*512+511);}
  for(let k=0;k<queue.length;k++){const i=queue[k],x=i%512,y=Math.floor(i/512);if(x)add(i-1);if(x<511)add(i+1);if(y)add(i-512);if(y<511)add(i+512);}
  for(const scene of scenes){let holes=0,leaks=0,gaps=0;for(let i=0;i<a.length;i++){
   if(outside[i]&&scene[i]>=128)leaks++;
   if(!outside[i]&&a[i]<10){holes++;if(scene[i]<128)gaps++;}
  }assert.ok(holes>50000,frame.name);assert.equal(leaks,0,frame.name+' outside leak');assert.equal(gaps,0,frame.name+' unfilled hole');}
 }
});
test('window period and season follow the same profile timezone/month/hemisphere rules as Home',()=>{
 const components=load('apps/mobile/src/components/burrow/window-artwork.tsx',{
  react:{memo:x=>x},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{}},'./burrow-image':{Image:'Image'},
  '@/lib/burrow-art-assets':art,'@/lib/use-burrow-environment':{useBurrowEnvironment:()=>environment},
 });let environment;
 for(const country of ['US','AU'])for(let month=0;month<12;month++)for(const hour of [5,6,17,18]){
  environment=model.burrowMapEnvironment(Date.UTC(2026,month,15,hour),'UTC',country);
  const tree=components.SeasonalWindowArtwork({asset:art.BURROW_ART.windows[0],style:{width:100,height:100}});
  assert.equal(tree.props.landscape,art.HOME_WINDOW_LANDSCAPES[environment.season][environment.period]);
 }
 const src=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
 assert.match(src,/landscape=\{HOME_WINDOW_LANDSCAPES\[environment.season\]\[environment.period\]\}/);
});
test('Admin shows every frame at its matching identity with the shared landscape, never a blank cutout or scene product',()=>{
 const registry=require('../apps/admin/src/generated/shop-art.json');
 const pricing=load('apps/admin/src/lib/burrow-shop-pricing.js',{'../generated/shop-art.json':registry});
 assert.equal(registry.categories.windows.length,39);
 for(const frame of art.BURROW_ART.windows){
  const preview=pricing.shopPreview({category:'windows',metadata:{windowFrameKey:frame.windowFrameKey,artOrdinal:999}});
  assert.equal(preview.name,frame.name);assert.ok(preview.landscapeUrl);assert.ok(fs.existsSync('apps/admin/public'+preview.landscapeUrl));
 }
 assert.equal(pricing.shopPreview({category:'windows',metadata:{artOrdinal:1}}),null,'deleted ordinal-only rows cannot masquerade as a new frame');
});
