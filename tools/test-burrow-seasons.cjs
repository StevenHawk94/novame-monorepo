const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, flush, clock } = require('./lifecycle-test-utils.cjs');
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
  ? [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.ListHeaderComponent), ...nodes(tree.props?.ListFooterComponent),
    ...(tree.type==='FlatList'?(tree.props.data??[]).flatMap((item,index)=>nodes(tree.props.renderItem?.({item,index}))):[])] : [];

function shopHarness(props = {}) {
  const h = hooks();
  const checkouts = [], saves = [];
  const { BurrowShop } = load('apps/mobile/src/components/burrow/burrow-shop.tsx', {
    '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
    ...require('./coin-purchase-test-mock.cjs')().imports,
    '@/lib/insufficient-coins':{showInsufficientCoins(){}},
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:()=>{}},
    './coin-ui': { CoinIcon: 'CoinIcon', CoinLabel: 'Text' },
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: {}, Image: 'NativeImage', Pressable: 'Pressable', ScrollView: 'ScrollView',
      FlatList: 'FlatList',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    './burrow-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { back() {}, dismissTo() {}, navigate() {} } }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 34 }) },
    '@/lib/burrow-shop-categories': load('apps/mobile/src/lib/burrow-shop-categories.ts', {
      '@novame/domain': { BURROW_DECOR_SHOP_CATEGORIES: ['tables', 'dresser_plants'] },
    }),
    '@/lib/app-major-update-api': { purchaseRoomLoadout: async (...args) => checkouts.push(args), saveRoomLoadout: async (...args) => saves.push(args) },
    '@/lib/burrow-store': { runBurrowAction: async (_id, action) => { await action('checkout-key'); return true; },
      refreshBurrow: async () => {}, setBurrowLoadoutLocally() {},enqueueBurrowRoomEdit: (...args)=>{checkouts.push(args);return 'queued';} },
    '@/lib/burrow-presentation': presentation, '@/lib/burrow-collection-options': options,
    '@/lib/burrow-shop-paging': load('apps/mobile/src/lib/burrow-shop-paging.ts'),
    '@/lib/burrow-shop-thumbnails': { createShopThumbnailWarmer: () => ({ warm() {}, cancel() {} }) },
    '@/lib/burrow-art-assets': art, '@/lib/burrow-shop-icons': { BURROW_SHOP_ICONS: {} },
    '@/lib/room-photo-crop': load('apps/mobile/src/lib/room-photo-crop.ts'),
    './burrow-back-button': { BurrowBackButton: 'Back' }, './outfit-bunny': { OutfitBunny: 'Bunny' },
    './home-art-preview': { HomeArtPreview: 'Preview' },
    './shop-category-icon': { ShopCategoryIcon: 'CategoryIcon' },
    './shop-item-price': { ShopItemPrice: 'ShopItemPrice' },
  });
  return { checkouts, saves, h, render: () => h.render(() => BurrowShop({ data, section: 'shop', initialCategory: 'seasons', away: false, ...props })) };
}

test('legacy seasonal purchases never enter active room slots; seasonal art remains bundled', () => {
  assert.equal(art.BURROW_ART.seasons, art.BURROW_ART.backgrounds);
  assert.equal(presentation.roomSlots(data, 'me').background, undefined);
  for (let i = 0; i < seasons.length; i++) {
    assert.equal(art.burrowArtForItem(seasons[i]), art.BURROW_ART.backgrounds[i]);
    assert.equal(art.burrowArtForItem(seasons[i], 'backgrounds'), art.BURROW_ART.backgrounds[i]);
    const solo = { ...data, loadouts: [{ room_type: 'home', owner_id: 'me', slot: 'background', item_id: seasons[i].stable_id }] };
    assert.equal(presentation.roomSlots(solo, 'me').background, undefined);
    const shared = { ...data, partner: { id: 'partner' }, loadouts: [{ room_type: 'our', slot: 'background', item_id: seasons[i].stable_id }] };
    assert.equal(presentation.roomSlots(shared, 'partner').background, undefined);
  }
});

