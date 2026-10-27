const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {load,clock}=require('./lifecycle-test-utils.cjs');
const rig=require('../apps/mobile/src/lib/bunny-rig.json'),motion=require('../apps/mobile/src/lib/bunny-motion.json');
const model=load('apps/mobile/src/lib/bunny-idle-motion.ts',{'./bunny-rig.json':rig,'./bunny-motion.json':motion});

test('constant-field row elimination preserves the original piecewise-affine warp, UVs and all outfit phases',()=>{
  const original=model.bunnyMesh(),mesh=model.bunnyRenderMesh(),weights=model.bunnyMeshWeights(mesh.textures);
  const ys=[...new Set(mesh.textures.map(p=>p.y))];
  assert.ok(mesh.textures.length<original.textures.length*.35,`${mesh.textures.length} vs ${original.textures.length}`);
  assert.equal(mesh.textures.length%49,0);assert.ok(mesh.indices.every(i=>i>=0&&i<mesh.textures.length));
  const sample=(ys,x,y,phase)=>{
    let row=ys.findIndex((v,i)=>i<ys.length-1&&y<=ys[i+1]);if(row<0)row=ys.length-2;
    const cell=Math.min(47,Math.floor(x/1189*48)),u=x/1189*48-cell,v=(y-ys[row])/(ys[row+1]-ys[row]);
    const point=(a,b)=>model.transformBunnyPoint('body',{x:(cell+a)*1189/48,y:ys[row+b]},phase);
    const tri=u+v<=1?[[point(0,0),1-u-v],[point(1,0),u],[point(0,1),v]]:[[point(1,0),1-v],[point(0,1),1-u],[point(1,1),u+v-1]];
    return tri.reduce((sum,[p,w])=>({x:sum.x+p.x*w,y:sum.y+p.y*w}),{x:0,y:0});
  };
  const oldYs=Array.from({length:81},(_,i)=>i*1323/80);
  let max=0;
  // Full canvas, cell interiors, boundaries and peak/intermediate breathing.
  for(const second of [0,.25,.75,1.5,2.25,3,3.5,4]){
    const pose=model.evaluateBunnyMotion(second),deformed=model.deformBunnyMesh(mesh.textures,weights,pose.liftSourcePx,pose.chestExpansion);
    for(let i=0;i<deformed.length;i++)assert.ok(Math.abs(deformed[i].x-model.transformBunnyPoint('body',mesh.textures[i],pose).x)<1e-10);
    for(let y=0;y<=1323;y+=6.5)for(let x=0;x<=1189;x+=19.75){
      const a=sample(oldYs,x,y,pose),b=sample(ys,x,y,pose);max=Math.max(max,Math.hypot(a.x-b.x,a.y-b.y));
    }
  }
  assert.ok(max<1e-9,`no approximation of the approved mesh: max source px=${max}`);
});

test('bunny-only priority freezes immediately and resumes one second after transition end without blocking actions',()=>{
  const time=clock(),priority=load('apps/mobile/src/lib/ui-work-priority.ts',{},time.globals).uiWorkPriority;
  const {scheduleBunnyIdle}=load('apps/mobile/src/lib/bunny-idle-scheduling.ts',{},time.globals),events=[];
  const stop=scheduleBunnyIdle(priority,value=>events.push(value));
  time.advance(999);assert.deepEqual(events,[false]);time.advance(1);assert.deepEqual(events,[false,true]);
  priority.action();assert.equal(events.at(-1),false);
  let dispatched=false;dispatched=true;assert.equal(dispatched,true,'no waiting on the bunny scheduler');
  priority.transition('tabs',true);time.advance(350);priority.transition('tabs',false);
  time.advance(999);assert.equal(events.at(-1),false);time.advance(1);assert.equal(events.at(-1),true);
  priority.action();time.advance(700);priority.action();time.advance(999);assert.equal(events.at(-1),false);
  time.advance(1);assert.equal(events.at(-1),true);stop();const count=events.length;
  priority.action();time.advance(5000);assert.equal(events.length,count,'cancelled/hidden/unmounted bunny cannot restart');
});

