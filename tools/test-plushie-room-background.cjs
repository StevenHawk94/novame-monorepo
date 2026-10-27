const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/plushie-room-layout.ts');
const registry='apps/mobile/src/lib/burrow-art-assets.ts';
const art=load(registry,Object.fromEntries([...fs.readFileSync(registry,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(registry),m[2])])));
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
test('all costume bounds, short/tall phones and different control heights keep exactly one third of the visible toy on the floor',()=>{
 for(const toy of art.BURROW_ART.couple_dolls)for(const width of [320,390,430,560])for(const innerHeight of [260,450,650]){
  const size=Math.min(width-40,innerHeight),scale=Math.min(size/toy.width,size/toy.height),artTop=(size-toy.height*scale)/2,stageY=52;
  const top=stageY+(innerHeight-size)/2+artTop+toy.bounds[1]*scale,bottom=top+(toy.bounds[3]-toy.bounds[1])*scale;
  const seam=model.plushieFloorY(toy,scale,artTop,size,stageY,innerHeight);
  assert.ok(Math.abs((bottom-seam)/(bottom-top)-1/3)<1e-10);
 }
});
test('shared floor stays proportional and fills every side through the bottom safe area, with source alpha margins outside the seam',()=>{
 const asset=art.HOME_BACKGROUND_FLOOR;
 for(const width of [320,390,430,560])for(const height of [450,700,1000])for(const seam of [height*.4,height*.65,height*.8]){
  const b=model.plushieFloorBox(width,height,seam,asset),scale=b.width/asset.width;
  assert.ok(Math.abs(b.height/asset.height-scale)<1e-10);
  assert.ok(b.left+asset.bounds[0]*scale<=1e-8);assert.ok(b.left+asset.bounds[2]*scale>=width-1e-8);
  assert.ok(Math.abs(b.top+asset.bounds[1]*scale-seam)<1e-8);
  assert.ok(b.top+asset.bounds[3]*scale>=height-1e-8);
 }
});
test('background uses the exact Home floor and active wallpaper with the same default fallback; it cannot intercept touch/particles',()=>{
 const {PlushieRoomBackground}=load('apps/mobile/src/components/burrow/plushie-room-background.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}}},
  '@/lib/burrow-art-assets':art,'@/lib/plushie-room-layout':model,'./burrow-image':{Image:'Image'},
 });
 const base={width:390,height:780,floorY:500,bottomInset:34};
 const draw=item=>PlushieRoomBackground({...base,wallpaper:item});
 const def=draw(),all=nodes(def);assert.equal(def.props.pointerEvents,'none');assert.equal(def.props.style[1].bottom,-34);
 assert.equal(all.find(n=>n.props?.testID==='plushie-room-floor').props.source,art.HOME_BACKGROUND_FLOOR.source);
 assert.equal(all.find(n=>n.props?.testID==='plushie-room-wallpaper').props.source,art.burrowArtFor('wallpapers').source);
 for(const ordinal of [2,3,5]){
  const selected={category:'wallpapers',metadata:{artOrdinal:ordinal}};
  const rendered=nodes(draw(selected)).find(n=>n.props?.testID==='plushie-room-wallpaper');
  assert.equal(rendered.props.source,art.burrowArtForItem(selected,'wallpapers').source);
 }
 assert.equal(all.find(n=>n.props?.testID==='plushie-room-wallpaper').props.style.top,0,'wallpaper begins immediately under the header');
});
