// Native event/hook boundary tests. Device visual timing still needs iOS/Android QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const pagerFile = 'apps/mobile/src/components/onboarding/onboarding-pager.tsx';
const screenFile = 'apps/mobile/app/(onboarding)/index.tsx';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const flat = (items) => [items].flat(Infinity).filter((x) => x != null && x !== false);
function nodes(tree) { return flat(tree).flatMap((node) => [node, ...nodes(node?.props?.children)]); }

function harness() {
  let owner = null, cursor = 0, nextId = 0, splashHides = 0;
  const timers = new Map(), frames = new Map(), listeners = new Set();
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) {
      const scope = owner, index = cursor++;
      if (!scope.slots[index]) scope.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [scope.slots[index].value, (update) => {
        const old = scope.slots[index].value, value = typeof update === 'function' ? update(old) : update;
        if (!Object.is(old, value)) { scope.slots[index].value = value; scope.dirty = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      return (owner.slots[index] ??= { current: value });
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(owner.slots[index]?.deps, deps)) owner.slots[index] = { deps, value: fn() };
      return owner.slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useId() { return react.useRef('image-' + ++nextId).current; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (same(owner.slots[index]?.deps, deps)) return;
      const previous = owner.slots[index], slot = owner.slots[index] = { deps };
      owner.effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); });
    },
    createContext(value) { const context = { value }; context.Provider = { context }; return context; },
    useContext(context) { return context.value; },
    Children: { map(children, fn) { return flat(children).map(fn); } },
    isValidElement: (child) => !!child?.props,
    cloneElement: (child, props) => ({ ...child, key: props.key ?? child.key, props: { ...child.props, ...props } }),
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const appState = {
    currentState: 'active',
    addEventListener(name, fn) { assert.equal(name, 'change'); listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const native = {
    ...Object.fromEntries(['ActivityIndicator', 'View', 'ScrollView', 'Text', 'TextInput', 'Modal', 'Pressable', 'KeyboardAvoidingView'].map((key) => [key, key])),
    Platform: { OS: 'ios' }, Linking: {}, AppState: appState, Keyboard: { dismiss() {} }, Share: { async share() {} },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: { create: (s) => s, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, absoluteFillObject: { position: 'absolute' } },
  };
  function load(file, imports = {}) {
    const module = { exports: {} };
    const defaults = {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
      'expo-image': { Image: 'NativeImage' }, '../../lib/splash': { hideSplashOnce: () => splashHides++ },
      '../../lib/download-queue': { markAndroidP0UiReady() {} },
      '../main/burrow-launch-screen': { BurrowLaunchScreen: 'BurrowLaunchScreen' },
    };
    const code = ts.transpileModule(read(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console,
      requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; },
      cancelAnimationFrame(id) { frames.delete(id); },
      setTimeout(fn, ms) { timers.set(++nextId, { fn, ms }); return nextId; },
      clearTimeout(id) { timers.delete(id); },
      require(name) {
        if (name in imports) return imports[name];
        if (name in defaults) return defaults[name];
        if (/\.(webp|png|gif)$/.test(name)) return path.resolve(path.dirname(path.join(root, file)), name);
        throw new Error('Unexpected import: ' + name);
      },
    }, { filename: file });
    return module.exports;
  }
  function component(fn, props) {
    const scope = { slots: [], effects: [], dirty: false, props };
    return {
      render(next = scope.props) {
        scope.props = next;
        let tree;
        for (let attempts = 0; ; attempts++) {
          assert.ok(attempts < 20, 'render loop');
          scope.dirty = false; cursor = 0; owner = scope;
          tree = fn(scope.props); owner = null;
          scope.effects.splice(0).forEach((effect) => effect());
          if (!scope.dirty) break;
        }
        return tree;
      },
      unmount() { scope.slots.forEach((slot) => slot?.cleanup?.()); },
    };
  }
  const exports = load(pagerFile);
  return {
    ...exports, load, component, jsx, frames, timers, listeners, native,
    splashHides: () => splashHides,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); },
    expire(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
    },
    appState(state) { appState.currentState = state; listeners.forEach((fn) => fn(state)); },
  };
}

