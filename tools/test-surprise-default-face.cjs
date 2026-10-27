const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const geometry=require('../apps/mobile/src/lib/surprise-frame-geometry.json');
const photoGeometry=load('apps/mobile/src/lib/surprise-photo-geometry.ts');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const names=Object.fromEntries(['Circle','Defs','Ellipse','G','Image','LinearGradient','Path','Polygon','Stop','ClipPath','Mask','Rect'].map(name=>[name,name]));
let serial=0;
const {SurprisePortrait}=load('apps/mobile/src/components/burrow/surprise-art.tsx',{
  react:{useId:()=>`face${++serial}`},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native-svg':{__esModule:true,default:'Svg',...names},
  'react-native':{View:'View',StyleSheet:{absoluteFill:{}}},'./burrow-image':{Image:'FrameBitmap'},
  '@/lib/surprise-frame-assets':{SURPRISE_DEFAULT_FACE:777,SURPRISE_FRAME_OPTIONS:Object.keys(geometry).map(id=>({id,name:id,source:`art:${id}`}))},
  '@/lib/surprise-frame-geometry.json':geometry,'@/lib/surprise-photo-geometry':photoGeometry,
});
test('all current frames use the local default face beneath original art with their individual cutout positions',()=>{
  const placements=[];
  for(const [frame,hole] of Object.entries(geometry)){
    const tree=SurprisePortrait({frame,size:230});
    const image=nodes(tree).find(n=>n.type==='Image'),clip=nodes(tree).find(n=>n.type==='ClipPath');
    assert.equal(image.props.href,777,frame);
    assert.equal(image.props.preserveAspectRatio,'xMidYMid slice');
    assert.equal(image.props.clipPath,`url(#${clip.props.id})`);
    assert.equal(clip.props.children.props.d,hole.path);
    const [x,y,w,h]=hole.bounds;
    assert.ok(Math.abs(image.props.x+image.props.width/2-(x+w/2))<1e-8,frame);
    assert.ok(Math.abs(image.props.y+image.props.height/2-(y+h/2))<1e-8,frame);
    assert.equal(image.props.width,image.props.height,'do not distort the default face');
    for(const point of hole.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)){
      const distance=Math.hypot(Number(point[1])-(x+w/2),Number(point[2])-(y+h/2));
      assert.ok(distance<=image.props.width*.425+1e-8,'transparent photo margins must stay outside the opening: '+frame);
    }
    assert.equal(tree.props.children.at(-1).type,'FrameBitmap','frame remains above the face');
    assert.equal(nodes(tree).some(n=>n.type==='Path'&&n.props.fill),false,'no solid-color placeholder');
    placements.push([image.props.x,image.props.y,image.props.width].join(':'));
  }
  assert.ok(new Set(placements).size>=30,'not one universal face position');
});
test('uploaded user faces keep their existing exact crop; camera view never renders the default',()=>{
  for(const [frame,hole] of Object.entries(geometry)){
    const image=nodes(SurprisePortrait({frame,uri:'file:///user-photo.jpg'})).find(n=>n.type==='Image');
    assert.equal(image.props.href.uri,'file:///user-photo.jpg');
    const [x,y,width,height]=hole.bounds;
    assert.deepEqual([image.props.x,image.props.y,image.props.width,image.props.height],[x,y,width,height]);
    const camera=SurprisePortrait({frame,transparentCenter:true});
    assert.equal(nodes(camera).some(n=>n.type==='Image'),false,frame);
    assert.equal(nodes(camera).some(n=>n.type==='Path'&&n.props.fill),false,frame);
  }
});
test('retired and unknown IDs show only the photo, never an old frame or a mapped current frame',()=>{
  for(const frame of ['bunny','flower','star','halloween','autumn_pumpkin','birthday_cake','not-a-frame','__proto__']){
    for(const props of [{},{uri:'private-photo.jpg'},{uri:'private-photo.jpg',portraitUri:'private-photo.jpg'},{transparentCenter:true}]){
      const tree=SurprisePortrait({frame,...props}),image=nodes(tree).find(n=>n.type==='FrameBitmap');
      if(props.transparentCenter)assert.equal(image,undefined);
      else if(props.uri)assert.equal(image.props.source.uri,props.uri);
      else assert.equal(image.props.source,777);
      assert.equal(nodes(tree).some(n=>n.type==='Svg'),false);
      assert.equal(nodes(tree).some(n=>typeof n.props?.source==='string'&&n.props.source.startsWith('art:')),false);
    }
  }
});
test('default-face is a bundled preview, not an uploaded picture or an additional selectable frame',()=>{
  const source=fs.readFileSync('apps/mobile/src/lib/surprise-frame-assets.ts','utf8');
  assert.match(source,/SURPRISE_DEFAULT_FACE\s*=\s*require\('\.\.\/\.\.\/assets\/burrow-webp\/surprise-room\/default-face\.webp'\)/);
  assert.equal((source.match(/id:["']/g)||[]).length,36);
  const camera=fs.readFileSync('apps/mobile/src/components/burrow/surprise-camera.tsx','utf8');
  assert.match(camera,/<SurprisePortrait frame=\{frame\} size=\{frameSize\} transparentCenter\/>/);
  const screen=fs.readFileSync('apps/mobile/src/components/burrow/surprise-room-screen.tsx','utf8');
  assert.doesNotMatch(screen,/SURPRISE_DEFAULT_FACE|default-face/,'draft/upload must only use the real photo');
});
