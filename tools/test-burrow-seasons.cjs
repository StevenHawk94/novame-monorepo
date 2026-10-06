const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, flush } = require('./lifecycle-test-utils.cjs');
const registryFile = 'apps/mobile/src/lib/burrow-art-assets.ts';
const imports = Object.fromEntries([...fs.readFileSync(registryFile, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(match => [match[2], path.resolve(path.dirname(registryFile), match[2])]));
const art = load(registryFile, imports);
const presentation = load('apps/mobile/src/lib/burrow-presentation.ts', { '@novame/engine': {} });
const options = load('apps/mobile/src/lib/burrow-collection-options.ts');
const seasons = ['Autumn', 'Spring', 'Summer', 'Winter'].map((title, index) => ({
  stable_id: `burrow_season_${title.toLowerCase()}_0${index + 1}`, title, category: 'seasons', item_type: 'decor',
  price: index ? 150 : 0, metadata: { slot: 'background', artOrdinal: index + 1, starter: !index },
}));
const data = { profile: { id: 'me' }, partner: null, catalog: seasons,
  loadouts: [], inventory: [{ owner_id: 'me', item_id: seasons[0].stable_id }], wallet: { balance: 1000 }, roomPhotos: [] };
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : [];

function shopHarness(props = {}) {
  const h = hooks();
  const checkouts = [], saves = [];
  const { BurrowShop } = load('apps/mobile/src/components/burrow/burrow-shop.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: {}, Image: 'NativeImage', Pressable: 'Pressable', ScrollView: 'ScrollView',
      FlatList: 'FlatList',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    './burrow-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { back() {}, navigate() {} } }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 34 }) },
    '@novame/domain': { BURROW_DECOR_SHOP_CATEGORIES: [] },
    '@/lib/app-major-update-api': { purchaseRoomLoadout: async (...args) => checkouts.push(args), saveRoomLoadout: async (...args) => saves.push(args) },
    '@/lib/burrow-store': { runBurrowAction: async (_id, action) => { await action('checkout-key'); return true; },
      refreshBurrow: async () => {}, setBurrowLoadoutLocally() {} },
    '@/lib/burrow-presentation': presentation, '@/lib/burrow-collection-options': options,
    '@/lib/burrow-art-assets': art, '@/lib/burrow-shop-icons': { BURROW_SHOP_ICONS: {} },
    '@/lib/room-photo-crop': load('apps/mobile/src/lib/room-photo-crop.ts'),
    './burrow-back-button': { BurrowBackButton: 'Back' }, './bunny-actor': { BunnyActor: 'Bunny' },
    './home-art-preview': { HomeArtPreview: 'Preview' },
  });
  return { checkouts, saves, render: () => h.render(() => BurrowShop({ data, section: 'shop', initialCategory: 'seasons', away: false, ...props })) };
}

test('Autumn remains default; saved solo and shared backgrounds survive reopening', () => {
  assert.equal(art.BURROW_ART.seasons, art.BURROW_ART.backgrounds);
  assert.equal(presentation.roomSlots(data, 'me').background, seasons[0]);
  for (let i = 0; i < seasons.length; i++) {
    assert.equal(art.burrowArtForItem(seasons[i]), art.BURROW_ART.backgrounds[i]);
    assert.equal(art.burrowArtForItem(seasons[i], 'backgrounds'), art.BURROW_ART.backgrounds[i]);
    const solo = { ...data, loadouts: [{ room_type: 'home', owner_id: 'me', slot: 'background', item_id: seasons[i].stable_id }] };
    assert.equal(presentation.roomSlots(solo, 'me').background, seasons[i]);
    const shared = { ...data, partner: { id: 'partner' }, loadouts: [{ room_type: 'our', slot: 'background', item_id: seasons[i].stable_id }] };
    assert.equal(presentation.roomSlots(shared, 'partner').background, seasons[i]);
  }
});

test('Shop Season lists all four products; decorator previews without changing other slots', () => {
  const shop = shopHarness();
  let tree = shop.render();
  nodes(tree).find(node => typeof node.type === 'function' && node.props.selected).props.onChange('seasons');
  tree = shop.render();
  const list = nodes(tree).find(node => node.type === 'FlatList');
  assert.equal(list.props.data.length, 4);
  assert.ok(list.props.data.every(item => nodes(list.props.renderItem({ item })).some(node => node.props?.accessibilityLabel === `Preview ${item.title}`)));
  const decor = shopHarness({ section: 'decorate' });
  tree = decor.render();
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Preview Winter').props.onPress();
  tree = decor.render();
  assert.equal(nodes(tree).find(node => node.type === 'Preview').props.slots.background, seasons[3]);
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children === 'Total: 🥕 150'));
  const owned = shopHarness({ section: 'decorate', ownedOnly: true });
  assert.equal(nodes(owned.render()).filter(node => node.props?.accessibilityLabel?.startsWith('Preview ')).length, 1);
});

test('season migration grants Autumn without resetting rooms and extends all checkout validators', () => {
  const sql = fs.readFileSync('supabase/migrations/20261004000156_burrow_season_shop.sql', 'utf8');
  for (const item of seasons) assert.ok(sql.includes(item.stable_id));
  assert.match(sql, /case when ordinal=1 then 0 else 150 end/);
  assert.match(sql, /on conflict \(owner_id,item_id\) do nothing/);
  assert.ok(!/delete from|update public\.room_loadouts/i.test(sql));
  for (const name of ['save_room_loadout_v1', 'solo_burrow_loadout_v1', 'purchase_room_loadout_v1']) assert.ok(sql.includes(name));
  assert.ok(sql.includes('not between 1 and 19'));
});

test('paying for a season sends the selected background with unchanged wallpaper and furniture', async () => {
  const wallpaper = { stable_id: 'wall', category: 'wallpapers', item_type: 'decor', price: 0, metadata: { slot: 'wallpaper', starter: true } };
  const table = { stable_id: 'table', category: 'tables', item_type: 'decor', price: 0, metadata: { slot: 'table', starter: true } };
  const room = { ...data, catalog: [...data.catalog, wallpaper, table], inventory: [...data.inventory,
    { owner_id: 'me', item_id: 'wall' }, { owner_id: 'me', item_id: 'table' }] };
  const h = shopHarness({ data: room, section: 'decorate' });
  let tree = h.render();
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Preview Spring').props.onPress();
  tree = h.render();
  const pay = nodes(tree).find(node => node.type === 'Pressable' && nodes(node)
    .some(child => child.type === 'Text' && child.props.children === 'Pay'));
  assert.equal(pay.props.disabled, false);
  pay.props.onPress();
  await flush();
  assert.equal(h.checkouts.length, 1);
  assert.deepEqual({ ...h.checkouts[0][0] }, { background: seasons[1].stable_id, wallpaper: 'wall', table: 'table' });
  assert.equal(h.saves.length, 0);
});
