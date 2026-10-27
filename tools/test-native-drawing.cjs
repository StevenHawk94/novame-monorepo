const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/burrow-surface.ts');
const plain=value=>JSON.parse(JSON.stringify(value));

test('flat and fully covered screens keep their exact colors without creating a gradient surface',()=>{
  for(const [section,entry,color] of [['home',false,'#793D29'],['burrow',false,'#572b1a'],['quests',false,'#844624'],['adventure',true,'#461501']])
    assert.equal(model.burrowFlatSurface(section,entry),color);
  for(const section of ['adventure','friends_room','self_care_room'])assert.equal(model.burrowFlatSurface(section,false),model.BURROW_PAGE_COLORS[0]);
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.doesNotMatch(source,/<NativeVerticalGradient/,'no invisible gradient behind opaque generic cover images');
  assert.match(source,/style=\{\[s.root,\{backgroundColor:flatSurface\?\?BURROW_PAGE_COLORS\[0\]/);
  assert.match(fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8'),/root: \{ flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#B75833' \}/,'Home has its own opaque full-viewport surface');
});

test('the pinned RN 0.81 native parser accepts unchanged vertical colors and evenly spaced stops',()=>{
  const resolution={paths:[path.resolve('apps/mobile'),path.resolve('node_modules/.pnpm/node_modules')]};
  const babel=require(require.resolve('@babel/core',resolution));
  const rn=path.dirname(require.resolve('react-native/package.json',resolution));
  const file=path.join(rn,'Libraries/StyleSheet/processBackgroundImage.js');
  const code=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,
    plugins:[require.resolve('@babel/plugin-transform-flow-strip-types',resolution),require.resolve('@babel/plugin-transform-modules-commonjs',resolution)]}).code;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,console,__DEV__:false,require:name=>{
    assert.equal(name,'./processColor');return{default:color=>color};
  }});
  for(const colors of [model.BURROW_PAGE_COLORS,model.ADVENTURE_PROGRESS_COLORS,model.ADVENTURE_RETURN_COLORS]){
    const style=model.nativeVerticalGradientStyle(colors),parsed=plain(module.exports.default(style.experimental_backgroundImage));
    assert.equal(style.backgroundColor,colors[0]);assert.equal(parsed.length,1);
    assert.deepEqual(parsed[0].direction,{type:'angle',value:180});
    assert.deepEqual(parsed[0].colorStops,Array.from(colors,(color,index)=>({color:color.toLowerCase(),position:`${index/(colors.length-1)*100}%`})));
  }
});

test('iOS uses the native compositing gradient, Android/web keep Expo, all remain noninteractive and preserve bounds',()=>{
  const h=hooks(),platform={OS:'ios'},style={position:'absolute',left:0,right:0,top:0,bottom:0};
  const jsx=(type,props)=>({type,props});
  const {NativeVerticalGradient}=load('apps/mobile/src/components/burrow/native-vertical-gradient.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:platform,View:'View'},
    'expo-linear-gradient':{LinearGradient:'ExpoGradient'},'@/lib/burrow-surface':model,
  },{nativeFabricUIManager:{}});
  const props={colors:model.ADVENTURE_PROGRESS_COLORS,style};
  const first=h.render(()=>NativeVerticalGradient(props)),second=h.render(()=>NativeVerticalGradient(props));
  assert.equal(first.type,'View');assert.equal(first.props.style[0],style);assert.equal(first.props.style[1],second.props.style[1]);
  assert.equal(first.props.pointerEvents,'none');assert.equal(first.props.accessible,false);
  for(const os of ['android','web']){platform.OS=os;const tree=h.render(()=>NativeVerticalGradient(props));
    assert.equal(tree.type,'ExpoGradient');assert.equal(tree.props.colors,props.colors);assert.equal(tree.props.style,style);assert.equal(tree.props.pointerEvents,'none');}
  h.unmount();
  const legacyHooks=hooks(),legacy=load('apps/mobile/src/components/burrow/native-vertical-gradient.tsx',{
    react:legacyHooks.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:'ios'},View:'View'},
    'expo-linear-gradient':{LinearGradient:'ExpoGradient'},'@/lib/burrow-surface':model,
  });
  assert.equal(legacyHooks.render(()=>legacy.NativeVerticalGradient(props)).type,'ExpoGradient','legacy iOS clients keep their supported gradient path');legacyHooks.unmount();
});

