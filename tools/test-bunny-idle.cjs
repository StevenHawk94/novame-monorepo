const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { load, hooks, deferred, flush, clock: testClock } = require('./lifecycle-test-utils.cjs');
const rig = require('../apps/mobile/src/lib/bunny-rig.json'), motion = require('../apps/mobile/src/lib/bunny-motion.json');
const runtime = load('apps/mobile/src/lib/bunny-idle-motion.ts', { './bunny-rig.json': rig, './bunny-motion.json': motion });
const loader = load('apps/mobile/src/lib/latest-outfit-loader.ts');
const plain = x => JSON.parse(JSON.stringify(x));
test('static Shop preview bypasses native renderer; stacks five uniformly fitted, downscaled cached WebPs', () => {
  let nativeChecks=0;
  const jsx=(type,props,key)=>({type,props,key});
  const sources={
    default:{tail:1,earLeft:2,earRight:3,body:4,head:5},
    office:{tail:6,earLeft:7,earRight:8,body:9,head:10},
  };
  const {OutfitBunny,StaticOutfitBunny}=load('apps/mobile/src/components/burrow/outfit-bunny.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Platform:{OS:'ios'},TurboModuleRegistry:{get(){nativeChecks++;return{};}},View:'View'},
    '@/lib/burrow-outfit-assets':{OUTFIT_LAYERS:sources,outfitKey:item=>item?.asset.outfitKey??'default'},
    '@/lib/bunny-idle-motion':runtime,'./burrow-image':{Image:'Image'},
    './outfit-bunny-native':{NativeOutfitBunny:'NativeBunny'},
  },{__DEV__:true});
  const outfit={asset:{outfitKey:'office'}};
  for(const choice of [undefined,outfit,undefined,outfit])
    assert.equal(OutfitBunny({outfit:choice,width:90,height:120,animated:false}).type,StaticOutfitBunny);
  assert.equal(nativeChecks,0,'static selection must not even initialize native rendering');
  const children=StaticOutfitBunny({outfit,width:90,height:120}).props.children;
  assert.equal(children.length,5);
  assert.deepEqual(plain(children.map(x=>x.props.source)),[6,7,8,9,10]);
  const first=plain(children[0].props.style);
  children.forEach(node=>{
    assert.equal(node.props.contentFit,'contain');assert.equal(node.props.allowDownscaling,true);
    assert.equal(node.props.enforceEarlyResizing,true);assert.equal(node.props.cachePolicy,'memory-disk');
    assert.deepEqual(plain(node.props.style),first);
    assert.ok(Math.abs(node.props.style.width/node.props.style.height-1189/1323)<1e-12);
    assert.match(node.key,/^office\//);
    assert.equal(node.props.recyclingKey,undefined,'cached ImageRefs must not be cleared by native recycling');
  });
  assert.equal(OutfitBunny({outfit,width:90,height:120,animated:true}).type,'NativeBunny');
  assert.equal(nativeChecks,1);
  assert.equal(OutfitBunny({outfit,width:90,height:120,animated:false}).type,StaticOutfitBunny);
  assert.equal(nativeChecks,1);
});
test('warm Default → outfit → Default never clears cached body/ear images during native prop updates',()=>{
  const jsx=(type,props,key)=>({type,props,key}),sources={
    default:{tail:1,earLeft:2,earRight:3,body:4,head:5},office:{tail:6,earLeft:7,earRight:8,body:9,head:10},
  };
  const {StaticOutfitBunny}=load('apps/mobile/src/components/burrow/outfit-bunny.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:'ios'},TurboModuleRegistry:{get:()=>null},View:'View'},
    '@/lib/burrow-outfit-assets':{OUTFIT_LAYERS:sources,outfitKey:item=>item?.asset.outfitKey??'default'},
    '@/lib/bunny-idle-motion':runtime,'./burrow-image':{Image:'Image'},
  });
  let native=new Map();
  for(const selected of ['default','office','default','office','default','default']){
    const tree=StaticOutfitBunny({outfit:{asset:{outfitKey:selected}},width:156,height:176}),next=new Map();
    for(const node of tree.props.children){
      const view=native.get(node.key)??{image:null,recyclingKey:undefined};
      // expo-image iOS renders SharedRef sources immediately. A subsequent
      // recyclingKey setter clears that bitmap; sources=nil means reload()
      // cannot restore it. Exercise that valid native prop update order.
      if(selected==='default')view.image=node.props.source;
      if(view.recyclingKey!=null&&view.recyclingKey!==node.props.recyclingKey)view.image=null;
      // Traditional URI sources finish loading after all props/reload(), while
      // already-decoded Default refs have no URL left to reload after clearing.
      if(selected!=='default')view.image=node.props.source;
      view.recyclingKey=node.props.recyclingKey;next.set(node.key,view);
      assert.equal(view.image,node.props.source,selected+'/'+node.key+' must remain visible');
    }
    native=next;assert.equal(native.size,5,'exactly one complete outfit, not accumulated hidden views');
  }
});
test('four-second cycle, one-second rest, anchored feet, rigid pivots and seamless loop', () => {
  const { evaluateBunnyMotion: evaluate, transformBunnyPoint: transform } = runtime;
  assert.equal(motion.cycleSeconds,4);
  assert.equal(motion.cycleSeconds-motion.breathingPhaseSeconds,1);
  assert.deepEqual(plain(evaluate(0)), plain(evaluate(motion.cycleSeconds)));
  assert.deepEqual(plain(evaluate(-1)), plain(evaluate(3)));
  assert.equal(evaluate(1.5).liftSourcePx,29.16);
  assert.equal(evaluate(1.5).chestExpansion,0.02916);
  assert.equal(Math.abs(evaluate(1.5).earLeftDegrees),0);
  assert.equal(evaluate(1.5).earRightDegrees,0);
  assert.equal(evaluate(3).earLeftDegrees,-16);
  assert.equal(evaluate(3).earRightDegrees,16);
  for (let t = 0; t <= motion.cycleSeconds; t += 0.025) {
    const state = evaluate(t);
    for (const y of [1035,1100,1258,1323]) assert.deepEqual(plain(transform('body',{x:177,y},state)),{x:177,y});
    assert.deepEqual(plain(transform('earLeft',rig.pivots.earLeft,state)),{x:452,y:430-state.liftSourcePx});
    assert.deepEqual(plain(transform('tail',rig.pivots.tail,state)),{x:208+state.tailTranslationSourcePx,y:1050});
    if(t>=3)assert.equal(state.liftSourcePx,0);
  }
});
test('ears tighten on inhale and open on exhale; tail only shakes during rest with smooth boundaries', () => {
  const evaluate=runtime.evaluateBunnyMotion;
  let previous=evaluate(0);
  assert.equal(previous.opening,1);
  for(let i=1;i<=60;i++) {
    const state=evaluate(i*0.025);
    assert.ok(state.liftSourcePx>=previous.liftSourcePx);
    assert.ok(state.opening<=previous.opening);
    assert.ok(Math.abs(state.opening+state.breath-1)<1e-12);
    assert.equal(state.tailDegrees,0);
    assert.equal(state.tailTranslationSourcePx,0);
    previous=state;
  }
  for(let i=61;i<=120;i++) {
    const state=evaluate(i*0.025);
    assert.ok(state.liftSourcePx<=previous.liftSourcePx);
    assert.ok(state.opening>=previous.opening);
    assert.equal(state.tailDegrees,0);
    assert.equal(state.tailTranslationSourcePx,0);
    previous=state;
  }
  let movingRestFrames=0;
  for(let i=121;i<160;i++) {
    const state=evaluate(i*0.025);
    assert.equal(state.liftSourcePx,0);
    assert.equal(state.chestExpansion,0);
    assert.equal(state.opening,1);
    if(Math.abs(state.tailDegrees)>0.01) movingRestFrames++;
  }
  assert.ok(movingRestFrames>20,'tail visibly shakes throughout the resting phase');
  assert.notEqual(evaluate(3.125).tailDegrees,0);
  for(const boundary of [0,1.5,3,motion.cycleSeconds]) {
    const before=evaluate(boundary-1e-5),at=evaluate(boundary),after=evaluate(boundary+1e-5);
    for(const key of ['liftSourcePx','earLeftDegrees','earRightDegrees','tailDegrees','tailTranslationSourcePx']) {
      assert.ok(Math.abs(before[key]-at[key])<1e-6,key+' before '+boundary);
      assert.ok(Math.abs(after[key]-at[key])<1e-6,key+' after '+boundary);
    }
  }
});
test('reduced-motion pose preserves the original undeformed five-layer artwork at every phase', () => {
  for(const seconds of [0,.125,1.5,2,3.5,4]) {
    const state=runtime.evaluateBunnyMotion(seconds,true);
    for(const layer of ['body','head','earLeft','earRight','tail'])
      assert.deepEqual(plain(runtime.transformBunnyPoint(layer,{x:390,y:730},state)),{x:390,y:730});
  }
});
test('all five layers preserve the full canvas, explicit product mapping and source-file existence', () => {
  const source = fs.readFileSync('apps/mobile/src/lib/burrow-outfit-assets.ts','utf8');
  const file = 'apps/mobile/src/lib/burrow-outfit-assets.ts';
  const imports = Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m => [m[2],path.resolve(path.dirname(file),m[2])]));
  const registry = load(file,imports);
  assert.equal(Object.keys(registry.OUTFIT_LAYERS).length,19);
  assert.equal(Object.keys(imports).length,95);
  Object.values(imports).forEach(p=>assert.ok(fs.existsSync(p),p));
  assert.equal(registry.outfitKey({asset:{outfitKey:'13_black_sweater_vest'}}),'13_black_sweater_vest');
  assert.equal(registry.outfitKey({asset:{outfitKey:'toString'}}),'default');
  assert.equal(registry.outfitKey({asset:{outfitStyle:'raincoat'}}),'default');
  assert.equal(runtime.bunnyMesh().textures.length,49*81);
  const fit=runtime.bunnyViewport(300,500);
  assert.equal(fit.scale,300/1259);
});
test('optimized mesh deviation is below 0.1pt at Home scale versus supplied 100 × 112 reference', () => {
  const { transformBunnyPoint: transform, evaluateBunnyMotion: evaluate } = runtime;
  function sample(columns, rows, p, state) {
    const fx=p.x/1189*columns,fy=p.y/1323*rows;
    const i=Math.min(columns-1,Math.floor(fx)),j=Math.min(rows-1,Math.floor(fy)),u=fx-i,v=fy-j;
    const point=(a,b)=>transform('body',{x:(i+a)*1189/columns,y:(j+b)*1323/rows},state);
    const weights=u+v<=1 ? [[point(0,0),1-u-v],[point(1,0),u],[point(0,1),v]] :
      [[point(1,0),1-v],[point(0,1),1-u],[point(1,1),u+v-1]];
    return weights.reduce((q,[p,w])=>({x:q.x+p.x*w,y:q.y+p.y*w}),{x:0,y:0});
  }
  let maximum=0;
  for(const t of [0,0.5,1,1.5,2,2.5,3,3.25,3.75])for(let y=700;y<=1050;y+=3)for(let x=0;x<=1189;x+=17){
    const state=evaluate(t),a=sample(48,80,{x,y},state),b=sample(100,112,{x,y},state);
    maximum=Math.max(maximum,Math.hypot(a.x-b.x,a.y-b.y)*205/1008);
  }
  assert.ok(maximum<0.1,'maximum point deviation: '+maximum);
});
test('precomputed deformation matches every approved mesh vertex throughout the original cycle without altering density or source UVs',()=>{
  const mesh=runtime.bunnyMesh(),weights=runtime.bunnyMeshWeights(mesh.textures),before=JSON.stringify(mesh);
  assert.equal(mesh.textures.length,3969);assert.equal(mesh.indices.length,48*80*6);
  for(let frame=0;frame<=240;frame++){
    const pose=runtime.evaluateBunnyMotion(frame/60),vertices=runtime.deformBunnyMesh(mesh.textures,weights,pose.liftSourcePx,pose.chestExpansion);
    assert.equal(vertices.length,mesh.textures.length);
    for(let i=0;i<vertices.length;i++){
      const expected=runtime.transformBunnyPoint('body',mesh.textures[i],pose),actual=vertices[i];
      assert.ok(Math.abs(actual.x-expected.x)<1e-10&&Math.abs(actual.y-expected.y)<1e-10,`frame ${frame}, point ${i}`);
    }
    if(frame>=180)assert.equal(vertices,mesh.textures,'tail-only rest reuses undeformed body vertices');
  }
  assert.equal(JSON.stringify(mesh),before,'never mutate UVs or the retained source mesh');
  const reduced=runtime.evaluateBunnyMotion(1.5,true);
  assert.equal(runtime.deformBunnyMesh(mesh.textures,weights,reduced.liftSourcePx,reduced.chestExpansion),mesh.textures);
});
test('native body worklet has one primitive phase read and never reads a shared pose from each vertex callback',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/outfit-bunny-native.tsx','utf8');
  assert.match(source,/const breath = useDerivedValue\(\(\) => state\.value\.breath\)/);
  assert.match(source,/const phase = breath\.value;\s*return deformBunnyMesh/);
  assert.doesNotMatch(source,/map\(point =>[^\n]*state\.value/);
});
test('rapid A → B → C loads serialize, discard A and commit only complete C', async () => {
  const pending=[],commits=[],discards=[];
  const resource=loader.createLatestOutfitLoader(key=>{const d=deferred();pending.push({key,...d});return d.promise;},
    (key,value)=>commits.push({key,value}),value=>discards.push(value),()=>assert.fail('unexpected failure'));
  resource.request('A');resource.request('B');resource.request('C');
  assert.deepEqual(pending.map(x=>x.key),['A']);
  pending[0].resolve('five A layers');await flush();
  assert.deepEqual(pending.map(x=>x.key),['A','C']);assert.equal(commits.length,0);
  pending[1].resolve('five C layers');await flush();
  assert.deepEqual(commits,[{key:'C',value:'five C layers'}]);assert.deepEqual(discards,['five A layers']);
  resource.close();
});
test('failed replacement leaves displayed outfit intact and unmounted decoding is discarded',async()=>{
  const pending=[],commits=[],discards=[],errors=[];
  const resource=loader.createLatestOutfitLoader(key=>{const d=deferred();pending.push(d);return d.promise;},
    (key,value)=>commits.push(key),value=>discards.push(value),e=>errors.push(e));
  resource.request('A');pending[0].resolve('A');await flush();
  resource.request('B');pending[1].reject(Error('decode failed'));await flush();assert.deepEqual(commits,['A']);assert.equal(errors.length,1);
  resource.request('C');resource.close();pending[2].resolve('C');await flush();assert.deepEqual(discards,['C']);
});
test('single UI-thread frame clock; no React frame state, no whole-character fake breathing',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/outfit-bunny-native.tsx','utf8');
  assert.match(source,/useFrameCallback\(frameCallback, false\)/);assert.match(source,/focused && foreground && active/);
  assert.match(source,/% BUNNY_MOTION\.cycleSeconds/);
  assert.match(source,/staticPose\.value = reduceMotion/);
  assert.doesNotMatch(source,/setInterval|withRepeat|setSeconds|key=\{key\}|seconds\.value = 0/);
  assert.match(source,/generation|createLatestOutfitLoader/);
});
test('native renderer pauses/resumes phase on focus/background, replaces whole suite without resetting, respects accessibility',async()=>{
  const time=testClock(),priority=load('apps/mobile/src/lib/ui-work-priority.ts',{},time.globals).uiWorkPriority;
  const h=hooks(),reducedQuery=deferred(),firstPaint=deferred();let focused=true,active=true,appListener,reduceListener,clock,snapshots=0,measure,registered=false;
  const frames=new Map();let frameId=0;
  const jsx=(type,props)=>({type,props}),images=[],shared=[];
  const skia={Data:{fromURI:async uri=>({dispose(){}})},Image:{MakeImageFromEncoded:()=>{
    const image={width:()=>1189,height:()=>1323,dispose(){image.disposed=true;}};images.push(image);return image;
  }}};
  const sources=Object.fromEntries(['default','13_black_sweater_vest'].map(key=>[key,Object.fromEntries(['tail','earLeft','earRight','body','head'].map((x,i)=>[x,i+1]))]));
  const {NativeOutfitBunny}=load('apps/mobile/src/components/burrow/outfit-bunny-native.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Image:{resolveAssetSource:id=>({uri:'file://'+id})},
      AppState:{currentState:'active',addEventListener:(_,fn)=>{appListener=fn;return{remove(){}};}},
      AccessibilityInfo:{isReduceMotionEnabled:()=>reducedQuery.promise,addEventListener:(_,fn)=>{reduceListener=fn;return{remove(){}};}}},
    '@react-navigation/native':{useIsFocused:()=>focused},
    '@shopify/react-native-skia':{Canvas:'Canvas',Group:'Group',ImageShader:'ImageShader',Vertices:'Vertices',Skia:skia,
      useCanvasRef:()=>h.react.useRef({measure:fn=>{measure=fn;},getNativeId:()=>1000,
        makeImageSnapshot:()=>assert.fail('synchronous snapshot can create a zero-sized Metal surface'),
        makeImageSnapshotAsync:()=>{assert.equal(registered,true);snapshots++;return firstPaint.promise;}})},
    'react-native-reanimated':{
      useSharedValue:value=>{const ref=h.react.useRef(null);if(!ref.current){ref.current={value};shared.push(ref.current);}return ref.current;},
      useDerivedValue:fn=>({get value(){return fn();}}),
      useFrameCallback:fn=>h.react.useMemo(()=>clock={active:false,frame:fn,setActive(v){this.active=v;}},[]),
    },
    '@/lib/burrow-outfit-assets':{OUTFIT_LAYERS:sources,outfitKey:item=>item?.asset.outfitKey??'default'},
    '@/lib/bunny-idle-motion':runtime,'@/lib/latest-outfit-loader':loader,
    '@/lib/ui-work-priority':{uiWorkPriority:priority},
    '@/lib/bunny-idle-scheduling':load('apps/mobile/src/lib/bunny-idle-scheduling.ts',{},time.globals),
    '@/lib/prepared-bunny':{prepareBunny:async key=>Object.fromEntries(await Promise.all(Object.entries(sources[key]).map(async([layer,id])=>{
      const encoded=await skia.Data.fromURI('file://'+id);const image=skia.Image.MakeImageFromEncoded(encoded);encoded.dispose();return[layer,image];
    })))},
    './outfit-bunny':{StaticOutfitBunny:'Static'},
  },{...time.globals,__DEV__:true,SkiaViewApi:{size:id=>{assert.equal(id,1000);return registered?{width:120,height:150}:{width:0,height:0};}},
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
  let outfit,tree;
  const render=()=>tree=h.render(()=>NativeOutfitBunny({outfit,width:120,height:150,active}));
  render();for(let i=0;i<8;i++)await flush();render();assert.equal(images.length,5);assert.equal(clock.active,false);
  assert.ok(tree.props.children.some(n=>n?.type==='Static'),'fallback remains under the first canvas');
  assert.equal(snapshots,0,'JS ref alone does not guarantee native registration; snapshot must wait for native measurement');
  frames.get(frameId)();measure(0,0,0,0);assert.equal(snapshots,0);
  frames.get(frameId)();measure(0,0,120,150);
  assert.equal(snapshots,0,'positive RN layout must not snapshot a missing/zero-sized native Skia surface');
  reduceListener(false);render();assert.equal(clock.active,false,'no deformation before first native draw completes');
  assert.ok(tree.props.children.some(n=>n?.type==='Static'),'positive layout does not prove native registration');
  registered=true;frames.get(frameId)();measure(0,0,120,150);assert.equal(snapshots,1);
  let snapshotDisposed=false;firstPaint.resolve({dispose(){snapshotDisposed=true;}});await flush();render();
  assert.equal(snapshotDisposed,true);assert.equal(tree.props.children.some(n=>n?.type==='Static'),false);
  reduceListener(false);render();assert.equal(clock.active,false);time.advance(1000);assert.equal(clock.active,true);
  clock.frame({timestamp:1000});clock.frame({timestamp:1050});const phase=shared[0].value;assert.equal(phase,0.05);
  appListener('background');render();assert.equal(clock.active,false);assert.equal(shared[0].value,phase);
  appListener('active');render();assert.equal(clock.active,false);time.advance(1000);clock.frame({timestamp:9000});assert.equal(shared[0].value,phase);
  focused=false;render();assert.equal(clock.active,false);focused=true;render();assert.equal(clock.active,false);time.advance(1000);assert.equal(clock.active,true);
  active=false;render();assert.equal(clock.active,false);assert.equal(images.length,5,'away status does not unmount/redecode the bunny');
  active=true;render();assert.equal(clock.active,false);time.advance(1000);assert.equal(clock.active,true);
  priority.touch(1);assert.equal(clock.active,false,'touch down stops only the bunny before focus changes');
  time.advance(1000);assert.equal(clock.active,false,'held touch never resumes');
  priority.touch(0);time.advance(999);assert.equal(clock.active,false);time.advance(1);assert.equal(clock.active,true);
  outfit={asset:{outfitKey:'13_black_sweater_vest'}};render();for(let i=0;i<8;i++)await flush();render();
  assert.equal(images.length,10);assert.equal(shared[0].value,phase);
  const nodes=tree.props.children.find(n=>n?.type==='Canvas').props.children.props.children;
  assert.equal(nodes.length,5);nodes.forEach(n=>assert.ok(images.slice(5).includes(n.props.children.props.image)));
  reduceListener(true);render();assert.equal(clock.active,false);
  reducedQuery.resolve(false);await flush();render();assert.equal(clock.active,false,'stale query cannot override setting');
  h.unmount();assert.equal(clock.active,false);
});
