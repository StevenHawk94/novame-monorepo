const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });

function harness(platform, outfit) {
  const h = hooks(), download = deferred();
  let resolves = 0, priorityResolves = 0, ready = 0, errors = 0, key = outfit;
  const players = [];
  const video = load('apps/mobile/src/components/main/companion-video.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: platform }, Pressable: 'Pressable', StyleSheet: { create: x => x },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useFocusEffect: fn => h.react.useEffect(fn, [fn]) },
    'expo-video': { VideoView: 'Video', useVideoPlayer(source, init) {
      const player = h.react.useRef(null);
      if (!player.current) {
        player.current = { play() {}, addListener: () => ({ remove() {} }), replaceAsync: async () => {} };
        init(player.current); players.push(source);
      }
      return player.current;
    } },
    'expo-image': { Image: 'Image' },
    './companion-video-source': { DEFAULT_COMPANION_VIDEO: 42 },
    '../../lib/outfits': {
      getEquippedOutfitKey: () => key,
      resolveEquippedOutfitVideo() { resolves++; return download.promise; },
      getCachedOutfitCatalog: () => [{ key, bunny: 'preview' }],
      outfitAssetUrl: () => 'https://preview',
      fetchOutfitCatalog: async () => [],
    },
    '../../lib/download-queue': {
      async ensurePriorityOutfitVideo() {
        priorityResolves++;
        const resolved = await download.promise;
        return resolved?.uri ?? null;
      },
    },
  }, { setTimeout, clearTimeout });
  const root = video.CompanionVideo({ waitForInitialAsset: true, onReady: () => ready++, onError: () => errors++ });
  const render = () => h.render(() => root.type(root.props));
  return { render, dispose: h.unmount, download, players, get ready() { return ready; }, get errors() { return errors; },
    get resolves() { return resolves; }, changeKey(value) { key = value; },
    get priorityResolves() { return priorityResolves; },
    mountNative(prepared) {
      const native = prepared.type(prepared.props);
      const nativeHooks = hooks();
      // The native component uses the same mocked React implementation, but a
      // separate component mount must start its hook storage from empty.
      h.unmount();
      Object.assign(h.react, nativeHooks.react);
      const renderNative = () => nativeHooks.render(() => native.type(native.props)).props.children;
      return { view: renderNative(), render: renderNative, dispose: nativeHooks.unmount };
    } };
}

test('bundled default needs no network and only the actual native display/first frame is ready', () => {
  for (const platform of ['ios', 'android']) {
    const h = harness(platform, null), prepared = h.render();
    assert.equal(h.resolves, 0); assert.equal(h.ready, 0);
    assert.equal(prepared.props.initialSource, 42);
    const native = h.mountNative(prepared);
    assert.equal(h.ready, 0);
    (platform === 'ios' ? native.view.props.onFirstFrameRender : native.view.props.onDisplay)();
    assert.equal(h.ready, 1); native.dispose();
  }
});

test('equipped outfit mounts directly from its local animation without a default/preview frame', async () => {
  const ios = harness('ios', 'coat');
  assert.equal(ios.render(), null); assert.equal(ios.resolves, 1); assert.equal(ios.ready, 0);
  ios.download.resolve({ key: 'coat', uri: 'file:///cached-coat' }); await flush();
  const iosPrepared = ios.render();
  assert.equal(iosPrepared.props.initialSource.uri, 'file:///cached-coat');
  const iosNative = ios.mountNative(iosPrepared);
  assert.equal(ios.resolves, 1, 'focus must not replace the prepared animation with a preview');
  assert.equal(ios.players[0].uri, 'file:///cached-coat');
  assert.equal(ios.ready, 0); iosNative.dispose();

  // Android releases the Home gate with the bundled animation, then its one
  // priority file-cache lane swaps in the selected animated WebP when ready.
  const android = harness('android', 'coat');
  const androidPrepared = android.render();
  assert.equal(androidPrepared.props.initialSource, 42);
  const androidNative = android.mountNative(androidPrepared);
  assert.equal(androidNative.view.props.source, 42);
  assert.equal(android.priorityResolves, 1);
  android.download.resolve({ key: 'coat', uri: 'file:///cached-coat' }); await flush();
  assert.equal(androidNative.render().props.source.uri, 'file:///cached-coat');
  androidNative.dispose();
});

test('failed, stale or unmounted outfit resolutions never release Home readiness', async () => {
  for (const scenario of ['missing', 'rejected', 'changed', 'unmounted']) {
    const h = harness('ios', 'coat'); h.render();
    if (scenario === 'changed') h.changeKey('other');
    if (scenario === 'unmounted') h.dispose();
    if (scenario === 'rejected') h.download.reject(Error('offline'));
    else h.download.resolve(scenario === 'missing' ? null : { key: 'coat', uri: 'file:///coat' });
    await flush();
    assert.equal(h.ready, 0);
    assert.equal(h.errors, scenario === 'unmounted' ? 0 : 1);
    h.dispose();
  }
});
