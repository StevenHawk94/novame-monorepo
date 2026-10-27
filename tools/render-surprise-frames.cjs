// Visual QA of the actual portrait component; supplied WebP files are read-only.
const path=require('node:path'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const next=path.dirname(require.resolve('next/package.json',{paths:[path.resolve('apps/admin')]}));
const sharp=require(require.resolve('sharp',{paths:[next]}));
const jsx=(type,props)=>({type,props});let serial=0;
const names={default:'svg',Circle:'circle',Defs:'defs',Ellipse:'ellipse',G:'g',Image:'image',LinearGradient:'linearGradient',Path:'path',Polygon:'polygon',Stop:'stop',ClipPath:'clipPath',Mask:'mask',Rect:'rect'};
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
async function run(){
 const geometry=require('../apps/mobile/src/lib/surprise-frame-geometry.json');
 const source=fs.readFileSync('apps/mobile/src/lib/surprise-frame-assets.ts','utf8');
 const files=[...source.matchAll(/id:'([^']+)'[^\n]+name:'([^']+)'[^\n]+require\('([^']+)'\)/g)];
 const options=await Promise.all(files.map(async ([,id,name,file])=>({id,name,source:{uri:'data:image/png;base64,'+(await sharp(path.resolve('apps/mobile/src/lib',file)).png().toBuffer()).toString('base64')}})));
 const defaultFile=source.match(/SURPRISE_DEFAULT_FACE = require\('([^']+)'\)/)[1];
 const defaultFace={uri:'data:image/png;base64,'+(await sharp(path.resolve('apps/mobile/src/lib',defaultFile)).png().toBuffer()).toString('base64')};
 const mode=process.argv[3]||'uploaded';
 const fixture=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EAB994"/><path d="M0 0H256V45Q128 10 0 65Z" fill="#5C3524"/><circle cx="83" cy="105" r="9" fill="#4A2917"/><circle cx="173" cy="105" r="9" fill="#4A2917"/><path d="M84 156Q128 204 172 156" fill="none" stroke="#B45949" stroke-width="10"/><text x="128" y="236" text-anchor="middle" font-size="20" fill="#4A2917">CROP CHECK</text></svg>')).png().toBuffer();
 const fixtureUri='data:image/png;base64,'+fixture.toString('base64');
 const art=load('apps/mobile/src/components/burrow/surprise-art.tsx',{
  react:{useId:()=>`qa${++serial}`},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'react-native-svg':{__esModule:true,...names},
  'react-native':{View:'view',StyleSheet:{absoluteFill:{}}},'./burrow-image':{Image:'bitmap'},
  '@/lib/surprise-frame-assets':{SURPRISE_FRAME_OPTIONS:options,SURPRISE_DEFAULT_FACE:defaultFace},'@/lib/surprise-frame-geometry.json':geometry,
  '@/lib/surprise-photo-geometry':load('apps/mobile/src/lib/surprise-photo-geometry.ts'),
 });
 function svg(node,size=220){
  if(node==null||node===false)return '';
  if(Array.isArray(node))return node.map(value=>svg(value,size)).join('');
  if(typeof node.type==='function')return svg(node.type(node.props),size);
  if(node.type==='fragment')return svg(node.props.children,size);
  if(node.type==='view')return '<g>'+svg(node.props.children,node.props.style.width||size)+'</g>';
  if(node.type==='bitmap')return '<image href="'+node.props.source.uri+'" width="'+size+'" height="'+size+'"/>';
  const {children,accessibilityLabel,style,rotation,origin,...props}=node.props;
  if(rotation!=null)props.transform='rotate('+rotation+' '+String(origin).replace(',',' ')+')';
  if(props.href?.uri)props.href=props.href.uri;
  return '<'+node.type+' '+Object.entries(props).map(([key,value])=>key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()).replace('view-box','viewBox')+'="'+escape(value)+'"').join(' ')+'>'+svg(children,size)+'</'+node.type+'>';
 }
 const cells=options.map((option,index)=>'<g transform="translate('+(20+index%4*250)+' '+(20+Math.floor(index/4)*260)+')"><rect width="230" height="230" rx="20" fill="#482010"/>'+svg(art.SurprisePortrait({frame:option.id,uri:mode==='uploaded'?fixtureUri:undefined,transparentCenter:mode==='camera',size:220}))+'<text x="115" y="250" text-anchor="middle" font-family="Georgia" font-size="17" fill="#4A2917">'+option.name+'</text></g>').join('');
 const height=20+Math.ceil(options.length/4)*260;
 await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="'+height+'"><rect width="1020" height="'+height+'" fill="#FFF8EC"/>'+cells+'</svg>')).png().toFile(process.argv[2]||'/private/tmp/burrow-surprise-frames.png');
 console.log('Rendered '+options.length+' original frames through the actual portrait component ('+mode+').');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
