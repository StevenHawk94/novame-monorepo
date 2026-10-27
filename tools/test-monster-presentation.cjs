const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const {screenHarness,domain,nodes,layout}=require('./release-room-test-utils.cjs');
const geometry=load('apps/mobile/src/lib/monster-art-geometry.ts');
test('geometry has no implicit global reduction; all idle/hit poses preserve aspect ratio and centre',()=>{
 for(const height of [60,100,175,230])for(const [id,poses] of Object.entries(geometry.MONSTER_GEOMETRY))for(const pose of ['normal','hit']){
  const [x,y,w,h]=poses[pose],f=geometry.monsterArtFrame(id,pose,height*1.06,height),scale=f.height/800;
  assert.ok(Math.abs(h*scale-height)<1e-8);assert.equal(f.width,f.height);
  assert.ok(Math.abs(f.top+(y+h/2)*scale-height/2)<1e-8);
  assert.ok(Math.abs(f.left+(x+w/2)*scale-height*1.06/2)<1e-8);
  assert.ok(w*scale<=height*1.06);
 }
});
test('geometry matches the actual largest alpha body, including export dust and differing hit-frame margins',async()=>{
 const r=createRequire(path.resolve('apps/api/package.json')),sharp=createRequire(r.resolve('next/package.json'))('sharp');
 const themes={overthinking:'Overthinking',procrastination:'Procrastination',the_spiral:'Anxiety',the_comparer:'Comparison',the_wall:'Isolation',the_fog:'Lost',the_hollow:'Self-Doubt',the_swallower:'People-Pleasing'};
 for(const[id,theme]of Object.entries(themes))for(const pose of ['normal','hit']){
  const file=`apps/mobile/assets/monsters/${theme}${pose==='hit'?'-Hit':''}.webp`;
  const{data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,800);assert.equal(info.height,800);
  const W=info.width,H=info.height,seen=new Uint8Array(W*H),queue=new Int32Array(W*H);let largest=0,bounds;
  for(let k=0;k<W*H;k++){
   if(seen[k]||data[k*4+3]<16)continue;
   let head=0,tail=1,x0=W,y0=H,x1=0,y1=0;queue[0]=k;seen[k]=1;
   while(head<tail){const p=queue[head++],x=p%W,y=(p-x)/W;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);
    for(const n of [x>0?p-1:-1,x<W-1?p+1:-1,p-W,p+W])if(n>=0&&n<W*H&&!seen[n]&&data[n*4+3]>=16){seen[n]=1;queue[tail++]=n;}
   }
   if(tail>largest){largest=tail;bounds=[x0,y0,x1-x0,y1-y0];}
  }
  assert.deepEqual(Array.from(geometry.MONSTER_GEOMETRY[id][pose]),bounds,file);
 }
});
test('a narrow artwork viewport still preserves the original square canvas and never clips the visible body',()=>{
 for(const [id,poses] of Object.entries(geometry.MONSTER_GEOMETRY))for(const pose of ['normal','hit']){
  const [x,y,w,h]=poses[pose],f=geometry.monsterArtFrame(id,pose,30,200),scale=f.width/800;
  assert.equal(f.width,f.height);assert.ok(w*scale<=30+1e-8);assert.ok(h*scale<=200+1e-8);
  assert.ok(f.left+x*scale>=-1e-8);assert.ok(f.top+y*scale>=-1e-8);
  assert.ok(f.left+(x+w)*scale<=30+1e-8);assert.ok(f.top+(y+h)*scale<=200+1e-8);
 }
});
test('selection, preparation and battle have independent explicit sizing for the requested six/two design groups',()=>{
 for(const id of Object.keys(geometry.MONSTER_GEOMETRY)){
  const larger=id==='procrastination'||id==='the_wall';
  assert.equal(geometry.monsterDisplayScale(id,'selection'),.7*(larger?1:1.1));
  assert.equal(geometry.monsterDisplayScale(id,'preparation'),.7*(larger?1.4:1.5));
  assert.equal(geometry.monsterDisplayScale(id,'battle'),1,'battle restores its pre-reduction size');
 }
});
test('every monster keeps decoded idle, hit and white-hit layers mounted with matching geometry',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props});
 const art=Object.fromEntries(Object.keys(geometry.MONSTER_GEOMETRY).map((id,i)=>[id,{normal:i*2,hit:i*2+1}]));
 const m=load('apps/mobile/src/components/burrow/monster-artwork.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{View:'View'},'expo-image':{Image:'TintImage'},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},useAnimatedStyle:fn=>fn()},
  '@/lib/monster-images':{MONSTER_ART:art},'@/lib/monster-art-geometry':geometry,'./burrow-image':{Image:'Image',resolveBurrowImageSource:source=>source},
 });
 for(const id of Object.keys(art)){
  for(const surface of ['selection','preparation','battle']){
   const tree=h.render(()=>m.MonsterArtwork({id,width:212,height:200,surface})),multiplier=geometry.monsterDisplayScale(id,surface);
   assert.equal(tree.props.style.width,212*multiplier);assert.equal(tree.props.style.height,200*multiplier);
   const frame=nodes(tree).find(n=>n.type==='Image').props.style;
   assert.ok(Math.abs(frame.height/800*geometry.MONSTER_GEOMETRY[id].normal[3]-200*multiplier)<1e-8);
  }
  const idle=h.render(()=>m.MonsterArtwork({id,width:212,height:200,flash:{value:0}}));
  const hit=h.render(()=>m.MonsterArtwork({id,width:212,height:200,flash:{value:1}}));
  const idleImages=nodes(idle).filter(n=>['Image','TintImage'].includes(n.type)),hitImages=nodes(hit).filter(n=>['Image','TintImage'].includes(n.type));
  assert.equal(idleImages.length,3);assert.equal(hitImages.length,3);
  assert.deepEqual(idleImages.map(n=>n.props.source),hitImages.map(n=>n.props.source));
  assert.equal(hitImages[2].props.tintColor,'#FFFFFF');assert.equal(hitImages[2].props.source,art[id].hit);
  assert.deepEqual(hitImages[2].props.style,hitImages[1].props.style);
  assert.equal(hitImages[2].type,'TintImage','white overlay must bypass prepared ImageRef prop-order tint bug');
  assert.equal(hitImages[2].props.cachePolicy,'memory-disk');assert.equal(hitImages[2].props.transition,0);
  assert.equal(hitImages[2].props.useAppleWebpCodec,false);
  for(const image of hitImages)assert.equal(image.props.contentFit,'contain');
  assert.deepEqual(nodes(idle).filter(n=>n.type==='AnimatedView').map(n=>n.props.style[1].opacity),[1,0,0]);
  assert.deepEqual(nodes(hit).filter(n=>n.type==='AnimatedView').map(n=>n.props.style[1].opacity),[0,1,1]);
 }
});
test('each screen explicitly selects its sizing policy without changing HP or shared stage slots',async()=>{
 const sizes=[];
 for(const monster of domain.RELEASE_ROOM_MONSTERS){
  const h=screenHarness();await flush();const grid=h.all().filter(n=>n.type==='MonsterArtwork');assert.equal(grid.length,8);assert.equal(new Set(grid.map(n=>n.props.height)).size,1);assert.ok(grid.every(n=>n.props.surface==='selection'));
  h.press('View '+monster.name);const prepArt=h.find(n=>n.type==='MonsterArtwork');assert.equal(prepArt.props.surface,'preparation');const prep=prepArt.props.height;h.press('Start');
  const sprite=h.find(n=>n.type==='MonsterArtwork');assert.ok(sprite.props.flash);assert.equal(sprite.props.surface,'battle');sizes.push([prep,sprite.props.height]);
  const hp=h.find(n=>n.props?.accessibilityLabel==='Monster energy');assert.equal(hp.props.accessibilityValue.now,20);
  const svg=nodes(hp).find(n=>n.type==='Svg');assert.equal(svg.props.width,'54%');assert.equal(svg.props.height,22);
  assert.equal(nodes(hp).filter(n=>n.type==='Path').length,2,'no extra heart icon');
  const swipe=h.find(n=>n.type==='Swipe').props.onHit;for(let n=0;n<10;n++)swipe();h.render();
  const half=h.find(n=>n.props?.accessibilityLabel==='Monster energy');assert.equal(half.props.accessibilityValue.now,10);
  assert.equal(nodes(half).find(n=>n.type==='Rect'&&n.props.fill==='#D8E83A').props.width,117);h.h.unmount();
 }
 assert.equal(new Set(sizes.map(s=>s.join(','))).size,1);
});
test('rendered end-of-battle dialogue stays 16 points from the visible restored monster at different screen sizes',async()=>{
 for(const viewport of [{width:320,height:568,top:20,bottom:0},{width:390,height:844,top:47,bottom:34},{width:430,height:932,top:59,bottom:34}]){
  const h=screenHarness(viewport);await flush();h.press('View People-Pleasing');h.press('Start');
  const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let i=0;i<20;i++)hit();h.render();
  const bubble=h.find(n=>n.props?.accessibilityLabel==='Monster dialogue').props.style[1];
  const sprite=h.find(n=>n.type==='MonsterArtwork'),wrapper=h.find(n=>n.type==='AnimatedView'&&n.props.onLayout);
  const frame=wrapper.props.style[0],transform=wrapper.props.style[1].transform,shrink=transform.find(t=>t.scale!==undefined).scale;
  const bodyHeight=sprite.props.height*geometry.monsterDisplayScale(sprite.props.id,sprite.props.surface)*shrink;
  const bodyTop=frame.top+(frame.height-bodyHeight)/2;
  assert.ok(Math.abs(bodyTop-bubble.top-bubble.height-10-16)<1e-8);
  const expected=layout.releaseRoomLayout(viewport.width,viewport.height,viewport.top,viewport.bottom);
  assert.ok(bodyTop+bodyHeight<=expected.finalArenaHeight);
  h.h.unmount();
 }
});
test('popup completion, not layout or a cancelled/background callback, releases a single reward',async()=>{
 const h=screenHarness({manualLayout:true,manualMotion:true});await flush();h.press('View Overthinking');h.press('Start');
 const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let n=0;n<20;n++)hit();h.render();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 h.complete();await flush();h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.all().filter(n=>n.type==='Confetti').length,1);assert.equal(h.rewards.length,0);
 h.find(n=>n.props?.accessibilityLabel==='Victory dialog').props.onLayout();h.render();h.render();
 h.animations.at(-1).callback(false);h.render();assert.equal(h.rewards.length,0);
 h.background();h.animations.at(-1).callback(true);h.render();assert.equal(h.rewards.length,0);
 h.foreground();h.finishPopup();h.render();assert.equal(h.rewards.length,1);
 h.finishPopup();h.render();assert.equal(h.rewards.length,1);h.h.unmount();h.finishPopup();assert.equal(h.rewards.length,1);
});
test('release-page warmup covers both poses for every monster before navigation',()=>{
 const source=fs.readFileSync('apps/mobile/src/lib/burrow-page-art.ts','utf8');assert.match(source,/flatMap\(art=>\[art.normal,art.hit\]\)/);
});
