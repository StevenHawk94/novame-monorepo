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
test('custom celebration source uses the same full playback and completes exactly once', () => {
  const source = structuredClone(require('../apps/mobile/assets/animations/reflect-dense.json'));
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
test('current Quest particles share one native clock, complete once and cancel on unmount without a retired full-screen composition', () => {
 const utils=require('./lifecycle-test-utils.cjs'),h=utils.hooks(),motion=require('./motion-test-utils.cjs').motionHarness(h);let done=0;
 const {QuestClaimConfetti}=utils.load('apps/mobile/src/components/burrow/quest-claim-confetti.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{create:x=>x}},'react-native-reanimated':motion.reanimated,
 });
 const tree=h.render(()=>QuestClaimConfetti({onComplete:()=>done++}));assert.equal(tree.props.pointerEvents,'none');assert.equal(tree.props.children.length,12);
 assert.equal(motion.timings.length,1);motion.time.advance(849);assert.equal(done,0);motion.time.advance(1);assert.equal(done,1);h.unmount();assert.equal(motion.time.timers.size,0);
 const source=read('apps/mobile/src/components/burrow/quest-board.tsx');assert.match(source,/QuestClaimConfetti/);assert.doesNotMatch(source,/quest-dense|CloverBurst/);
});
