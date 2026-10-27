const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const {load}=require('./lifecycle-test-utils.cjs'),{faceMask,generate}=require('./generate-plushie-face-masks.cjs');
const masks=require('../apps/mobile/src/lib/generated/plushie-face-masks.json');
const lib=load('apps/mobile/src/lib/plushie-face-mask.ts',{'./generated/plushie-face-masks.json':masks});
const file='apps/mobile/src/lib/burrow-art-assets.ts',imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(file),m[2])]));
const toys=load(file,imports).BURROW_ART.couple_dolls;
const sharp=createRequire(createRequire(path.resolve('apps/api/package.json')).resolve('next/package.json'))('sharp');
test('all 33 alpha-derived masks cover every existing face pixel and zero exterior transparent pixels',async()=>{
 assert.equal(Object.keys(masks).length,33);let leaky=0;
 for(const toy of toys){
  const bytes=fs.readFileSync(toy.source),mask=lib.plushieFaceMask(toy);assert.ok(mask,toy.name);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),mask.sourceSha256,'bundled image bytes remain unchanged');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}),shape=faceMask(data,info.width,info.height,toy.photoBounds);
  const svg=Buffer.from(`<svg width="${mask.width}" height="${mask.height}"><path d="${mask.path}" fill="white"/></svg>`);
  const raster=await sharp(svg).ensureAlpha().raw().toBuffer();const [l,t,r,b]=toy.photoBounds;let oldLeaks=0;
  for(let y=t;y<b;y++)for(let x=l;x<r;x++){
   const p=y*info.width+x,a=raster[((y-t)*mask.width+x-l)*4+3];
   if(shape.face[p])assert.equal(a,255,`${toy.name} face was cut at ${x},${y}`);
   if(!shape.face[p]&&data[p*4+3]<16){oldLeaks++;assert.equal(a,0,`${toy.name} exposed background at ${x},${y}`);}
  }
  if(oldLeaks)leaky++;
 }
 assert.equal(leaky,16);
 assert.equal(await generate(),fs.readFileSync('apps/mobile/src/lib/generated/plushie-face-masks.json','utf8'));
});
test('geometry is only applied to the matching costume canvas and photo bounds',()=>{
 const toy=toys.find(t=>t.name==='Super Hero');assert.ok(lib.plushieFaceMask(toy));
 assert.equal(lib.plushieFaceMask({...toy,width:600}),null);
 assert.equal(lib.plushieFaceMask({...toy,photoBounds:[0,0,100,100]}),null);
 assert.equal(lib.plushieFaceMask({...toy,name:'Unknown'}),null);
});
test('native mask clips only SVG primitives, keeps shared photo resolver and fingertip-free camera placeholder',()=>{
 let seq=0;const jsx=(type,props)=>({type,props});const {PlushieFaceMask}=load('apps/mobile/src/components/burrow/plushie-face-mask.tsx',{
  react:{useId:()=>':id'+(++seq)+':'},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View'},
  'react-native-svg':{__esModule:true,default:'Svg',ClipPath:'ClipPath',Defs:'Defs',G:'G',Rect:'Rect',SvgXml:'SvgXml',Image:'SvgImage',Path:'Path'},
  '@/lib/plushie-face-mask':lib,
  '@/lib/use-room-photo-uri':{useRoomPhotoResource:photo=>({uri:photo?'file:///private-face.jpg':null})},
  '@/lib/room-photo-placeholder-art':{roomPhotoPlaceholderSvg:()=>'<svg/>'},
 });
 const asset=toys.find(t=>t.name==='Super Hero');
 const a=PlushieFaceMask({asset,photo:{id:'photo',updatedAt:'version'},width:80,height:70}),b=PlushieFaceMask({asset,placeholder:true});
 const [defs,group]=a.props.children,id=defs.props.children.props.id;
 assert.equal(group.type,'G');assert.equal(group.props.clipPath,`url(#${id})`);
 const face=group.props.children.find(x=>x?.type==='SvgImage');assert.equal(face.props.href.uri,'file:///private-face.jpg');
 assert.equal(face.props.width,80);assert.equal(face.props.height,70);
 assert.ok(b.props.children[1].props.children.some(x=>x?.type==='SvgXml'));
 const crop=PlushieFaceMask({asset,sourceUri:'draft',imageRect:{x:-5,y:2,width:120,height:140}}).props.children[1].props.children.at(-1);
 assert.equal(crop.props.x,-5);assert.equal(crop.props.height,140);assert.equal(crop.props.href.uri,'draft');
 assert.notEqual(id,b.props.children[0].props.children.props.id);
});
test('Skia photo composition intersects the face mask and restores clipping before original costume',()=>{
 const ts=require('typescript'),vm=require('node:vm'),source=fs.readFileSync('apps/mobile/src/components/burrow/localized-toy.tsx','utf8');
 const ast=ts.createSourceFile('toy.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='composeTexture').getText(ast),calls=[];
 const canvas={clear(){},scale(){},save:()=>calls.push('save'),restore:()=>calls.push('restore'),clipPath:(_p,op)=>calls.push(['clip',op]),drawImageRect:()=>calls.push('face'),drawImage:()=>calls.push('costume')};
 const image={makeNonTextureImage(){return this;}},context={exports:{},plushieFaceMask:lib.plushieFaceMask,dollFaceBounds:a=>a.photoBounds,ClipOp:{Intersect:1},
  Skia:{Color:x=>x,Paint:()=>({}),Path:{MakeFromSVGString:d=>({offset:(x,y)=>calls.push(['offset',x,y])})},Surface:{Make:()=>({getCanvas:()=>canvas,flush(){},makeImageSnapshot:()=>image})}}};
 vm.runInNewContext(ts.transpileModule(fn+';exports.compose=composeTexture;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 const asset=toys.find(t=>t.name==='Super Hero');assert.equal(context.exports.compose({}, {width:()=>512,height:()=>512},asset,100),image);
 assert.deepEqual(calls,['save',['offset',255,191],['clip',1],'face','restore','costume']);
});
