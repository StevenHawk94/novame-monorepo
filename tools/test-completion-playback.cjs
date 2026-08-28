// Native-boundary regressions. Real device audio/rendering still needs acceptance testing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { clock } = require('./lifecycle-test-utils.cjs');
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
function animationHarness(platform = 'ios', source) {
  const time = clock();
  const slots = [], effects = [], frames = new Map(), listeners = new Set();
  let cursor = 0, nextFrame = 0, tree, completions = 0;
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
    ...time.globals,
  }).ReflectCelebration;
  const view = { plays: [], pauses: 0, resumes: 0,
    play(...args) { this.plays.push(args); }, pause() { this.pauses++; }, resume() { this.resumes++; } };
  return {
    view, listeners, time,
    render(active) { cursor = 0; tree = component({ active, source, onComplete: () => completions++ }); return tree; },
    completions: () => completions,
    lottie: () => nodes(tree).find((node) => node.type === 'Lottie'),
    effects() { effects.splice(0).forEach((fn) => fn()); },
    frame() { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); },
    state(value) { appState.currentState = value; [...listeners].forEach((fn) => fn(value)); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
function prepareAnimation(h, active) {
  const tree = h.render(active); h.effects();
  tree.props.onLayout(layout());
  h.render(active); h.effects();
  const lottie = h.lottie(); lottie.props.ref(h.view);
  return lottie;
}
test('lost animation completion recovers after full playback; zero layouts do not restart it and background time does not consume it', () => {
  const h=animationHarness();const original=prepareAnimation(h,true);
  h.time.advance(4900);assert.equal(h.completions(),0);
  h.render(true).props.onLayout(layout(0,0));h.render(true);h.effects();
  assert.equal(h.lottie().key,original.key);
  h.state('background');h.time.advance(30000);assert.equal(h.completions(),0);
  h.state('active');h.time.advance(100);assert.equal(h.completions(),0,'five-second composition is never cut short');
  h.time.advance(2500);assert.equal(h.completions(),1);
  original.props.onAnimationFinish(false);assert.equal(h.completions(),1);
  assert.equal(h.render(true),null);h.effects();h.unmount();assert.equal(h.time.timers.size,0);
});
test('Reflect warms invisibly, creates a fresh native autoplay run on reveal, and never restarts on re-render', () => {
  for (const platform of ['ios', 'android']) {
    const h = animationHarness(platform), tree = h.render(false);
    h.effects();
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.style[1].opacity, 0);
    let l = prepareAnimation(h, false);
    const preload = l;
    assert.equal(l.props.autoPlay, false);
    assert.equal(l.props.speed, 0);
    assert.equal(h.view.plays.length, 0);
    h.render(true); h.effects(); h.frame(); l = h.lottie();
    assert.equal(l.props.autoPlay, true);
    assert.notEqual(l.key, preload.key);
    assert.equal(l.props.speed, 1);
    assert.equal(l.props.loop, false);
    assert.deepEqual(h.view.plays, []); // No competing/lost imperative play command.
    assert.equal((l.props.source.op - l.props.source.ip) / l.props.source.fr, 5);
    assert.equal(l.props.resizeMode, 'cover');
    assert.equal(l.props.hardwareAccelerationAndroid, platform === 'android');
    assert.equal(l.props.renderMode, platform === 'android' ? 'HARDWARE' : 'AUTOMATIC');
    h.render(true); h.effects();
    assert.equal(h.lottie().key, l.key);
    preload.props.onAnimationFinish(false); // Hidden/old instance cannot end a visible run.
    assert.equal(h.completions(), 0);
    l.props.onAnimationFinish(false);
    assert.equal(h.render(true), null);
    h.effects(); h.frame();
    assert.equal(h.view.plays.length, 0);
    h.unmount();
    assert.equal(h.listeners.size, 0);
  }
});
test('native autoplay handles late composition loading without depending on a loaded event or a premature command', () => {
  for (const refFirst of [false, true]) {
    const h = animationHarness();
    h.render(true); h.effects();
    let l = h.lottie();
    // Intentionally never send onAnimationLoaded.
    if (refFirst) l.props.ref(h.view);
    h.render(true).props.onLayout(layout(390, 0)); h.render(true); h.effects();
    assert.equal(h.lottie().props.autoPlay, false);
    assert.equal(h.view.plays.length, 0);
    h.render(true).props.onLayout(layout());
    h.render(true); h.effects(); l = h.lottie();
    if (!refFirst) l.props.ref(h.view);
    h.frame();
    assert.deepEqual(h.view.plays, []);
    assert.equal(l.props.autoPlay, true); // Native readiness fallback for a late composition.
    assert.equal(l.key, 'run-0');
    h.unmount();
  }
});
test('temporary inactivity pauses/restores instead of permanently deleting the effect', () => {
  const h = animationHarness();
  let l = prepareAnimation(h, true);
  h.state('inactive');
  assert.equal(h.view.pauses, 1);
  l.props.onAnimationFinish(true); // Native pause/cancellation is not successful completion.
  assert.ok(h.render(true)); h.effects();
  h.state('active');
  assert.equal(h.view.resumes, 1);
  assert.equal(h.view.plays.length, 0); // Resume, never replay from frame zero.
  l = h.lottie(); l.props.onAnimationFinish(false);
  assert.equal(h.render(true), null); h.effects();
  h.state('background'); h.state('active');
  assert.equal(h.view.resumes, 1);
  h.unmount();
});
test('unmount pauses the native instance and leaves no queued start or replay', () => {
  const h = animationHarness();
  h.render(true); h.effects();
  const l = h.lottie();
  l.props.ref(h.view);
  h.unmount(); h.frame();
  assert.equal(h.view.plays.length, 0);
  assert.equal(h.view.pauses, 1);
});
test('recolored Quest composition uses the same full playback and completes exactly once', () => {
  const source = require('../apps/mobile/assets/animations/quest-dense.json');
  for (const platform of ['ios', 'android']) {
    const h = animationHarness(platform, source);
    let l = prepareAnimation(h, false);
    assert.equal(l.props.source, source);
    assert.equal(h.view.plays.length, 0);
    h.render(true); h.effects(); h.frame(); l = h.lottie();
    assert.equal(l.props.autoPlay, true);
    assert.equal(l.props.speed, 1);
    assert.deepEqual(h.view.plays, []);
    assert.equal((source.op - source.ip) / source.fr, 5);
    assert.equal(l.props.resizeMode, 'cover');
    l.props.onAnimationFinish(true);
    assert.equal(h.completions(), 0);
    assert.ok(h.render(true)); h.effects();
    l.props.onAnimationFinish(false);
    l.props.onAnimationFinish(false);
    assert.equal(h.completions(), 1);
    assert.equal(h.render(true), null);
    h.unmount();
  }
});
test('a failed preload cannot suppress the active run; active failure retries once and ignores stale native events', () => {
  for (const platform of ['ios', 'android']) {
    const h = animationHarness(platform);
    const preload = prepareAnimation(h, false);
    preload.props.onAnimationFailure('preload failed');
    assert.ok(h.render(false)); assert.equal(h.completions(), 0);
    let active = prepareAnimation(h, true);
    assert.equal(active.props.autoPlay, true);
    preload.props.onAnimationFinish(false);
    assert.equal(h.completions(), 0);
    active.props.onAnimationFailure('run failed');
    h.render(true); h.effects(); const retry = h.lottie();
    assert.equal(retry.key, 'run-1'); assert.equal(retry.props.autoPlay, true);
    if (platform === 'android') assert.equal(retry.props.renderMode, 'SOFTWARE');
    active.props.onAnimationFinish(false); active.props.onAnimationFailure('stale error');
    assert.equal(h.completions(), 0);
    retry.props.onAnimationFinish(false);
    assert.equal(h.completions(), 1); assert.equal(h.render(true), null);
    h.unmount();
  }
  const h = animationHarness(); const l = prepareAnimation(h, true);
  l.props.onAnimationFailure('first'); h.render(true); h.effects();
  h.lottie().props.onAnimationFailure('second');
  assert.equal(h.completions(), 1); assert.equal(h.render(true), null);
  h.unmount();
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
  assert.match(source, /<ReflectCelebration key=\{celebrationRun.key\}/);
  assert.match(source, /source=\{QUEST_CELEBRATION_SOURCE\}/);
  assert.ok(!source.includes('ConfettiBurst'));
  assert.ok(!source.includes('LottieView'));
});

