const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');
const modelFile = 'apps/mobile/src/lib/burrow-map-model.ts';
const model = load(modelFile);
const time = (month, hour = 12, minute = 0) => Date.UTC(2026, month - 1, 1, hour, minute);

test('all twelve months map to north and south seasons in both storefront code formats', () => {
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const south = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
  for (let month = 1; month <= 12; month++) {
    for (const country of ['US', 'USA', 'CN', undefined]) assert.equal(model.burrowMapEnvironment(time(month), 'UTC', country).season, north[month - 1]);
    for (const country of ['AU', 'AUS', 'NZ', 'NZL', 'za', 'BRA']) assert.equal(model.burrowMapEnvironment(time(month), 'UTC', country).season, south[month - 1]);
  }
});

test('day starts at exactly 06:00 and night at 18:00 in the local timezone', () => {
  for (const [hour, minute, period] of [[0, 0, 'night'], [5, 59, 'night'], [6, 0, 'day'], [17, 59, 'day'], [18, 0, 'night'], [23, 59, 'night']]) {
    assert.equal(model.burrowMapEnvironment(time(10, hour, minute), 'UTC', 'US').banner, `autumn-${period}`);
  }
  // UTC March 1 is still February (winter) on the Pacific coast.
  assert.equal(model.burrowMapEnvironment(time(3, 1), 'America/Los_Angeles', 'US').banner, 'winter-day');
  assert.doesNotThrow(() => model.burrowMapEnvironment(time(10), 'invalid/timezone', 'US'));
});

test('fallback uses explicit device region, not the language to guess a hemisphere', () => {
  for (const [locale, code] of [['en_AU', 'AU'], ['en-NZ', 'NZ'], ['zh-Hans-CN', 'CN'], ['pt_BR@calendar=gregorian', 'BR'], ['en', undefined], ['es-419', undefined], [undefined, undefined]]) {
    assert.equal(model.burrowLocaleCountry(locale), code);
  }
});

test('four paired rows retain all eight destinations and extend with added rooms', () => {
  assert.equal(model.BURROW_SOIL_COLOR, '#572b1a');
  assert.equal(model.BURROW_MAP_ROOMS.map(room => room.id).join(','), 'my_room,partner_room,our_room,game_room,rage_room,friends_room,memories_room,collection_room');
  const layout = model.burrowMapLayout(8);
  assert.equal(layout.rooms.length, 8);
  assert.equal(layout.lights.length, 4);
  assert.equal(layout.branches.length, 4);
  assert.equal(layout.trunk.left + layout.trunk.width / 2, 400);
  assert.equal(layout.trunk.top, model.BURROW_BANNER_PATH_END - 1);
  for (let row = 0; row < 4; row++) {
    const left = layout.rooms[row * 2], right = layout.rooms[row * 2 + 1], branch = layout.branches[row], light = layout.lights[row];
    assert.equal(left.top, right.top);
    assert.ok(left.left + left.width > branch.left, 'branch overlaps left border behind art');
    assert.ok(branch.left + branch.width > right.left, 'branch overlaps right border behind art');
    assert.equal(branch.left + branch.width / 2, 400);
    assert.equal(light.left + light.width / 2, 400);
    assert.ok(Math.abs(light.width - 90 * .7) < 1e-8);
    assert.ok(Math.abs(light.height - 120 * .7) < 1e-8);
    assert.equal(light.top + light.height / 2, left.top + 128 - 6);
    assert.equal(branch.top + branch.height / 2, left.top + 128);
    assert.ok(layout.height > left.top + left.height);
  }
  assert.equal(model.burrowMapLayout(10).height - layout.height, 350);
  assert.equal(layout.height - model.burrowMapLayout(6).height, 350);
  assert.equal(model.burrowMapLayout(7).branches[3].width, 106, 'no dangling passage to an absent eighth room');
  assert.equal(model.burrowMapLayout(0).trunk.height, 0);
});

