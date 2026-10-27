const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./lifecycle-test-utils.cjs');
const shopCategories = load('apps/mobile/src/lib/burrow-shop-categories.ts', {
  '@novame/domain': { BURROW_DECOR_SHOP_CATEGORIES: ['cushions','tables','rugs','vases','lamps','windows','cabinets','shelves','shelf_decor','music_players','frames','posters','couple_dolls','light_strings','ladders','dresser_plants'] },
});
const model = load('apps/mobile/src/lib/collection-room-model.ts', { './burrow-shop-categories': shopCategories });
const item = (id, type, category, metadata = {}, tags = []) => ({ stable_id: id, item_type: type, category, title: id, metadata, tags });
const data = {
  profile: { id: 'me' }, partner: { id: 'partner' }, wallet: { balance: 1240 }, gifts: [],
  adventureCollection: { enabled: true },
  catalog: [item('chair', 'decor', 'cushions', { slot: 'cushion' }), item('lamp', 'decor', 'lamps'),
    item('outfit', 'outfit', 'outfits'), item('room', 'our_room', 'our_room'), item('season', 'decor', 'seasons'), item('wallpaper', 'decor', 'wallpapers'),
    item('gift', 'decor', 'shelf_decor', { giftCategory: 'Lanterns', friendId: 'adventure_friend_arlo' }, ['adventure_v2_gift']),
    item('unknown-gift', 'decor', 'shelf_decor', { giftCategory: 'Plants' }, ['adventure_v2_gift'])],
  inventory: [{ owner_id: 'me', item_id: 'chair' }, { owner_id: 'me', item_id: 'gift' }, { owner_id: 'partner', item_id: 'lamp' }],
  friends: [{ stable_id: 'legacy', name: 'Old friend' }, { stable_id: 'adventure_friend_arlo', name: 'Arlo' }, { stable_id: 'adventure_friend_fenn', name: 'Fenn' }],
  discoveries: [{ user_id: 'me', friend_id: 'adventure_friend_arlo', interaction_completed_at: 'now' },
    { user_id: 'me', friend_id: 'adventure_friend_fenn', interaction_completed_at: null }],
};
const ids = entries => Array.from(entries, x => x.id);
test('Items exclude seasons and friend gifts; counts and ownership belong to the chosen person', () => {
  const mine = model.collectionRoomModel(data, 'me', 'items');
  assert.deepEqual(ids(mine.entries), ['chair', 'lamp', 'outfit', 'room', 'wallpaper']);
  assert.equal(mine.count, 1);
  assert.deepEqual(ids(model.collectionRoomModel(data, 'me', 'items', 'outfits').entries), ['outfit']);
  assert.deepEqual(ids(model.collectionRoomModel(data, 'me', 'items', 'wallpapers').entries), ['wallpaper']);
  assert.deepEqual(ids(model.collectionRoomModel(data, 'me', 'items', 'lamps').entries), ['lamp']);
  const partner = model.collectionRoomModel(data, 'partner', 'items');
  assert.equal(partner.count, 1); assert.equal(partner.entries[0].id, 'lamp');
  assert.equal(partner.entries.find(x => x.id === 'chair').found, false);
});
test('Default outfit is not a Collection item or part of its collected count',()=>{
 const starter=item('default-outfit','outfit','outfits',{starter:true,slot:'outfit'});
 const snapshot={...data,catalog:[starter,...data.catalog],inventory:[{owner_id:'me',item_id:starter.stable_id},...data.inventory]};
 const list=model.collectionRoomModel(snapshot,'me','items');
 assert.equal(list.entries.some(x=>x.id===starter.stable_id),false);assert.equal(list.count,1);
 assert.deepEqual(ids(model.collectionRoomModel(snapshot,'me','items','outfits').entries),['outfit']);
});
test('Gifts have real origins/category filters and completed friend conversations count once', () => {
  const gifts = model.collectionRoomModel(data, 'me', 'gifts', 'all', 'Lanterns');
  assert.equal(gifts.count, 1); assert.deepEqual(ids(gifts.entries), ['gift']);
  assert.equal(gifts.entries[0].origin, 'From Arlo');
  assert.equal(model.collectionRoomModel(data, 'me', 'gifts', 'all', 'Removed category').selectedCategory, null);
  const friends = model.collectionRoomModel(data, 'me', 'friends');
  assert.equal(friends.count, 1); assert.equal(friends.totalFriends, 2);
  assert.equal(model.collectionRoomModel(data, 'partner', 'friends').count, 0);
});
test('four-column items/gifts and three-column friends fit all supported screen widths', () => {
  for (const width of [320, 375, 390, 430, 560, 820]) for (const tab of ['items', 'gifts', 'friends']) {
    const g = model.collectionGridLayout(width, tab);
    assert.equal(g.columns, tab === 'friends' ? 3 : 4);
    assert.ok(g.cardWidth > 60);
    assert.ok(Math.abs(g.padding * 2 + g.columns * g.cardWidth + (g.columns - 1) * g.gap - g.boardWidth) < 1e-9);
  }
});
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function harness(snapshot = data, missingArt = false) {
  const h = hooks(), resolved = [], routes = [], claims = [];
  const { CollectionRoomScreen } = load('apps/mobile/src/components/burrow/collection-room-screen.tsx', {
    './coin-ui': { CoinIcon: 'CoinIcon' },
    react: { ...h.react, memo: fn => fn }, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Button', ScrollView: 'Scroll', FlatList: 'List',
      StyleSheet: { create: x => x, absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'expo-router': { router: { push: x => routes.push(x), back() {} } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' },
    '@/lib/collection-room-model': model,
    '@/lib/burrow-shop-categories': shopCategories,
    '@/lib/burrow-art-assets': { BURROW_BACKGROUNDS: { common: 1 }, burrowArtForItem: item => {
      resolved.push(item.stable_id); if(missingArt)return null;return { source: item.stable_id.includes('gift') ? { uri: 'https://r2.example/' + item.stable_id } : 2, width: 500, height: 500, bounds: [0, 0, 500, 500] };
    } },
    '@/lib/burrow-ui-assets': { burrowFriendArt: () => 3 }, '@/lib/room-photo-crop': { FRAME_ART_REFERENCE_BOUNDS: [0, 0, 500, 500] },
    './burrow-image': { Image: 'Image' }, './burrow-back-button': { BurrowBackButton: 'Back' },
    './outfit-bunny': { OutfitBunny: 'Bunny' }, './shop-category-icon': { ShopCategoryIcon: 'CategoryIcon' },
    './outfit-thumbnail':{OutfitThumbnail:'Thumbnail'},
  });
  const render = () => h.render(() => CollectionRoomScreen({ data: snapshot, loading: false, error: 'offline', onRefresh() {}, onClaimGift: id => claims.push(id) }));
  const press = label => nodes(render()).find(n => n.props?.accessibilityLabel === label).props.onPress();
  const panels = () => nodes(render()).filter(n => n.type?.name === 'CollectionGrid');
  const list = tab => { const panel = panels().find(n => n.props.tab === tab); return nodes(panel.type(panel.props)).find(n => n.type === 'List'); };
  const card = (tab, entry) => { const node = list(tab).props.renderItem({ item: entry }); return node.type(node.props); };
  return { render, press, resolved, routes, claims, panels, list, card };
}
test('Collection keeps the shared circular back button at its full size and clear of the title',()=>{
 const h=harness(),tree=nodes(h.render()),back=tree.find(n=>n.type==='Back');
 assert.equal(back.props.light,true);
 assert.equal(back.props.style.position,'absolute');
 for(const property of ['width','height','borderRadius','backgroundColor'])assert.equal(back.props.style[property],undefined);
 const header=tree.find(n=>n.props?.style?.paddingTop===54);
 assert.ok(header.props.style.paddingTop>=44,'the title clears the full-sized back button');
});
test('Collection Toy art preserves the full source canvas instead of applying a silhouette fit',()=>{
 const h=harness(),toy=item('toy','decor','couple_dolls',{slot:'couple_doll'});
 const card=h.card('items',{id:'toy',title:'Toy',found:true,item:toy});
 const node=nodes(card).find(n=>n.type?.name==='CollectionArt'),image=nodes(node.type(node.props)).find(n=>n.type==='Image');
 assert.equal(image.props.contentFit,'contain');assert.equal(image.props.style.width,image.props.style.height);
 assert.equal(image.props.style.position,undefined);
});
test('removed retired Collection art remains an empty slot, not a category or mystery icon',()=>{
 const h=harness(data,true),retired={...item('removed','decor','wallpapers'),status:'active'};
 const card=h.card('items',{id:'removed',title:'Removed',found:true,item:retired});
 const node=nodes(card).find(n=>n.type?.name==='CollectionArt');
 const tree=node.type(node.props);
 assert.equal(tree.type,'View');assert.ok(tree.props.style.width>0);assert.equal(tree.props.style.width,tree.props.style.height);
 assert.equal(tree.props.children,undefined,'blank slot, no category, mystery icon or replacement product');
});
test('Collection headings share Gifts size and reserved height; Friends and received copy are exact',()=>{
 const h=harness();
 for(const tab of ['items','friends','gifts']){
  h.press(tab[0].toUpperCase()+tab.slice(1));
  const tree=nodes(h.render()),headings=tree.filter(n=>n.props?.accessibilityRole==='header');
  assert.ok(headings.some(n=>n.props.children==='Collection Room'));
  for(const text of headings.filter(n=>n.props.children!=='Collection Room')){
   assert.equal(Object.assign({},...text.props.style).fontSize,20);
  }
  assert.ok(tree.some(n=>n.props?.style?.minHeight===50));
  if(tab==='friends')assert.ok(tree.some(n=>n.props?.children==='Friends met in adventure'));
  if(tab==='gifts')assert.ok(tree.some(n=>n.props?.children==='1 received'));
  assert.equal(tree.some(n=>n.props?.style?.height===8&&n.props?.style?.borderRadius===4),false);
 }
});
test('three persistent memoized panels switch visibility only; no owner toggle, loading request or Owned labels', () => {
  const h = harness();
  const original = h.panels().map(n => n.props.entries);
  const keys = () => nodes(h.render()).filter(n => n.props?.importantForAccessibility).map(n => n.key);
  const firstKeys = keys();
  for (const [tab, columns] of [['Items', 4], ['Gifts', null], ['Friends', 3]]) {
    h.press(tab);
    const tree = nodes(h.render());
    if(columns){const list = h.list(tab.toLowerCase());
      assert.equal(list.props.numColumns, columns); assert.equal(list.props.windowSize, 3);
      assert.equal(list.key, undefined, 'filters/tabs cannot remount the FlatList');
    }else{assert.ok(tree.some(n=>n.type==='AdventureGiftCollection'&&n.props.embedded));}
    assert.deepEqual(keys(), firstKeys);
    h.panels().forEach((panel, i) => assert.equal(panel.props.entries, original[i], 'same prepared arrays'));
    assert.equal(tree.some(n => n.type === 'Text' && n.props.children === 'Everything we’ve found together'),false);
    assert.ok(tree.some(n => n.type === 'Text' && n.props.children === 'Collection Room'));
    assert.ok(tree.some(n => n.props?.accessibilityLabel === 'Retry collection refresh'));
    assert.equal(tree.some(n => ['My collection', 'Partner’s collection'].includes(n.props?.accessibilityLabel)), false);
    assert.equal(tree.some(n => n.props?.children === 'Owned'), false);
    assert.equal(tree.some(n => n.type === 'CoinIcon'), false, 'Collection has no coin-spending controls');
    assert.equal(tree.some(n => n.props?.accessibilityLabel === 'Open coin shop'), false, 'Collection header has no wallet shortcut');
  }
  const source = fs.readFileSync('apps/mobile/src/components/burrow/collection-room-screen.tsx', 'utf8');
  assert.match(source, /const CollectionGrid = memo/); assert.match(source, /const CollectionCard = memo/);
  assert.ok(!source.includes('setOwner')); assert.ok(!source.includes('refreshBurrow'));
});
test('Items use the exact Shop icon categories and unowned cards render only a question without decoding art', () => {
  const h = harness();
  // Icon function remains a JSX component until native rendering.
  const icons = nodes(h.render()).filter(n => n.type === 'CategoryIcon');
  assert.equal(icons.length, shopCategories.BURROW_SHOP_CATEGORIES.length);
  assert.deepEqual(icons.map(n => n.props.category), Array.from(shopCategories.BURROW_SHOP_CATEGORIES));
  h.press('Floor Lamps'); const card = h.card('items', h.list('items').props.data[0]);
  assert.equal(card.props.disabled, true);
  const art = nodes(card).find(n => typeof n.type === 'function');
  assert.equal(nodes(art.type(art.props)).some(n => n.type === 'Image'), false);
  assert.deepEqual(h.resolved, []);
  h.press('Cushions'); const owned = h.card('items', h.list('items').props.data[0]);
  assert.ok(!nodes(owned).some(n => n.props?.children === 'Owned'));
  const before = h.list('items').props.data;
  h.press('Floor Lamps'); h.press('Cushions'); assert.equal(h.list('items').props.data, before);
});
test('Gifts reuse the Home category library and category navigation returns to Collection', () => {
  const h = harness(); h.press('Gifts');
  const tree=nodes(h.render()),library=tree.find(n=>n.type==='AdventureGiftCollection');
  assert.equal(library.props.data,data);assert.equal(library.props.ownerId,'me');
  assert.equal(library.props.embedded,true);
  assert.ok(tree.some(n=>n.props?.children==='Gifts from Burrow Friends'));
  library.props.onOpenCategory('Lanterns');
  assert.equal(h.routes.at(-1).params.category,'Lanterns');
  assert.equal(h.routes.at(-1).params.returnTo,'collection');
  assert.deepEqual(h.resolved,[],'the parent never resolves locked reward images');
});
test('owned decorations can be placed, locked items cannot; cache-less screen keeps its layout without a spinner', () => {
  const h = harness(); h.press('Cushions');
  const owned = h.card('items', h.list('items').props.data[0]); owned.props.onPress();
  assert.equal(h.routes[0].params.ownedOnly, '1'); assert.equal(h.routes[0].params.itemId, 'chair');
  h.press('Floor Lamps'); assert.equal(h.card('items', h.list('items').props.data[0]).props.disabled, true);
  const emptyHarness = harness(null), empty = nodes(emptyHarness.render()); assert.ok(emptyHarness.list('items'));
  assert.equal(empty.some(n => n.type === 'ActivityIndicator'), false);
  const source = fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx', 'utf8');
  assert.match(source, /if\(section==='collection'\)return <CollectionRoomScreen/);
  assert.ok(!source.includes('collectionTab')); assert.ok(source.includes("router.push('/(main)/gift-library')"), 'Home gift-shelf picker opens the native library route');
});
test('prepared arrays survive reopening and wallet refresh; ownership and discovery changes invalidate the cache', () => {
  const first = model.collectionRoomModel(data, 'me', 'items', 'lamps').entries;
  assert.equal(model.collectionRoomModel(data, 'me', 'items', 'lamps').entries, first);
  assert.equal(model.collectionRoomModel({ ...data, wallet: { balance: 900 } }, 'me', 'items', 'lamps').entries, first);
  const claimed = { ...data, inventory: [...data.inventory, { owner_id: 'me', item_id: 'lamp' }] };
  const updated = model.collectionRoomModel(claimed, 'me', 'items', 'lamps');
  assert.notEqual(updated.entries, first); assert.equal(updated.entries[0].found, true);
  const partner = model.collectionRoomModel(claimed, 'partner', 'items', 'cushions'); assert.equal(partner.entries[0].found, false);
  const met = { ...claimed, discoveries: [...data.discoveries, { user_id: 'me', friend_id: 'adventure_friend_fenn', interaction_completed_at: 'now' }] };
  assert.equal(model.collectionRoomModel(met, 'me', 'friends').count, 2);
});
test('each Shop category places all owned items first, followed by every locked item', () => {
  const snapshot = { ...data, catalog: [item('locked-first', 'decor', 'lamps'), ...data.catalog,
    item('mine-last', 'decor', 'lamps')], inventory: [...data.inventory, { owner_id: 'me', item_id: 'mine-last' }] };
  const lamps = model.collectionRoomModel(snapshot, 'me', 'items', 'lamps').entries;
  assert.deepEqual(ids(lamps), ['mine-last', 'locked-first', 'lamp']);
  assert.equal(lamps[0].found, true); assert.ok(lamps.slice(1).every(row => !row.found));
});
