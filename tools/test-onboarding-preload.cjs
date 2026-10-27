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
function nodes(tree) { return flat(tree).flatMap((node) => [node, ...nodes(typeof node?.type==='function'&&['PairingInviteCard','PairingCodeSheet','PairingConnectedPage','BurrowPaywallPage'].includes(node.type.name)?node.type(node.props):node?.props?.children)]); }

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
    imports['@/lib/user-error-message'] ??= require('./lifecycle-test-utils.cjs').load('apps/mobile/src/lib/user-error-message.ts');
    const module = { exports: {} };
    const defaults = {
      './choose-bunny-page':{ChooseBunnyPage:'ChooseBunnyPage'},
      '@/lib/bunny-identity':{bunnyVariant:()=> 'biscuit',queueBunnySelection(){},syncBunnyIdentity:async()=>{}},
      '@/components/main/burrow-launch-screen': { BurrowLaunchScreen: 'BurrowLaunchScreen' },
      react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
      '@/lib/app-viewport': { useAppViewport: () => native.useWindowDimensions() },
      '@/components/layout/app-modal': { AppModal: 'Modal' },
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
  const pairingUi=h.load('apps/mobile/src/components/onboarding/partner-pairing-ui.tsx',{
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:40,bottom:24})},
    '@expo/vector-icons':{MaterialIcons:'Icon'},'@/components/ui/user-avatar':{UserAvatar:'UserAvatar'},
    '@/lib/burrow-onboarding-design':design,
  });
  const ui = h.load('apps/mobile/src/components/onboarding/burrow-onboarding-pages.tsx', {
    '@/components/paywall/burrow-paywall-page': h.load('apps/mobile/src/components/paywall/burrow-paywall-page.tsx', {
    "../burrow/burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({top:40,bottom:24}) },
      '@expo/vector-icons': { Feather: 'Icon' }, '@/lib/paywall-presentation': h.load('apps/mobile/src/lib/paywall-presentation.ts'),
    }),
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 24 }) },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path' },
    '@expo/vector-icons': { MaterialIcons: 'Icon' },
    '@/components/ui/user-avatar': { UserAvatar: 'UserAvatar' },
    '@/components/ui/grid-background': { GridBackground: 'Grid' },
    '@/lib/burrow-onboarding-design': design, './onboarding-pager': h,
    './plus-benefit-icon': { PlusBenefitIcon: 'PlusBenefitIcon' },
    './partner-pairing-ui':pairingUi,
  });
  let completed, failed, purchases = 0, sessions = 0, inviteRequests = 0,companionWrites=0;
  const queued = [], alerts = [], routes = [], pairCalls = [], names = [], completions = [];
  const screen = h.load(screenFile, {
    '@/lib/home-art-preparation':{prepareHomeArt:async()=>{}},
    '@/lib/burrow-store':{burrowClock:()=>0,getBurrowSnapshot:()=>({data:{profile:{id:'owner'}}}),refreshBurrow:async()=>{},refreshBurrowAfterCurrent:async()=>{}},
    '@/lib/ui-idle':{afterUiSettles:()=>()=>{}},
    '@/components/auth/connect-account-view': { ConnectAccountView: 'ConnectAccountView' },
    '@/components/ui/app-dialog': { appAlert: (...args) => alerts.push(args) },
    '@/components/onboarding/burrow-onboarding-pages': ui,
    '@/components/onboarding/onboarding-date-wheel': { OnboardingDateWheel: 'DateWheel' },
    '@/lib/onboarding-relationship-date': h.load('apps/mobile/src/lib/onboarding-relationship-date.ts'),
    '@/lib/burrow-onboarding-design': design,
    '@react-native-community/datetimepicker': { __esModule: true, default: 'DatePicker' },
    'expo-clipboard': { async setStringAsync() {} },
    'expo-image-picker': { async launchImageLibraryAsync() { return { canceled: true }; } },
    'expo-image-manipulator': { manipulateAsync: async uri => ({ uri }), SaveFormat: { JPEG: 'jpeg' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 40, bottom: 24 }) },
    'expo-router': { useRouter: () => ({ replace: route => routes.push(route) }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '../../src/lib/haptics': { haptics: { light() {}, medium() {}, success() {}, pageOpen() {} } },
    '../../src/lib/home-entry-readiness': { beginHomeEntry() {}, homeEntryRemainingMs:()=>5000, deferHomeEntryNotification() {} },
    '../../src/lib/onboarding': {
      beginAnonymousOnboardingAuthHandoff() {}, endAnonymousOnboardingAuthHandoff() {},
      markIntroSeen: () => completions.push(true), setBunnyName: name => names.push(name), setChosenCompanion() {},
      queueOnboardingProfile: value => queued.push(value), syncOnboardingProfile: async () => true,
      syncOnboardingCompanion: async () => {companionWrites++;return options.syncCompanion?options.syncCompanion():true;},
    },
    '../../src/lib/ad-measurement': { logOnboardingCompleted() {}, logRegistration() {} },
    '../../src/components/privacy/meta-privacy-provider': { useMetaPrivacy: () => ({ ensureConsentBeforeHome: async () => {} }) },
    '../../src/lib/auth': { async ensureSession() { sessions++; return true; },connectProviderOrSignIn:async()=>options.providerResult??{ok:true,mode:'linked'} },
    '../../src/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } } },
    '../../src/lib/account-api': { updateDisplayName: async () => {} },
    '../../src/lib/avatar-upload-queue': { queueProfileAvatar: async uri => uri, syncProfileAvatar: async () => true },
    '../../src/lib/avatar': { DEFAULT_AVATAR_OPTIONS: [{ id: 'default-1', source: 1 }] },
    '../../src/lib/friends-api': {
      getCachedFriends: () => options.cachedFriends ?? { inviteCode: null, friends: [], pending: [], sent: [] },
      fetchFriends: async request => {
        if(request?.force)return options.fetchPartner ? options.fetchPartner() : { inviteCode: 'ABC123', friends: [], pending: [], sent: [] };
        inviteRequests++; return options.fetchInvite ? options.fetchInvite() : { inviteCode: 'ABC123', friends: [], pending: [], sent: [] };
      },
      addFriend: async (...args) => { pairCalls.push(args); return options.pairResult ?? { ok: true, partner: { userId: 'partner', displayName: 'Alex' } }; },
    },
    '../../src/lib/async-lifecycle': h.load('apps/mobile/src/lib/async-lifecycle.ts'),
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
        pricing: { yearlyTrialEligible: true, yearlyTrialDuration: [{unit:'day',value:3}], monthlyAnnualized: '$59.88', yearlyPerMonth: '$4.99',
          yearly: { displayPrice: '$59.99',price:59.99,currency:'USD' }, monthly: { displayPrice: '$5.99',price:5.99,currency:'USD' } },
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
    inviteRequests: () => inviteRequests,
    companionWrites:()=>companionWrites,
  };
}
const flush = () => new Promise(setImmediate);
function signingHarness({session={user:{id:'owner'}},ensure=true}={}){
 const h=harness(),routes=[];let resolveSync;
 const sync=new Promise(resolve=>{resolveSync=resolve;});
 const {default:Screen}=h.load('apps/mobile/app/(auth)/signing-in.tsx',{
  'expo-router':{router:{replace:route=>routes.push(route)},useLocalSearchParams:()=>({})},
  '@/lib/auth':{getCurrentSession:async()=>session,ensureSession:async()=>ensure},
  '@/lib/subscription':{fetchSubscriptionTier:async()=>{}},'@/lib/me-stats':{fetchMeStats:async()=>{}},
  '@/lib/onboarding':{syncOnboardingCompanion:()=>sync,syncOnboardingProfile:async()=>false},
  '@/lib/home-entry-readiness':{beginHomeEntry(){},deferHomeEntryNotification(){},homeEntryRemainingMs:()=>5000},
 });
 const controller=h.component(Screen,{});controller.render();
 return{...h,routes,controller,resolveSync};
}
test('auth Splash releases once at the shared deadline; late companion response never reroutes Home',async()=>{
 const h=signingHarness();await flush();h.expire(5000);await flush();h.expire(0);
 assert.equal(h.routes.join(','),'/(main)/(tabs)');
 h.resolveSync(true);await flush();h.expire(0);assert.equal(h.routes.length,1);h.controller.unmount();
});
test('explicit missing identity still opens sign-in, not an authenticated Home',async()=>{
 const h=signingHarness({session:null,ensure:false});await flush();
 assert.equal(h.routes.join(','),'/(auth)/sign-in');h.expire(5000);h.expire(0);assert.equal(h.routes.length,1);h.controller.unmount();
});
test('unmounting auth Splash cancels its UI deadline and ignores late setup',async()=>{
 const h=signingHarness();await flush();h.controller.unmount();h.expire(5000);h.resolveSync(true);await flush();h.expire(0);
 assert.equal(h.routes.length,0);
});
test('closing onboarding paywall paints Splash immediately; remote setup failures continue with durable retry',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});
 const f=screenHarness(harness(),{syncCompanion:()=>pending});
 const finish=f.props().finish;finish();finish();
 assert.equal(f.controller.render().type,'BurrowLaunchScreen');
 await flush();assert.deepEqual(f.routes,[]);assert.equal(f.companionWrites(),1,'double close must not create duplicate setup');
 resolve(true);await flush();await flush();
 assert.equal(f.routes.at(-1),'/(auth)/signing-in');
 assert.equal(f.controller.render().type,'BurrowLaunchScreen','do not flash the paywall while navigation commits');f.controller.unmount();
 const retry=screenHarness(harness(),{syncCompanion:async()=>false});
 retry.props().finish();assert.equal(retry.controller.render().type,'BurrowLaunchScreen');
 await flush();await flush();assert.equal(retry.controller.render().type,'BurrowLaunchScreen');
 assert.equal(retry.routes.at(-1),'/(auth)/signing-in');assert.equal(retry.alerts.length,0);retry.controller.unmount();
});
test('hung onboarding setup releases after five seconds and cannot navigate twice on late success',async()=>{
 const h=harness();let resolve;const pending=new Promise(done=>{resolve=done;});
 const f=screenHarness(h,{syncCompanion:()=>pending});f.props().finish();await flush();
 h.expire(5000);await flush();await flush();
 assert.equal(f.routes.at(-1),'/(auth)/signing-in');assert.equal(f.alerts.length,0);
 resolve(true);await flush();assert.equal(f.routes.length,1);f.controller.unmount();
});
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
test('all 16 pages declare pager-managed art accurately; bunny choice icons and avatars do not block navigation', () => {
  const h = harness(), f = screenHarness(h), tree = f.render();
  const pages = nodes(tree).filter(node => node.type === h.OnboardingPage);
  assert.equal(pages.length, 16);
  let images = 0;
  for (const page of pages) {
    const imgs = nodes(page).filter(node => node.type === h.OnboardingImage);
    assert.equal(imgs.length, page.props.imageCount, page.props.id);
    for (const img of imgs) { assert.ok(fs.existsSync(img.props.source), img.props.source); images++; }
    for (const scroll of nodes(page).filter(node => node.type === 'ScrollView')) assert.equal(scroll.props.removeClippedSubviews, false);
  }
  assert.equal(images, 19);
  assert.equal(f.purchases(), 0); assert.equal(f.sessions(), 1, 'welcome starts account-owned code preparation, never payments');
  f.controller.unmount();
});
test('six feature pages precede name → optional photo → relationship date; partner nickname is not required', async () => {
  const h = harness(), f = screenHarness(h);
  const actual = [];
  for (let i = 0; i < 8; i++) { actual.push(f.props().step); if (i < 7) f.props().next(); }
  assert.deepEqual(actual, ['start', 'decorate', 'toy', 'affection', 'surprise', 'games', 'explore', 'self-info']);
  f.props().saveInfo(); assert.equal(f.props().step, 'self-info');
  f.props().setFirstName(' Sam ');
  assert.equal(f.props().validInfo, true);
  f.props().saveInfo();
  assert.equal(f.props().step, 'profile-photo');
  assert.equal(f.queued[0].displayName, 'Sam');
  assert.equal(f.queued[0].partnerNickname, undefined);
  assert.equal(f.queued[0].relationshipSince, undefined);
  assert.equal(f.queued[0].birthday, undefined);
  f.props().savePhoto(); assert.equal(f.props().step, 'relationship-date');
  f.props().dateInput.props.onChange('21/12/2023'); f.props().saveDate(); f.props(); await flush();
  assert.equal(f.props().step,'choose-bunny');f.props().continueBunny();await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'ABC123');
  assert.equal(f.queued.some(job=>job.defaultAvatarId!==undefined),false,'skipping photo retains name-initial avatar');
  assert.equal(f.queued.at(-1).relationshipSince, '2023-12-21');
  assert.equal(f.sessions(), 1, 'concurrent background setup shares one identity');
  f.controller.unmount();
});
test('the six revised pages have the reference fields/actions and no old nickname/date questionnaire',()=>{
  const h=harness(),f=screenHarness(h);f.props().setFirstName('Alex');
  const tree=f.render(),pages=nodes(tree).filter(node=>node.type===h.OnboardingPage);
  const page=id=>pages.find(node=>node.props.id===id),text=id=>nodes(page(id)).filter(node=>node.type==='Text').flatMap(node=>flat(node.props.children)).join(' ');
  assert.ok(text('self-info').includes('What should we call you?'));
  const input=nodes(page('self-info')).find(node=>node.type==='TextInput');assert.equal(input.props.maxLength,20);assert.equal(input.props.accessibilityLabel,'Your name');
  assert.ok(nodes(page('self-info')).some(node=>node.type==='Text'&&flat(node.props.children).join('')==='4/20'));
  assert.equal(nodes(page('self-info')).filter(node=>node.type==='TextInput').length,1);
  assert.ok(text('profile-photo').includes('Add a profile photo'));assert.ok(nodes(page('profile-photo')).some(node=>node.props?.accessibilityLabel==='Skip'));
  assert.ok(text('relationship-date').includes('When did your story begin?'));assert.ok(text('relationship-date').includes('An approximate date is okay.'));
  assert.ok(text('pairing').includes('Your invite code'));assert.ok(text('pairing').includes('Have their code?'));
  assert.ok(nodes(page('pairing')).some(node=>node.props?.accessibilityLabel==='Share Invite'));
  assert.ok(nodes(page('pairing')).some(node=>node.props?.accessibilityLabel==='Enter partner’s code'));
  assert.ok(!nodes(page('pairing')).some(node=>node.type===h.OnboardingImage));
  assert.ok(text('pairing-success').includes('You’re Connected!'));
  const modal=nodes(tree).find(node=>node.type==='Modal');assert.ok(nodes(modal).some(node=>node.props?.children==='Enter Their Code'));assert.ok(nodes(modal).some(node=>node.props?.accessibilityLabel==='Pair Now'));
  assert.ok(!nodes(modal).some(node=>node.type==='TextInput'),'a closed code modal must not steal keyboard focus');
  f.controller.unmount();
});
test('name requires only a nonblank name, preserves 20 characters, and repeated Continue cannot skip the photo page',()=>{
  const f=screenHarness(harness());f.props().go('self-info');f.props().setFirstName('   ');f.props().saveInfo();assert.equal(f.props().step,'self-info');
  f.props().setFirstName('ABCDEFGHIJKLMNOPQRSTmore');const submit=f.props().saveInfo;submit();submit();
  assert.equal(f.props().step,'profile-photo');assert.equal(f.props().firstName,'ABCDEFGHIJKLMNOPQRST');assert.equal(f.queued.at(-1).displayName,'ABCDEFGHIJKLMNOPQRST');
  f.props().savePhoto();assert.equal(f.props().step,'relationship-date');f.controller.unmount();
});
test('invalid or future relationship dates cannot advance; selected date reaches the pairing request',async()=>{
  const f=screenHarness(harness());f.props().go('relationship-date');
  for(const value of ['31/02/2024','01/01/2999','invalid']){f.props().dateInput.props.onChange(value);assert.equal(f.props().validDate,false);f.props().saveDate();assert.equal(f.props().step,'relationship-date');}
  f.props().dateInput.props.onChange('29/02/2024');f.props().saveDate();assert.equal(f.props().step,'choose-bunny');f.props().continueBunny();await flush();assert.equal(f.props().step,'pairing');
  f.props().setPairCode('abc123');f.props().pair();await flush();assert.equal(f.pairCalls[0][1].relationshipSince,'2024-02-29');f.controller.unmount();
});
test('inviter reaches Connected using real partner profile after the other device pairs, then continues to Plus',async()=>{
  let paired=false,calls=0;const h=harness(),f=screenHarness(h,{fetchPartner:async()=>{calls++;return {inviteCode:'ABC123',friends:paired?[{userId:'their-id',displayName:'Taylor',avatarUrl:'https://example.test/avatar.jpg',isDefaultAvatar:false}]:[],pending:[],sent:[]};}});
  f.props().go('pairing');f.props();await flush();assert.equal(f.props().step,'pairing');assert.equal(calls,1);
  paired=true;h.expire(5_000);await flush();assert.equal(f.props().step,'pairing-success');assert.equal(f.props().partner.name,'Taylor');assert.equal(f.props().partner.userId,'their-id');
  const page=nodes(f.render()).find(node=>node.type===h.OnboardingPage&&node.props.id==='pairing-success');
  const continueButton=nodes(page).find(node=>node.props?.accessibilityLabel==='Continue');continueButton.props.onPress();assert.equal(f.props().step,'paywall');
  h.expire(5_000);await flush();assert.equal(calls,2,'leaving Invite stops rechecks');f.controller.unmount();
});
test('Skip and backgrounding reject late partner checks without taking over the next page',async()=>{
  for(const reason of ['skip','background','unmount']){
    let resolve,calls=0;const h=harness(),f=screenHarness(h,{fetchPartner:()=>{calls++;return new Promise(done=>{resolve=done;});}});
    f.props().go('pairing');f.props();await flush();assert.equal(calls,1);
    if(reason==='skip'){f.props().go('paywall');f.props();}else if(reason==='background')h.appState('background');else f.controller.unmount();
    resolve({inviteCode:'ABC123',friends:[{userId:'other',displayName:'Late'}],pending:[],sent:[]});await flush();
    assert.equal(f.props().partner,null);assert.equal(f.props().step,reason==='skip'?'paywall':'pairing');
    h.expire(5_000);await flush();assert.equal(calls,1);f.controller.unmount();
  }
});
test('welcome preallocates the invite; opening Pairing reuses it without another request', async () => {
  const f = screenHarness(harness());
  assert.equal(f.props().step, 'start');
  await flush();
  assert.equal(f.props().inviteCode, 'ABC123');
  assert.equal(f.inviteRequests(), 1);
  f.props().go('profile-photo');
  f.props().savePhoto(); assert.equal(f.props().step, 'relationship-date'); f.props().saveDate(); await flush();
  assert.equal(f.props().step,'choose-bunny');f.props().continueBunny();await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'ABC123');
  assert.equal(f.inviteRequests(), 1, 'no force-refresh or serial duplicate on entry');
  f.controller.unmount();
});
test('stable cached invite is immediately reused after identity hydration', async () => {
  const f = screenHarness(harness(), { cachedFriends: { inviteCode: 'CACHED', friends: [], pending: [], sent: [] } });
  f.props(); await flush();
  assert.equal(f.props().inviteCode, 'CACHED');
  assert.equal(f.inviteRequests(), 0);
  f.props().go('relationship-date'); f.props().saveDate(); await flush();
  assert.equal(f.props().step,'choose-bunny');f.props().continueBunny();await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'CACHED');
  f.controller.unmount();
});
test('real Friends cache never pins a missing invite for its five-minute TTL and coalesces prefetches', async () => {
  const h = harness(), values = new Map(); let calls = 0;
  const friends = h.load('apps/mobile/src/lib/friends-api.ts', {
    './partner-invite-cache':{cachedPartnerInvite:()=>null,rememberPartnerInvite(){}},
    './widget-sync': {}, './connection-analysis-cache': {}, './analysis-refresh-policy': {},
    './subscription': {}, './bags-api': {}, './remote-items': {},
    './session-lifecycle': {sessionEpoch:()=>1,sessionUserId:()=> 'owner',subscribeSessionIdentity(){}},
    './storage': { storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value) } },
    '../shared/storage/keys': Object.fromEntries(['kCommonItems', 'kConnInsights', 'kFriendsFeed', 'kFriendsStatus', 'kPairingStatus', 'kSharedBoxState'].map(key => [key, { name: key }])),
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } } },
    './api': { apiClient: { get: async () => { calls++; return { success: true, inviteCode: 'NEW123', friends: [], pending: [], sent: [] }; } } },
  });
  values.set('kFriendsStatus', JSON.stringify({ status: { inviteCode: null, friends: [], pending: [], sent: [] },
    fetchedAtMs: Date.now(), localDate: friends.localDateStr() }));
  const first = friends.fetchFriends(), second = friends.fetchFriends();
  assert.equal(first, second);
  assert.equal((await first).inviteCode, 'NEW123');
  assert.equal(calls, 1);
  assert.equal(friends.getCachedFriends().inviteCode, 'NEW123');
  await friends.fetchFriends();
  assert.equal(calls, 1, 'the now-complete snapshot is reusable');
});
test('slow invite prepares on the previous page and never reveals an empty Pairing card', async () => {
  let resolve;
  const request = new Promise(done => { resolve = done; });
  const f = screenHarness(harness(), { fetchInvite: () => request });
  f.props(); await flush();
  f.props().go('relationship-date'); f.props().saveDate();f.props().continueBunny();f.props().continueBunny();
  assert.equal(f.props().step, 'choose-bunny');
  assert.equal(f.props().openingPairing, true);
  assert.equal(f.inviteRequests(), 1, 'double tap and background preparation share the request');
  resolve({ inviteCode: 'READY6', friends: [], pending: [], sent: [] }); await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'READY6');
  assert.equal(f.props().openingPairing, false);
  f.controller.unmount();
});
test('offline invite can retry successfully without losing the relationship date step', async () => {
  let offline = true;
  const f = screenHarness(harness(), { fetchInvite: async () => {
    if (offline) throw Error('offline');
    return { inviteCode: 'BACK12', friends: [], pending: [], sent: [] };
  } });
  f.props(); await flush();
  assert.equal(f.alerts.length, 0, 'background prefetch errors never interrupt the welcome');
  f.props().go('relationship-date'); f.props().saveDate();f.props().continueBunny(); await flush();
  assert.equal(f.props().step, 'choose-bunny');
  assert.equal(f.props().openingPairing, false);
  assert.equal(f.alerts.at(-1)[0], 'Could not prepare invite');
  offline = false;
  f.alerts.at(-1)[2].find(button => button.text === 'Try again').onPress(); await flush();
  assert.equal(f.props().step, 'pairing');
  assert.equal(f.props().inviteCode, 'BACK12');
  f.controller.unmount();
});
test('invite preparation has a bounded wait and Invite later cannot be undone by a late response', async () => {
  let resolve;
  const request = new Promise(done => { resolve = done; });
  const h = harness(), f = screenHarness(h, { fetchInvite: () => request });
  f.props(); await flush(); f.props().go('relationship-date'); f.props().saveDate();f.props().continueBunny();await flush();
  h.expire(12_000); await flush();
  assert.equal(f.props().step, 'choose-bunny');
  assert.equal(f.props().openingPairing, false);
  f.alerts.at(-1)[2].find(button => button.text === 'Invite later').onPress();
  assert.equal(f.props().step, 'paywall');
  resolve({ inviteCode: 'LATE12', friends: [], pending: [], sent: [] }); await flush();
  assert.equal(f.props().step, 'paywall');
  assert.equal(f.props().inviteCode, null);
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
  assert.equal(f.completions.length, 0,'no setup Splash/completion before account connection');
  assert.equal(f.companionWrites(),0);assert.notEqual(f.controller.render().type,'BurrowLaunchScreen');
  f.props().connectAccount.props.onClose();
  f.alerts.at(-1)[2].find(button=>button.text==='Close Anyway').onPress();
  assert.equal(f.controller.render().type,'BurrowLaunchScreen','only exiting Connect starts Splash');
  await flush();await flush();
  assert.equal(f.completions.length,1);assert.equal(f.companionWrites(),1);
  assert.equal(f.routes.at(-1),'/(auth)/signing-in');
  assert.ok(f.names.includes('Sam'));
  f.controller.unmount();
});
test('paid Connect is immediately interactive; linking same guest finishes setup after connection, not before',async()=>{
 const f=screenHarness(harness(),{purchaseOutcome:{kind:'completed'}});
 f.props().purchase();await flush();f.completed();
 assert.equal(f.props().step,'connect');assert.equal(f.props().connectAccount.props.busy,false);
 f.props().connectAccount.props.onProvider('apple');await flush();
  assert.equal(f.companionWrites(),0);assert.notEqual(f.controller.render().type,'BurrowLaunchScreen');
 f.alerts.at(-1)[2][0].onPress();assert.equal(f.controller.render().type,'BurrowLaunchScreen');
 await flush();await flush();assert.equal(f.companionWrites(),1);assert.equal(f.completions.length,1);f.controller.unmount();
});
test('signing into an existing account after paid onboarding never applies guest setup to the recovered profile',async()=>{
 const f=screenHarness(harness(),{purchaseOutcome:{kind:'completed'},providerResult:{ok:true,mode:'signed-in'}});
 f.props().purchase();await flush();f.completed();f.props().connectAccount.props.onProvider('google');await flush();
 assert.ok(f.completions.length>0,'first-Home announcement is armed before auth navigation settles');
 f.alerts.at(-1)[2][0].onPress();await flush();await flush();
 assert.equal(f.companionWrites(),0);assert.equal(f.names.length,0);assert.equal(f.routes.at(-1),'/(auth)/signing-in');f.controller.unmount();
});
test('verified paid completion keeps success and enters Home handoff despite setup network failure',async()=>{
 const f=screenHarness(harness(),{purchaseOutcome:{kind:'completed'},syncCompanion:async()=>false});
 f.props().purchase();await flush();f.completed();
 const close=()=>{f.props().connectAccount.props.onClose();f.alerts.at(-1)[2].find(button=>button.text==='Close Anyway').onPress();};
 close();assert.equal(f.controller.render().type,'BurrowLaunchScreen');await flush();await flush();
 assert.equal(f.routes.at(-1),'/(auth)/signing-in');assert.equal(f.alerts.length,1,'only the explicit account-safety confirmation, no network failure modal');
 assert.equal(f.completions.length,1);f.controller.unmount();
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