test('all eight banners, room, lantern and six moved icons exist and are bundled locally', () => {
  for (const file of ['apps/mobile/src/lib/burrow-map-assets.ts', 'apps/mobile/src/lib/burrow-ui-assets.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\((['"])(.*?)\1\)/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[2])), match[2]);
  }
  const source = fs.readFileSync('apps/mobile/src/lib/burrow-map-assets.ts', 'utf8');
  assert.equal([...source.matchAll(/require\(/g)].length, 10);
});

function storefrontHarness({ cached, locale = 'en_AU', getStorefront = async () => 'USA', os = 'ios' } = {}) {
  const h = hooks(), c = clock();
  const values = new Map(cached ? [['country', cached]] : []);
  let epoch = 1, foreground, identity;
  const { useBurrowStorefront } = load('apps/mobile/src/lib/use-burrow-storefront.ts', {
    react: h.react,
    'react-native': {
      Platform: { OS: os }, NativeModules: { SettingsManager: { settings: { AppleLocale: locale } } },
      AppState: { addEventListener(_, callback) { foreground = callback; return { remove() { foreground = undefined; } }; } },
    },
    'expo-iap': { getStorefront }, './storage': { storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value) } },
    '../shared/storage/keys': { kBurrowStorefrontCountry: { name: 'country' } },
    './session-lifecycle': { sessionEpoch: () => epoch, subscribeSessionIdentity(fn) { identity = fn; return () => { identity = undefined; }; } },
    './burrow-map-model': model,
  }, c.globals);
  return { read: () => h.render(useBurrowStorefront), values, c, unmount: h.unmount,
    foreground: () => foreground?.('active'), changeIdentity() { epoch++; values.clear(); identity?.(); } };
}

test('storefront opens from cache immediately then refreshes silently and on foreground', async () => {
  const d = deferred(); let calls = 0;
  const h = storefrontHarness({ cached: 'AUS', getStorefront: () => { calls++; return calls === 1 ? d.promise : Promise.resolve('NZL'); } });
  assert.equal(h.read(), 'AUS');
  d.resolve(' usa '); await flush();
  assert.equal(h.read(), 'USA');
  assert.equal(h.values.get('country'), 'USA');
  h.foreground(); await flush();
  assert.equal(h.read(), 'NZL');
  h.unmount();
});

test('offline/invalid storefront falls back without a loader, and timeout permits retry', async () => {
  const offline = storefrontHarness({ getStorefront: async () => { throw new Error('offline'); } });
  assert.equal(offline.read(), 'AU'); await flush(); assert.equal(offline.read(), 'AU'); offline.unmount();
  const invalid = storefrontHarness({ locale: 'en', getStorefront: async () => 'invalid-country' });
  assert.equal(invalid.read(), undefined); await flush(); assert.equal(invalid.values.size, 0); invalid.unmount();
  let calls = 0;
  const timeout = storefrontHarness({ getStorefront: () => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve('NZ'); } });
  assert.equal(timeout.read(), 'AU'); timeout.c.advance(5000); await flush();
  assert.equal(timeout.read(), 'AU'); timeout.foreground(); await flush();
  assert.equal(timeout.read(), 'NZ'); timeout.unmount();
});

test('old-account in-flight result cannot overwrite the new account storefront', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const h = storefrontHarness({ cached: 'USA', getStorefront: () => ++calls === 1 ? old.promise : fresh.promise });
  assert.equal(h.read(), 'USA'); h.changeIdentity();
  assert.equal(h.read(), 'AU'); old.resolve('USA'); await flush();
  assert.equal(h.values.size, 0);
  fresh.resolve('NZL'); await flush(); assert.equal(h.read(), 'NZL'); h.unmount();
});

test('map UI places labels inside pills, uses seasonal banner, and every room is tappable', () => {
  const jsx = (type, props) => ({ type, props });
  const icons = Object.fromEntries(model.BURROW_MAP_ROOMS.filter(r => !['my_room', 'partner_room'].includes(r.id)).map(r => [r.id, r.id]));
  const { BurrowMap } = load('apps/mobile/src/components/burrow/burrow-map.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, './burrow-image': { Image: 'Image' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: s => s, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 400 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20 }) },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' },
    '@/lib/burrow-ui-assets': { BURROW_ROOM_ICONS: icons }, '@/lib/burrow-map-model': model,
    '@/lib/burrow-map-assets': { BURROW_MAP_ART: { room: 'room', light: 'light', banners: { 'spring-day': 'spring-day' } } },
    '@/lib/use-burrow-storefront': { useBurrowStorefront: () => 'AU' },
  });
  const actions = [];
  const tree = BurrowMap({ now: time(10), timeZone: 'UTC', onRoom: id => actions.push(id), visiting: true });
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
  const nodes = all(tree);
  const buttons = nodes.filter(n => n.type === 'Pressable');
  assert.equal(buttons.length, 8);
  for (const button of buttons) button.props.onPress();
  assert.equal(actions.join(','), model.BURROW_MAP_ROOMS.map(r => r.id).join(','));
  assert.ok(nodes.some(n => n.type === 'Image' && n.props.source === 'spring-day'));
  assert.equal(nodes.filter(n => n.type === 'Image' && n.props.source === 'light').length, 4);
  for (const button of buttons) {
    const label = all(button).find(n => n.type === 'Text');
    assert.equal(label.props.style[1].fontSize, 12);
    assert.equal(label.props.children, button.props.accessibilityLabel.replace('Open ', ''));
    assert.ok(button.props.style({ pressed: true })[1].opacity < 1);
  }
});
