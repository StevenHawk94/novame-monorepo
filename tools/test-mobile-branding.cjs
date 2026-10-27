const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../apps/mobile');
const config = require('../apps/mobile/app.json').expo;
const mobileRequire = createRequire(path.join(root, 'package.json'));
const prebuildRequire = createRequire(createRequire(mobileRequire.resolve('expo-splash-screen/plugin/build/withSplashScreen')).resolve('@expo/prebuild-config/package.json'));
const utils = prebuildRequire('@expo/image-utils');
const parsePng = createRequire(prebuildRequire.resolve('@expo/image-utils'))('parse-png');
const { decoded, sharp, BACKGROUND, validateBrandingColors, prepareBrandingAssets, notificationIconPng } = require('../apps/mobile/plugins/branding-assets.cjs');
const icon = path.join(root, config.icon), backgroundColor = '#3f150b';
const master = path.join(root, 'assets/icon-transparent.png');
const splash = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
const exists = p => fs.existsSync(path.join(root, p));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
async function image(width, options = {}) {
  // Generate fresh expectations: Expo's cache key does not include radius,
  // so sharing a test cache across square/round variants would mask errors.
  return (await utils.generateImageAsync({ projectRoot: root }, {
    src: icon, width, height: width, ...options,
  })).source;
}
async function pixels(file, expected) {
  const [actualPng, expectedPng] = await Promise.all([decoded(fs.readFileSync(path.join(root, file))), decoded(expected)]);
  assert.equal(actualPng.width, expectedPng.width, file);
  assert.equal(actualPng.height, expectedPng.height, file);
  assert.deepEqual(actualPng.data, expectedPng.data, 'Generated pixels must match current icon.png: ' + file);
}
test('native and JS splash share new icon and exact background; Android launcher no longer references old art', () => {
  assert.equal(config.icon, './assets/icon.png');
  assert.equal(config.splash.image, './assets/branding/splash-logo.png'); assert.equal(config.splash.backgroundColor, backgroundColor);
  assert.equal(splash.image, config.splash.image); assert.equal(splash.backgroundColor, backgroundColor);
  assert.equal(splash.android.image, config.splash.image); assert.equal(splash.android.backgroundColor, backgroundColor);
  assert.equal(config.android.adaptiveIcon.foregroundImage, './assets/branding/android-adaptive-foreground.png');
  assert.equal(config.android.adaptiveIcon.backgroundColor, backgroundColor);
  assert.match(read('src/lib/burrow-onboarding-design.ts'), /BURROW_LAUNCH_BACKGROUND = '#3f150b'/);
  assert.match(read('src/lib/burrow-onboarding-design.ts'), /BURROW_LAUNCH_LOGO = require\('\.\.\/\.\.\/assets\/branding\/splash-logo.png'\)/);
  assert.equal(splash.imageWidth, 140); // Do not change hand-off size or startup behavior.
  assert.match(read('src/components/main/burrow-launch-screen.tsx'), /const size = 140/);
  assert.equal(require('../apps/mobile/targets/widget/expo-target.config.js').icon, '../../assets/icon.png');
});
test('transparent master is sufficient: opaque app icon is its exact composite on the fixed brand colour', async () => {
  const metadata=await sharp(master).metadata();
  assert.equal(metadata.width,1024);assert.equal(metadata.height,1024);assert.equal(metadata.hasAlpha,true);
  assert.equal((await sharp(master).stats()).isOpaque,false);
  const expected=await sharp(master).flatten({background:BACKGROUND}).removeAlpha().png().toBuffer();
  await pixels('assets/icon.png',expected);
  const {data,info}=await sharp(icon).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.channels,3,'App Store source has no alpha channel');
  for(const [x,y] of [[0,0],[1023,0],[0,1023],[1023,1023]])
    assert.deepEqual([...data.subarray((y*1024+x)*3,(y*1024+x)*3+3)],[63,21,11]);
  const manifest=JSON.parse(read('assets/branding/manifest.json'));
  assert.equal(manifest.source.path,'../icon-transparent.png');assert.equal(manifest.background,BACKGROUND);
});
test('Splash keeps transparent edges and the master proportions, not a baked square background', async () => {
  const file=path.join(root,splash.image),metadata=await sharp(file).metadata();
  assert.equal(metadata.hasAlpha,true);assert.equal(metadata.width,560);assert.equal(metadata.height,560);
  const expected=await sharp(master).resize(560,560,{fit:'contain'}).ensureAlpha().png().toBuffer();
  await pixels(splash.image,expected);
  const {data}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const [x,y] of [[0,0],[559,0],[0,559],[559,559]])assert.equal(data[(y*560+x)*4+3],0);
});
test('Android uses transparent foreground artwork, without the old coloured square inside the padded layer', async () => {
  const file=path.join(root,config.android.adaptiveIcon.foregroundImage);
  const art=await sharp(master).resize(288,288).png().toBuffer();
  const expected=await sharp({create:{width:432,height:432,channels:4,background:{r:63,g:21,b:11,alpha:0}}})
    .composite([{input:art,left:72,top:72}]).png().toBuffer();
  await pixels(config.android.adaptiveIcon.foregroundImage,expected);
  const {data}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(data[(80*432+80)*4+3],0,'transparent margin remains transparent inside the artwork canvas');
});
test('background is locked across platforms; different Android/dark colours or background art are rejected', () => {
  validateBrandingColors(config);
  for(const mutate of [c=>c.android.adaptiveIcon.backgroundColor='#ffffff',c=>c.android.adaptiveIcon.backgroundImage='./another-background.png',
    c=>c.splash.backgroundColor='#000000',c=>c.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-splash-screen')[1].android.backgroundColor='#fff',
    c=>c.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-splash-screen')[1].dark={backgroundColor:'#000000'}]){
    const changed=structuredClone(config);mutate(changed);assert.throws(()=>validateBrandingColors(changed));
  }
});
test('generation needs only the transparent master and is reproducible without an existing opaque icon', async () => {
  const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'novame-transparent-branding-test-'));
  try{
    fs.mkdirSync(path.join(directory,'assets'));fs.copyFileSync(master,path.join(directory,'assets/icon-transparent.png'));
    const first=await prepareBrandingAssets(directory),second=await prepareBrandingAssets(directory);
    assert.equal(first.source.pixelSha256,second.source.pixelSha256);
    assert.equal(first.icon.sha256,second.icon.sha256);
    assert.deepEqual(first.generated.map(g=>g.sha256),second.generated.map(g=>g.sha256));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('iOS main icon is opaque 1024×1024 art derived from latest source', { skip: !exists('ios/Burrow/Images.xcassets') }, async () => {
  const folder = 'ios/Burrow/Images.xcassets/AppIcon.appiconset';
  const manifest = JSON.parse(read(folder + '/Contents.json'));
  assert.equal(manifest.images[0].size, '1024x1024');
  await pixels(folder + '/' + manifest.images[0].filename, await image(1024, {
    removeTransparency: true, resizeMode: 'cover', backgroundColor: '#ffffff',
  }));
  const png = await parsePng(fs.readFileSync(path.join(root, folder, manifest.images[0].filename)));
  for (let i = 3; i < png.data.length; i += 4) assert.equal(png.data[i], 255);
});
test('Android notification is the current logo alpha mask, not the old bunny or a coloured square', async () => {
  const notification = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-notifications')[1];
  assert.equal(notification.icon, './assets/notification-icon.png');
  await pixels(notification.icon, await notificationIconPng(master));
  const {data,width,height} = await decoded(fs.readFileSync(path.join(root,notification.icon)));
  assert.equal(width,96); assert.equal(height,96);
  let visible=0, transparent=0;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]){visible++;assert.deepEqual([...data.subarray(i,i+3)],[255,255,255]);}
    else transparent++;
  }
  assert.ok(visible>1000 && transparent>4000, 'readable silhouette with transparent safe margin');
  const entry=JSON.parse(read('assets/branding/manifest.json')).channels.find(c=>c.path==='../notification-icon.png');
  assert.equal(entry.sha256,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,notification.icon))).digest('hex'));
});
test('all Android push and local notification densities use the new mask', {skip:!exists('android/app/src/main/res')}, async()=>{
  for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
    await pixels(`android/app/src/main/res/drawable-${density}/notification_icon.png`,await image(24*scale,{
      src:path.join(root,'assets/notification-icon.png'),resizeMode:'cover',backgroundColor:'transparent',
    }));
  }
  const manifest=read('android/app/src/main/AndroidManifest.xml');
  for(const name of ['com.google.firebase.messaging.default_notification_icon','expo.modules.notifications.default_notification_icon'])
    assert.ok(manifest.includes(`android:name="${name}" android:resource="@drawable/notification_icon"`));
});
test('all iOS splash densities use the new source and matching named/storyboard colours', { skip: !exists('ios/Burrow/Images.xcassets') }, async () => {
  for (const ratio of [1, 2, 3]) {
    await pixels(`ios/Burrow/Images.xcassets/SplashScreenLogo.imageset/image${ratio === 1 ? '' : '@' + ratio + 'x'}.png`, await image(140 * ratio, {src:path.join(root,splash.image)}));
  }
  const components = JSON.parse(read('ios/Burrow/Images.xcassets/SplashScreenBackground.colorset/Contents.json')).colors[0].color.components;
  for (const [channel, value] of Object.entries({ red: 63, green: 21, blue: 11 })) assert.equal(Math.round(Number(components[channel]) * 255), value);
  const storyboard = read('ios/Burrow/SplashScreen.storyboard');
  assert.match(storyboard, /green="0\.0823529411764706" red="0\.247058823529412"/);
  assert.match(read('ios/Burrow.xcodeproj/project.pbxproj'), /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
});
test('Android legacy, round and adaptive launcher images at every density use new art', { skip: !exists('android/app/src/main/res') }, async () => {
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const folder = `android/app/src/main/res/mipmap-${density}`;
    for (const name of ['ic_launcher.webp','ic_launcher_round.webp','ic_launcher_foreground.webp'])
      assert.equal((await sharp(path.join(root,folder,name)).metadata()).format,'webp','native suffix must match actual format');
    await pixels(folder + '/ic_launcher.webp', await image(48 * scale, { resizeMode: 'cover', backgroundColor }));
    await pixels(folder + '/ic_launcher_round.webp', await image(48 * scale, { resizeMode: 'cover', backgroundColor, borderRadius: 24 * scale }));
    await pixels(folder + '/ic_launcher_foreground.webp', await image(108 * scale, {src:path.join(root,config.android.adaptiveIcon.foregroundImage), resizeMode: 'cover', backgroundColor: 'transparent' }));
  }
  const colors = read('android/app/src/main/res/values/colors.xml');
  for (const name of ['splashscreen_background', 'iconBackground']) assert.ok(colors.includes(`<color name="${name}">${backgroundColor}</color>`));
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android:icon="@mipmap\/ic_launcher"/);
});
test('Android splash composition preserves 140dp logo and correct background at all densities', { skip: !exists('android/app/src/main/res') }, async () => {
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const background = await utils.generateImageBackgroundAsync({ width: 288 * scale, height: 288 * scale, backgroundColor, resizeMode: 'cover' });
    const foreground = await image(140 * scale, { src:path.join(root,splash.image), resizeMode: 'contain' });
    const expected = await utils.compositeImagesAsync({ background, foreground, x: 74 * scale, y: 74 * scale });
    await pixels(`android/app/src/main/res/drawable-${density}/splashscreen_logo.png`, expected);
  }
});
test('widget icon catalog cannot retain the previous app artwork', async () => {
  const folder = 'targets/widget/Assets.xcassets/AppIcon.appiconset';
  const manifest = JSON.parse(read(folder + '/Contents.json')), checked = new Set();
  for (const entry of manifest.images) {
    if (checked.has(entry.filename)) continue; checked.add(entry.filename);
    const size = Number(entry.size.split('x')[0]) * Number(entry.scale.replace('x', ''));
    await pixels(folder + '/' + entry.filename, await image(size, { resizeMode: 'cover', removeTransparency: true, backgroundColor: '#ffffff' }));
  }
  assert.ok(checked.size >= 15);
});