test('only the real visible page + its next destination are mounted, including skips', () => {
  const h = harness(), pages = ['start', 'someone', 'who', 'blocker', 'feedback', 'imagine', 'how', 'space', 'insights', 'boundaries', 'creator', 'paywall', 'plans', 'name', 'connect'];
  const mounted = (...args) => Array.from(h.onboardingMountedPages(...args));
  assert.deepEqual(mounted(null, 'start', 'someone'), ['start']);
  for (let i = 0; i < pages.length; i++) {
    assert.deepEqual(mounted(pages[i], pages[i], pages[i + 1] ?? null), pages.slice(i, i + 2));
    assert.ok(mounted(pages[i], 'name', 'connect').length <= 2);
  }
  assert.deepEqual(mounted('paywall', 'name', 'connect'), ['paywall', 'name']);
  assert.deepEqual(mounted('name', 'connect', null), ['name', 'connect']);
});

test('page waits for layout AND every displayed image, not just the first image', () => {
  const h = harness(), calls = [];
  const props = { id: 'who', imageCount: 5, requested: true, onReady: (id) => calls.push(id) };
  const page = h.component(h.OnboardingPage, props);
  let tree = page.render();
  for (let i = 0; i < 5; i++) tree.props.value.imageReady('image-' + i);
  page.render(); assert.equal(h.frames.size, 0);
  tree.props.children.props.onLayout();
  tree = page.render();
  assert.equal(h.frames.size, 1); assert.equal(calls.length, 0);
  assert.equal(h.timers.size, 0);
  h.frame(); assert.deepEqual(calls, ['who']);
  tree.props.value.imageReady('image-1'); page.render(); h.frame();
  assert.deepEqual(calls, ['who']); // repeated native onDisplay cannot advance twice
  page.unmount(); assert.equal(h.timers.size, 0);
});

