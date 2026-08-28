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
  './tap-your-day-v1.json': JSON.parse(read('packages/engine/src/items/tap-your-day-v1.json')),
});
const rawCatalog = load('apps/mobile/src/lib/guided-catalog.g.ts');
const catalog = load('apps/mobile/src/lib/custom-tap-catalog.ts', { '@novame/engine': engine, './guided-catalog.g': rawCatalog });
const [activity, food, people, feeling] = engine.TAP_YOUR_DAY_QUESTIONS;

test('destinations are exactly six activity + four food headings; people/feelings cannot add', () => {
  assert.equal(catalog.CUSTOM_TAP_GROUPS.length, 10);
  assert.equal(catalog.CUSTOM_TAP_GROUPS.filter(group => group.kind === 'activity').length, 6);
  assert.equal(catalog.CUSTOM_TAP_GROUPS.filter(group => group.kind === 'food').length, 4);
  assert.deepEqual(plain(engine.TAP_YOUR_DAY_QUESTIONS.map(catalog.canAddCustomTapItem)), [true, true, false, false]);
  assert.equal(catalog.customTapDestination('Fruit'), undefined);
  assert.equal(catalog.customTapDestination('DRINKS').kind, 'food');
});
test('browser has ten Main_Category choices, each containing the union of its secondary categories', () => {
  assert.equal(catalog.CUSTOM_TAP_ICON_CATEGORIES.length, 10);
  const dictionary = JSON.parse(read('packages/engine/src/items/dictionary.json'));
  for (const category of catalog.CUSTOM_TAP_ICON_CATEGORIES) {
    const parent = rawCatalog.PROMPT_CATEGORIES.find(value => value.key === category.key);
    assert.equal(category.label, parent.label);
    assert.ok(category.itemIds.length > 0);
    assert.deepEqual(plain(category.itemIds), [...new Set(parent.subcategories.flatMap(group => group.itemIds))]);
    assert.ok(category.itemIds.every(id => dictionary.items[id]), category.label);
  }
});
test('custom destinations are visible on the correct question; old groups remain accessible without cache mutation', () => {
  const items = [
    { itemId: 'a', label: 'Custom tea', kind: 'activity', group: 'DRINKS', custom: true },
    { itemId: 'b', label: 'Old category', kind: 'food', group: 'Fruit', custom: true },
    { itemId: 'c', label: 'An old friend', kind: 'person', group: 'My Items', custom: true },
    { itemId: 'd', label: 'Old feeling', kind: 'feeling', group: 'My Items', custom: true },
  ];
  const before = JSON.stringify(items);
  for (const question of [activity, food, people, feeling]) {
    const rows = catalog.customTapGroupsForQuestion(question, items);
    assert.deepEqual(plain(rows.map(group => group.title)), plain(question.groups.map(group => group.title)));
    assert.equal(rows.flatMap(group => group.choices).filter(choice => !choice.custom).length,
      question.groups.flatMap(group => group.choices).length);
  }
  const rows = catalog.customTapGroupsForQuestion(food, items);
  assert.equal(rows.find(group => group.title === 'DRINKS').choices.find(choice => choice.itemId === 'a').kind, 'food');
  assert.equal(rows[0].choices.find(choice => choice.itemId === 'b').label, 'Old category');
  assert.equal(JSON.stringify(items), before);
  assert.equal(catalog.customTapGroupsForQuestion(activity, items).flatMap(group => group.choices).filter(choice => choice.custom).length, 0);
});

