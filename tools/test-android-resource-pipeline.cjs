const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Android release keeps the runtime image and Metro asset bridge intact', () => {
  const plugin = require(path.join(root, 'apps/mobile/plugins/with-android-r8-optimization.js'));
  assert.match(plugin.R8_SAFETY_RULES, /-keep class expo\.modules\.image\.\*\* \{ \*; \}/);
  assert.match(plugin.R8_SAFETY_RULES, /-keep class expo\.modules\.asset\.\*\* \{ \*; \}/);
  assert.match(plugin.RESOURCE_KEEP_XML, /tools:keep="@drawable\/assets_\*,@raw\/assets_\*"/);

  const once = plugin.upsertMarkedBlock('# existing\n', plugin.R8_SAFETY_RULES);
  const twice = plugin.upsertMarkedBlock(once, plugin.R8_SAFETY_RULES);
  assert.equal(twice.match(/burrow-r8-safety:start/g)?.length, 1);
  assert.equal(twice.match(/burrow-r8-safety:end/g)?.length, 1);
});

test('core Android Metro images bypass expo-image without changing iOS', () => {
  const gate = read('apps/mobile/src/components/main/home-entry-gate.tsx');
  assert.match(gate, /Platform\.OS === 'android' && typeof props\.source === 'number'/);
  assert.match(gate, /<NativeImage/);
  assert.match(gate, /return \(\s*<ExpoImage/);
  assert.match(gate, /const ANDROID_ENTRY_TIMEOUT_MS = 750/);
  assert.match(gate, /const ready = Platform\.OS === 'android' \|\| homeEntryIsReady\(\)/);
  assert.match(gate, /markAndroidP0UiReady\(\)/);

  const readiness = read('apps/mobile/src/lib/home-entry-readiness.ts');
  assert.match(readiness, /export const HOME_ENTRY_TIMEOUT_MS = 5_000/);
  assert.match(readiness, /requiredAssets\(state\.target\)\.every/);
});

test('Android R2 files are atomic, persistent and never decoded while warming', () => {
  const cache = read('apps/mobile/src/lib/android-r2-file-cache.ts');
  assert.match(cache, /expo-file-system\/legacy/);
  assert.match(cache, /const partial = `\$\{destination\}\.part`/);
  assert.match(cache, /FileSystem\.downloadAsync\(url, partial\)/);
  assert.match(cache, /FileSystem\.moveAsync\(\{ from: partial, to: destination \}\)/);
  assert.match(cache, /kAndroidR2FileIndex/);
  assert.match(cache, /retireOlderVersion\(url\)/);
  assert.doesNotMatch(cache, /from 'expo-image'/);

  const keys = read('apps/mobile/src/shared/storage/keys.ts');
  assert.match(keys, /android-r2-p0:file-index:v1/);
});

test('Android P0 uses one idle lane in the confirmed manifest order', () => {
  const queue = read('apps/mobile/src/lib/download-queue.ts');
  assert.match(queue, /const MAX_CONCURRENCY = IS_ANDROID \? 1 : 2/);
  assert.match(queue, /InteractionManager\.runAfterInteractions/);
  assert.match(queue, /requiresAndroidUi: IS_ANDROID/);
  assert.match(queue, /requiresAndroidIdle: IS_ANDROID && priority >= 0/);
  assert.match(queue, /export function markAndroidP0UiReady/);
  assert.match(queue, /const MAX_ATTEMPTS = 3/);
  assert.match(queue, /Date\.now\(\) \+ MAX_RETRY_BACKOFF_MS/);
  assert.match(queue, /if \(!IS_ANDROID \|\| task\.priority < 0\) notifyAssetReady\(\)/);
  assert.match(queue, /timeoutMs: IS_ANDROID \? null : undefined/);

  const p0 = queue.slice(queue.indexOf('function stageAndroidP0'), queue.indexOf('function stageScene'));
  const ordered = [
    'outfitAssetUrl(outfit.thumb',
    'sceneAssetUrl(scene.thumb',
    'outfitAssetUrl(outfit.bunny',
    'sceneAssetUrl(scene.image',
    'addOutfitVideoTask(outfit, PRIORITY.outfitAnimation',
    "key: 'focus-voice:all'",
  ].map((needle) => p0.indexOf(needle));
  assert.ok(ordered.every((index) => index >= 0), `missing P0 stage: ${ordered}`);
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
});

test('visible Android assets jump ahead while iOS retains memory-disk warm-up', () => {
  const queue = read('apps/mobile/src/lib/download-queue.ts');
  assert.match(queue, /urgent: IS_ANDROID \? -300 : -100/);
  assert.match(queue, /ensureAndroidR2FileCached\(url\)/);
  assert.match(queue, /if \(!IS_ANDROID\) \{\s*for \(const outfit of outfits\) stageOutfit/);
  assert.match(queue, /ExpoImage\.prefetch\(url, \{ cachePolicy: 'memory-disk' \}\)/);

  const announcements = read('apps/mobile/src/lib/announcements-api.ts');
  assert.match(announcements, /ensurePriorityR2Image\(uri, -200\)/);
  assert.match(announcements, /ExpoImage\.prefetch\(uri, 'disk'\)/);
});

test('Android renderers use verified local files and keep bundled fallbacks', () => {
  const scenes = read('apps/mobile/src/lib/scenes.ts');
  assert.match(scenes, /androidR2ImageSource\(remoteUrl\) \?\? DEFAULT_SCENE_BG/);

  const item = read('apps/mobile/src/components/ui/item-sprite.tsx');
  assert.match(item, /ensurePriorityR2Image\(remoteUri\)/);
  assert.match(item, /androidRemote\.sourceUrl === remoteUri && androidRemote\.localUri/);
  assert.match(item, /const art = remoteArt \?\? warmedArt \?\? bundledArt/);
  assert.match(item, /invalidateAndroidR2CachedFile\(remoteUri\)/);

  const prefetch = read('apps/mobile/src/lib/prefetch.ts');
  assert.match(prefetch, /if \(Platform\.OS === 'android'\) return/);
});

test('outfit and Focus Voice media require atomic completion markers', () => {
  const outfits = read('apps/mobile/src/lib/outfits.ts');
  assert.match(outfits, /videoCompletePath/);
  assert.match(outfits, /const partial = `\$\{destination\}\.part`/);
  assert.match(outfits, /FileSystem\.moveAsync\(\{ from: partial, to: destination \}\)/);
  assert.match(outfits, /FileSystem\.writeAsStringAsync\(marker, 'ok'\)/);
  assert.match(outfits, /if \(Platform\.OS !== 'android'\)[\s\S]*FileSystem\.downloadAsync\([\s\S]*destination/);

  const focus = read('apps/mobile/src/lib/focus-voice.ts');
  assert.match(focus, /completePath/);
  assert.match(focus, /const partial = `\$\{path\}\.part`/);
  assert.match(focus, /shouldContinue/);
  assert.match(focus, /FileSystem\.writeAsStringAsync\(marker, 'ok'\)/);
  assert.match(focus, /if \(Platform\.OS !== 'android'\)[\s\S]*FileSystem\.downloadAsync\(urlFor\(key\), path\)/);
});

test('Android runtime waits for first paint, then completes P0 sequentially', async () => {
  const code = ts.transpileModule(read('apps/mobile/src/lib/download-queue.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const idle = [];
  const downloads = [];
  const cachedImages = new Set();
  const cachedVideos = new Set();
  let active = 0;
  let maxActive = 0;
  const outfits = [
    { key: 'o1', thumb: 'Outfits/o1.webp', bunny: 'Outfits/o1-Bunny.webp', video: 'Character Videos/o1.mov', androidVideo: 'Character Videos-Android/o1.webp', assetVersion: '1' },
    { key: 'o2', thumb: 'Outfits/o2.webp', bunny: 'Outfits/o2-Bunny.webp', video: 'Character Videos/o2.mov', androidVideo: 'Character Videos-Android/o2.webp', assetVersion: '1' },
  ];
  const scenes = [
    { key: 's1', thumb: 'Maps/s1-Small.webp', image: 'Maps/s1.webp', assetVersion: '1' },
  ];
  const module = { exports: {} };
  const imports = {
    'react-native': {
      Platform: { OS: 'android' },
      AppState: { currentState: 'active' },
      InteractionManager: {
        runAfterInteractions(fn) {
          const entry = { fn, cancelled: false };
          idle.push(entry);
          return { cancel() { entry.cancelled = true; } };
        },
      },
    },
    'expo-image': { Image: { getCachePathAsync: async () => null, prefetch: async () => true } },
    './outfits': {
      getCachedOutfitCatalog: () => outfits,
      fetchOutfitCatalog: async () => outfits,
      getEquippedOutfitKey: () => null,
      outfitAssetUrl: (key, version) => `https://media.novameapp.com/${key}?v=${version}`,
      getCachedOutfitVideoUri: async (key) => cachedVideos.has(key) ? `file://${key}` : null,
      ensureOutfitVideoCached: async (outfit) => {
        active += 1; maxActive = Math.max(maxActive, active);
        downloads.push(`video:${outfit.key}`);
        cachedVideos.add(outfit.key);
        active -= 1;
        return `file://${outfit.key}`;
      },
    },
    './scenes': {
      getCachedSceneCatalog: () => scenes,
      fetchSceneCatalog: async () => scenes,
      sceneAssetUrl: (key, version) => `https://media.novameapp.com/${key}?v=${version}`,
    },
    './focus-voice': {
      syncAllFocusVoiceAssets: async () => { downloads.push('focus'); return true; },
    },
    './item-manifest-cache': { getCachedRemoteItemManifest: () => null, remoteItemAssetUrl: () => '' },
    './cosmetics-store': { getSelectedScene: () => 'default' },
    './android-r2-file-cache': {
      getAndroidR2CachedUri: (url) => cachedImages.has(url) ? `file://${url}` : null,
      isAndroidR2FileCached: async (url) => cachedImages.has(url),
      ensureAndroidR2FileCached: async (url) => {
        active += 1; maxActive = Math.max(maxActive, active);
        downloads.push(url.replace('https://media.novameapp.com/', '').replace(/\?v=.*/, ''));
        cachedImages.add(url);
        active -= 1;
        return `file://${url}`;
      },
    },
    '@novame/engine': {},
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  const queue = module.exports;
  queue.startDownloadQueue();
  await new Promise(setImmediate);
  assert.deepEqual(downloads, []);

  queue.markAndroidP0UiReady();
  for (let guard = 0; guard < 30 && !downloads.includes('focus'); guard += 1) {
    await new Promise(setImmediate);
    const next = idle.shift();
    if (next && !next.cancelled) next.fn();
  }
  await new Promise(setImmediate);
  assert.equal(maxActive, 1);
  assert.deepEqual(downloads, [
    'Outfits/o1.webp', 'Outfits/o2.webp',
    'Maps/s1-Small.webp',
    'Outfits/o1-Bunny.webp', 'Outfits/o2-Bunny.webp',
    'Maps/s1.webp',
    'video:o1', 'video:o2',
    'focus',
  ]);
  queue.resetDownloadQueue();
});