test('Shop and decorator remove Season, including stale links and cached catalog rows', () => {
  const shop = shopHarness();
  let tree = shop.render();
  nodes(tree).find(node => typeof node.type === 'function' && node.props.selected).props.onChange('seasons');
  tree = shop.render();
  const pager = nodes(tree).find(node => node.props?.pages);
  assert.equal(pager.props.pages.wallpapers.length, 0);
  assert.equal(Object.hasOwn(pager.props.pages,'seasons'),false);
  assert.equal(nodes(tree).find(node => typeof node.type === 'function' && node.props.selected).props.selected, 'outfits');
  const source = fs.readFileSync('apps/mobile/src/components/burrow/burrow-shop.tsx', 'utf8');
  assert.ok(!source.match(/const categories = (.*);/)[1].includes('seasons'));
  assert.match(source, /<ShopCategoryIcon category=\{cat\} selected=\{selected === cat\}/);
  shop.h.unmount();
  const decor = shopHarness({ section: 'decorate' });
  tree = decor.render();
  assert.equal(nodes(tree).some(node => node.props?.accessibilityLabel?.startsWith('Preview ')), false);
  assert.equal(nodes(tree).find(node => node.type === 'Preview').props.slots.background, undefined);
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children === 'Total: {coin} 0'));
  const stale = shopHarness({ initialDetail: { itemId: seasons[1].stable_id } });
  assert.equal(nodes(stale.render()).some(node => node.type === 'Preview'), false);
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

test('furniture checkout never charges for or sends a cached seasonal loadout', async () => {
  const wallpaper = { stable_id: 'wall', title: 'wall', category: 'wallpapers', item_type: 'decor', price: 0, metadata: { slot: 'wallpaper', starter: true } };
  const table = { stable_id: 'table', title: 'table', category: 'tables', item_type: 'decor', price: 200, metadata: { slot: 'table' } };
  const room = { ...data, catalog: [...data.catalog, wallpaper, table], inventory: [...data.inventory,
    { owner_id: 'me', item_id: 'wall' }], loadouts: [{ room_type: 'home', owner_id: 'me', slot: 'background', item_id: seasons[1].stable_id }] };
  const h = shopHarness({ data: room, section: 'decorate', initialCategory: 'tables' });
  let tree = h.render();
  const options = nodes(tree).find(node => node.props?.items?.includes(table));
  options.props.onSelect(table);
  tree = h.render();
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children === 'Total: {coin} 200'));
  const pay = nodes(tree).find(node => node.type === 'Pressable' && nodes(node)
    .some(child => child.type === 'Text' && child.props.children === 'Pay'));
  assert.equal(pay.props.disabled, false);
  pay.props.onPress();
  await flush();
  assert.equal(h.checkouts.length, 1);
  assert.deepEqual({ ...h.checkouts[0][0] }, { wallpaper: 'wall', table: 'table' });
  assert.equal(h.saves.length, 0);
});

test('season retirement is non-destructive and prevents purchases, gifts and drops', () => {
  const sql = fs.readFileSync('supabase/migrations/20261011000221_burrow_automatic_seasons.sql', 'utf8');
  assert.match(sql, /status='retired', price=null, tradable=false, drop_weight=0/);
  assert.match(sql, /where category='seasons' and metadata->>'slot'='background'/);
  assert.ok(!/delete from|update (?:public\.)?(?:room_loadouts|user_inventory|coin_wallets)/i.test(sql));
  const registry = fs.readFileSync('apps/mobile/src/lib/burrow-shop-icons.ts', 'utf8');
  assert.match(registry, /dresser_plants: require\('.*burrow-shop-icons\/kettle.webp'\)/);
  assert.ok(!registry.includes('burrow-shop-icons/dresser_plants.png'));
});

test('automatic environment refreshes across months and on foreground, with offline regional fallback', () => {
  const h = hooks(), c = clock();
  const start = Date.UTC(2026, 1, 28, 23, 59, 30);
  class RoomDate extends Date {
    constructor(...args) { super(...(args.length ? args : [RoomDate.now()])); }
    static now() { return start + c.globals.Date.now() - 10000; }
  }
  let foreground, country = 'US';
  const model = load('apps/mobile/src/lib/burrow-map-model.ts');
  const { useBurrowEnvironment } = load('apps/mobile/src/lib/use-burrow-environment.ts', {
    react: {...h.react,useSyncExternalStore:(_subscribe,get)=>get()},
    './burrow-environment-state':{getBurrowEnvironment:()=>({context:null}),subscribeBurrowEnvironment:()=>()=>{}},
    'react-native': { AppState: { addEventListener(_event, fn) {
      foreground = fn; return { remove() { foreground = undefined; } };
    } } },
    './burrow-map-model': model, './use-burrow-storefront': { useBurrowStorefront: () => country },
  }, { ...c.globals, Date: RoomDate });
  const read = now => h.render(() => useBurrowEnvironment('UTC', now));
  assert.equal(read().season, 'winter');
  c.advance(60000);
  assert.equal(read().season, 'spring');
  country = 'AU';
  foreground('active');
  assert.equal(read().season, 'autumn');
  assert.equal(read(Date.UTC(2026, 6, 1)).season, 'winter');
  assert.equal(c.timers.size, 0, 'external clock does not create another timer');
  h.unmount();
  assert.equal(foreground, undefined);
});

