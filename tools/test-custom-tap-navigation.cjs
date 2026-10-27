/* Offline UI/state regressions. No device, account, network, or cache writes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const jsx = (type, props) => ({ type, props: props || {} });
function load(file, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (Object.hasOwn(imports, name)) return imports[name];
    throw Error('Unexpected dependency: ' + name);
  } }, { filename: file });
  return module.exports;
}
function reactHarness() {
  const slots = [], pending = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pending.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  return { react, render(fn) { cursor = 0; const tree = fn(); pending.splice(0).forEach(fn => fn()); return tree; },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree?.props?.children || '');
}
const engine = load('packages/engine/src/items/tap-your-day.ts', {
  './tap-your-day-v2.json': require('../packages/engine/src/items/tap-your-day-v2.json'), './tap-your-day-v4.json': require('../packages/engine/src/items/tap-your-day-v4.json'), './tap-your-day-local.json': require('../packages/engine/src/items/tap-your-day-local.json'), './tap-your-day-v1.json': JSON.parse(read('packages/engine/src/items/tap-your-day-v1.json')),
});
const rawCatalog = load('apps/mobile/src/lib/guided-catalog.g.ts');
const catalog = load('apps/mobile/src/lib/custom-tap-catalog.ts', { '@novame/engine': engine, './guided-catalog.g': rawCatalog });
const [activity, food, people, feeling] = engine.TAP_YOUR_DAY_QUESTIONS;

test('only approved optional groups are addable; people and feelings stay fixed', () => {
  assert.equal(catalog.CUSTOM_TAP_GROUPS.length, 12);
  assert.equal(catalog.CUSTOM_TAP_GROUPS.filter(group => group.kind === 'activity').length, 8);
  assert.deepEqual(plain(engine.TAP_YOUR_DAY_QUESTIONS.map(catalog.canAddCustomTapItem)), [true, true, false, false]);
  assert.deepEqual(plain(catalog.CUSTOM_TAP_GROUPS.filter(group => group.kind === 'food').map(group => group.title)), ['MEALS', 'CUISINE', 'SNACKS', 'DRINKS']);
});
test('optional IDs have canonical destinations, retired choices are hidden without mutating legacy preferences', () => {
  const pick = engine.TAP_YOUR_DAY_OPTIONAL_CHOICES.find(x => x.group === 'CUISINE');
  const items = [{ ...pick, label: 'Old custom name', kind: 'activity', group: 'DAILY RHYTHM' },
    { itemId: 'retired-charger', label: 'Charger', kind: 'food', group: 'MEALS', custom: true }, pick];
  const before = JSON.stringify(items);
  const rows = catalog.customTapGroupsForQuestion(food, items);
  assert.equal(rows.find(group => group.title === 'CUISINE').choices.length, 1);
  assert.equal(rows.find(group => group.title === 'CUISINE').choices[0].label, pick.label);
  assert.equal(catalog.customTapGroupsForQuestion(activity, items).flatMap(g => g.choices).filter(x => x.custom).length, 0);
  assert.equal(JSON.stringify(items), before);
  assert.equal(rows.flatMap(g => g.choices).some(x => x.itemId === 'retired-charger'), false);
});
function sheetHarness(question = activity, addedItems = []) {
  const hooks = reactHarness(), saved = []; let closed = 0;
  const components = Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name]));
  const { CustomTapItemSheet } = load('apps/mobile/src/components/main/custom-tap-item-sheet.tsx', {
    "@/components/burrow/burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    react: hooks.react, '@/components/ui/screen-overlay': { ScreenOverlay: 'Modal' },
    'react-native': { ...components, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: s => s } },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) },
    '@novame/engine': engine, '@/lib/custom-tap-catalog': catalog,
    '@/components/ui/tap-day-icon': { TapDayIcon: 'TapDayIcon' }, '@/lib/haptics': { haptics: { light() {} } },
  });
  let tree;
  const render = () => tree = hooks.render(() => CustomTapItemSheet({ question, addedItems, onClose: () => closed++, onSave: item => saved.push(item) }));
  const find = predicate => nodes(tree).find(predicate);
  const button = label => find(node => node.type === 'Pressable' && text(node) === label);
  render(); return { render, find, button, saved, closed: () => closed };
}
test('offline Add browses approved activities, filters labels and saves the canonical selection', () => {
  const sheet = sheetHarness();
  assert.equal(sheet.button('Add activity').props.disabled, true);
  assert.equal(sheet.find(n => n.type === 'FlatList').props.data.length, 175);
  sheet.button('HOME & CARE').props.onPress(); sheet.render();
  assert.equal(sheet.find(n => n.type === 'FlatList').props.data.length, 19);
  sheet.find(n => n.type === 'TextInput').props.onChangeText('drying'); sheet.render();
  let list = sheet.find(n => n.type === 'FlatList'); assert.equal(list.props.data.length, 1);
  const selected = list.props.data[0]; list.props.renderItem({ item: selected }).props.onPress(); sheet.render();
  sheet.button('Add activity').props.onPress(); assert.deepEqual(plain(sheet.saved), [plain(selected)]); assert.equal(sheet.closed(), 1);
  sheet.find(n => n.type === 'TextInput').props.onChangeText('charger'); sheet.render();
  assert.equal(sheet.find(n => n.type === 'FlatList').props.data.length, 0);
});
test('food Add only has takeout and cuisine options, and already-added icons cannot be duplicated', () => {
  const cuisine = engine.TAP_YOUR_DAY_OPTIONAL_CHOICES.find(x => x.group === 'CUISINE');
  const sheet = sheetHarness(food, [cuisine]);
  const list = sheet.find(n => n.type === 'FlatList'); assert.equal(list.props.data.length, 82);
  assert.equal(list.props.renderItem({ item: cuisine }).props.disabled, true);
  assert.equal(sheet.button('HOME & CARE'), undefined);
});

test('Home directly mounts retained Burrow, not the retired async entry lock', () => {
  const source = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  assert.match(source, /<BurrowScreen section="home"/);
  assert.doesNotMatch(source, /useNavigationAction|LegacyHomeScreen/);
  assert.ok(!source.includes('openingEntryRef'));
  assert.ok(!source.includes('InteractionManager'));
});

function swipeHarness() {
  const hooks = reactHarness(), listeners = new Map(), calls = [];
  const navigation = { addListener(event, callback) { listeners.set(event, callback); return () => listeners.delete(event); } };
  const { SwipeDownToDismiss } = load('apps/mobile/src/components/ui/swipe-down-to-dismiss.tsx', {
    react: hooks.react, 'expo-router': { useNavigation: () => navigation },
    'react-native': { View: 'View', StyleSheet: { create: s => s },
      PanResponder: { create: handlers => ({ panHandlers: handlers }) },
    },
  });
  return { calls, listeners, cleanup: hooks.cleanup,
    render: (enabled = true, canStart = () => true) => hooks.render(() => SwipeDownToDismiss({
      children: 'content', enabled, canStart, onDismiss: () => calls.push(['dismiss']),
    })).props };
}
test('swipe delegates exit directly to navigation without first hiding content; short swipes leave it visible', () => {
  const swipe = swipeHarness(), handlers = swipe.render();
  assert.equal(handlers.style.transform, undefined);
  assert.equal(handlers.onPanResponderMove, undefined);
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), false);
  swipe.listeners.get('transitionEnd')({ data: { closing: false } });
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), true);
  handlers.onPanResponderRelease(null, { dy: 30, vy: 0 });
  assert.equal(swipe.calls.length, 0);
  handlers.onPanResponderRelease(null, { dy: 120, vy: 0 });
  assert.deepEqual(swipe.calls, [['dismiss']]);
  handlers.onPanResponderRelease(null, { dy: 120, vy: 0 });
  assert.equal(swipe.calls.length, 1, 'cannot pop twice during closing');
  swipe.cleanup(); assert.equal(swipe.listeners.size, 0);
});
test('entry gesture re-enables after returning from a child without another native transition', () => {
  const swipe = swipeHarness(); swipe.render();
  swipe.listeners.get('transitionEnd')({ data: { closing: false } });
  let handlers = swipe.render(false);
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), false);
  handlers.onPanResponderRelease(null, { dy: 120, vy: 0 });
  assert.equal(swipe.calls.length, 0);
  handlers = swipe.render(true);
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), true);
  handlers.onPanResponderRelease(null, { dy: 120, vy: 0 });
  assert.deepEqual(swipe.calls, [['dismiss']]);
  swipe.cleanup();
});
test('entry scroll gate, sideways gestures and native closing cannot accidentally dismiss an entry', () => {
  const swipe = swipeHarness(); let atTop = false;
  const handlers = swipe.render(true, () => atTop);
  swipe.listeners.get('transitionEnd')({ data: { closing: false } });
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), false);
  atTop = true;
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 50, dy: 20 }), false);
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 20 }), true);
  swipe.listeners.get('transitionStart')({ data: { closing: true } });
  handlers.onPanResponderRelease(null, { dy: 120, vy: 0 });
  assert.equal(swipe.calls.length, 0);
  swipe.cleanup();
});
test('Menu/settings and current Adventure inputs retain edge back; old aliases have no transition', () => {
  const edge=load('apps/mobile/src/lib/page-edge-gesture.ts');
  const policy=load('apps/mobile/src/lib/main-navigation-options.ts',{'./page-edge-gesture':edge});
  const { default: MainLayout } = load('apps/mobile/app/(main)/_layout.tsx', {
    '@/components/burrow/burrow-toast-host':{BurrowToastHost:'BurrowToastHost'},
    '@/lib/profile-avatar-local':{syncLocalProfileAvatar(){},onProfileAvatarCommitted:()=>()=>{}},
    '@/lib/session-lifecycle':{sessionUserId:()=>null},
    '@/lib/me-stats':{},'@/lib/burrow-store':{},
    '@/lib/account-profile-local':{syncAccountProfile(){}},
    '@/lib/burrow-destination-model':{burrowDestinationId:()=>null},
    '@/lib/avatar-upload-queue': { syncProfileAvatar() {} },
    '@/components/burrow/burrow-music': { BurrowMusicGate: 'BurrowMusicGate' },
    '@/components/burrow/adventure-arrival-gate': { AdventureArrivalGate: 'AdventureArrivalGate' },
    '@/components/burrow/surprise-arrival-gate': { SurpriseArrivalGate: 'SurpriseArrivalGate' },
    '@/components/burrow/burrow-sync-gate': { BurrowSyncGate: 'BurrowSyncGate' },
    '@/components/burrow/game-sync-gate': { GameSyncGate: 'GameSyncGate' },
    '@/components/burrow/burrow-page-entry-overlay': { BurrowPageEntryOverlay: 'BurrowPageEntryOverlay' },
    '@/components/main/partner-connection-gate': { PartnerConnectionGate: 'PartnerConnectionGate' },
    '@/lib/main-navigation-options': policy,
    '@/lib/use-major-update': { useMajorUpdateEnabled: () => true },
    react: { useEffect() {} },
    'react-native': { Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { Stack: { Screen: 'StackScreen' } },
    '@/lib/rating-navigation': { ratingNavigationListeners: {} },
    '@/components/rating/official-rating-gate': { OfficialRatingGate: 'OfficialRatingGate' },
    '@/components/main/home-entry-gate': { HomeEntryGate: 'HomeEntryGate' },
    '@/components/burrow/burrow-environment-gate': { BurrowEnvironmentGate: 'BurrowEnvironmentGate' },
    '@/lib/use-reflect-settlement-recovery': { useReflectSettlementRecovery() {} },
    '@/components/ui/android-compact-typography': { AndroidCompactTypographyProvider: 'TypographyProvider' },
    '@/lib/auth': { getCurrentSession: async () => null },
    '@/lib/onboarding': { syncOnboardingCompanion: async () => ({ ok: true }) },
  });
  const screens = Object.fromEntries(nodes(MainLayout()).filter(node => node.type === 'StackScreen').map(node => [node.props.name, { ...policy.MAIN_CARD_OPTIONS, ...node.props.options }]));
  for (const name of ['thump', 'reflect']) {
    assert.equal(screens[name].presentation, 'card');
    assert.equal(screens[name].animation, name === 'thump' ? 'none' : 'slide_from_bottom');
    assert.equal(screens[name].animationDuration, 250);
    assert.equal(screens[name].gestureEnabled, false, 'only guarded swipe recognizer may start a close');
  }
  for (const name of ['reflect-typing', 'reflect-guided']) {
    assert.equal(screens[name].presentation, 'card');
    assert.equal(screens[name].gestureEnabled, true);
  }
  assert.equal(screens['shared-memory-create'].gestureEnabled,false);
  assert.equal(screens['companion-sheet'].animation, 'none');
  assert.equal(screens['companion-sheet'].gestureEnabled,false);
  assert.equal(screens.menu.presentation, 'card');
  assert.equal(screens.menu.animation, 'slide_from_right');
  assert.equal(screens.menu.gestureEnabled, true);
  assert.equal(screens.menu.gestureDirection, 'horizontal');
  assert.equal(screens.menu.fullScreenGestureEnabled, false, 'long menu scrolling must not be intercepted by a full-screen swipe');
  assert.equal(screens.menu.gestureResponseDistance.end, 24);
  assert.equal(screens.menu.animationMatchesGesture, true);
  assert.equal(screens['(modals)'].presentation, 'card', 'settings share the global hierarchical edge-back policy');
  const menuRoute=read('apps/mobile/app/(main)/menu.tsx');
  assert.match(menuRoute,/export \{ default \} from '\.\/\(modals\)\/me'/);
  for(const file of ['apps/mobile/src/components/burrow/burrow-screen.tsx']){
    const source=read(file);assert.match(source,/'\/\(main\)\/menu'/);
    assert.doesNotMatch(source,/'\/\(main\)\/\(modals\)\/me'/);
  }
});
