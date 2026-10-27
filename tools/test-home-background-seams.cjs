const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {chunks,correctedAlpha,repair,files,hash}=require('./repair-home-background-alpha.cjs');
const {load}=require('./lifecycle-test-utils.cjs');
const sharp=createRequire(require.resolve('next/package.json',{paths:[path.resolve('apps/api')]}))('sharp');
const layout=load('apps/mobile/src/lib/burrow-home-layout.ts');
const directory='apps/mobile/assets/burrow-webp/room decoration/background-season';
// Hashes captured from the user-supplied files BEFORE their ALPH-only repair.
const originals={
 'autumn-day.webp':['adfde4d8f721a7e972c901c7a32a963a1737a8f7f840a92cedfbec7fdb4fbdbf','a69cefee44a65f2d811d257db435f7237e97366805ccda3ef018c1510a4cb142'],
 'autumn-night.webp':['38cff3cd9959eccb22f1f8462624b8f6f4406c04779fa98eeb5e94ea7537e767','b738b0ad99cb707fac7d95b2d9b43b4ef1fd1598c62f9bdcb222893f162f1b89'],
 'spring-day.webp':['f0a544e70c4dac5f3d04b6b141c1aa0e6e1c413695cfc2923819a0c6709f7a74','d51c81a9a241bf5d955c8b121652bd0059dbab7303966900408ce7e7484d423a'],
 'spring-night.webp':['6b72211ee98b9422bb67dc02258d01e3c1eb3b24e14ffc60a9e203159468be85','33ce102dba5e7489484b3f71a58c8eb16abb266431bcf228d329d99873c2a6fc'],
 'summer-day.webp':['4e82bda38ef6a761cbf354cbdf309c8ba84965859fc78727da7abba914554ea0','7a087c2242dd4cb84221a24b2d656e0b196139a01ee1e5ded99f60d139f91f48'],
 'summer-night.webp':['3cee432fe54a42b3d7361bc74789d303fd90be9d9f4c99405349935fb52f1832','d87cee3a219b2ce85301fcf886b15db9c792fa99fe8130cb6c643871104be94a'],
 'winter-day.webp':['44e7db1a50c44b88419a6140d7f324bc7d8986c651b420b9b2f0a586cfc504b1','07b5e7ae8a43fcea65f5af6a168b90edeef112a32a56111fc54f03be2bd82276'],
 'winter-night.webp':['da23c15919af7f2c7e57aba22994744c7fd963137511e91a09e52b025cee369f','a8c52cc15c1de5e9742da93a392a389b3769287ba2f35ad29ff657508fe4ebe5'],
};
test('alpha correction preserves transparent holes and curved antialiasing, fixing only export residue and solid side edges',()=>{
 const values=[0,1,127,128,149,249,250,254,255],rgba=Buffer.alloc(values.length*4);
 values.forEach((a,i)=>{rgba[i*4]=123;rgba[i*4+3]=a;});
 const result=correctedAlpha(rgba,values.length,1);
 assert.deepEqual(Array.from(result.alpha),[0,1,127,128,149,249,255,255,255]);
 assert.equal(rgba[6*4+3],250,'input buffer must remain untouched');
 const row=Buffer.from([50,20,10,150,50,20,10,253,50,20,10,150]);
 assert.deepEqual(Array.from(correctedAlpha(row,3,1).alpha),[255,255,255]);
 row[7]=0;assert.deepEqual(Array.from(correctedAlpha(row,3,1).alpha),[150,0,150],'do not bridge transparent openings');
 const darkEdge=Buffer.from([50,20,10,249,50,20,10,249,50,20,10,249]);
 assert.deepEqual(Array.from(correctedAlpha(darkEdge,3,1).alpha),[255,249,255],'near-opaque side residue must not remain as a one-pixel edge');
});
test('all eight headers retain exact colour payloads, canvas sizes and transparent silhouettes; solid side edges are opaque',async()=>{
 for(const name of files){
  const bytes=fs.readFileSync(path.join(directory,name)),parts=chunks(bytes);
  assert.equal(hash(parts.find(c=>c.type==='VP8 ').bytes),originals[name][0],name+' colour payload');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,800);assert.equal(info.height,560);
  const silhouette=Buffer.alloc(800*560);
  for(let i=0;i<silhouette.length;i++)silhouette[i]=data[i*4+3]>0?1:0;
  assert.equal(hash(silhouette),originals[name][1],name+' cave/silhouette');
  for(let y=0;y<400;y++)for(const x of [0,799])assert.equal(data[(y*800+x)*4+3],255,`${name} side ${x}/${y}`);
  assert.equal(correctedAlpha(data,800,560).changed,0,'no export residue remains');
  assert.ok((await repair(bytes)).bytes.equals(bytes),'repair must be byte-idempotent');
 }
});
test('floor artwork remains byte-identical; its edge fix belongs only to rendering',()=>{
 assert.equal(hash(fs.readFileSync(path.join(directory,'floor.webp'))),'39a16e0a2c564b9fcbe4b801e70359257e2ecc24088181a4902b5ebff49a842c');
});
test('native background rectangles fill the existing pixel grid without contain gaps, overscan or vertical geometry changes',()=>{
 const source=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
 const declaredFit={};
 for(const id of ['home-background-rim','home-background-floor']){
  const tag=source.match(new RegExp('<Image[^>]*testID="'+id+'"[^>]*>'))?.[0];
  assert.ok(tag,id);assert.match(tag,/contentFit="fill"/);assert.doesNotMatch(tag,/transform|translate|scale|cover|contain/);
  declaredFit[id.replace('home-background-','')]=tag.match(/contentFit="([^"]+)"/)[1];
 }
 const boxes=layout.homeBackgroundLayout();
 assert.deepEqual(JSON.parse(JSON.stringify(boxes)),{floor:{x:0,y:1185,width:900,height:765},rim:{x:0,y:-50,width:900,height:630}});
 for(const [w,h] of [[320,568],[375,667],[390,844],[393,852],[402,874],[414,896],[428,926],[430,932],[440,956],[768,1024],[1024,1366]])for(const dpr of [1,2,3]){
  const l=layout.homeArtLayout(w,h,0),canvasTop=h-1950*l.scale;
  for(const [name,b] of Object.entries(boxes)){
   const x0=Math.round(l.left*dpr),x1=Math.round((l.left+b.width*l.scale)*dpr);
   const y=canvasTop+b.y*l.scale,y0=Math.round(y*dpr),y1=Math.round((y+b.height*l.scale)*dpr);
   // Model native UIImageView aspectFit versus scaleToFill, using the actual
   // renderer prop above. A regression to contain must fail for rounded frames.
   const W=x1-x0,H=y1-y0,sourceHeight=name==='rim'?560:680;
   const factor=Math.min(W/800,H/sourceHeight);
   const fitted=declaredFit[name]==='fill'?{width:W,height:H}:{width:800*factor,height:sourceHeight*factor};
   assert.equal((W-fitted.width)/2,0,`${name}/${w}/${h}/${dpr} horizontal gap`);
   assert.equal((H-fitted.height)/2,0,`${name}/${w}/${h}/${dpr} vertical gap`);
   assert.ok(Math.abs(b.height*l.scale-(b===boxes.rim?630:765)*l.scale)<1e-10);
  }
 }
 const oldContainWidth=Math.min(1284/800,898/560)*800;
 assert.ok((1284-oldContainWidth)/2>.5,'regression reproduces the reported 428pt 3x edge gap');
});
test('ALPH-only repair rejects malformed containers rather than damaging source files',()=>{
 assert.throws(()=>chunks(Buffer.from('bad')),/Invalid WebP/);
 const b=Buffer.alloc(20);b.write('RIFF');b.writeUInt32LE(12,4);b.write('WEBP',8);b.write('ALPH',12);b.writeUInt32LE(99,16);
 assert.throws(()=>chunks(b),/Truncated chunk/);
});