test('Home, partner room and static previews ignore old purchased season and follow map environment', () => {
  const h = hooks(), layout = load('apps/mobile/src/lib/burrow-home-layout.ts');
  const model = load('apps/mobile/src/lib/burrow-map-model.ts');
  let country = 'US';
  const { HomeArtScene } = load('apps/mobile/src/components/burrow/home-art-scene.tsx', {
    ...require('./home-pull-test-mocks.cjs'),
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    './coin-ui': { CoinIcon: 'CoinIcon', CoinLabel: 'Text' },
    ...require('./burrow-attention-test-mocks.cjs'),
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    'expo-status-bar': { StatusBar: 'StatusBar' }, '@expo/vector-icons': { Feather: 'Icon' },
    './burrow-image': { Image: 'Image' }, './room-photo': { RoomPhoto: 'Photo' },
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'Placeholder' }, './interactive-doll': { InteractiveDoll: 'Doll' },
    './doll-photo-preview':{DollPhotoPreview:'PhotoPreview'},
    '@/lib/burrow-toy-photos': { toyPhotoFor: () => undefined }, '@/lib/burrow-doll-face': { dollFaceRect: () => ({}), framePhotoRect: () => ({}) },
    '@/lib/burrow-art-assets': art, '@/lib/burrow-home-layout': layout,
    '@/lib/use-burrow-environment': { useBurrowEnvironment: (tz, now) => model.burrowMapEnvironment(now, tz, country) },
  });
  for (const region of ['US', 'AU']) {
    country = region;
    for (const month of [1, 4, 7, 10]) {
      for(const hour of [0,6,12,18,23]){
      const now = Date.UTC(2026, month - 1, 1, hour);
      const expected = model.burrowMapEnvironment(now, 'UTC', country).season;
      const ordinal = { autumn: 1, spring: 2, summer: 3, winter: 4 }[expected];
      for (const mode of [{}, { previewOnly: true }, { partnerRoom: { name: 'Partner' } }]) {
        const tree = nodes(h.render(() => HomeArtScene({ ...mode, now, timeZone: 'UTC', slots: { background: seasons[3] }, ownerId: 'me', balance: 0 })));
        const asset=art.BURROW_ART.backgrounds[ordinal-1],source=hour>=6&&hour<18?asset.source:asset.nightSource;
        assert.ok(tree.some(node => node.type === 'Image' && node.props.source === source), `${region}/${month}/${hour}/${JSON.stringify(mode)}`);
        const backgrounds = tree.filter(node => node.type === 'Image' && art.BURROW_ART.backgrounds.some(asset => asset.source === node.props.source||asset.nightSource===node.props.source));
        assert.equal(backgrounds.length, 1);
        assert.equal(tree.filter(node=>node.props.testID==='home-background-floor'&&node.props.source===art.HOME_BACKGROUND_FLOOR.source).length,1);
        for(const layer of tree.filter(node=>['home-background-rim','home-background-floor'].includes(node.props?.testID))){
          assert.equal(layer.props.contentFit,'fill','native pixel rounding must not introduce contain letterboxing');
          assert.equal(layer.props.style.left,0);assert.equal(layer.props.style.width,390);
        }
      }
      }
    }
  }
  h.unmount();
});

test('Home keeps its native bunny mounted but hidden and paused while away, so arrival does not remount it',()=>{
  const src=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
  assert.doesNotMatch(src,/\{!away && <OutfitBunny/);
  assert.match(src,/opacity: bunnyAway \? 0 : 1/);
  assert.match(src,/active=\{!bunnyAway\}/);
  assert.match(src,/accessibilityElementsHidden=\{bunnyAway\}/);
});