test('final Quest completion preserves the active run across the picker and preloads the next run', async () => {
  for (const interrupted of [false, true]) {
  const slots = [], checked = [], awards = [], alerts = [];
  let cursor = 0, soundCount = 0, tree, focus;
  const initial = { active: true, plan: { themeKey: 'study', title: 'Study',
    tasks: Array.from({ length: 7 }, (_, i) => ({ text: `Task ${i}`, reward: 10, done: i < 6 })),
    checkedCount: 6, checkedToday: false, day: 7 } };
  const component = load('apps/mobile/app/(main)/(tabs)/quests.tsx', {
    react: {
      useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
        return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
      useRef(current) { const i = cursor++; slots[i] ??= { current }; return slots[i]; },
      useCallback: (fn) => fn, useMemo: (fn) => fn(),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: (x) => x, absoluteFillObject: { position: 'absolute' } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useRouter: () => ({ push() {} }), useFocusEffect(fn) { focus=fn; } },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@novame/domain': { CLOVERS_PER_TASK: 10, COMPLETION_BONUS: 20, themesForScope: () => [] },
    '@/lib/icons': { ICONS: {} },
    '@/lib/session-lifecycle': { sessionEpoch: () => 0 },
    '@/components/ui/app-dialog': { appAlert(...args) { alerts.push(args); } },
    '@/components/ui/offset-card': { OffsetCard: 'OffsetCard' },
    '@/components/ui/tab-header-typography': load('apps/mobile/src/components/ui/tab-header-typography.ts', {
      'react-native': { Platform: { OS: 'android' } },
    }),
    '@/components/ui/grid-background': { GridBackground: 'GridBackground' },
    '@/components/main/reflect-celebration': { ReflectCelebration: 'Celebration' },
    '@/components/main/feature-guide-modal': { FeatureGuideModal: 'FeatureGuideModal' },
    '@/lib/haptics': { haptics: { success() {}, pageOpen() {} } },
    '@/lib/use-completion-sound': { useCompletionSound: () => ({ play: () => soundCount++ }) },
    '@/lib/cosmetics-api': { optimisticCloverAward(amount) {
      awards.push(amount); return { commit: (amount) => awards.push(amount), rollback() { assert.fail('unexpected rollback'); } };
    } },
    '@/lib/quests-api': { getCachedStatus: () => initial, getCachedCustomTasks: () => [], cacheQuestStatus() {},
      fetchQuestStatus: async () => ({ active: false }),
      checkTask: async (index) => { checked.push(index); return { ok: true, allDone: true, cloversEarned: 30 }; } },
    '../../../assets/animations/quest-dense.json': require('../apps/mobile/assets/animations/quest-dense.json'),
  }).default;
  const render = () => { cursor = 0; tree = component(); return nodes(tree).find(n => n.type === 'Celebration'); };
  const idle = render();
  const blur=focus();
  assert.equal(idle.props.active, false);
  const button = nodes(tree).find(n => n.type === 'Pressable'
    && nodes(n).some(child => child.type === 'MaterialIcons' && child.props.name === 'check'));
  button.props.onPress(); button.props.onPress(); // in-flight guard also protects the animation/sound.
  const running = render();
  assert.equal(running.props.active, true);
  assert.equal(running.key, idle.key);
  if (interrupted) {
    blur();assert.equal(render().props.active,false);
    await new Promise(setImmediate);focus();
    const revisited=render();assert.equal(revisited.props.active,false);
    running.props.onComplete();assert.equal(render().key,revisited.key);
    assert.equal(alerts.length,0);assert.equal(soundCount,1);
    assert.deepEqual(awards,[30,30],'leaving consumes visual event, not the earned reward');
    continue;
  }
  await new Promise(resolve => setImmediate(resolve));
  const picker = render();
  assert.ok(nodes(tree).some(n => n.props?.children === 'Weekly Quests'));
  assert.equal(picker.key, running.key);
  assert.equal(picker.props.active, true);
  assert.equal(alerts.length, 0, 'fast final-task response must not cover the confetti');
  assert.equal(nodes(tree).find(n => n.key === 'quest-celebration').props.pointerEvents, 'none');
  picker.props.onComplete();
  const next = render();
  assert.equal(next.props.active, false);
  assert.equal(next.key, running.key + 1);
  assert.deepEqual(alerts, [['Plan complete!', 'You earned 30 clovers.']]);
  picker.props.onComplete(); // stale callback cannot end/reset the next run.
  assert.equal(render().key, next.key);
  assert.equal(soundCount, 1);
  assert.deepEqual(checked, [6]);
  assert.deepEqual(awards, [30, 30]);
  }
});
