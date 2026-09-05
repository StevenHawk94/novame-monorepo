/* Offline regressions: completion cadence, native navigation and prompt ordering. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { clock } = require('./lifecycle-test-utils.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, require(name) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  }, ...globals });
  return module.exports;
}
function counter(initial = '0', fail = false) {
  let stored = initial, shown = 0;
  const api = load('apps/mobile/src/lib/reflection-paywall-count.ts', {
    '@/lib/storage': { storage: { getString: () => stored, set(_key, value) { if (fail) throw Error('disk'); stored = value; } } },
    '@/shared/storage': { kReflectionPaywallCount: { name: 'existing-counter' } },
  }, { console: { warn() {} } });
  api.subscribeReflectionPaywallRequest(() => shown++);
  return { api, count: () => Number(stored), shown: () => shown };
}

test('restores 1,3,5,8,11,14… for Free, excluding Plus and preserving the existing counter', () => {
  const h = counter(), opportunities = [];
  for (let n = 1; n <= 20; n++) {
    const before = h.shown(); h.api.recordReflectionPaywallClaim(true);
    if (h.shown() !== before) opportunities.push(n);
    h.api.recordReflectionPaywallClaim(false);
    assert.equal(h.count(), n);
  }
  assert.deepEqual(opportunities, [1, 3, 5, 8, 11, 14, 17, 20]);
  const resumed = counter('5');
  resumed.api.recordReflectionPaywallClaim(true); resumed.api.recordReflectionPaywallClaim(true);
  assert.equal(resumed.shown(), 0);
  resumed.api.recordReflectionPaywallClaim(true); assert.equal(resumed.shown(), 1);
  const broken = counter('0', true);
  assert.doesNotThrow(() => broken.api.recordReflectionPaywallClaim(true));
  assert.equal(broken.shown(), 0);
});

test('current settlement completion counts once, only after success; an in-settlement Plus upgrade skips the count', () => {
  const source = ts.createSourceFile('settlement.tsx', read('apps/mobile/src/components/main/reflect-settlement.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0].getText(source).includes('recordReflectionPaywallClaim')) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(effect, 'new settlement must invoke the restored cadence');
  const h = counter(), calls = [];
  const context = { completed: null, delivered: { current: false }, isPaid: false, shared: false,
    draft: { draftId: 'one', userId: 'user-one' },
    Platform: { OS: 'ios' }, route: { key: 'reflect-screen' }, markNavigationTransitionPending() {},
    releaseReflectSettlement() {}, recordReflectionPaywallClaim: h.api.recordReflectionPaywallClaim,
    logFirstReflectCompleted() {},
    onFinalized: () => calls.push('finished'), recordReflectClaimForRating: () => false, emitOfficialRatingRequest() {},
  };
  const run = vm.runInNewContext('(' + effect.getText(source) + ')', context);
  run(); assert.equal(h.count(), 0);
  context.completed = { reflectId: 'one' }; run(); run();
  assert.equal(h.count(), 1); assert.equal(h.shown(), 1); assert.deepEqual(calls, ['finished']);
  context.delivered.current = false; context.isPaid = true; run();
  assert.equal(h.count(), 1); assert.equal(calls.length, 2);
});

function gateHarness({ slowStore = false, navigation } = {}) {
  const time = clock();
  const slots = [], effects = [], timers = new Map(), pushes = [], resolvers = [];
  const env = { route: ['(main)', 'reflect-typing'], busy: false, dialog: false, modal: undefined, tier: 'free' };
  let cursor = 0, dirty = false, nextTimer = 0, ratingListener, paywallListener, appListener, reviews = 0, checks = 0;
  const appState = { currentState: 'active', addEventListener(_event, fn) { appListener = fn; return { remove() {} }; } };
  const react = {
    useMemo: fn => { cursor++; return fn(); },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => {
      if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true; }
    }]; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (old && deps.length === old.deps.length && deps.every((value, n) => Object.is(value, old.deps[n]))) return;
      const slot = slots[i] = { deps };
      effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
    },
  };
  const { OfficialRatingGate } = load('apps/mobile/src/components/rating/official-rating-gate.tsx', {
    react,
    'react-native': { AppState: appState },
    'expo-router': { useSegments: () => env.route, router: { push(route) { pushes.push(typeof route === 'string' ? route : route.pathname); env.route = ['(main)', '(modals)', 'reflection-plus-paywall']; } } },
    'expo-store-review': {
      hasAction() { checks++; return slowStore ? new Promise(resolve => resolvers.push(resolve)) : Promise.resolve(true); },
      requestReview: async () => { reviews++; },
    },
    '@/lib/official-rating-prompt': { subscribeOfficialRatingRequest(fn) { ratingListener = fn; return () => { ratingListener = null; }; } },
    '@/lib/reflection-paywall-count': {
      getNextReflectionPaywallVariant: () => '1',
      subscribeReflectionPaywallRequest(fn) { paywallListener = fn; return () => { paywallListener = null; }; },
    },
    '@/lib/rating-navigation': {
      useRatingTransitionBusy: () => navigation ? navigation.isNavigationTransitionBusy() : env.busy,
      isNavigationTransitionBusy: () => navigation ? navigation.isNavigationTransitionBusy() : env.busy,
    },
    '@/components/ui/app-dialog': { useAppDialogVisible: () => env.dialog },
    '@/lib/use-subscription-tier': { useSubscriptionTierState: () => env.tier },
    '@/lib/use-home-entry': { useHomeEntry: () => ({ pending: false, resumeRequired: false }) },
    '@/lib/modal-coordinator': { useActiveModalSlot: () => env.modal },
    '@/lib/overlay-presence': { useOverlayPresent: () => env.overlay, isOverlayPresent: () => env.overlay },
    '@/lib/async-lifecycle': load('apps/mobile/src/lib/async-lifecycle.ts', {}, time.globals),
  }, { requestAnimationFrame(fn) { const id = ++nextTimer; timers.set(id, { fn }); return id; },
    cancelAnimationFrame: id => timers.delete(id), ...time.globals });
  function render() {
    let n = 0;
    do { assert.ok(n++ < 20, 'effects must settle'); dirty = false; cursor = 0;
      assert.equal(OfficialRatingGate(), null, 'queue must never render a touch-blocking layer');
      effects.splice(0).forEach(fn => fn());
    } while (dirty);
  }
  render();
  return { timers, pushes, reviews: () => reviews, checks: () => checks,
    set(next) { Object.assign(env, next); render(); },
    queue({ paywall = false, rating = false } = {}) { if (paywall) paywallListener(); if (rating) ratingListener(); render(); },
    foreground(active) { appState.currentState = active ? 'active' : 'background'; appListener(appState.currentState); render(); },
    frame() { const timer = [...timers][0]; assert.ok(timer, 'missing next-frame dispatch');
      timers.delete(timer[0]); timer[1].fn(); render(); },
    async settleStore() { if (resolvers.length) resolvers.shift()(true); await new Promise(setImmediate); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('paywall waits for Done dismissal and native transitions, then opens once from the picker', () => {
  const h = gateHarness(); h.queue({ paywall: true }); assert.equal(h.timers.size, 0);
  h.set({ route: ['(main)', 'reflect'], busy: true }); assert.equal(h.timers.size, 0);
  h.set({ busy: false }); assert.equal(h.timers.size, 1);
  h.frame(); assert.deepEqual(h.pushes, ['/(main)/(modals)/reflection-plus-paywall']);
  h.set({ route: ['(main)', 'reflect'] }); assert.equal(h.timers.size, 0); h.unmount();
});
test('when both cadences are due, paywall is first and rating follows dismissal on the picker', async () => {
  const h = gateHarness(); h.set({ route: ['(main)', '(tabs)', 'index'] });
  h.queue({ paywall: true, rating: true }); assert.equal(h.timers.size, 1); assert.equal(h.checks(), 0);
  h.frame(); assert.equal(h.timers.size, 0); assert.equal(h.reviews(), 0);
  h.set({ route: ['(main)', 'reflect'], busy: true }); assert.equal(h.timers.size, 0);
  h.set({ busy: false }); h.frame(); await h.settleStore();
  assert.equal(h.reviews(), 1); assert.equal(h.pushes.length, 1); assert.equal(h.timers.size, 0); h.unmount();
});
test('navigating, backgrounding, dialogs and walkthroughs defer the request without consuming it', () => {
  const h = gateHarness(); h.set({ route: ['(main)', 'reflect'] }); h.queue({ paywall: true });
  h.set({ route: ['(main)', 'focus'] }); assert.equal(h.timers.size, 0);
  h.set({ route: ['(main)', 'reflect'], dialog: true }); assert.equal(h.timers.size, 0);
  h.set({ dialog: false, modal: 'guide' }); assert.equal(h.timers.size, 0);
  h.set({ modal: undefined }); assert.equal(h.timers.size, 1);
  h.foreground(false); assert.equal(h.timers.size, 0);
  h.foreground(true); h.frame(); assert.equal(h.pushes.length, 1); h.unmount();
});
test('unknown entitlement waits; becoming Plus cancels an already queued paywall', () => {
  const h = gateHarness(); h.set({ route: ['(main)', 'reflect'], tier: null }); h.queue({ paywall: true });
  assert.equal(h.timers.size, 0); h.set({ tier: 'free' }); assert.equal(h.timers.size, 1);
  h.set({ tier: 'plus' }); assert.equal(h.timers.size, 0);
  h.set({ tier: 'free' }); assert.equal(h.timers.size, 0); assert.equal(h.pushes.length, 0); h.unmount();
});
test('a slow native rating lookup cannot overlap a newly queued paywall', async () => {
  const h = gateHarness({ slowStore: true }); h.set({ route: ['(main)', '(tabs)', 'index'] });
  h.queue({ rating: true }); h.frame(); assert.equal(h.checks(), 1); assert.equal(h.reviews(), 0);
  h.queue({ paywall: true }); assert.equal(h.timers.size, 0);
  await h.settleStore(); assert.equal(h.reviews(), 0); h.frame();
  h.set({ route: ['(main)', '(tabs)', 'index'] }); h.frame(); await h.settleStore();
  assert.equal(h.reviews(), 1); h.unmount();
});
test('unmount clears pending timers and cancels a not-yet-presented rating request', async () => {
  const h = gateHarness(); h.set({ route: ['(main)', 'reflect'] }); h.queue({ paywall: true });
  h.unmount(); assert.equal(h.timers.size, 0); assert.equal(h.pushes.length, 0);
  const r = gateHarness({ slowStore: true }); r.set({ route: ['(main)', '(tabs)', 'index'] });
  r.queue({ rating: true }); r.frame(); r.unmount(); await r.settleStore(); assert.equal(r.reviews(), 0);
});

test('rating dispatches on the first idle frame after settlement dismissal, not after returning Home', async () => {
  const h = gateHarness({ slowStore: true }); h.queue({ rating: true });
  assert.equal(h.checks(), 0);
  h.set({ route: ['(main)', 'reflect'], busy: true }); assert.equal(h.timers.size, 0);
  h.set({ busy: false }); h.frame(); assert.equal(h.checks(), 1);
  assert.equal(h.reviews(), 0); // Store preparation is asynchronous; the gate renders no blocking view.
  h.set({ route: ['(main)', '(tabs)', 'quests'] });
  await h.settleStore(); assert.equal(h.reviews(), 1); h.unmount();
});

function navigationHarness() {
  const time = clock();
  const api = load('apps/mobile/src/lib/rating-navigation.ts', { react: { useSyncExternalStore() {} } }, time.globals);
  let focused = 'reflect-typing-id';
  const context = { navigation: { getState: () => ({ index: 0, routes: [{ key: focused }] }) } };
  const events = typeof api.ratingNavigationListeners === 'function'
    ? api.ratingNavigationListeners(context) : api.ratingNavigationListeners;
  return { api, events, time, focus: key => { focused = key; } };
}

test('a popped settlement never emits its closing end: destination appearance releases the first Free paywall', () => {
  const n = navigationHarness(), h = gateHarness({ navigation: n.api });
  n.api.markNavigationTransitionPending('reflect-typing-id');
  h.queue({ paywall: true }); assert.equal(h.timers.size, 0);
  // React Navigation drops screenListeners events whose target left state.routes.
  // Programmatic pop removes the settlement before its native onDisappear.
  n.focus('reflect-picker');
  n.events.transitionStart({ target: 'reflect-picker', data: { closing: false } });
  h.set({ route: ['(main)', 'reflect'] }); assert.equal(h.timers.size, 0);
  n.events.transitionEnd({ target: 'reflect-picker', data: { closing: false } });
  assert.equal(n.api.isNavigationTransitionBusy(), false);
  h.set({}); h.frame(); assert.equal(h.pushes.length, 1);
  h.set({ route: ['(main)', 'reflect'] }); assert.equal(h.timers.size, 0); h.unmount();
});

test('late events from a background route cannot release or recreate the current transition', () => {
  const n = navigationHarness();
  n.api.markNavigationTransitionPending('reflect-typing-id');
  n.focus('reflect-picker');
  n.events.transitionStart({ target: 'reflect-picker', data: { closing: false } });
  n.events.transitionEnd({ target: 'home', data: { closing: false } });
  assert.equal(n.api.isNavigationTransitionBusy(), true);
  n.events.transitionEnd({ target: 'reflect-picker', data: { closing: false } });
  assert.equal(n.api.isNavigationTransitionBusy(), false);
  n.events.transitionStart({ target: 'reflect-typing-id', data: { closing: true } });
  n.events.transitionStart({ target: 'home', data: { closing: false } });
  assert.equal(n.api.isNavigationTransitionBusy(), false);
});

test('destination appearance without an opening start still clears a pending prompt', () => {
  const n = navigationHarness();
  n.api.markNavigationTransitionPending('reflect-typing-id');
  n.focus('home');
  n.events.transitionEnd({ target: 'home', data: { closing: false } });
  assert.equal(n.api.isNavigationTransitionBusy(), false);
});

test('cancelling a native swipe clears transition state on the still-focused route', () => {
  const n = navigationHarness();
  n.events.transitionStart({ target: 'reflect-typing-id', data: { closing: true } });
  assert.equal(n.api.isNavigationTransitionBusy(), true);
  n.events.gestureCancel({ target: 'reflect-typing-id' });
  assert.equal(n.api.isNavigationTransitionBusy(), false);
});

test('Paywall uses requested copy and responsive larger icons with a fixed text gap', () => {
  const file = read('apps/mobile/app/(main)/(modals)/reflection-plus-paywall.tsx');
  for (const copy of ['Memories Need Your Input', 'Auto Summarize Reflections into Memories',
    'And more features to help you live your life while staying close to your person.', '[Input your memory]', 'Try for Free']) {
    assert.ok(file.includes(copy), copy);
  }
  assert.match(file, /itemImage: \{ width: '100%', maxWidth: 124, aspectRatio: 1 \}/);
  assert.ok(!file.includes("justifyContent: 'space-between'"));
  assert.match(file, /alignItems: 'center', gap: 6/);
  assert.ok(file.includes("router.replace('/(main)/(modals)/subscription-paywall?phase=plans'"));
  assert.match(file, /source=\{ICONS\.Plus\}[\s\S]*style=\{styles\.v1PlusIcon\}/);
  assert.match(file, /v1PlusIcon: \{ width: 56, height: 56, alignSelf: 'center', marginBottom: 8 \}/);
});
