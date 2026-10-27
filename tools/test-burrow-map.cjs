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
  assert.equal(model.BURROW_MAP_ROOMS.map(room => room.id).join(','), 'my_room,partner_room,surprise_room,game_room,rage_room,friends_room,memories_room,collection_room');
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
    assert.equal(light.top + light.height / 2, left.top + 145 - 6);
    assert.equal(branch.top + branch.height / 2, left.top + 145);
    assert.ok(layout.height > left.top + left.height);
  }
  assert.equal(model.burrowMapLayout(10).height - layout.height, 370);
  assert.equal(layout.height - model.burrowMapLayout(6).height, 370);
  assert.equal(model.burrowMapLayout(7).branches[3].width, 121, 'no dangling passage to an absent eighth room');
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

test('storefront is frozen for a foreground visit; silent updates are applied on the next foreground', async () => {
  const d = deferred(); let calls = 0;
  const h = storefrontHarness({ cached: 'AUS', getStorefront: () => { calls++; return calls === 1 ? d.promise : Promise.resolve('NZL'); } });
  assert.equal(h.read(), 'AUS');
  d.resolve(' usa '); await flush();
  assert.equal(h.read(), 'AUS', 'a slow storefront response cannot change the visible season');
  assert.equal(h.values.get('country'), 'USA');
  h.foreground(); await flush();
  assert.equal(h.read(), 'USA');
  assert.equal(h.values.get('country'), 'NZL');
  h.foreground();assert.equal(h.read(),'NZL');
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
  assert.equal(timeout.read(), 'AU');assert.equal(timeout.values.get('country'),'NZ');
  timeout.foreground();assert.equal(timeout.read(),'NZ');timeout.unmount();
});

test('old-account in-flight result cannot overwrite the new account storefront', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const h = storefrontHarness({ cached: 'USA', getStorefront: () => ++calls === 1 ? old.promise : fresh.promise });
  assert.equal(h.read(), 'USA'); h.changeIdentity();
  assert.equal(h.read(), 'AU'); old.resolve('USA'); await flush();
  assert.equal(h.values.size, 0);
  fresh.resolve('NZL'); await flush(); assert.equal(h.read(), 'AU');assert.equal(h.values.get('country'),'NZL');
  h.foreground();assert.equal(h.read(),'NZL');h.unmount();
});

