const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./lifecycle-test-utils.cjs');
const { normalizeMetroAssetUri } = load('apps/mobile/src/lib/metro-asset-uri.ts', {}, { URL, URLSearchParams });

test('Metro nested double-encoded paths resolve with spaces and secondary query intact', () => {
  const broken = 'http://localhost:8081/assets/?unstable_path=.%252Fassets%252Fburrow-webp%252Froom%2520decoration%252Fwindows/Default-Autumn%20Sunset.webp?platform=ios&hash=abc';
  const url = new URL(normalizeMetroAssetUri(broken));
  assert.equal(url.pathname, '/assets/assets/burrow-webp/room%20decoration/windows/Default-Autumn%20Sunset.webp');
  assert.equal(url.searchParams.get('platform'), 'ios');
  assert.equal(url.searchParams.get('hash'), 'abc');
  assert.equal(url.searchParams.has('unstable_path'), false);
});

test('all bundled art paths survive Metro URI normalization without renaming assets', () => {
  const registry = fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts', 'utf8');
  const games = fs.readFileSync('apps/mobile/src/lib/burrow-game-room-art.ts', 'utf8');
  for (const [, , relative] of (registry + games).matchAll(/require\((['"])(.*?)\1\)/g)) {
    const file = relative.replace('../../', '');
    const slash = file.lastIndexOf('/');
    const directory = './' + file.slice(0, slash);
    const broken = `http://localhost:8081/assets/?unstable_path=${encodeURIComponent(encodeURIComponent(directory))}/${encodeURIComponent(file.slice(slash + 1))}?platform=ios&hash=test`;
    const fixed = new URL(normalizeMetroAssetUri(broken));
    assert.equal(decodeURIComponent(fixed.pathname), '/assets/' + file);
    assert.equal(fixed.searchParams.get('platform'), 'ios');
    assert.equal(normalizeMetroAssetUri(fixed.href), fixed.href);
  }
});

test('raw ampersands in RN filenames do not truncate Metro icon paths', () => {
  for (const name of ['Coffee & Sips', 'Green Flags & Red Flags', 'Turn-Ons & Turn-Offs', 'Hugs & Holds', 'Our Song & Playlist']) {
    const broken = `http://localhost:8081/assets/?unstable_path=.%252Fassets%252Fburrow-webp%252Fgame-room-icons/${name}.webp?platform=ios&hash=abc`;
    const fixed = new URL(normalizeMetroAssetUri(broken));
    assert.equal(decodeURIComponent(fixed.pathname), `/assets/assets/burrow-webp/game-room-icons/${name}.webp`);
    assert.deepEqual([...fixed.searchParams.keys()].sort(), ['hash', 'platform']);
    assert.equal(fixed.searchParams.get('platform'), 'ios');
    assert.equal(fixed.searchParams.get('hash'), 'abc');
  }
});

test('Game Room uses the shared WebP decoder and normalizes its dev asset source', () => {
  const screen = fs.readFileSync('apps/mobile/src/components/burrow/game-room-screen.tsx', 'utf8');
  assert.match(screen, /import \{ Image \} from '\.\/burrow-image'/);
  assert.doesNotMatch(screen, /import \{[^}]*\bImage\s*[,}][^}]*\} from 'react-native'/);
  const react = hooks();
  const jsx = (type, props) => ({ type, props });
  const broken = 'http://device-host:8081/assets/?unstable_path=.%252Fassets%252Fburrow-webp%252Fgame-room-icons/Coffee%20%26%20Sips.webp?platform=ios&hash=abc';
  const wrapper = load('apps/mobile/src/components/burrow/burrow-image.tsx', {
    '@/lib/prepared-burrow-images':{preparedBurrowImage:()=>undefined},
    react: react.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-image': { Image: 'ExpoImage' },
    'react-native': { Image: { resolveAssetSource: () => ({ uri: broken, width: 512, height: 512 }) } },
    '@/lib/use-r2-asset-revision': { useR2AssetRevision() {} },
    '@/lib/android-r2-file-cache': { getAndroidR2CachedUri: () => null },
    '@/lib/download-queue': { enqueueR2Image() { throw Error('Bundled game icons must not use R2'); } },
    '@/lib/metro-asset-uri': { normalizeMetroAssetUri },
  }, { __DEV__: true });
  const result = react.render(() => wrapper.Image({ source: 123, contentFit: 'contain' }));
  assert.equal(result.type, 'ExpoImage');
  assert.equal(result.props.useAppleWebpCodec, false);
  assert.equal(result.props.contentFit, 'contain');
  const resolved = new URL(result.props.source.uri);
  assert.equal(resolved.origin, 'http://device-host:8081');
  assert.equal(resolved.pathname, '/assets/assets/burrow-webp/game-room-icons/Coffee%20%26%20Sips.webp');
  assert.equal(resolved.searchParams.get('hash'), 'abc');
  assert.equal(resolved.searchParams.get('platform'), 'ios');
  react.unmount();
});

test('production, user photos, and unrelated URLs are untouched', () => {
  for (const uri of ['file:///documents/photo.webp', 'asset:/art.webp', 'https://storage.example.com/photo.webp?token=private', 'http://localhost:8081/assets/art.webp?platform=ios']) {
    assert.equal(normalizeMetroAssetUri(uri), uri);
  }
  const traversal = 'http://localhost:8081/assets/?unstable_path=..%252Fsecret.webp';
  assert.equal(normalizeMetroAssetUri(traversal), traversal);
});
