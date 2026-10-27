// Build-time transforms only. No quantization, palette reduction or lossy WebP.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const pluginRequire = createRequire(require.resolve('expo-splash-screen/plugin/build/withSplashScreen'));
const prebuildRequire = createRequire(pluginRequire.resolve('@expo/prebuild-config/package.json'));
// Explicit mobile build dependency: EAS excludes the Next.js apps, so never
// rely on their transitive Sharp installation being hoisted locally.
const sharp = (() => {
  try { return require('sharp'); }
  catch (error) {
    // Existing local pnpm links may predate the new explicit dependency. Use
    // the installed Expo build tool until dependencies are next installed;
    // clean EAS builds resolve the pinned mobile devDependency directly.
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.startsWith("Cannot find module 'sharp'")) throw error;
    return createRequire(prebuildRequire.resolve('@expo/image-utils'))('sharp');
  }
})();
const BACKGROUND = '#3f150b';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function decoded(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // RGB under a fully transparent pixel has no rendered meaning. Lossless
  // WebP may canonicalize it, but every visible RGB/alpha value must match.
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 0) data.fill(0, i, i + 3);
  return { data, width: info.width, height: info.height };
}
async function equalPixels(before, after, name) {
  const [a, b] = await Promise.all([decoded(before), decoded(after)]);
  assert.equal(a.width, b.width, name); assert.equal(a.height, b.height, name);
  assert.ok(a.data.equals(b.data), 'Lossless verification failed: ' + name);
  return sha(a.data);
}
async function optimize(file, { preserveAlpha = false } = {}) {
  const original = fs.readFileSync(file), metadata = await sharp(original).metadata();
  const webp = file.endsWith('.webp');
  let best = original;
  if (webp) {
    best = await sharp(original).keepIccProfile().webp({ lossless: true, effort: 6 }).toBuffer();
  } else {
    for (const adaptiveFiltering of [true, false]) {
      let pipeline = sharp(original).keepIccProfile();
      if (!preserveAlpha && (await pipeline.clone().stats()).isOpaque) pipeline = pipeline.removeAlpha();
      const candidate = await pipeline.png({ compressionLevel: 9, adaptiveFiltering, palette: false }).toBuffer();
      if (candidate.length < best.length) best = candidate;
    }
  }
  const pixelSha256 = await equalPixels(original, best, file);
  if (metadata.format === (webp ? 'webp' : 'png') && best.length >= original.length) best = original;
  if (!best.equals(original)) fs.writeFileSync(file, best);
  const output = await sharp(best).metadata();
  return { path: file, width: output.width, height: output.height, format: output.format,
    beforeBytes: original.length, bytes: best.length, pixelSha256, sha256: sha(best) };
}
async function notificationIconPng(master) {
  // Android small icons are alpha masks, not full-colour launcher artwork.
  // Remove the diffuse glow before downsampling so it cannot become a square
  // or a fuzzy disc in the status bar. Keep the new bunny/burrow silhouette.
  const alpha = await sharp(master).extractChannel('alpha').threshold(128)
    .resize(80, 80).raw().toBuffer();
  return sharp({ create: { width: 80, height: 80, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width: 80, height: 80, channels: 1 } })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
}
async function prepareBrandingAssets(root) {
  // The transparent artwork is the only authoring source. icon.png is an
  // opaque build artifact required by iOS/App Store and legacy launchers.
  const master = path.join(root, 'assets/icon-transparent.png'), source = fs.readFileSync(master), meta = await sharp(source).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
  assert.equal(meta.depth, 'uchar'); assert.ok(meta.hasAlpha, 'Branding master must retain transparency');
  assert.ok(!(await sharp(source).stats()).isOpaque, 'Branding master must have a transparent background');
  const directory = path.join(root, 'assets/branding'); fs.mkdirSync(directory, { recursive: true });
  const original = await optimize(master, { preserveAlpha: true });
  const file = path.join(root, 'assets/icon.png');
  fs.writeFileSync(file, await sharp(master).keepIccProfile().flatten({background: BACKGROUND}).removeAlpha()
    .png({compressionLevel:9,adaptiveFiltering:true,palette:false}).toBuffer());
  const icon = await optimize(file);
  const generated = [];
  for (const [name, size, alpha] of [['google-play-512.png', 512, false], ['splash-logo.png', 560, true], ['favicon-32.png', 32, false]]) {
    let pipeline = sharp(alpha ? master : file).keepIccProfile().resize(size, size, { fit: 'contain' });
    pipeline = alpha ? pipeline.ensureAlpha() : pipeline.removeAlpha();
    const target = path.join(directory, name);
    fs.writeFileSync(target, await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer());
    generated.push(await optimize(target, { preserveAlpha: alpha }));
  }
  // 108dp adaptive layer, with the unchanged square art centered at 72dp.
  // Keep essential bunny details inside the 66dp safe circle rather than
  // allowing the launcher mask to crop the ears at the edge of a full layer.
  const adaptive = path.join(directory, 'android-adaptive-foreground.png');
  const artwork = await sharp(master).resize(288,288).png().toBuffer();
  fs.writeFileSync(adaptive,await sharp({create:{width:432,height:432,channels:4,
    background:{r:63,g:21,b:11,alpha:0}}}).composite([{input:artwork,left:72,top:72}])
    .png({compressionLevel:9,adaptiveFiltering:true,palette:false}).toBuffer());
  generated.push(await optimize(adaptive,{preserveAlpha:true}));
  const notification = path.join(root, 'assets/notification-icon.png');
  fs.writeFileSync(notification, await notificationIconPng(master));
  generated.push(await optimize(notification, { preserveAlpha: true }));
  const play = generated.find(entry => entry.path.endsWith('google-play-512.png'));
  assert.ok(play.bytes <= 1024 * 1024, 'Google Play icon exceeds 1024KB');
  const manifest = {
    source: { path: '../icon-transparent.png', width: 1024, height: 1024, format: 'png', alpha: true, bytes: original.bytes, pixelSha256: original.pixelSha256, sha256: original.sha256 },
    background: BACKGROUND,
    channels: [
      { channel: 'App Store / iOS', path: '../icon.png', width: 1024, height: 1024, format: 'png', alpha: false, background: BACKGROUND, bytes: icon.bytes, sha256: icon.sha256 },
      ...generated.map(entry => ({ channel: entry.path.endsWith('notification-icon.png') ? 'Android notification (white alpha mask; OS controls surface)' : entry.path.endsWith('google-play-512.png') ? 'Google Play' : entry.path.endsWith('splash-logo.png') ? 'Splash source (140pt, up to 4x)' : entry.path.endsWith('android-adaptive-foreground.png') ? 'Android adaptive foreground (108dp at 4x; 72dp artwork)' : 'Web favicon',
        path: (entry.path === notification ? '../' : '') + path.basename(entry.path), width: entry.width, height: entry.height, format: entry.format, bytes: entry.bytes, sha256: entry.sha256,
        alpha: /splash-logo|android-adaptive|notification-icon/.test(entry.path), background: entry.path === notification ? 'transparent; system-tinted monochrome' : /splash-logo|android-adaptive/.test(entry.path) ? 'transparent artwork; fixed #3f150b surface' : BACKGROUND })),
    ],
    native: { iosIcon: '1024x1024 PNG (universal asset catalog)', iosSplash: [140, 280, 420],
      androidLegacy: [48, 72, 96, 144, 192], androidAdaptiveLayers: [108, 162, 216, 324, 432],
      androidSplashCanvas: [288, 432, 576, 864, 1152], androidFormat: 'lossless WebP launcher / PNG splash',
      iosNotification: 'system-generated from installed native AppIcon; requires a new app build',
      androidNotification: [24, 36, 48, 72, 96],
      widget: 'all sizes declared by targets/widget/Assets.xcassets/AppIcon.appiconset/Contents.json' },
    standards: { apple: 'https://developer.apple.com/documentation/xcode/configuring-your-app-icon',
      googlePlay: 'https://developer.android.com/distribute/google-play/resources/icon-design-specifications' },
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { source: original, icon, generated };
}
function validateBrandingColors(config) {
  const splash = config.plugins.find(entry => Array.isArray(entry) && entry[0] === 'expo-splash-screen')?.[1];
  for (const [name, color] of Object.entries({
    splash: config.splash?.backgroundColor,
    adaptiveIcon: config.android?.adaptiveIcon?.backgroundColor,
    nativeSplash: splash?.backgroundColor,
    androidSplash: splash?.android?.backgroundColor,
    darkSplash: splash?.dark?.backgroundColor ?? BACKGROUND,
    androidDarkSplash: splash?.android?.dark?.backgroundColor ?? BACKGROUND,
  })) assert.equal(color, BACKGROUND, name + ' must use the fixed Burrow brand background');
  assert.ok(!config.android.adaptiveIcon.backgroundImage, 'Android cannot substitute a separate background design');
}
async function writeAndroidIcons(root,config) {
  validateBrandingColors(config);
  const {setIconAsync,configureAdaptiveIconAsync}=prebuildRequire('./build/plugins/icons/withAndroidIcons');
  // Legacy launchers use the full square art. Only adaptive foreground layers
  // need overscan/safe padding; don't shrink the Android 7 fallback twice.
  await setIconAsync(root,{icon:path.join(root,config.icon),backgroundColor:BACKGROUND,isAdaptive:true});
  await configureAdaptiveIconAsync(root,path.join(root,config.android.adaptiveIcon.foregroundImage),null,null,true);
  const notification = config.plugins.find(entry => Array.isArray(entry) && entry[0] === 'expo-notifications')?.[1];
  assert.equal(notification?.icon, './assets/notification-icon.png');
  const notificationRequire = createRequire(require.resolve('expo-notifications/package.json'));
  const { setNotificationIconAsync } = notificationRequire('./plugin/build/withNotificationsAndroid');
  await setNotificationIconAsync(root, path.join(root, notification.icon));
}
async function optimizeNativeBranding(root, platform) {
  const files = [];
  const add = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory)) if (/\.(png|webp)$/.test(entry)) files.push(path.join(directory, entry));
  };
  if (platform === 'ios') {
    for (const name of ['AppIcon.appiconset', 'SplashScreenLogo.imageset']) add(path.join(root, 'ios/Burrow/Images.xcassets', name));
    add(path.join(root, 'targets/widget/Assets.xcassets/AppIcon.appiconset'));
  } else {
    const res = path.join(root, 'android/app/src/main/res');
    if (fs.existsSync(res)) for (const folder of fs.readdirSync(res)) {
      if (/^mipmap-(?:m|h|xh|xxh|xxxh)dpi$/.test(folder)) {
        for (const name of ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp']) {
          const file = path.join(res, folder, name); if (fs.existsSync(file)) files.push(file);
        }
      } else if (/^drawable-(?:m|h|xh|xxh|xxxh)dpi$/.test(folder)) {
        for (const name of ['splashscreen_logo.png', 'notification_icon.png']) {
          const file = path.join(res, folder, name); if (fs.existsSync(file)) files.push(file);
        }
      }
    }
  }
  return Promise.all(files.map(file => optimize(file)));
}
module.exports = { BACKGROUND, decoded, equalPixels, optimize, prepareBrandingAssets, notificationIconPng, optimizeNativeBranding, writeAndroidIcons, validateBrandingColors, sharp };