test('map UI places labels inside pills, uses seasonal banner, and every room is tappable', () => {
  const jsx = (type, props) => ({ type, props });
  const icons = Object.fromEntries(model.BURROW_MAP_ROOMS.map(r => [r.id, r.id]));
  const { BurrowMap } = load('apps/mobile/src/components/burrow/burrow-map.tsx', {
    './plushie-touch-badge':{PlushieTouchBadge:'TouchBadge'},
    ...require('./burrow-attention-test-mocks.cjs'),
    'react/jsx-runtime': { jsx, jsxs: jsx }, './burrow-image': { Image: 'Image' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: s => s, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 400 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20 }) },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' },
    '@/lib/burrow-ui-assets': { BURROW_ROOM_ICONS: icons }, '@/lib/burrow-map-model': model,
    '@/lib/bunny-variant-assets':{BUNNY_ICONS:{biscuit:'bunny-biscuit',pinky:'bunny-pinky'}},
    '@/lib/burrow-map-assets': { BURROW_MAP_ART: { room: 'room', light: 'light', banners: { 'spring-day': 'spring-day' } } },
    '@/lib/use-burrow-environment': { useBurrowEnvironment: (tz, now) => model.burrowMapEnvironment(now, tz, 'AU') },
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
    const id = model.BURROW_MAP_ROOMS[buttons.indexOf(button)].id;
    const icon = all(button).find(n => n.type === 'Image' && n.props.source === (id==='my_room'?'bunny-biscuit':id==='partner_room'?'bunny-pinky':id));
    assert.equal(icon.props.contentFit, 'contain');
    assert.equal(icon.props.style.width,'100%');
    assert.equal(icon.props.style.height,'100%');
    const door=all(button).find(n=>n.type==='Image'&&n.props.source==='room');
    assert.equal(door.props.contentFit,'contain');assert.equal(door.props.style.width,door.props.style.height);
    const labelBox=all(button).find(n=>n.type==='View'&&n.props.style?.some?.(s=>s?.backgroundColor==='#FFF2DF'));
    assert.ok(labelBox,'room name is inside a real cream box, not assumed to be baked into the door');
  }
  assert.equal(buttons[0].props.accessibilityLabel, 'Open My Room');
  assert.equal(buttons[1].props.accessibilityLabel, 'Open Partner’s Room');
  assert.equal(buttons[5].props.accessibilityLabel, "Open Friend's Room");
});
test('door ratio, label space and shadow share design coordinates without stretching the new asset',()=>{
  const art=model.BURROW_ROOM_ART,label=model.BURROW_ROOM_LABEL,icon=model.BURROW_ROOM_ICON;
  // Read the bundled WebP canvas too: a future replacement must not silently
  // retain an obsolete layout ratio (the regression this test protects).
  const webp=fs.readFileSync('apps/mobile/assets/burrow-webp/burrow-page/room.webp');
  assert.equal(webp.toString('ascii',12,16),'VP8X');
  const sourceWidth=1+webp.readUIntLE(24,3),sourceHeight=1+webp.readUIntLE(27,3);
  assert.equal(sourceWidth,1024);assert.equal(sourceHeight,1024);
  assert.equal(art.width/art.height,sourceWidth/sourceHeight);assert.equal(icon.width,icon.height);
  assert.equal(icon.width,140*.8);
  assert.equal(icon.left+icon.width/2,art.left+art.width/2);
  assert.equal(icon.top+icon.height/2,art.top+art.height/2);
  assert.equal(label.left+label.width/2,art.left+art.width/2);
  assert.ok(label.top>art.height*.8&&label.top<art.height*.9,'label covers only the lower frame');
  assert.ok(label.top>=art.top+art.height*856/1024+8,
    'label clears the lowest green panel pixels with a small visible wooden gap');
  const tabBarSource=fs.readFileSync(path.join(process.cwd(),'apps/mobile/src/components/main/bottom-tab-bar.tsx'),'utf8');
  assert.ok(tabBarSource.includes("backgroundColor: '#FFF2DF'"),'room labels match the Home navigation cream');
  const layout=model.burrowMapLayout(8);assert.ok(label.top+label.height<=layout.rooms[0].height);
  assert.ok(layout.rooms[0].top+layout.rooms[0].height<layout.rooms[2].top);
  for(const width of [320,375,390,430,800]){
    const scale=width/800,shadow=model.burrowRoomIconShadow(scale);
    assert.equal(shadow.shadowColor,'#000000');assert.equal(shadow.shadowOpacity,.5);
    assert.equal(shadow.shadowRadius,1.5*scale);
    assert.equal(shadow.shadowOffset.width,-3*scale);
    assert.equal(shadow.shadowOffset.height,10*scale);
    assert.ok(Math.hypot(shadow.shadowOffset.width,shadow.shadowOffset.height)<icon.width*scale*.1,
      'contact shadow stays against the icon instead of casting far across the door');
    assert.ok((layout.rooms[0].left+label.left+label.width)*scale<width/2);
    for(const room of layout.rooms){
      assert.ok((room.left+art.left)*scale>=0);
      assert.ok((room.left+art.left+art.width)*scale<=width);
      assert.ok(label.top+label.height<=room.height,'label remains inside the tappable room');
    }
    assert.equal(layout.rooms[0].left+icon.left+icon.width/2,
      800-(layout.rooms[1].left+icon.left+icon.width/2),'doors remain symmetric about the tunnel');
  }
});
test('only Burrow gains native edge rebound; quests and coin shop retain their non-bouncing scroll',()=>{
  const {burrowPageScrollBehavior}=load('apps/mobile/src/lib/burrow-surface.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(burrowPageScrollBehavior('burrow'))),
    {bounces:true,alwaysBounceVertical:true,overScrollMode:'always'});
  for(const section of ['quests','carrot_shop'])assert.deepEqual(JSON.parse(JSON.stringify(burrowPageScrollBehavior(section))),
    {bounces:false,alwaysBounceVertical:false,overScrollMode:'never'});
  for(const section of ['adventure','game_room','friends_room'])assert.deepEqual(JSON.parse(JSON.stringify(burrowPageScrollBehavior(section))),
    {bounces:true,alwaysBounceVertical:false,overScrollMode:'never'});
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(source,/<PageScrollView key=\{section\}[^\n]*?\{\.\.\.burrowPageScrollBehavior\(section\)\}/);
  assert.match(source,/const PageScrollView=section==='burrow'\?BurrowMapScrollView:ScrollView/);
  assert.match(source,/refreshControl=\{section==='burrow'\|\|section==='carrot_shop'\|\|section==='quests'\?undefined:/,
    'edge rebound must not introduce map pull-to-refresh');
});
test('map clamps only negative top offsets on the UI thread, leaving native bottom rebound untouched',()=>{
  const calls=[],ref={},jsx=(type,props)=>({type,props});let handlers;
  const {BurrowMapScrollView}=load('apps/mobile/src/components/burrow/burrow-map-scroll-view.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native-reanimated':{__esModule:true,default:{ScrollView:'NativeAnimatedScrollView'},
      useAnimatedRef:()=>ref,useAnimatedScrollHandler:h=>(handlers=h),
      scrollTo:(...args)=>calls.push(args)},
  });
  let layouts=0;const child={room:'map'},onLayout=()=>layouts++;
  const tree=BurrowMapScrollView({children:child,onLayout,style:{flex:1},bounces:false});
  assert.equal(tree.type,'NativeAnimatedScrollView');assert.equal(tree.props.children,child);
  tree.props.onLayout();assert.equal(layouts,1);
  assert.equal(tree.props.bounces,true);assert.equal(tree.props.alwaysBounceVertical,true);
  assert.equal(tree.props.contentInset.top,0);assert.equal(tree.props.contentInsetAdjustmentBehavior,'never');
  assert.equal(tree.props.refreshControl,undefined);assert.equal(tree.props.scrollEventThrottle,16);
  for(const callback of Object.values(handlers)){
    const before=calls.length;
    // Normal scroll, exact top, bottom and bottom overshoot must receive no command.
    for(const y of [0,1,200,1000,1100])callback({contentOffset:{x:0,y}});
    assert.equal(calls.length,before);
    for(const y of [-.01,-12,-180])callback({contentOffset:{x:0,y}});
    assert.equal(calls.length,before+3);
    for(const call of calls.slice(before))assert.deepEqual(call,[ref,0,0,false]);
    callback({contentOffset:{x:0,y:0}});assert.equal(calls.length,before+3,'correction cannot recurse at zero');
  }
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-map-scroll-view.tsx','utf8');
  assert.match(source,/'worklet'/);assert.doesNotMatch(source,/useState|runOnJS|setTimeout|withSpring/);
});
test('map heads follow current account identity, ignore stale partners and preserve previously approved same-colour pairs',()=>{
 const jsx=(type,props)=>({type,props}),all=t=>Array.isArray(t)?t.flatMap(all):t&&typeof t==='object'?[t,...all(t.props?.children)]:[];
 let mine='biscuit',identity;
 const {BurrowMap}=load('apps/mobile/src/components/burrow/burrow-map.tsx',{
  './plushie-touch-badge':{PlushieTouchBadge:'TouchBadge'},
  ...require('./burrow-attention-test-mocks.cjs'),'react/jsx-runtime':{jsx,jsxs:jsx},'./burrow-image':{Image:'Image'},
  'react-native':{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:v=>v},useWindowDimensions:()=>({width:390})},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20})},
  '@/lib/burrow-ui-assets':{BURROW_ROOM_ICONS:{}},'@/lib/burrow-map-model':model,
  '@/lib/burrow-map-assets':{BURROW_MAP_ART:{room:'door',light:'light',banners:{'autumn-day':'banner'}}},
  '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({banner:'autumn-day',season:'autumn',period:'day'})},
  '@/lib/bunny-variant-assets':{BUNNY_ICONS:{biscuit:'B',pinky:'P'}},
  '@/lib/bunny-identity':{useBunnyVariant:()=>mine,useBunnyIdentity:()=>identity},
 });
 const read=(partnerId='partner',pairVersion='pair')=>all(BurrowMap({onRoom(){},roomIds:['my_room','partner_room'],partnerId,pairVersion})).filter(n=>n.type==='Image'&&['B','P'].includes(n.props.source)).map(n=>n.props.source);
 assert.deepEqual(read(),['B','P']);mine='pinky';assert.deepEqual(read(),['P','B']);
 identity={partnerId:'partner',pairVersion:'pair',partnerVariant:'pinky'};assert.deepEqual(read(),['P','P']);
 assert.deepEqual(read('other','new'),['P','B']);identity={partnerId:'partner',pairVersion:'old',partnerVariant:'pinky'};
 assert.deepEqual(read(),['P','B']);assert.deepEqual(read(null,null),['P','B']);
});