test('held touches, transition cancellation and missing callbacks cannot leave a permanent bunny pause',()=>{
  const time=clock(),priority=load('apps/mobile/src/lib/ui-work-priority.ts',{},time.globals).uiWorkPriority;
  const {scheduleBunnyIdle}=load('apps/mobile/src/lib/bunny-idle-scheduling.ts',{},time.globals),events=[];
  const stop=scheduleBunnyIdle(priority,value=>events.push(value));
  priority.touch(1);time.advance(5000);assert.equal(events.at(-1),false);
  priority.touch(0);time.advance(1000);assert.equal(events.at(-1),true);
  priority.transition('native-stack',true);time.advance(1600);assert.equal(events.at(-1),true,'expired transition lease recovers');
  priority.transition('tabs',true);priority.reset();time.advance(1000);assert.equal(events.at(-1),true);
  stop();assert.equal(time.timers.size,0);
});

test('the installed RN AnimatedProps key changes for descriptor children, but not for the function-only scene host',()=>{
  const resolution={paths:[path.resolve('apps/mobile'),path.resolve('node_modules/.pnpm/node_modules')]},babel=require(require.resolve('@babel/core',resolution));
  const rn=path.dirname(require.resolve('react-native/package.json',resolution));
  const file=path.join(rn,'src/private/animated/createAnimatedPropsMemoHook.js');
  const code=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,
    plugins:[require.resolve('babel-plugin-syntax-hermes-parser',resolution),require.resolve('@babel/plugin-transform-flow-strip-types',resolution),require.resolve('@babel/plugin-transform-modules-commonjs',resolution)]}).code;
  class AnimatedNode{}class AnimatedEvent{}
  const flatten=value=>Array.isArray(value)?Object.assign({},...value.map(flatten)):value;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{
    if(name.endsWith('AnimatedNode'))return AnimatedNode;if(name.endsWith('AnimatedEvent'))return{AnimatedEvent};
    if(name.endsWith('AnimatedObject'))return{isPlainObject:v=>v!==null&&typeof v==='object'&&!Array.isArray(v)};
    if(name.endsWith('flattenStyle'))return flatten;if(name==='react'||name.includes('FeatureFlags'))return{};
    if(name==='nullthrows')return v=>{assert.ok(v);return v;};assert.fail(name);
  }});
  const {createCompositeKeyForProps:key,areCompositeKeysEqual:equal}=module.exports;
  const offset=new AnimatedNode(),style=[{opacity:1,zIndex:2,transform:[{translateX:offset}]}];
  const child=()=>({type:'NavigationContext',props:{route:'burrow'}});
  assert.equal(equal(key({style,children:child()}),key({style,children:child()})),false,'old graph restores default transform during descriptor replacement');
  let latest=child();const jsx=(type,props)=>({type,props});
  const {NativeAnimatedContent:Host}=load('apps/mobile/src/components/ui/native-animated-content.tsx',{
    react:{forwardRef:fn=>fn},'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Animated:{createAnimatedComponent:fn=>fn}},
  });
  const before={style,renderScene:()=>latest},after={style:[{opacity:0,zIndex:-2,transform:[{translateX:offset}]}],renderScene:()=>latest};
  assert.equal(equal(key(before),key(after)),true,'position graph remains attached through close/hide');
  const first=Host(before,null);latest=child();const second=Host(after,null);
  assert.equal(second.props.children,latest);assert.notEqual(first.props.children,latest,'latest navigation context is not cached/frozen');
  assert.equal(second.props.renderScene,undefined,'function prop never leaks to native View');
  const navigator=fs.readFileSync('apps/mobile/src/components/main/retained-tabs-navigator.tsx','utf8');
  assert.match(navigator,/<AnimatedTabScene key=\{route.key\}/);
  assert.match(navigator,/renderScene=\{descriptors\[route.key\]\.render\}/);
  assert.doesNotMatch(navigator,/\{descriptors\[route.key\]\.render\(\)\}/,'first My Room close cannot replace the host graph through children');
});

test('generic screen artwork really is opaque and fills the surface removed from the gradient path',async()=>{
  const sharp=require('node:module').createRequire(require.resolve('next/package.json',{paths:[path.resolve('apps/api')]}))('sharp');
  for(const name of ['basic-bg.webp','friends-room-bg.webp','adventure finish-bg.webp.webp','affection-send-bg.webp']){
    const metadata=await sharp(path.resolve('apps/mobile/assets/burrow-webp',name)).metadata();
    assert.equal(metadata.hasAlpha,false,name+' must not depend on the removed gradient');
  }
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.doesNotMatch(source,/<NativeVerticalGradient/);
  assert.match(source,/<Image source=\{background\} contentFit="cover" contentPosition="top" style=\{StyleSheet.absoluteFillObject\}/);
});
