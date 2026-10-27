const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const PRODUCTS = ['burrow.coin.200', 'burrow.coin.400', 'burrow.coin.1000'];
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function harness(options = {}) {
  let h = hooks(); const time = clock(), products = deferred(), checkout = deferred(), calls = [];
  let purchase = { busy: false, message: null }, subscriptionBusy = false;
  let cache = options.cachedPrices ?? {};
  const priceModule = {
    cachedCoinPrices: () => cache,
    loadCoinPrices: async force => {
      if (!force && Object.keys(cache).length) return cache;
      calls.push('products');
      const rows = await products.promise;
      cache = Object.fromEntries(rows.filter(p => PRODUCTS.includes(p.id) && p.displayPrice).map(p => [p.id, p.displayPrice]));
      return cache;
    },
  };
  const react = Object.fromEntries(['useState', 'useRef', 'useEffect'].map(k => [k, (...args) => h.react[k](...args)]));
  const api = load('apps/mobile/src/components/burrow/carrot-shop.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: options.width ?? 390, height: options.height ?? 844 }) },
    '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'Crown' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' }, './coin-pack-art': { CoinPackArt: 'CoinPackArt' },
    '@/lib/haptics': { haptics: { selection() {}, light() {} } },
    '@/lib/coin-store-prices': priceModule,
    '@/lib/carrot-iap': { CARROT_PRODUCTS: PRODUCTS,
      prewarmCarrotPurchase: force => calls.push(['prewarm',force]),
      purchaseCarrots: async id => { calls.push(['buy', id]); return checkout.promise; }, useCarrotPurchase: () => purchase },
    '@/lib/iap': { initIAP: async () => calls.push('init'), reconcileAvailablePurchases: async options => {assert.equal(options.coinsOnly,true);calls.push('reconcile');},
      isSubscriptionPurchaseBusy: () => subscriptionBusy },
  }, { ...time.globals, Error });
  const render = () => h.render(() => api.CarrotShop({ balance: options.balance ?? 0,
    onClose: () => calls.push('close'), onTryPlus: () => calls.push('plus') }));
  const all = () => nodes(render());
  const labelled = label => all().find(n => n.props?.accessibilityLabel === label);
  const packs = () => all().filter(n => n.type === 'Pressable' && n.props?.accessibilityLabel?.startsWith('Buy '));
  const pressText = text => {
    const n = all().find(n => n.type === 'Pressable' && nodes(n.props.children).some(c => c.type === 'Text' && c.props.children === text));
    assert.ok(n, text); n.props.onPress();
  };
  render();
  return { render, all, labelled, packs, pressText, calls, products, checkout, time,
    setPurchase: state => { purchase = state; }, setSubscriptionBusy: value => { subscriptionBusy = value; },
    async ready(rows = PRODUCTS.map((id, i) => ({ id, displayPrice: ['€2,99', '€4,99', '€9,99'][i] }))) {
      products.resolve(rows); await flush(); render();
    }, remount() { h.unmount(); h = hooks(); render(); }, unmount: () => h.unmount() };
}

