// Native-boundary regressions. Real device audio/rendering still needs acceptance testing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const layout = (width = 390, height = 844) => ({ nativeEvent: { layout: { width, height } } });
const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== 'object' ? [] :
  [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
    ...globals,
  });
  return module.exports;
}

// Retain hook state across active=false -> active=true and subsequent re-renders.
function animationHarness(platform = 'ios') {
  const slots = [], effects = [], frames = new Map(), listeners = new Set();
  let cursor = 0, nextFrame = 0, tree;
  const react = {
    memo: (fn) => fn,
    useRef: (value) => {
      const i = cursor++;
      slots[i] ??= { current: value };
      return slots[i];
    },
    useState: (initial) => {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [slots[i].value, (value) => { slots[i].value = value; }];
    },
    useCallback(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const appState = {
    currentState: 'active',
    addEventListener(_event, fn) { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const component = load('apps/mobile/src/components/main/reflect-celebration.tsx', {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      AppState: appState, Platform: { OS: platform }, View: 'View',
      StyleSheet: { absoluteFill: { position: 'absolute' }, absoluteFillObject: { position: 'absolute' }, create: (x) => x },
    },
    'lottie-react-native': 'Lottie',
    '../../../assets/animations/reflect-dense.json': require('../apps/mobile/assets/animations/reflect-dense.json'),
  }, {
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout() { assert.fail('A mount-time timeout must not truncate celebration'); },
  }).ReflectCelebration;
  const view = { plays: [], pauses: 0, resumes: 0,
    play(...args) { this.plays.push(args); }, pause() { this.pauses++; }, resume() { this.resumes++; } };
  return {
    view, listeners,
    render(active) { cursor = 0; tree = component({ active }); return tree; },
    lottie: () => nodes(tree).find((node) => node.type === 'Lottie'),
    effects() { effects.splice(0).forEach((fn) => fn()); },
    frame() { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); },
    state(value) { appState.currentState = value; [...listeners].forEach((fn) => fn(value)); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
test('Reflect preloads invisibly, starts a full five seconds on reveal, and never repeats on re-render', () => {
  for (const platform of ['ios', 'android']) {
    const h = animationHarness(platform), tree = h.render(false);
    h.effects();
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.style[1].opacity, 0);
    let l = h.lottie();
    l.props.ref(h.view); l.props.onLayout(layout()); l.props.onAnimationLoaded();
    h.frame();
    assert.equal(l.props.autoPlay, false);
    assert.equal(h.view.plays.length, 0);
    h.render(true); h.effects(); h.frame(); l = h.lottie();
    assert.equal(l.props.autoPlay, true);
    assert.equal(l.props.loop, false);
    assert.deepEqual(h.view.plays, [[0, 300]]);
    assert.equal((l.props.source.op - l.props.source.ip) / l.props.source.fr, 5);
    assert.equal(l.props.resizeMode, 'cover');
    assert.equal(l.props.hardwareAccelerationAndroid, platform === 'android');
    assert.equal(l.props.renderMode, platform === 'android' ? 'HARDWARE' : 'AUTOMATIC');
    h.render(true); h.effects(); l.props.onLayout(layout()); l.props.onAnimationLoaded(); h.frame();
    assert.equal(h.view.plays.length, 1);
    l.props.onAnimationFinish(false);
    assert.equal(h.render(true), null);
    h.effects(); h.frame();
    assert.equal(h.view.plays.length, 1);
    h.unmount();
    assert.equal(h.listeners.size, 0);
  }
});
test('missing loaded event and every ref/layout ordering can still start; zero layout cannot', () => {
  for (const refFirst of [false, true]) {
    const h = animationHarness();
    h.render(true); h.effects();
    const l = h.lottie();
    // Intentionally never send onAnimationLoaded.
    if (refFirst) l.props.ref(h.view);
    l.props.onLayout(layout(390, 0)); h.frame();
    assert.equal(h.view.plays.length, 0);
    l.props.onLayout(layout());
    if (!refFirst) { h.frame(); assert.equal(h.view.plays.length, 0); l.props.ref(h.view); }
    h.frame();
    assert.deepEqual(h.view.plays, [[0, 300]]);
    assert.equal(l.props.autoPlay, true); // Native readiness fallback for a late composition.
    h.unmount();
  }
});
test('temporary inactivity pauses/restores instead of permanently deleting the effect', () => {
  const h = animationHarness();
  h.render(true); h.effects();
  let l = h.lottie();
  l.props.ref(h.view); l.props.onLayout(layout()); h.frame();
  h.state('inactive');
  assert.equal(h.view.pauses, 1);
  l.props.onAnimationFinish(true); // Native pause/cancellation is not successful completion.
  assert.ok(h.render(true)); h.effects();
  h.state('active');
  assert.equal(h.view.resumes, 1);
  assert.equal(h.view.plays.length, 1); // Resume, never replay from frame zero.
  l = h.lottie(); l.props.onAnimationFinish(false);
  assert.equal(h.render(true), null); h.effects();
  h.state('background'); h.state('active');
  assert.equal(h.view.resumes, 1);
  h.unmount();
});
test('leaving before the next render frame cancels a queued native start', () => {
  const h = animationHarness();
  h.render(true); h.effects();
  const l = h.lottie();
  l.props.ref(h.view); l.props.onLayout(layout());
  h.unmount(); h.frame();
  assert.equal(h.view.plays.length, 0);
});
test('every Quest particle stays visible until it exits the full screen, and only the last one completes', () => {
  for (const height of [568, 844, 1200]) for (const random of [0, 0.5, 0.999]) {
    const effects = [], shared = [], cancelled = [], timers = [];
    let done = 0;
    const { ConfettiBurst } = load('apps/mobile/src/components/main/confetti-burst.tsx', {
      react: { useEffect: (fn) => effects.push(fn), useMemo: (fn) => fn() },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { View: 'View', useWindowDimensions: () => ({ width: 390, height }),
        StyleSheet: { absoluteFill: {}, create: (x) => x } },
      'react-native-reanimated': {
        __esModule: true, default: { View: 'AnimatedView' },
        Easing: { in: (x) => x, quad: 'quad' },
        useSharedValue: (value) => { const ref = { value }; shared.push(ref); return ref; },
        useAnimatedStyle: (fn) => fn,
        withTiming: (_target, config, callback) => ({ config, callback }),
        withDelay: (delay, animation) => { timers.push({ delay, ...animation }); return 0; },
        cancelAnimation: (value) => cancelled.push(value), runOnJS: (fn) => fn,
      },
    }, { Math: Object.assign(Object.create(Math), { random: () => random }) });
    const tree = ConfettiBurst({ onDone: () => done++ });
    assert.equal(tree.props.pointerEvents, 'none');
    const pieces = tree.props.children;
    assert.equal(pieces.length, 26);
    const rendered = pieces.map((piece) => piece.type(piece.props));
    const cleanups = effects.map((fn) => fn());
    rendered.forEach((node, i) => {
      const style = node.props.style.at(-1);
      for (const progress of [0, 0.5, 0.75, 0.9, 1]) {
        shared[i].value = progress;
        assert.equal(style().opacity, 1);
      }
      assert.ok(style().transform[1].translateY > height + 16);
    });
    assert.equal(timers.length, 26);
    assert.equal(pieces.filter((p) => typeof p.props.onLast === 'function').length, 1);
    const last = pieces.findIndex((p) => p.props.onLast);
    assert.ok(timers.every((t) => t.delay + t.config.duration <= timers[last].delay + timers[last].config.duration));
    timers.forEach((t, i) => { if (i !== last) t.callback(true); });
    assert.equal(done, 0);
    timers[last].callback(false); assert.equal(done, 0);
    timers[last].callback(true); assert.equal(done, 1);
    cleanups.forEach((fn) => fn());
    assert.equal(cancelled.length, 26);
  }
});
test('Quest celebration survives switching from completed plan to picker without timer truncation', () => {
  const source = read('apps/mobile/app/(main)/(tabs)/quests.tsx');
  assert.equal((source.match(/\{celebration\}/g) || []).length, 2);
  assert.match(source, /key="quest-celebration"/);
  assert.ok(!source.includes('FALLBACK_MS'));
  assert.ok(!source.includes('setTimeout'));
  assert.match(source, /if \(!cancelled\) setShowLottie\(false\)/);
});