test('ongoing progress updates only the orange SVG surface, not the retained earth strokes',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-digging-route.tsx','utf8');
  const bed=source.slice(source.indexOf('const TunnelBed='),source.indexOf('function DirtParticle'));
  assert.match(bed,/memo\(function TunnelBed/);assert.equal((bed.match(/<Path /g)||[]).length,2);
  assert.doesNotMatch(bed,/animatedProps|shown\.value|progress\.value/);
  const foreground=source.slice(source.indexOf('<TunnelBed id={id}/>'));
  assert.equal((foreground.match(/<AnimatedPath /g)||[]).length,1);
  assert.doesNotMatch(foreground,/<Path /);
  assert.match(foreground,/strokeDasharray=\{\[DIGGING_PATH_LENGTH,DIGGING_PATH_LENGTH\]\}/);
});

test('a paused preloaded Adventure seeks current time on its first focused render, before effects/ticks run',()=>{
  const ts=require('typescript'),source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),declarations=new Map();
  const visit=node=>{if(ts.isVariableDeclaration(node)&&['renderClock','now'].includes(node.name.getText(ast)))declarations.set(node.name.getText(ast),node.getText(ast));ts.forEachChild(node,visit);};visit(ast);
  assert.equal(declarations.size,2);
  const server=Date.parse('2026-10-19T10:00:00Z'),context={focused:false,section:'adventure',clock:1000,receivedAt:1000,data:{serverNow:new Date(server).toISOString()},burrowClock:()=>241000,Date,Math};
  const code=`const ${declarations.get('renderClock')};const ${declarations.get('now')};now;`;
  assert.equal(vm.runInNewContext(code,context),server+240000,'hidden cache renders must use the same current clock, without enabling a hidden timer');
  context.focused=true;assert.equal(vm.runInNewContext(code,{...context}),server+240000);
  context.section='home';assert.equal(vm.runInNewContext(code,{...context}),server,'other screens keep their existing timer cadence');
});

test('separating static tunnel and orange surface preserves the painted route across screen sizes and progress',async()=>{
  const sharp=require('node:module').createRequire(require.resolve('next/package.json',{paths:[path.resolve('apps/api')]}))('sharp');
  const {DIGGING_PATH:d,DIGGING_PATH_LENGTH:length}=load('apps/mobile/src/lib/adventure-digging-path.ts');
  const defs='<defs><linearGradient id="earth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#884724"/><stop offset="1" stop-color="#71391E"/></linearGradient><linearGradient id="dug" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF881C"/><stop offset="1" stop-color="#FF9824"/></linearGradient></defs>';
  const base=`<path d="${d}" fill="none" stroke="#5B2C13" stroke-width="72" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="url(#earth)" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>`;
  for(const width of [280,390,486]){
    const height=Math.round(width*440/486),svg=body=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 486 440">${defs}${body}</svg>`);
    const bed=await sharp(svg(base)).png().toBuffer();
    for(const progress of [0,.02,.31,.5,.87,1]){
      const orange=`<path d="${d}" fill="none" stroke="url(#dug)" stroke-width="56" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="${length} ${length}" stroke-dashoffset="${length*(1-progress)}" opacity="${progress>0?1:0}"/>`;
      const single=await sharp(svg(base+orange)).png().toBuffer(),overlay=await sharp(svg(orange)).png().toBuffer();
      const background={create:{width,height,channels:4,background:'#2C0D00'}};
      const before=await sharp(background).composite([{input:single}]).raw().toBuffer();
      const after=await sharp(background).composite([{input:bed},{input:overlay}]).raw().toBuffer();
      let maximum=0,total=0;for(let i=0;i<before.length;i++){const delta=Math.abs(before[i]-after[i]);maximum=Math.max(maximum,delta);total+=delta;}
      assert.ok(maximum<=2&&total/before.length<.03,`8-bit edge compositing: width=${width}, p=${progress}, max=${maximum}, mean=${total/before.length}`);
    }
  }
});