test('three compact cards use store-localized prices; each card directly opens its exact consumable', async () => {
  for (let i = 0; i < PRODUCTS.length; i++) {
    const h = harness(); await h.ready();
    assert.equal(h.packs().length, 3);
    assert.ok(h.packs()[0].props.accessibilityLabel.includes('€2,99'));
    assert.ok(h.packs()[2].props.accessibilityLabel.includes('1,000'));
    assert.equal(h.all().filter(n => n.type === 'CoinPackArt').length, 4);
    assert.deepEqual(h.all().filter(n => n.type === 'CoinPackArt').map(n => n.props.amount), [1000, 200, 400, 1000]);
    assert.equal(h.all().some(n => n.props?.children === 'Reload store prices'), false);
    h.packs()[i].props.onPress(); await flush();
    assert.deepEqual(h.calls.filter(x => Array.isArray(x)&&x[0]==='buy'), [['buy', PRODUCTS[i]]]);
    h.checkout.resolve(); await flush(); h.unmount();
  }
});
test('Burrow Coins explains quests and unlocks with the requested exact copy',()=>{
 const h=harness();assert.ok(h.all().some(n=>n.props?.children==='Complete quests to earn coins and unlock new items, gift and games!'));h.unmount();
});
test('cold URI and warm ImageRef pack art have identical square viewports on all supported sizes',()=>{
 const flatten=s=>Object.assign({},...(Array.isArray(s)?s:[s]).filter(Boolean));
 for(const height of [568,844,1024]){
  const h=harness({height});
  const viewports=h.all().filter(n=>n.type==='View'&&n.props.children?.type==='CoinPackArt');
  assert.equal(viewports.length,4);
  for(const viewport of viewports){const style=flatten(viewport.props.style);assert.equal(style.width,style.height);assert.equal(typeof style.width,'number');}
  assert.equal(flatten(viewports[1].props.style).width,height<700?44:48);h.unmount();
 }
});
test('coin purchase card has no balance wallet or empty header row and shrinks to content on small and large screens',()=>{
 for(const height of [568,844,1024]){
  const h=harness({height,balance:12345}),all=h.all(),scroll=all.find(n=>n.type==='ScrollView');
  assert.equal(all.some(n=>n.type==='CoinWallet'||n.props?.testID==='coin-wallet-face'),false);
  assert.equal(all.some(n=>n.type==='Text'&&n.props.children===12345),false);
  assert.equal(scroll.props.style.flexGrow,0);assert.equal(scroll.props.style.flexShrink,1);
  assert.equal(h.labelled('Close coin shop').props.style.position,'absolute');
  assert.equal(nodes(scroll).some(n=>n.props?.accessibilityLabel==='Close coin shop'),false,'close remains fixed while content scrolls');h.unmount();
 }
});
test('rapid taps cannot open another purchase or Plus while first checkout starts', async () => {
  const h = harness(); await h.ready(); const [first, second] = h.packs();
  first.props.onPress(); second.props.onPress(); h.labelled('Try Plus').props.onPress(); await flush();
  assert.equal(h.calls.filter(x => Array.isArray(x)&&x[0]==='buy').length, 1);
  assert.equal(h.calls.includes('plus'), false);
  assert.ok(h.packs().every(n => n.props.disabled));
  h.checkout.resolve(); await flush(); h.setPurchase({ busy: true, message: 'Waiting for the store…' });
  assert.equal(h.labelled('Try Plus').props.disabled, true); h.unmount();
});
test('checkout shows a centered spinner immediately, hides connection/status copy and retains terminal recovery',async()=>{
  const h=harness();await h.ready();
  assert.ok(h.calls.some(x=>Array.isArray(x)&&x[0]==='prewarm'),'opening warms authenticated readiness alongside prices');
  h.packs()[0].props.onPress();
  let loader=h.labelled('Processing purchase');assert.equal(loader.props.accessibilityRole,'progressbar');
  assert.equal(loader.props.style.alignItems,'center');assert.equal(loader.props.style.justifyContent,'center');
  assert.equal(nodes(loader).filter(n=>n.type==='ActivityIndicator').length,1);
  assert.ok(!h.all().some(n=>n.type==='Text'&&/Connecting|Waiting for the store/.test(n.props.children)));
  h.checkout.resolve();await flush();
  for(const message of ['Waiting for the store…','Connecting to the store…','Sandbox testing: this purchase credits a separate test balance, not Home coins.']){
    h.setPurchase({busy:true,message});assert.ok(h.labelled('Processing purchase'));
    assert.ok(!h.all().some(n=>n.type==='Text'&&n.props.children===message));
  }
  const message='Your payment is not confirmed yet. Check pending purchases to retry safely; you will not be credited twice.';
  h.setPurchase({busy:false,message,status:'unconfirmed'});assert.equal(h.labelled('Processing purchase'),undefined);
  assert.ok(h.all().some(n=>n.type==='Text'&&n.props.children===message));
  h.pressText('Check pending purchases');await flush();assert.ok(h.calls.includes('reconcile'));h.unmount();
});
test('slow or unavailable store never blocks Plus; missing products cannot be purchased', async () => {
  const h = harness(); assert.ok(h.packs().every(n => n.props.disabled));
  assert.equal(h.labelled('Try Plus').props.disabled, false);
  h.labelled('Try Plus').props.onPress(); assert.ok(h.calls.includes('plus'));
  await h.ready([{ id: PRODUCTS[0], displayPrice: '¥18.00' }, { id: 'other.product', displayPrice: '$1' }]);
  assert.equal(h.packs()[0].props.disabled, false);
  assert.equal(h.packs()[1].props.disabled, true);
  h.packs()[1].props.onPress(); assert.equal(h.calls.filter(x=>Array.isArray(x)&&x[0]==='buy').length, 0); h.unmount();
});
test('subscription ownership blocks coin checkout and Plus navigation', async () => {
  const h = harness(); await h.ready(); h.setSubscriptionBusy(true);
  h.packs()[0].props.onPress(); h.labelled('Try Plus').props.onPress();
  assert.equal(h.calls.includes('plus'), false); assert.equal(h.calls.filter(x=>Array.isArray(x)&&x[0]==='buy').length, 0);
  assert.ok(h.all().some(n => n.props?.children === 'Please finish your subscription purchase first.')); h.unmount();
});
test('store failure shows bounded recovery actions; pending check reuses transaction reconciliation', async () => {
  const h = harness(); h.products.reject(Error('Store offline')); await flush();
  assert.ok(h.packs().every(n => n.props.disabled));
  assert.ok(h.all().some(n => n.props?.children === 'The store is unavailable. Please try again.'));
  h.pressText('Retry store'); await flush(); assert.equal(h.calls.includes('reconcile'),false); h.unmount();
});
test('cancelled checkout returns to the same shop without messages or recovery buttons',async()=>{
  const h=harness();await h.ready();h.packs()[0].props.onPress();h.checkout.resolve();await flush();
  h.setPurchase({busy:false,message:null,status:'idle'});
  assert.equal(h.labelled('Processing purchase'),undefined);
  assert.ok(h.packs().every(n=>!n.props.disabled));
  assert.ok(!h.all().some(n=>n.type==='Text'&&/cancelled|Retry store|Check pending purchases/i.test(n.props.children)));
  assert.equal(h.calls.includes('close'),false);h.unmount();
});
test('prefetched prices are instant on first opening and reopen; closed shops do not cancel global prefetch', async () => {
  const prefetched = harness({ cachedPrices: Object.fromEntries(PRODUCTS.map(id => [id, '€2,99'])) });
  assert.ok(prefetched.packs().every(n => !n.props.disabled));
  assert.equal(prefetched.calls.includes('products'), false); prefetched.unmount();
  const h = harness(); await h.ready(); h.remount(); await flush();
  assert.equal(h.calls.filter(x => x === 'products').length, 1);
  assert.ok(h.packs().every(n => !n.props.disabled)); h.unmount();
  const abandoned = harness(); await flush(); abandoned.unmount();
  abandoned.products.resolve(PRODUCTS.map(id => ({ id, displayPrice: '$99' }))); await flush();
  abandoned.remount(); await flush();
  assert.equal(abandoned.calls.filter(x => x === 'products').length, 1);
  assert.ok(abandoned.packs().every(n => !n.props.disabled)); abandoned.unmount();
});
test('small screen stays scrollable, refunded balances are explained and close works', async () => {
  const h = harness({ width: 320, height: 568, balance: -30 }); await h.ready();
  const root = h.render(); assert.equal(root.props.style[1].width, 288); assert.equal(root.props.style[1].maxHeight, '100%');
  assert.ok(h.all().some(n => n.type === 'ScrollView' && n.props.bounces === false));
  h.labelled('Close coin shop').props.onPress(); assert.ok(h.calls.includes('close')); h.unmount();
});
test('transparent route preserves underlying page and replaces itself with subscription paywall', () => {
  const calls = [];
  const route = load('apps/mobile/app/(main)/coin-shop.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { router: { canGoBack: () => true, back: () => calls.push('back'), replace: x => calls.push(x) } },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x, absoluteFill: {} } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    '@/components/burrow/carrot-shop': { CarrotShop: 'CarrotShop' }, '@/lib/burrow-store': { useBurrowSnapshot: () => ({ data: null }) },
  });
  const tree = nodes(route.default()); const card = tree.find(n => n.type === 'CarrotShop');
  assert.equal(card.props.balance, 0); card.props.onTryPlus(); card.props.onClose();
  assert.deepEqual(calls, ['/(main)/(modals)/subscription-paywall', 'back']);
  assert.match(fs.readFileSync('apps/mobile/app/(main)/_layout.tsx', 'utf8'), /name="coin-shop" options=\{\{ presentation: 'transparentModal'/);
  assert.match(fs.readFileSync('apps/mobile/app/(main)/burrow-detail.tsx', 'utf8'), /section==='carrot_shop'.*Redirect href="\/\(main\)\/coin-shop"/);
});