function sheetHarness() {
  const hooks = reactHarness(), saved = [];
  let closed = 0;
  const components = Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name]));
  const { CustomTapItemSheet } = load('apps/mobile/src/components/main/custom-tap-item-sheet.tsx', {
    react: hooks.react,
    '@/components/ui/screen-overlay': { ScreenOverlay: 'Modal' },
    'react-native': { ...components, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: s => s } },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) },
    '@novame/engine': { ITEM_DICTIONARY: { items: { coffee: { displayName: 'Coffee' } } }, matchItems: value => value === 'coffee' ? [{ itemId: 'coffee' }] : [] },
    '@/lib/custom-tap-catalog': catalog, '@/lib/remote-items': { mergedItemDictionary() {} },
    '@/components/ui/item-sprite': { ItemSprite: 'ItemSprite' }, '@/lib/haptics': { haptics: { light() {} } },
  });
  let tree;
  const render = () => tree = hooks.render(() => CustomTapItemSheet({ question: activity, onClose: () => closed++, onSave: item => saved.push(item) }));
  const find = predicate => nodes(tree).find(predicate);
  const button = label => find(node => node.type === 'Pressable' && text(node) === label);
  render();
  return { render, find, button, saved, closed: () => closed, nodes: () => nodes(tree) };
}
test('sheet keeps icon selection separate from the ten destination groups and saves into the chosen question', () => {
  const sheet = sheetHarness();
  assert.equal(sheet.button('Save').props.disabled, true);
  sheet.find(node => node.type === 'TextInput').props.onChangeText('coffee'); sheet.render();
  let list = sheet.find(node => node.type === 'FlatList');
  assert.deepEqual(plain(list.props.data), ['coffee']);
  list.props.renderItem({ item: 'coffee' }).props.onPress(); sheet.render();
  sheet.find(node => node.props.accessibilityLabel === 'Select Group: DAILY RHYTHM').props.onPress(); sheet.render();
  assert.equal(sheet.nodes().filter(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio').length, 10);
  sheet.button('DRINKS').props.onPress(); sheet.render();
  assert.deepEqual(plain(sheet.find(node => node.type === 'FlatList').props.data), ['coffee']);
  assert.equal(sheet.button('Save').props.disabled, false);
  sheet.button('Save').props.onPress();
  assert.deepEqual(plain(sheet.saved), [{ itemId: 'coffee', label: 'coffee', group: 'DRINKS', kind: 'food', custom: true }]);
  assert.equal(sheet.closed(), 1);
});
test('no-match browser uses main categories without changing the destination; footer padding is inside KAV', () => {
  const sheet = sheetHarness();
  sheet.find(node => node.type === 'TextInput').props.onChangeText('Custom activity'); sheet.render();
  sheet.button('Browse Categories').props.onPress(); sheet.render();
  assert.equal(sheet.nodes().filter(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio').length, 10);
  const category = catalog.CUSTOM_TAP_ICON_CATEGORIES[0];
  sheet.button(category.label).props.onPress(); sheet.render();
  const list = sheet.find(node => node.type === 'FlatList');
  assert.deepEqual(plain(list.props.data), plain(category.itemIds));
  assert.ok(sheet.find(node => node.props.accessibilityLabel === 'Select Group: DAILY RHYTHM'));
  const kav = sheet.find(node => node.type === 'KeyboardAvoidingView');
  assert.equal(kav.props.keyboardVerticalOffset, 59);
  assert.equal(kav.props.style.padding, undefined);
  assert.equal(kav.props.children.props.style.padding, 16);
  const footer = sheet.find(node => node.type === 'View' && node.props.style?.paddingBottom === 8);
  assert.ok(nodes(footer).some(node => node.type === 'Pressable' && text(node) === 'Save'));
  assert.ok(sheet.nodes().some(node => node.props.name === 'edit'));
  assert.ok(sheet.nodes().some(node => node.props.name === 'folder'));
});

test('Home uses the shared bounded action guard, not an entry lock dependent on async fetching', () => {
  const source = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  assert.match(source, /const navigate = useNavigationAction\(\)/);
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
test('Focus gesture re-enables after returning from playback without needing another native transition', () => {
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
test('Focus scroll gate, sideways gestures and native closing cannot accidentally dismiss an entry', () => {
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
test('only Focus/Reflect entries use native cards; input and companion modal protections stay unchanged', () => {
  const { default: MainLayout } = load('apps/mobile/app/(main)/_layout.tsx', {
    react: { useEffect() {} },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { Stack: { Screen: 'StackScreen' } },
    '@/lib/rating-navigation': { ratingNavigationListeners: {} },
    '@/components/rating/official-rating-gate': { OfficialRatingGate: 'OfficialRatingGate' },
    '@/components/main/home-entry-gate': { HomeEntryGate: 'HomeEntryGate' },
    '@/lib/use-reflect-settlement-recovery': { useReflectSettlementRecovery() {} },
  });
  const screens = Object.fromEntries(nodes(MainLayout()).filter(node => node.type === 'StackScreen').map(node => [node.props.name, node.props.options]));
  for (const name of ['focus', 'reflect']) {
    assert.equal(screens[name].presentation, 'card');
    assert.equal(screens[name].animation, 'slide_from_bottom');
    assert.equal(screens[name].animationDuration, 250);
    assert.equal(screens[name].gestureEnabled, false, 'only guarded swipe recognizer may start a close');
  }
  for (const name of ['reflect-typing', 'reflect-guided', 'shared-memory-create']) {
    assert.equal(screens[name].presentation, 'fullScreenModal');
    assert.equal(screens[name].gestureEnabled, false);
  }
  assert.equal(screens['companion-sheet'].presentation, 'transparentModal');
});
