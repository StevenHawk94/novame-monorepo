// Targeted Expo asset generation for existing native checkouts. Never run
// prebuild --clean or rewrite native project/settings to refresh branding.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const os = require('node:os');
const root = path.resolve(__dirname, '../apps/mobile');
const mobileRequire = createRequire(path.join(root, 'package.json'));
const pluginRequire = createRequire(mobileRequire.resolve('expo-splash-screen/plugin/build/withSplashScreen'));
const prebuildRequire = createRequire(pluginRequire.resolve('@expo/prebuild-config/package.json'));
const { generateImageAsync } = prebuildRequire('@expo/image-utils');
const { prepareBrandingAssets, optimizeNativeBranding,writeAndroidIcons,validateBrandingColors } = require('../apps/mobile/plugins/branding-assets.cjs');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const splash = config.plugins.find(entry => Array.isArray(entry) && entry[0] === 'expo-splash-screen')[1];
assert.equal(config.icon, './assets/icon.png');
assert.equal(splash.image, './assets/branding/splash-logo.png'); assert.equal(config.android.adaptiveIcon.foregroundImage, './assets/branding/android-adaptive-foreground.png');
function retireLegacyAssets() {
  const names = ['adaptive-icon.png', 'splash-icon.png', 'splash.png', 'favicon.png'];
  const sources = [path.join(root,'app.json'),path.join(root,'package.json')];
  function scan(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())scan(file);else if(/\.(?:[cm]?js|tsx?|json)$/.test(entry.name))sources.push(file);
  } }
  for(const dir of ['app','src','plugins','targets'])scan(path.join(root,dir));
  for(const file of sources){const source=fs.readFileSync(file,'utf8');for(const name of names)
    assert.ok(!source.includes(name),'Still referenced: '+name+' in '+file);}
  const files=names.map(name=>path.join(root,'assets',name)).filter(file=>fs.existsSync(file));
  if(!files.length)return null;
  const backup=fs.mkdtempSync(path.join(os.tmpdir(),'novame-retired-branding-'));
  for(const file of files)fs.renameSync(file,path.join(backup,path.basename(file)));
  return {backup,files:files.map(file=>path.relative(root,file))};
}
async function sync() {
  // Expo's image cache resolves relative asset sources from the process cwd.
  process.chdir(root);
  validateBrandingColors(config);
  // Preserve the hand-supplied opaque export before making icon.png a derived
  // artifact, so the supplied original remains recoverable if needed.
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'novame-branding-original-'));
  for (const name of ['icon.png','icon-transparent.png']) fs.copyFileSync(path.join(root,'assets',name),path.join(backup,name));
  const prepared = await prepareBrandingAssets(root);
  let ios = false, android = false;
  if (fs.existsSync(path.join(root, 'ios/Burrow/Images.xcassets'))) {
    const { setIconsAsync } = prebuildRequire('./build/plugins/icons/withIosIcons');
    await setIconsAsync(config, root);
    const directory = path.join(root, 'ios/Burrow/Images.xcassets/SplashScreenLogo.imageset');
    assert.ok(fs.existsSync(directory));
    for (const ratio of [1, 2, 3]) {
      const { source } = await generateImageAsync({ projectRoot: root, cacheType: 'splash-ios' }, {
        src: splash.image, width: splash.imageWidth * ratio, height: splash.imageWidth * ratio,
      });
      fs.writeFileSync(path.join(directory, `image${ratio === 1 ? '' : '@' + ratio + 'x'}.png`), source);
    }
    ios = true;
  }
  if (fs.existsSync(path.join(root, 'android/app/src/main/res'))) {
    await writeAndroidIcons(root,config);
    const { getAndroidSplashConfig } = prebuildRequire('./build/plugins/unversioned/expo-splash-screen/getAndroidSplashConfig');
    const { setSplashImageDrawablesForThemeAsync } = prebuildRequire('./build/plugins/unversioned/expo-splash-screen/withAndroidSplashImages');
    const props = { ...splash, ...splash.android };
    await setSplashImageDrawablesForThemeAsync(getAndroidSplashConfig(config, props), 'light', root, props.imageWidth);
    android = true;
  }
  // The widget has its own checked-in icon catalogue. Refresh it from the
  // same source rather than shipping a stale second logo inside the app.
  const targetRequire = createRequire(mobileRequire.resolve('@bacons/apple-targets/package.json'));
  const { setIconsAsync: setWidgetIconsAsync } = targetRequire('./build/icon/with-ios-icon');
  await setWidgetIconsAsync(path.join(root, config.icon), root, path.join(root, 'targets/widget'), 'targets/widget', false);
  const optimized = [...await optimizeNativeBranding(root, 'ios'), ...await optimizeNativeBranding(root, 'android')];
  const retired = process.argv.includes('--retire-legacy') ? retireLegacyAssets() : null;
  console.log(JSON.stringify({ source: './assets/icon-transparent.png', generatedOpaqueIcon: config.icon, originalAssetsBackup: backup, splashBackground: splash.backgroundColor,
    iosAssetsRegenerated: ios, androidAssetsRegenerated: android, widgetAssetsRegenerated: true,
    sourceBeforeBytes: prepared.source.beforeBytes, sourceBytes: prepared.source.bytes,
    sourcePixelsUnchanged: true, opaqueIconBytes: prepared.icon.bytes, generatedChannels: prepared.generated.map(entry => ({...entry,path:path.relative(root,entry.path)})),
    nativeAssetsOptimized: optimized.length, nativeBeforeBytes: optimized.reduce((n,r)=>n+r.beforeBytes,0),
    nativeBytes: optimized.reduce((n,r)=>n+r.bytes,0),retired }));
}
sync().catch(error => { console.error(error); process.exitCode = 1; });