test('an already warm page reveals without reloading; it never steals touches or accessibility', () => {
  const h = harness(), calls = [];
  const props = { id: 'someone', imageCount: 1, onReady: (id) => calls.push(id) };
  const page = h.component(h.OnboardingPage, props);
  let tree = page.render(), view = tree.props.children;
  assert.equal(view.props.collapsable, false);
  assert.equal(view.props.pointerEvents, 'none');
  assert.equal(view.props.accessibilityElementsHidden, true);
  assert.equal(view.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(view.props.style[1].opacity, 0);
  view.props.onLayout(); tree.props.value.imageReady('question');
  page.render(); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  page.render({ ...props, requested: true }); h.frame();
  assert.deepEqual(calls, ['someone']);
  tree = page.render({ ...props, requested: true, visible: true, interactive: true });
  assert.equal(tree.props.children.props.style[1].opacity, 1);
  assert.equal(tree.props.children.props.pointerEvents, 'auto');
  assert.equal(tree.props.children.props.accessibilityElementsHidden, false);
  assert.equal(tree.props.value.playing, true);
  tree = page.render({ ...props, requested: true, visible: true, foreground: false });
  assert.equal(tree.props.value.playing, false);
  page.unmount();
});

test('no-image pages wait only for layout; broken/missing native events have a bounded fallback', () => {
  const h = harness(), calls = [];
  const empty = h.component(h.OnboardingPage, { id: 'plans', requested: true, onReady: (id) => calls.push(id) });
  empty.render().props.children.props.onLayout();
  empty.render(); h.frame(); assert.deepEqual(calls, ['plans']);
  empty.unmount();
  const props = { id: 'name', imageCount: 1, requested: true, onReady: (id) => calls.push(id) };
  const broken = h.component(h.OnboardingPage, props);
  broken.render(); assert.equal([...h.timers.values()][0].ms, 8000);
  h.expire(8000); assert.deepEqual(calls, ['plans', 'name']);
  broken.unmount();
  const cancelled = h.component(h.OnboardingPage, props);
  cancelled.render(); cancelled.unmount(); h.expire(8000);
  assert.deepEqual(calls, ['plans', 'name']); assert.equal(h.frames.size, 0);
});

test('cancelled navigation removes queued frame callbacks and does not reveal an old destination', () => {
  const h = harness(), calls = [];
  const props = { id: 'plans', requested: true, onReady: (id) => calls.push(id) };
  const page = h.component(h.OnboardingPage, props);
  page.render().props.children.props.onLayout(); page.render();
  assert.equal(h.frames.size, 1);
  page.render({ ...props, requested: false });
  h.frame(); assert.deepEqual(calls, []);
  page.unmount();
});

test('pager preserves keys/native views at hand-off, rejects late signals, and cleans up', () => {
  const h = harness(), children = ['start', 'someone', 'who', 'name'].map((id) => h.jsx(h.OnboardingPage, { id }));
  const p = h.component(h.OnboardingPager, { requestedPage: 'start', nextPage: 'someone', children });
  const pages = (tree) => nodes(tree).filter((node) => node.type === h.OnboardingPage);
  let tree = p.render(), first = pages(tree)[0];
  assert.deepEqual(pages(tree).map((node) => node.props.id), ['start']);
  assert.equal(h.splashHides(), 0);
  first.props.onReady('start'); tree = p.render(); h.frame();
  assert.equal(h.splashHides(), 1);
  assert.deepEqual(pages(tree).map((node) => node.props.id), ['start', 'someone']);
  const warm = pages(tree)[1];
  tree = p.render({ requestedPage: 'someone', nextPage: 'who', children });
  assert.equal(pages(tree)[0].props.visible, true); // old page stays intact until target is ready
  assert.equal(pages(tree)[0].props.interactive, false);
  assert.equal(pages(tree)[1].key, warm.key);
  assert.equal(pages(tree)[1].type, warm.type);
  warm.props.onReady('someone'); tree = p.render(); h.frame();
  assert.deepEqual(pages(tree).map((node) => node.props.id), ['someone', 'who']);
  assert.equal(pages(tree)[0].props.visible, true);
  assert.equal(pages(tree)[0].key, warm.key);
  tree = p.render({ requestedPage: 'name', nextPage: null, children });
  warm.props.onReady('someone'); tree = p.render(); // late old callback is ignored
  assert.equal(pages(tree).find((node) => node.props.id === 'name').props.visible, false);
  h.expire(200); tree = p.render();
  assert.ok(nodes(tree).some((node) => node.type === 'ActivityIndicator'));
  pages(tree).find((node) => node.props.id === 'name').props.onReady('name');
  tree = p.render(); h.frame();
  assert.deepEqual(pages(tree).map((node) => node.props.id), ['name']);
  assert.ok(!nodes(tree).some((node) => node.type === 'ActivityIndicator'));
  h.appState('background'); tree = p.render();
  assert.equal(pages(tree)[0].props.foreground, false);
  p.unmount();
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
});

test('image readiness uses onDisplay and errors; GIF stays paused while staged/backgrounded', async () => {
  const h = harness(), ready = [];
  const page = h.component(h.OnboardingPage, { id: 'how', imageCount: 1 });
  const provider = page.render();
  provider.type.context.value = { playing: false, imageReady: (key) => ready.push(key) };
  const image = h.component(h.OnboardingImage, { source: 42, animated: true });
  let tree = image.render();
  const calls = [], nativeImage = {
    async startAnimating() { calls.push('play'); },
    async stopAnimating() { calls.push('stop'); },
  };
  tree.props.ref.current = nativeImage;
  assert.equal(tree.props.transition, 0);
  assert.equal(tree.props.autoplay, false);
  assert.equal(tree.props.onLoad, undefined);
  assert.equal(ready.length, 0);
  tree.props.onDisplay(); tree = image.render();
  assert.equal(ready.length, 1); assert.ok(!calls.includes('play'));
  provider.type.context.value = { ...provider.type.context.value, playing: true };
  tree = image.render(); h.frame(); assert.equal(calls.at(-1), 'play'); assert.equal(tree.props.autoplay, true);
  provider.type.context.value = { ...provider.type.context.value, playing: false };
  image.render(); assert.equal(calls.at(-1), 'stop');
  image.unmount(); page.unmount();
  const errorImage = h.component(h.OnboardingImage, { source: 99 });
  tree = errorImage.render(); tree.props.onError({ error: 'missing bundle asset' });
  assert.equal(ready.length, 2);
  errorImage.unmount();
});

test('Android preloaded GIF resumes with its render listener still attached', () => {
  const h = harness();
  h.native.Platform.OS = 'android';
  const page = h.component(h.OnboardingPage, { id: 'how', imageCount: 1 });
  const provider = page.render(), context = provider.type.context;
  context.value = { playing: false, imageReady() {} };
  const image = h.component(h.OnboardingImage, { source: 42, animated: true });
  let tree = image.render();
  // Model expo-image 3.0.11 + FrameAnimationDrawable 3.0.5: native
  // autoplay=false hard-stops/removes the listener; pause/resume do not reattach.
  let attached = false, paused = false, drawing = false, starts = 0;
  tree.props.ref.current = {
    async startAnimating() {
      starts++;
      if (paused) paused = false;
      else attached = true;
      drawing = attached;
    },
    async stopAnimating() { paused = true; drawing = false; },
  };
  function nativeDisplay() {
    attached = true; paused = false; drawing = true;
    tree.props.onDisplay();
    if (!tree.props.autoplay) { attached = false; drawing = false; }
    tree = image.render();
  }
  nativeDisplay();
  assert.equal(tree.props.autoplay, true, 'avoid Android hard-stop on preloaded resources');
  assert.equal(attached, true);
  assert.equal(drawing, false, 'offscreen staged page must remain paused');
  context.value = { ...context.value, playing: true };
  tree = image.render();
  assert.equal(drawing, false, 'wait for native reveal commit');
  h.frame();
  assert.equal(drawing, true, 'revealed GIF must actually draw, not merely call resume');
  // A native drawable delivered again while paused must be paused again too.
  context.value = { ...context.value, playing: false };
  tree = image.render();
  assert.equal(drawing, false);
  nativeDisplay();
  assert.equal(drawing, false, 'replacement drawable cannot run in the background');
  context.value = { ...context.value, playing: true };
  tree = image.render(); h.frame();
  assert.equal(drawing, true);
  // If a page is left before the queued start, it must not restart offscreen.
  nativeDisplay();
  const previousStarts = starts;
  context.value = { ...context.value, playing: false };
  tree = image.render(); h.frame();
  assert.equal(starts, previousStarts);
  assert.equal(drawing, false);
  context.value = { ...context.value, playing: true };
  image.render(); image.unmount(); h.frame();
  assert.equal(drawing, false);
  assert.equal(h.frames.size, 0);
  page.unmount();
});

test('static onboarding images never start animation on either platform', () => {
  for (const platform of ['ios', 'android']) {
    const h = harness(); h.native.Platform.OS = platform;
    const image = h.component(h.OnboardingImage, { source: 42 });
    let tree = image.render();
    tree.props.ref.current = {
      startAnimating() { assert.fail('static image started'); },
      stopAnimating() { assert.fail('static image paused'); },
    };
    tree.props.onDisplay(); tree = image.render(); h.frame();
    assert.equal(tree.props.autoplay, false);
    image.unmount();
  }
});


// Render real presentation separately from its controller: no payments, auth
// mutations or remote avatars can run merely because the next page is staged.
function screenHarness(h, options = {}) {
  const design = h.load('apps/mobile/src/lib/burrow-onboarding-design.ts');
  const ui = h.load('apps/mobile/src/components/onboarding/burrow-onboarding-pages.tsx', {
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 24 }) },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path' },
    '@expo/vector-icons': { MaterialIcons: 'Icon' },
    '@/components/ui/user-avatar': { UserAvatar: 'UserAvatar' },
    '@/components/ui/grid-background': { GridBackground: 'Grid' },
    '@/lib/burrow-onboarding-design': design, './onboarding-pager': h,
    './plus-benefit-icon': { PlusBenefitIcon: 'PlusBenefitIcon' },
  });
  let completed, failed, purchases = 0, sessions = 0;
  const queued = [], alerts = [], routes = [], pairCalls = [], names = [], completions = [];
  const screen = h.load(screenFile, {
    '@/components/ui/app-dialog': { appAlert: (...args) => alerts.push(args) },
    '@/components/onboarding/burrow-onboarding-pages': ui,
    '@/lib/burrow-onboarding-design': design,
    '@react-native-community/datetimepicker': { __esModule: true, default: 'DatePicker' },
    'expo-clipboard': { async setStringAsync() {} },
    'expo-image-picker': { async launchImageLibraryAsync() { return { canceled: true }; } },
    'expo-image-manipulator': { manipulateAsync: async uri => ({ uri }), SaveFormat: { JPEG: 'jpeg' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 24 }) },
    'expo-router': { useRouter: () => ({ replace: route => routes.push(route) }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '../../src/lib/haptics': { haptics: { light() {}, medium() {}, success() {}, pageOpen() {} } },
    '../../src/lib/home-entry-readiness': { beginHomeEntry() {}, deferHomeEntryNotification() {} },
    '../../src/lib/feature-guides': { enableFeatureGuidesForNewUser() {} },
    '../../src/lib/onboarding': {
      beginAnonymousOnboardingAuthHandoff() {}, endAnonymousOnboardingAuthHandoff() {},
      markIntroSeen: () => completions.push(true), setBunnyName: name => names.push(name), setChosenCompanion() {},
      queueOnboardingProfile: value => queued.push(value), syncOnboardingProfile: async () => true,
      syncOnboardingCompanion: async () => true,
    },
    '../../src/lib/ad-measurement': { logOnboardingCompleted() {}, logRegistration() {} },
    '../../src/components/privacy/meta-privacy-provider': { useMetaPrivacy: () => ({ ensureConsentBeforeHome: async () => {} }) },
    '../../src/lib/auth': { async ensureSession() { sessions++; return true; } },
    '../../src/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } } },
    '../../src/lib/account-api': { updateDisplayName: async () => {} },
    '../../src/lib/avatar-upload-queue': { queueProfileAvatar: async uri => uri, syncProfileAvatar: async () => true },
    '../../src/lib/avatar': { DEFAULT_AVATAR_OPTIONS: [{ id: 'default-1', source: 1 }] },
    '../../src/lib/friends-api': {
      fetchFriends: async () => ({ inviteCode: 'ABC123', friends: [], pending: [], sent: [] }),
      addFriend: async (...args) => { pairCalls.push(args); return options.pairResult ?? { ok: true, partner: { userId: 'partner', displayName: 'Alex' } }; },
    },
    '../../src/lib/iap': {
      onPurchaseComplete(fn) { completed = fn; return () => {}; },
      onPurchaseError(fn) { failed = fn; return () => {}; },
      async initIAP() {},
      async purchaseSubscription() { purchases++; return options.purchaseOutcome ?? { kind: 'cancelled' }; },
      restoreSubscriptions: async () => ({ restored: false }),
    },
    '../../src/lib/notification-settings': {},
    '../../src/hooks/use-store-subscription-pricing': {
      useStoreSubscriptionPricing: () => ({
        pricing: { yearlyTrialEligible: true, monthlyAnnualized: '$59.88', yearlyPerMonth: '$4.99',
          yearly: { displayPrice: '$59.99' }, monthly: { displayPrice: '$5.99' } },
        status: 'ready', load: async () => null, retry: async () => null,
      }),
    },
  });
  const controller = h.component(screen.default, {});
  return {
    controller, ui, design, queued, alerts, routes, pairCalls, names, completions,
    props: () => controller.render().props,
    render: () => h.component(ui.BurrowOnboardingPages, controller.render().props).render(),
    completed: () => completed(), failed: error => failed(error), purchases: () => purchases, sessions: () => sessions,
  };
}
const flush = () => new Promise(setImmediate);
test('Share invite only loads Share, preserves the real code, and handles dismissal/failure', async () => {
  assert.doesNotMatch(read(screenFile), /\bimport\s*\(\s*['"]react-native['"]\s*\)/,
    'Metro namespace imports eagerly evaluate every React Native export');
  const h = harness(), shares = [];
  Object.defineProperty(h.native, 'PushNotificationIOS', {
    enumerable: true,
    get() { assert.fail('sharing must not evaluate unrelated RN native module getters'); },
  });
  h.native.Share.share = async content => { shares.push(content.message); return { action: 'dismissedAction' }; };
  const f = screenHarness(h);
  f.props().shareCode(); await flush();
  assert.equal(shares.length, 0, 'sharing waits for an account-owned code');
  f.props().go('pairing'); f.props(); await flush();
  f.props().shareCode(); await flush();
  assert.equal(shares.length, 1);
  assert.ok(shares[0].includes('ABC123'));
  assert.equal(f.alerts.length, 0, 'dismissing the native share sheet is not an error');
  assert.equal(f.props().step, 'pairing');
  h.native.Share.share = async () => { throw new Error('Share sheet unavailable'); };
  f.props().shareCode(); await flush();
  assert.equal(f.alerts.at(-1)[0], 'Could not share invite');
  assert.equal(f.props().step, 'pairing');
  f.controller.unmount();
});
test('all 13 new pages declare bundled art accurately; remote avatars never block readiness', () => {
  const h = harness(), f = screenHarness(h), tree = f.render();
  const pages = nodes(tree).filter(node => node.type === h.OnboardingPage);
  assert.equal(pages.length, 13);
  let images = 0;
  for (const page of pages) {
    const imgs = nodes(page).filter(node => node.type === h.OnboardingImage);
    assert.equal(imgs.length, page.props.imageCount, page.props.id);
    for (const img of imgs) { assert.ok(fs.existsSync(img.props.source), img.props.source); images++; }
    for (const scroll of nodes(page).filter(node => node.type === 'ScrollView')) assert.equal(scroll.props.removeClippedSubviews, false);
  }
  assert.equal(images, 9);
  assert.equal(f.purchases(), 0); assert.equal(f.sessions(), 0);
  f.controller.unmount();
});
test('five feature pages precede combined info; no birthday/pronouns questionnaire is required', async () => {
  const h = harness(), f = screenHarness(h);
  const actual = [];
  for (let i = 0; i < 7; i++) { actual.push(f.props().step); if (i < 6) f.props().next(); }
  assert.deepEqual(actual, ['start', 'decorate', 'toy', 'affection', 'games', 'explore', 'self-info']);
  f.props().saveInfo(); assert.equal(f.props().step, 'self-info');
  f.props().setFirstName(' Sam '); f.props().setPartnerName(' Babe ');
  f.props().dateInput.props.onChange('21/12/2023');
  assert.equal(f.props().validInfo, true);
  f.props().saveInfo();
  assert.equal(f.props().step, 'profile-photo');
  assert.equal(f.queued[0].displayName, 'Sam');
  assert.equal(f.queued[0].partnerNickname, 'Babe');
  assert.equal(f.queued[0].relationshipSince, '2023-12-21');
  assert.equal(f.queued[0].birthday, undefined);
  f.props().savePhoto(); f.props(); await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'ABC123');
  assert.equal(f.queued[1].defaultAvatarId, 'default-1');
  assert.equal(f.sessions(), 1, 'concurrent background setup shares one identity');
  f.controller.unmount();
});
test('correct normalized code connects immediately; real partner data replaces nickname', async () => {
  const f = screenHarness(harness());
  f.props().go('pairing'); await flush();
  f.props().setPairCode('abc-123'); f.props().pair(); f.props().pair();
  assert.equal(f.props().pairing, true);
  await flush();
  assert.equal(f.pairCalls.length, 1);
  assert.equal(f.pairCalls[0][0], 'ABC123');
  assert.equal(f.props().step, 'pairing-success');
  assert.equal(f.props().partner.name, 'Alex');
  assert.equal(f.props().pairing, false);
  f.controller.unmount();
});
test('invalid code never renders connected state or advances onboarding', async () => {
  const f = screenHarness(harness(), { pairResult: { ok: false } });
  f.props().go('pairing'); f.props().setPairCode('BAD123'); f.props().pair();
  await flush();
  assert.equal(f.props().step, 'pairing'); assert.equal(f.props().partner, null);
  assert.equal(f.alerts[0][0], 'Wrong code'); assert.equal(f.props().pairing, false);
  f.controller.unmount();
});
test('cancelled purchases do not finish; unrelated store events are ignored', async () => {
  const f = screenHarness(harness());
  f.props(); f.completed(); assert.equal(f.completions.length, 0);
  f.props().purchase(); await flush();
  assert.equal(f.purchases(), 1); f.completed(); await flush();
  assert.equal(f.completions.length, 0); assert.equal(f.props().purchasing, false);
  f.controller.unmount();
});
test('verified purchase uses latest entered name and proceeds to optional account connection once', async () => {
  const f = screenHarness(harness(), { purchaseOutcome: { kind: 'completed' } });
  f.props().setFirstName('Sam'); f.props().purchase(); await flush(); f.props();
  assert.equal(f.completions.length, 0, 'store sheet alone does not grant access');
  f.completed(); f.completed(); await flush();
  assert.equal(f.props().step, 'connect');
  assert.equal(f.completions.length, 1);
  assert.ok(f.names.includes('Sam'));
  f.controller.unmount();
});
test('layout dimensions support small phones and 900:1600 without squeezing footer or hero away', () => {
  const f = screenHarness(harness());
  for (const [width, height] of [[320,568],[375,667],[390,844],[900,1600]]) {
    const m = f.design.onboardingMetrics(width,height,24,16);
    assert.ok(m.heroHeight >= 200 && m.heroHeight + m.footer < height);
    assert.ok(m.title <= 38 && m.body <= 21);
    assert.ok(m.buttonHeight >= 50);
  }
  f.controller.unmount();
});
