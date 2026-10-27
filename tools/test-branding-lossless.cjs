const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {load}=require('./lifecycle-test-utils.cjs');
const {sharp,optimize,decoded}=require('../apps/mobile/plugins/branding-assets.cjs');
const root=path.resolve(__dirname,'../apps/mobile');
const config=require('../apps/mobile/app.json').expo;
test('store and Splash exports have exact channel dimensions, real formats and source receipts',async()=>{
  const manifest=require('../apps/mobile/assets/branding/manifest.json');
  const source=fs.readFileSync(path.join(root,'assets/icon.png'));
  const original=await sharp(source).metadata();assert.equal(original.width,1024);assert.equal(original.height,1024);assert.equal(original.hasAlpha,false);
  const pixels=await decoded(fs.readFileSync(path.join(root,'assets/icon-transparent.png'))),crypto=require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(pixels.data).digest('hex'),manifest.source.pixelSha256);
  for(const [name,size,alpha]of[['google-play-512.png',512,false],['splash-logo.png',560,true],['favicon-32.png',32,false],['android-adaptive-foreground.png',432,true]]){
    const file=path.join(root,'assets/branding',name),bytes=fs.readFileSync(file),meta=await sharp(bytes).metadata();
    assert.equal(meta.format,'png');assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,alpha);
    const entry=manifest.channels.find(row=>row.path===name);assert.equal(entry.bytes,bytes.length);
    assert.equal(entry.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
    if(name.startsWith('google-play'))assert.ok(bytes.length<=1024*1024);
  }
  assert.equal(config.web.favicon,'./assets/branding/favicon-32.png');
  assert.equal(manifest.background,'#3f150b');
});
test('lossless optimization is pixel-identical, dimension-preserving and repeatable',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'novame-branding-lossless-test-'));
  try{
    const file=path.join(dir,'test.png');
    const before=await sharp({create:{width:120,height:120,channels:4,background:{r:63,g:21,b:11,alpha:1}}}).png({compressionLevel:0}).toBuffer();
    fs.writeFileSync(file,before);const first=await optimize(file),after=fs.readFileSync(file);
    assert.ok(after.length<before.length);assert.ok((await decoded(before)).data.equals((await decoded(after)).data));
    const second=await optimize(file);assert.equal(second.bytes,first.bytes);assert.deepEqual(fs.readFileSync(file),after);
    const webp=path.join(dir,'launcher.webp');fs.writeFileSync(webp,before);await optimize(webp);
    assert.equal((await sharp(webp).metadata()).format,'webp');
    assert.ok((await decoded(fs.readFileSync(webp))).data.equals((await decoded(before)).data));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bunny ear highlights fit the adaptive icon 66dp safe circle',async()=>{
  const {data,width}=await decoded(fs.readFileSync(path.join(root,'assets/branding/android-adaptive-foreground.png')));
  assert.equal(width,432);let earPixels=0;
  for(let y=72;y<216;y++)for(let x=72;x<360;x++){
    const i=(y*width+x)*4;
    if(data[i+3]>240&&data[i]>210&&data[i+1]>150&&data[i+2]>100){
      earPixels++;assert.ok((x-216)**2+(y-216)**2<=132**2,'ear detail outside safe zone');
    }
  }
  assert.ok(earPixels>1000);
});
test('clean EAS prebuilds optimize only after native generation on both platforms',async()=>{
  const mods=[],calls=[];
  const plugin=load('apps/mobile/plugins/with-mobile-branding.js',{
    'expo/config-plugins':{withFinalizedMod:(config,[platform,action])=>{mods.push({platform,action});return config;}},
    './branding-assets.cjs':{validateBrandingColors:()=>{},optimizeNativeBranding:async(root,platform)=>calls.push({root,platform}),writeAndroidIcons:async()=>calls.push({regeneratedLegacyAndAdaptive:true})},
  });
  plugin({});assert.deepEqual(mods.map(m=>m.platform),['ios','android']);
  for(const mod of mods){const context={modRequest:{projectRoot:'/test/project'}};assert.equal(await mod.action(context),context);}
  assert.deepEqual(calls,[{root:'/test/project',platform:'ios'},{regeneratedLegacyAndAdaptive:true},{root:'/test/project',platform:'android'}]);
  assert.equal(config.plugins.at(-1),'./plugins/with-mobile-branding');
  const ignore=fs.readFileSync('.easignore','utf8');assert.doesNotMatch(ignore,/^apps\/mobile\/plugins\//m);
});
