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

test('retired settlement UI no longer creates a second paywall trigger',()=>{
  assert.equal(fs.existsSync(path.join(root,'apps/mobile/src/components/main/reflect-settlement.tsx')),false);
  const tap=read('apps/mobile/app/(main)/reflect-guided.tsx');
  assert.doesNotMatch(tap,/recordReflectionPaywallClaim|ReflectSettlementView/);
});

function gateHarness({ slowStore = false, navigation, initialAdventure = null } = {}) {
  const time = clock();
  const slots = [], effects = [], timers = new Map(), pushes = [], resolvers = [];
  const env = { route: ['(main)', 'reflect-typing'], busy: false, dialog: false, modal: undefined, tier: 'free' };
  let cursor = 0, dirty = false, nextTimer = 0, ratingListener, paywallListener, adventureListener, adventurePending=initialAdventure, appListener, reviews = 0, checks = 0;
  const adventureConsumed=[];
  let milestoneRequest=null,milestoneListener;const ratingsConsumed=[];
  const appState = { currentState: 'active', addEventListener(_event, fn) { appListener = fn; return { remove() {} }; } };
  const react = {
    useMemo: fn => { cursor++; return fn(); },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => {
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
    '@/lib/official-rating-milestones':{
      canPresentRatingInline:()=>env.inlineReady!==false,
      peekRatingMilestone:()=>milestoneRequest,
      subscribeRatingMilestones:fn=>{milestoneListener=fn;return()=>{milestoneListener=null;};},
      consumeRatingMilestone:value=>{ratingsConsumed.push(value);if(milestoneRequest?.id===value.id){milestoneRequest=null;milestoneListener?.();}},
    },
    '@/lib/coin-reward-store':{useCoinRewardBusy:()=>!!env.rewarding},
    '@/lib/adventure-paywall':{
      peekAdventurePaywall:()=>adventurePending,
      subscribeAdventurePaywall:fn=>{adventureListener=fn;return()=>{adventureListener=null;};},
      consumeAdventurePaywall:id=>{adventureConsumed.push(id);adventurePending=null;adventureListener?.();},
    },
    '@/lib/partner-reflect-paywall': { peekPartnerReflectPaywall: () => null, subscribePartnerReflectPaywallRequest: () => () => {}, syncPartnerReflectPaywallRequests: async () => {} },
    react,
    'react-native': { AppState: appState },
    'expo-router': { useSegments: () => env.route, router: { push(route) { const path=typeof route === 'string' ? route : route.pathname;pushes.push(path);env.route = ['(main)', '(modals)', path.split('/').at(-1)]; } } },
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
    '@/lib/use-home-entry': { useHomeEntry: () => ({ pending: !!env.homePending, resumeRequired: !!env.homeResume }) },
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
  return { timers, pushes, adventureConsumed,ratingsConsumed,reviews: () => reviews, checks: () => checks,
    set(next) { Object.assign(env, next); render(); },
    queue({ paywall = false, rating = false } = {}) { if (paywall) paywallListener(); if (rating) ratingListener(); render(); },
    adventure(id='journey') { adventurePending=id;adventureListener();render(); },
    milestone(kind='purchase',id='new',userId='me') { milestoneRequest=kind?{kind,id,userId}:null;milestoneListener();render(); },
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
  h.set({ route: ['(main)', 'thump'] }); assert.equal(h.timers.size, 0);
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

test('Adventure offer waits for final exit to Home and its native transition, then mounts the unified paywall once',()=>{
 const h=gateHarness();h.set({route:['(main)','burrow-detail']});h.adventure();assert.equal(h.timers.size,0);
 h.set({route:['(main)','(tabs)','index'],busy:true});assert.equal(h.timers.size,0);
 h.set({busy:false});assert.equal(h.timers.size,1);h.frame();
 assert.deepEqual(h.pushes,['/(main)/(modals)/subscription-paywall']);assert.deepEqual(h.adventureConsumed,['journey']);
 h.set({route:['(main)','(tabs)','index']});assert.equal(h.timers.size,0);h.unmount();
});
test('Adventure promotion waits through non-Home tabs, backgrounding, overlays and unknown entitlement',()=>{
 const h=gateHarness();h.set({route:['(main)','(tabs)','shop']});h.adventure();assert.equal(h.timers.size,0);
 h.set({route:['(main)','reflect']});assert.equal(h.timers.size,0);
 h.set({route:['(main)','(tabs)','index'],homePending:true});assert.equal(h.timers.size,0);
 h.set({homePending:false,homeResume:true});assert.equal(h.timers.size,0);
 h.set({homeResume:false,tier:null});assert.equal(h.timers.size,0);
 h.set({tier:'free',overlay:true});assert.equal(h.timers.size,0);
 h.set({overlay:false,dialog:true});assert.equal(h.timers.size,0);
 h.set({dialog:false,modal:'walkthrough'});assert.equal(h.timers.size,0);
 h.set({modal:undefined});assert.equal(h.timers.size,1);
 h.foreground(false);assert.equal(h.timers.size,0);h.foreground(true);h.frame();assert.equal(h.pushes.length,1);h.unmount();
});
test('a pending Adventure promotion is cancelled for Plus or account change, not leaked into the next account',()=>{
 const h=gateHarness();h.set({route:['(main)','(tabs)','index']});h.adventure();
 h.set({tier:'plus'});assert.equal(h.timers.size,0);assert.deepEqual(h.adventureConsumed,['journey']);
 h.set({tier:'free'});assert.equal(h.timers.size,0);h.adventure('other-journey');h.adventure(null);
 assert.equal(h.timers.size,0);assert.equal(h.pushes.length,0);h.unmount();
});
test('another already-visible unified offer satisfies the Adventure trigger without stacking a second paywall',()=>{
 const h=gateHarness();h.adventure();h.set({route:['(main)','(modals)','subscription-paywall']});
 assert.deepEqual(h.adventureConsumed,['journey']);h.set({route:['(main)','(tabs)','index']});
 assert.equal(h.timers.size,0);assert.equal(h.pushes.length,0);h.unmount();
});
test('restart restores an unpresented Adventure offer, with rating deferred until that offer closes',async()=>{
 const h=gateHarness({initialAdventure:'restored-journey'});h.queue({rating:true});
 assert.equal(h.timers.size,0);h.set({route:['(main)','(tabs)','index']});h.frame();
 assert.deepEqual(h.pushes,['/(main)/(modals)/subscription-paywall']);assert.equal(h.checks(),0);
 assert.deepEqual(h.adventureConsumed,['restored-journey']);
 h.set({route:['(main)','(tabs)','index']});h.frame();await h.settleStore();
 assert.equal(h.reviews(),1);assert.equal(h.pushes.length,1);h.unmount();
});

for(const tier of ['free','plus'])test(`${tier}: a completed Affection can request official review after its animation/coins, without waiting for Home`,async()=>{
 const h=gateHarness();h.set({route:['(main)','affection-detail'],tier,rewarding:true});h.milestone('affection');
 assert.equal(h.timers.size,0);h.set({rewarding:false});h.frame();await h.settleStore();
 assert.equal(h.reviews(),1);assert.equal(h.ratingsConsumed.length,1);assert.equal(h.timers.size,0);h.unmount();
});
test('photo-backed Toy interaction waits until exiting the Toy route, not after upload or a menu push',async()=>{
 const h=gateHarness();h.set({route:['(main)','room-interaction']});h.milestone('toy');assert.equal(h.timers.size,0);
 h.set({route:['(main)','toy-collection']});assert.equal(h.timers.size,0);
 h.set({route:['(main)','(tabs)','index'],busy:true});assert.equal(h.timers.size,0);
 h.set({busy:false});h.frame();await h.settleStore();assert.equal(h.reviews(),1);h.unmount();
});
test('item purchase review waits for acknowledgement, navigation and other overlays, then works in shop detail',async()=>{
 const h=gateHarness();h.set({route:['(main)','shop-detail'],overlay:true});h.milestone('purchase');assert.equal(h.timers.size,0);
 h.set({overlay:false,busy:true});assert.equal(h.timers.size,0);
 h.set({busy:false,tier:null});assert.equal(h.timers.size,0);
 h.set({tier:'plus'});h.frame();await h.settleStore();assert.equal(h.reviews(),1);h.unmount();
});
test('account replacement during a slow official lookup cannot show or consume the previous account’s request',async()=>{
 const h=gateHarness({slowStore:true});h.set({route:['(main)','(tabs)','index']});h.milestone('purchase','A','A');h.frame();
 h.milestone(null);await h.settleStore();assert.equal(h.reviews(),0);assert.equal(h.ratingsConsumed.length,0);h.unmount();
});
test('paid users still receive queued legacy official ratings rather than returning from the Paywall filter',async()=>{
 const h=gateHarness();h.set({route:['(main)','(tabs)','index'],tier:'plus'});h.queue({rating:true});
 h.frame();await h.settleStore();assert.equal(h.reviews(),1);assert.equal(h.pushes.length,0);h.unmount();
});
test('restored or previous Affection requests cannot interrupt a new gesture screen',async()=>{
 const h=gateHarness();h.set({route:['(main)','affection-detail'],inlineReady:false});h.milestone('affection');
 assert.equal(h.timers.size,0);h.set({route:['(main)','(tabs)','index']});h.frame();await h.settleStore();assert.equal(h.reviews(),1);h.unmount();
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
  const common=require('./lifecycle-test-utils.cjs');
  const api = load('apps/mobile/src/lib/rating-navigation.ts', { react: { useSyncExternalStore() {} },
    './ui-work-priority':common.load('apps/mobile/src/lib/ui-work-priority.ts',{},time.globals),
    './interaction-timing':common.load('apps/mobile/src/lib/interaction-timing.ts',{},time.globals),
  }, time.globals);
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

test('Reflect promotions reuse the sole Paywall instead of rendering alternate visual variants', () => {
  const file = read('apps/mobile/app/(main)/(modals)/reflection-plus-paywall.tsx');
  assert.match(file, /return <SubscriptionPaywallModal \/>/);
  assert.match(file, /recordReflectionPaywallVariantShown/,'promotional cadence still consumes its old bookkeeping slot');
  assert.doesNotMatch(file, /StyleSheet|Try for Free|V1_BENEFITS|GridBackground|router\.replace/);
});
