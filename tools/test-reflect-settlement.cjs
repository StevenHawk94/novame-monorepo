/* Native layout/event regression tests with deterministic RN boundaries.
 * These do not replace iOS/Android visual and keyboard acceptance testing.
 * Run: node --test tools/test-reflect-settlement.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const keyboardFile = 'apps/mobile/src/lib/use-memory-editor-keyboard.ts';
const settlementFile = 'apps/mobile/src/components/main/reflect-settlement.tsx';

function harness(platform = 'ios') {
  const effects = [], stateChanges = [], events = new Map(), frames = new Map();
  let nextFrame = 0, dismissCount = 0;
  const react = {
    memo: (fn) => fn,
    useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (current) => ({ current }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, (next) => stateChanges.push(next)],
    useEffect: (fn) => effects.push(fn),
  };
  const native = {
    AppState: { addEventListener: (name, fn) => { events.set(name, fn); return { remove: () => events.delete(name) }; } },
    Keyboard: {
      dismiss: () => dismissCount++,
      addListener: (name, fn) => { events.set(name, fn); return { remove: () => events.delete(name) }; },
    },
    Platform: { OS: platform },
    StyleSheet: { create: (styles) => styles, absoluteFill: { position: 'absolute' }, absoluteFillObject: { position: 'absolute' } },
    ...Object.fromEntries(['View', 'Text', 'TextInput', 'ScrollView', 'Modal', 'Pressable', 'KeyboardAvoidingView', 'ActivityIndicator'].map((key) => [key, key])),
  };
  const jsx = (type, props) => ({ type, props });
  function load(file, extra = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const imports = { react, 'react-native': native, 'react/jsx-runtime': { jsx, jsxs: jsx }, ...extra };
    vm.runInNewContext(code, {
      module, exports: module.exports, console, setTimeout, clearTimeout,
      requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
      cancelAnimationFrame: (id) => frames.delete(id),
      require: (name) => { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error('Unexpected dependency: ' + name); },
    }, { filename: file });
    return module.exports;
  }
  const keyboard = load(keyboardFile);
  return { load, keyboard, events, frames, stateChanges, effects, dismissCount: () => dismissCount,
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
  };
}

const geometry = { offset: 200, contentHeight: 2500, viewportY: 100, viewportHeight: 400, inputY: 420, inputHeight: 90, keyboardY: null };
test('scroll target excludes keyboard AND the fixed editor footer', () => {
  const { memoryEditorScrollTarget: target } = harness().keyboard;
  assert.equal(target(geometry), 222); // visible scroll bottom = 488, not keyboard top
  assert.equal(target({ ...geometry, keyboardY: 450 }), 272);
  assert.equal(target({ ...geometry, inputY: 60 }), 136); // back to an earlier row
  assert.equal(target({ ...geometry, inputY: 200 }), 200); // visible input stays put
});
test('long lists, tall inputs, hardware keyboard and missing layout stay bounded', () => {
  const { memoryEditorScrollTarget: target } = harness().keyboard;
  assert.equal(target({ ...geometry, offset: 2400, inputY: 700 }), 2100);
  assert.equal(target({ ...geometry, offset: 0, inputY: 0 }), 0);
  assert.equal(target({ ...geometry, inputHeight: 800, inputY: 160 }), 236);
  assert.equal(target({ ...geometry, viewportHeight: 0 }), 200);
  assert.equal(target({ ...geometry, keyboardY: 80 }), 200);
});
test('focus remeasures after keyboard resize; switching rows and growing text stay visible', () => {
  const h = harness(), hook = h.keyboard.useMemoryEditorKeyboard();
  const cleanups = h.effects.map((fn) => fn());
  let viewportHeight = 500, offset = 0, inputHeight = 70;
  const scrolls = [];
  hook.scrollRef.current = { scrollTo: ({ y }) => { offset = y; scrolls.push(y); } };
  hook.viewportRef.current = { measureInWindow: (fn) => fn(0, 150, 360, viewportHeight) };
  hook.setInputRef('first', { measureInWindow: (fn) => fn(0, 700 - offset, 200, inputHeight) });
  hook.setInputRef('last', { measureInWindow: (fn) => fn(0, 2100 - offset, 200, inputHeight) });
  hook.onContentSizeChange(360, 2300);
  hook.onFocus('first'); h.flush();
  viewportHeight = 220;
  hook.onViewportLayout({ nativeEvent: { layout: { height: viewportHeight } } });
  h.events.get('keyboardDidShow')({ endCoordinates: { screenY: 490, height: 320 } });
  h.flush();
  assert.equal(offset, 412);
  assert.ok(700 - offset + inputHeight <= 150 + viewportHeight - 12);
  hook.onFocus('last'); h.flush();
  assert.equal(offset, 1812);
  inputHeight = 140;
  hook.revealFocused(); h.flush();
  assert.equal(offset, 1882);
  hook.onBlur('last');
  hook.revealFocused(); h.flush();
  assert.equal(offset, 1882);
  assert.ok(scrolls.length >= 4);
  cleanups.forEach((fn) => fn?.());
  assert.equal(h.events.size, 0);
  assert.equal(h.frames.size, 0);
});
test('pending native measurement cannot scroll a closed editor or a different focus', () => {
  const h = harness(), hook = h.keyboard.useMemoryEditorKeyboard();
  const cleanups = h.effects.map((fn) => fn());
  let pending, count = 0;
  hook.viewportRef.current = { measureInWindow: (fn) => { pending = fn; } };
  hook.scrollRef.current = { scrollTo: () => count++ };
  hook.setInputRef('one', { measureInWindow: (fn) => fn(0, 900, 100, 50) });
  hook.onContentSizeChange(300, 2000);
  hook.onFocus('one'); h.flush();
  cleanups.forEach((fn) => fn?.());
  pending(0, 150, 360, 220);
  assert.equal(count, 0);
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function tapItemHarness() {
  return harness().load('apps/mobile/src/components/main/tap-your-day-item.tsx', {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/components/ui/item-sprite': { ItemSprite: 'ItemSprite' },
  });
}
test('Tap Your Day labels wrap below the icon; the entire choice remains selectable', () => {
  const { TapYourDayItem } = tapItemHarness();
  const { TAP_YOUR_DAY_CHOICES } = harness().load('packages/engine/src/items/tap-your-day.ts', { './tap-your-day-v1.json': require('../packages/engine/src/items/tap-your-day-v1.json') });
  for (const choice of TAP_YOUR_DAY_CHOICES) {
    let presses = 0;
    const tree = TapYourDayItem({ choice, width: 76, selected: true, onPress: () => presses++ });
    const all = nodes(tree), label = all.find((node) => node.type === 'Text');
    assert.equal(label.props.children, choice.label);
    assert.equal(label.props.numberOfLines, undefined); // no clipping of long names
    assert.equal(tree.props.accessibilityState.checked, true);
    assert.equal(all.find((node) => node.type === 'ItemSprite').props.itemId, choice.itemId);
    assert.equal(all.find((node) => node.type === 'ItemSprite').props.tapYourDay, undefined);
    tree.props.onPress(); assert.equal(presses, 1);
    const preview = TapYourDayItem({ choice, width: 80, iconSize: 44 });
    assert.equal(preview.type, 'View');
    assert.equal(nodes(preview).find((node) => node.type === 'ItemSprite').props.tapYourDay, undefined);
    assert.equal(nodes(preview).find((node) => node.type === 'Text').props.children, choice.label);
  }
});
test('final-note preview hides names but retains new artwork and accessible item labels', () => {
  const { TapYourDayItem } = tapItemHarness();
  const choice = { itemId: 'tap.person.just_me', label: 'Just Me' };
  const preview = TapYourDayItem({ choice, width: 50, iconSize: 44, showLabel: false });
  assert.equal(nodes(preview).filter((node) => node.type === 'Text').length, 0);
  assert.equal(preview.props.accessibilityLabel, 'Just Me');
  assert.equal(preview.props.accessibilityRole, 'image');
  const sprite = nodes(preview).find((node) => node.type === 'ItemSprite');
  assert.equal(sprite.props.itemId, choice.itemId);
  assert.equal(sprite.props.tapYourDay, undefined);
  assert.equal(sprite.props.size, 44);
  const source = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/reflect-guided.tsx'), 'utf8');
  assert.match(source, /iconSize=\{44\} showLabel=\{false\}/);
  assert.equal((source.match(/showLabel=\{false\}/g) || []).length, 1);
});
test('Tap item columns adapt to narrow screens and large text without overflowing', () => {
  const { tapItemGridMetrics: metrics, TAP_GRID_PADDING, TAP_ITEM_GAP } = tapItemHarness();
  assert.equal(metrics(284).columns, 3);
  assert.equal(metrics(354).columns, 4);
  assert.ok(metrics(354, 1.5).columns < metrics(354).columns);
  for (const width of [220, 284, 324, 354, 394, 720, 1000]) for (const scale of [1, 1.5, 2]) {
    const { columns, cellWidth } = metrics(width, scale);
    assert.ok(columns * cellWidth + (columns - 1) * TAP_ITEM_GAP + TAP_GRID_PADDING * 2 <= width);
    assert.ok(cellWidth >= 72);
    assert.ok(columns <= 6);
  }
});
function settlementHarness(paid = false, platform = 'ios', bottomInset = 34) {
  const h = harness(platform);
  const module = h.load(settlementFile, {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' }, 'expo-image': { Image: 'Image' },
    'expo-router': { router: {} },
    '@react-navigation/native': { useRoute: () => ({ key: 'settlement' }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: bottomInset }) },
    '@/components/ui/app-dialog': {}, '@/components/main/clover-burst': { CloverBurst: 'CloverBurst' },
    '@/components/ui/screen-overlay': { ScreenOverlay: 'Modal' },
    '@/components/ui/item-sprite': { ItemSprite: 'ItemSprite' }, '@/components/ui/offset-card': { OffsetCard: 'OffsetCard' },
    '@/components/ui/spring-pop': { SpringPop: 'SpringPop' }, '@/lib/haptics': {}, '@/lib/icons': { ICONS: { Plus: 'plus.png' } },
    '@/lib/reflect-api': {}, '@/lib/official-rating-prompt': {},
    '@/lib/reflection-paywall-count': {}, '@/lib/rating-navigation': {},
    '@/lib/use-subscription-tier': { useSubscriptionTier: () => paid ? 'plus' : 'free' },
    '@/lib/use-memory-editor-keyboard': h.keyboard,
    '@/lib/use-reflect-exit-guard': { useReflectExitGuard() {} },
    '@/lib/reflect-settlement-outbox': { holdReflectSettlement() {}, releaseReflectSettlement() {}, writeSettlementCheckpoint() {} },
    './reflect-shared': { RC: { yellow: '#fff', yellowDrop: '#aaa' } },
  });
  return { ...h, ...module };
}
function settlementTree(h, count = 2, shared = false, mode = 'prompt') {
  return h.ReflectSettlementView({
    draft: { draftId: 'one', mode, hasContext: false, matchedItems: Array.from({ length: count }, (_, i) => ({ itemId: 'item-' + i })), aiMemories: {} },
    itemWord: 'Selected', shared, onPresented() {}, onFinalized() {},
  });
}
test('settlement and editor always use canonical item art without mode overrides', () => {
  for (const mode of ['typing', 'prompt', 'items']) {
    const h = settlementHarness(), all = nodes(settlementTree(h, 2, mode === 'items', mode));
    assert.ok(all.filter((node) => node.type === 'ItemSprite').every((node) => node.props.tapYourDay === undefined));
  }
  const tree = settlementHarness().MemoryEditorSheet({
    items: [{ itemId: 'one', displayName: 'One' }], memories: [{ itemId: 'one', text: '', visible: true }],
    isPaid: false, shared: false, onChange() {}, onDone() {},
  });
  assert.equal(nodes(tree).find((node) => node.type === 'ItemSprite').props.tapYourDay, undefined);
  const source = fs.readFileSync(path.join(root, settlementFile), 'utf8');
  assert.doesNotMatch(source, /tapYourDay/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/reflect-detail.tsx'), 'utf8'), /tapYourDay/);
});
test('all settlement sizes retain the full list, flow footer, and reserved upward reward space', () => {
  for (const platform of ['ios', 'android'])
  for (const [paid, shared] of [[false, false], [true, false], [true, true]])
  for (const count of [0, 1, 7, 131]) {
    const h = settlementHarness(paid, platform), tree = settlementTree(h, count, shared);
    const all = nodes(tree), scroller = all.find((node) => node.type === 'ScrollView');
    assert.equal(all.filter((node) => node.type === 'ScrollView').length, 1);
    assert.equal(scroller.props.style.flex, 1);
    assert.equal(scroller.props.contentContainerStyle[0].flexGrow, 1);
    assert.equal(scroller.props.contentContainerStyle[0].justifyContent, 'flex-start');
    assert.equal(all.filter((node) => node.type === 'ItemSprite').length, count);
    const slot = all.find((node) => node.props?.style?.height === 48);
    assert.equal(slot.props.style.paddingTop, undefined); // no hidden padding restoring the old 96pt gap
    assert.equal(slot.props.style.justifyContent, 'center');
    const reward = nodes(slot).find((node) => node.type === 'CloverBurst');
    assert.equal(reward.props.durationMs, 2000);
    assert.equal(reward.props.riseDistance, 4); // the original 34pt drift would clip above this compact slot
    assert.ok(!all.some((node) => node.props?.style?.flexGrow === 1 && node.props.style.justifyContent === 'center'));
    assert.ok(nodes(scroller).some((node) => node.type === 'Text' && node.props.children === 'Done'));
    assert.equal(all.filter((node) => node.type === 'SpringPop')[0].props.boundedBounce, true);
  }
});
test('sections have fixed gaps in content order; only the Items card grows with its wrapped rows', () => {
  for (const [paid, shared] of [[false, false], [true, false], [true, true]]) {
    for (const count of [1, 7, 131]) {
      const scroller = nodes(settlementTree(settlementHarness(paid), count, shared))
        .find((node) => node.type === 'ScrollView');
      const blocks = [scroller.props.children].flat(Infinity).filter((node) => node?.type);
      const celebration = blocks.find((node) => node.props.children === '🎉');
      const title = blocks.find((node) => node.props.children === 'REFLECTION SAVED');
      const subtitle = blocks.find((node) => node.props.children === 'Your full reflection is private in My Logs.');
      const summary = blocks.find((node) => nodes(node).some((child) => child.type === 'SpringPop'));
      const share = blocks.find((node) => node.type === 'Pressable');
      const footer = blocks.at(-1);
      const ordered = [celebration, title, subtitle, summary, ...(shared ? [] : [share]), footer];
      assert.deepEqual(blocks.slice(paid ? 2 : 1), ordered);
      assert.equal(title.props.style.marginTop, 12);
      assert.equal(subtitle.props.style.marginTop, 8);
      assert.equal(summary.props.style.marginTop, 24);
      assert.equal(!!share, !shared);
      if (share) assert.equal(share.props.style.marginTop, 16);
      const footerStyle = Object.assign({}, ...footer.props.style.filter(Boolean));
      assert.equal(footerStyle.marginTop, shared ? 24 : 36);
      assert.equal(footerStyle.gap, 12);
      // No flexible spacer or bottom pin may distribute spare viewport space.
      assert.equal(scroller.props.contentContainerStyle[0].gap, undefined);
      for (const block of blocks) {
        const style = Object.assign({}, ...[block.props.style].flat(Infinity).filter(Boolean));
        for (const property of ['flex', 'flexGrow', 'height', 'maxHeight', 'bottom', 'position', 'marginBottom']) {
          if (property === 'height' && nodes(block).some((node) => node.type === 'CloverBurst')) continue; // fixed 48pt reward slot
          if (property === 'marginBottom' && block === blocks[0] && paid) continue; // compact badge gap
          assert.equal(style?.[property], undefined, property + ' must not stretch/pin a section');
        }
      }
      const card = nodes(summary).find((node) => node.type === 'Pressable');
      assert.equal(card.props.style.height, undefined);
      assert.equal(card.props.style.maxHeight, undefined);
      const grid = nodes(card).find((node) => node.props?.style?.flexWrap === 'wrap');
      assert.equal(grid.props.style.justifyContent, 'center');
      assert.equal(nodes(grid).filter((node) => node.type === 'ItemSprite').length, count);
      const actions = [footer.props.children].flat(Infinity).filter((node) => node?.type);
      assert.equal(actions.length, paid ? 1 : 2);
      if (!paid) {
        assert.equal(actions[0].props.style.gap, 16); // upgrade copy -> Join Plus
        assert.ok(nodes(actions[0]).some((node) => node.props?.children === 'Join Burrow Plus'));
      }
      assert.ok(nodes(actions.at(-1)).some((node) => node.props?.children === 'Done'));
    }
  }
});
test('Done has 24pt of scrollable bottom breathing room plus the device safe area', () => {
  for (const bottomInset of [0, 16, 34, 48]) {
    const tree = settlementTree(settlementHarness(true, 'android', bottomInset), 131);
    const scroll = nodes(tree).find((node) => node.type === 'ScrollView');
    assert.equal(scroll.props.contentContainerStyle[1].paddingBottom, bottomInset + 24);
  }
});
test('compact settlement reward preserves the default upward drift on other reward surfaces', () => {
  for (const riseDistance of [undefined, 4]) {
    const values = [];
    let animatedStyle;
    const { CloverBurst } = harness().load('apps/mobile/src/components/main/clover-burst.tsx', {
      'expo-image': { Image: 'Image' },
      '@/lib/icons': { ICONS: { Clovers: 'clovers.png' } },
      'react-native-reanimated': {
        __esModule: true, default: { View: 'AnimatedView' },
        useSharedValue: (value) => { const shared = { value }; values.push(shared); return shared; },
        useAnimatedStyle: (compute) => { animatedStyle = compute; return compute(); },
      },
    });
    CloverBurst({ amount: 30, riseDistance, durationMs: 2000 });
    values[0].value = 1;
    values[1].value = 1;
    const style = animatedStyle();
    assert.equal(style.transform[0].translateY, -(riseDistance ?? 34));
    assert.equal(style.transform[1].scale, 1);
    assert.equal(style.opacity, 1);
  }
});
test('all three Reflect routes continue to use the common settlement layout', () => {
  for (const route of ['reflect-typing', 'reflect-guided', 'shared-memory-create']) {
    const source = fs.readFileSync(path.join(root, `apps/mobile/app/(main)/${route}.tsx`), 'utf8');
    assert.match(source, /<ReflectSettlementView\b/);
    assert.match(source, /enabled=\{phase !== 'result'\}/); // stale keyboard cannot shrink the result viewport
  }
});
test('settlement starts the preloaded sound once on first visible layout, not on edit or AI updates', () => {
  for (const paid of [false, true]) for (const shared of [false, true]) {
    const h = settlementHarness(paid), calls = [];
    const tree = h.ReflectSettlementView({
      draft: { draftId: 'one', mode: 'typing', hasContext: false, matchedItems: [], aiMemories: {} },
      itemWord: 'Matched', shared, onPresented: (id) => calls.push(id), onFinalized() {},
    });
    const layout = (width, height) => tree.props.onLayout({ nativeEvent: { layout: { width, height } } });
    assert.deepEqual(calls, []);
    layout(0, 700); layout(390, 0); assert.deepEqual(calls, []);
    layout(390, 700); assert.deepEqual(calls, ['one']);
    layout(390, 720); layout(390, 400); assert.deepEqual(calls, ['one']);
  }
});
test('shared editor wires every input to focus/reveal and limits multiline height', () => {
  const h = settlementHarness();
  const tree = h.MemoryEditorSheet({
    items: [{ itemId: 'one', displayName: 'One' }],
    memories: [{ itemId: 'one', text: '', visible: true }], isPaid: false, shared: false,
    onChange() {}, onDone() {},
  });
  const all = nodes(tree), input = all.find((node) => node.type === 'TextInput');
  assert.equal(typeof input.props.onFocus, 'function');
  assert.equal(typeof input.props.onContentSizeChange, 'function');
  assert.equal(input.props.style[1].maxHeight, 140);
  assert.ok(all.some((node) => node.props?.collapsable === false && node.props.onLayout));
  assert.equal(typeof all.find((node) => node.type === 'ScrollView').props.onContentSizeChange, 'function');
  all.find((node) => node.type === 'OffsetCard').props.onPress();
  assert.equal(h.dismissCount(), 1);
});
