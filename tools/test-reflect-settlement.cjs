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
  return { load, events, frames, stateChanges, effects, dismissCount: () => dismissCount,
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function tapItemHarness() {
  return harness().load('apps/mobile/src/components/main/tap-your-day-item.tsx', {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/components/ui/tap-day-icon': { TapDayIcon: 'TapDayIcon' },
    '@/lib/tap-day-icon-layout': harness().load('apps/mobile/src/lib/tap-day-icon-layout.ts'),
  });
}
test('Tap Your Day labels wrap below the icon; the entire choice remains selectable', () => {
  const { TapYourDayItem } = tapItemHarness();
  const { TAP_YOUR_DAY_CHOICES } = harness().load('packages/engine/src/items/tap-your-day.ts', { './tap-your-day-v2.json': require('../packages/engine/src/items/tap-your-day-v2.json'), './tap-your-day-v4.json': require('../packages/engine/src/items/tap-your-day-v4.json'), './tap-your-day-local.json': require('../packages/engine/src/items/tap-your-day-local.json'), './tap-your-day-v1.json': require('../packages/engine/src/items/tap-your-day-v1.json') });
  for (const choice of TAP_YOUR_DAY_CHOICES) {
    let presses = 0;
    const tree = TapYourDayItem({ choice, width: 76, selected: true, onPress: () => presses++ });
    const all = nodes(tree), label = all.find((node) => node.type === 'Text');
    assert.equal(label.props.children, choice.label);
    assert.equal(label.props.numberOfLines, undefined); // no clipping of long names
    assert.equal(tree.props.accessibilityState.checked, true);
    assert.equal(all.find((node) => node.type === 'TapDayIcon').props.itemId, choice.itemId);
    assert.equal(all.find((node) => node.type === 'TapDayIcon').props.tapYourDay, undefined);
    tree.props.onPress(); assert.equal(presses, 1);
    const preview = TapYourDayItem({ choice, width: 80, iconSize: 44 });
    assert.equal(preview.type, 'View');
    assert.equal(nodes(preview).find((node) => node.type === 'TapDayIcon').props.tapYourDay, undefined);
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
  const sprite = nodes(preview).find((node) => node.type === 'TapDayIcon');
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
