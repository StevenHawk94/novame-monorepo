// Native display-event boundary tests; device decoding/visual timing needs QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stateFile = 'apps/mobile/src/lib/home-entry-readiness.ts';
const gateFile = 'apps/mobile/src/components/main/home-entry-gate.tsx';
const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== 'object' ? [] :
  [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
    ...globals,
  });
  return module.exports;
}
function harness() {
  const api = load(stateFile), frames = new Map(), timers = new Map(), appListeners = new Set(), backListeners = new Set(), routes = [];
  let next = 0, owner, cursor;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type, props, ...children) => jsx(type, { ...props, ...(children.length ? { children } : {}) }, props?.key),
    useState(initial) {
      const scope = owner, i = cursor++;
      scope.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [scope.slots[i].value, (v) => { scope.slots[i].value = v; }];
    },
    useEffect(fn, deps) {
      const i = cursor++, old = owner.slots[i];
      if (same(old?.deps, deps)) return;
      const slot = owner.slots[i] = { deps };
      owner.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
    },
  };
  const appState = { currentState: 'active', addEventListener(_event, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } };
  const components = load(gateFile, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', AppState: appState,
      BackHandler: { addEventListener(_event, fn) { backListeners.add(fn); return { remove: () => backListeners.delete(fn) }; } },
      StyleSheet: { create: (x) => x, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
    },
    'expo-image': { Image: 'Image' }, 'expo-router': { router: { push: (route) => routes.push(route) } },
    '@/lib/home-entry-readiness': api, '@/lib/use-home-entry': { useHomeEntry: api.getHomeEntryState },
    '@/lib/icons': { ICONS: { obBunnyHead: 1 } }, '@/lib/haptics': { haptics: { light() {} } },
    '@/components/ui/grid-background': { GridBackground: 'Grid' },
  }, {
    requestAnimationFrame(fn) { frames.set(++next, fn); return next; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearTimeout(id) { timers.delete(id); },
  });
  function component(fn, props) {
    const scope = { slots: [], effects: [] };
    return {
      render() { owner = scope; cursor = 0; const tree = fn(props); owner = null; scope.effects.splice(0).forEach((effect) => effect()); return tree; },
      unmount() { scope.slots.forEach((slot) => slot?.cleanup?.()); },
    };
  }
  return {
    ...api, ...components, component, frames, timers, routes, appListeners, backListeners,
    ready() { const { attempt } = api.getHomeEntryState(); api.HOME_ENTRY_ASSETS.forEach((asset) => api.markHomeEntryAsset(asset, attempt)); },
    frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach((fn) => fn()); },
    expire(ms) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
    state(value) { appState.currentState = value; [...appListeners].forEach((fn) => fn(value)); },
  };
}

test('returning users never wait; finishing first Home preserves the same native keys', () => {
  const h = harness(), home = jsx('Home', {}), gate = h.component(h.HomeEntryGate, { children: home });
  let tree = gate.render();
  assert.equal(tree.props.children[0].props.children, home);
  assert.equal(tree.props.children[1], null);
  assert.equal(h.timers.size, 0);
  h.beginHomeEntry(); gate.render(); const attempt = h.getHomeEntryState().attempt;
  h.ready(); gate.render(); h.frame();
  assert.equal(h.getHomeEntryState().pending, true);
  h.frame(); tree = gate.render();
  assert.equal(h.getHomeEntryState().pending, false);
  assert.equal(h.getHomeEntryState().attempt, attempt);
  assert.equal(tree.props.children[0].props.children, home);
  assert.equal(tree.props.children[1], null);
  assert.equal(h.timers.size, 0);
  gate.unmount(); assert.equal(h.appListeners.size, 0); assert.equal(h.backListeners.size, 0);
});

test('all 12 display/layout signals are required; duplicate callbacks cannot release early', () => {
  const h = harness(); h.beginHomeEntry();
  const attempt = h.getHomeEntryState().attempt;
  assert.equal(h.HOME_ENTRY_ASSETS.length, 12);
  h.HOME_ENTRY_ASSETS.slice(0, -1).forEach((asset) => h.markHomeEntryAsset(asset, attempt));
  h.markHomeEntryAsset('scene', attempt); h.finishHomeEntry(attempt);
  assert.equal(h.homeEntryIsReady(), false); assert.equal(h.getHomeEntryState().pending, true);
  h.markHomeEntryAsset('tabs-layout', attempt);
  assert.equal(h.homeEntryIsReady(), true);
});

test('image download alone is not ready: actual onDisplay fires, errors remain retryable', () => {
  const h = harness(); h.beginHomeEntry();
  const props = { asset: 'menu', source: 7, onDisplay() { props.displayed = true; } };
  const image = h.HomeEntryImage(props);
  assert.equal(image.props.transition, 0); assert.equal(image.props.onLoad, undefined);
  assert.equal(h.getHomeEntryState().ready.length, 0);
  image.props.onDisplay(); assert.equal(props.displayed, true);
  assert.ok(h.getHomeEntryState().ready.includes('menu'));
  h.HomeEntryImage({ asset: 'scene' }).props.onError({ error: 'decode failed' });
  assert.equal(h.getHomeEntryState().failed, true);
});

test('opaque full-screen cover blocks touch/accessibility until ready, never scales Home down', () => {
  const h = harness(); h.beginHomeEntry(); const gate = h.component(h.HomeEntryGate, { children: jsx('Home', {}) });
  const tree = gate.render(), [content, cover] = tree.props.children;
  assert.equal(content.props.pointerEvents, 'none');
  assert.equal(content.props.accessibilityElementsHidden, true);
  assert.equal(content.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(content.props.style.flex, 1);
  assert.equal(cover.props.style.position, 'absolute'); assert.equal(cover.props.style.bottom, 0);
  assert.equal(cover.props.style.backgroundColor, '#F8E2C1');
  assert.equal([...h.backListeners][0](), true);
  gate.unmount();
});

test('timeout offers a retry; old attempt callbacks cannot reveal the new attempt', () => {
  const h = harness(); h.beginHomeEntry(); h.deferHomeEntryNotification();
  const gate = h.component(h.HomeEntryGate, { children: jsx('Home', {}) });
  gate.render(); const oldImage = h.HomeEntryImage({ asset: 'scene' }), oldAttempt = h.getHomeEntryState().attempt;
  h.expire(12000); const tree = gate.render();
  assert.equal(h.getHomeEntryState().pending, true);
  assert.equal(nodes(tree).some((n) => n.type === 'Spinner'), false);
  nodes(tree).find((n) => n.type === 'Pressable').props.onPress(); gate.render();
  assert.equal(h.getHomeEntryState().attempt, oldAttempt + 1);
  assert.equal(h.getHomeEntryState().failed, false);
  assert.equal(h.getHomeEntryState().after, 'notification-settings');
  oldImage.props.onDisplay(); oldImage.props.onError({});
  assert.equal(h.getHomeEntryState().ready.length, 0); assert.equal(h.getHomeEntryState().failed, false);
  assert.notEqual(h.HomeEntryImage({ asset: 'scene' }).key, oldImage.key);
  gate.unmount(); assert.equal(h.timers.size, 0);
});

test('background cancels timeout/reveal and resumes when active; unmount cancels queued work', () => {
  const h = harness(); h.beginHomeEntry(); const gate = h.component(h.HomeEntryGate, { children: null });
  gate.render(); h.state('background'); gate.render(); assert.equal(h.timers.size, 0);
  h.ready(); gate.render(); h.frame(); h.frame(); assert.equal(h.getHomeEntryState().pending, true);
  h.state('active'); gate.render(); h.frame();
  gate.unmount(); h.frame(); assert.equal(h.getHomeEntryState().pending, true);
  assert.equal(h.frames.size, 0); assert.equal(h.appListeners.size, 0);
});

test('purchased onboarding notification is deferred until after Home paint, exactly once', () => {
  const h = harness(); h.beginHomeEntry(); h.deferHomeEntryNotification(); h.beginHomeEntry();
  assert.equal(h.getHomeEntryState().after, 'notification-settings'); // duplicate auth path must not reset
  const gate = h.component(h.HomeEntryGate, { children: jsx('Home', {}) });
  gate.render(); h.ready(); gate.render(); h.frame(); h.frame();
  assert.equal(h.routes.length, 0);
  const tree = gate.render(); assert.equal(tree.props.children[1], null);
  h.frame(); assert.deepEqual(h.routes, ['/(main)/(modals)/notification-settings']);
  gate.render(); h.frame(); h.frame(); assert.equal(h.routes.length, 1);
  gate.unmount();
});

test('late native frames can recover a timeout without a second navigation', () => {
  const h = harness(); h.beginHomeEntry(); const gate = h.component(h.HomeEntryGate, { children: null });
  gate.render(); h.expire(12000); gate.render(); h.ready(); gate.render(); h.frame(); h.frame(); gate.render();
  assert.equal(h.getHomeEntryState().pending, false); assert.equal(h.routes.length, 0);
  gate.unmount();
});

test('interrupted Home mount invalidates its decoded views and stale native callbacks', () => {
  const h = harness(); h.beginHomeEntry();
  const gate = h.component(h.HomeEntryGate, { children: null }); gate.render();
  const oldImage = h.HomeEntryImage({ asset: 'scene' });
  h.ready(); gate.render(); gate.unmount();
  assert.equal(h.getHomeEntryState().ready.length, 0);
  oldImage.props.onDisplay(); h.frame(); h.frame();
  assert.equal(h.getHomeEntryState().ready.length, 0);
  assert.equal(h.getHomeEntryState().pending, true);
});

test('entry is armed before auth redirects; first Home mounts before notification modal', () => {
  const onboarding = read('apps/mobile/app/(onboarding)/index.tsx');
  const finish = onboarding.slice(onboarding.indexOf('async function onFinishName()'), onboarding.indexOf('async function onLinkProvider'));
  assert.ok(finish.indexOf('beginHomeEntry()') < finish.indexOf('markIntroSeen()'));
  assert.ok(finish.indexOf('beginHomeEntry()') < finish.indexOf('await ensureSession()'));
  const signing = read('apps/mobile/app/(auth)/signing-in.tsx');
  assert.match(signing, /params.after === 'notification-settings' && !preparingFirstHome/);
  assert.match(read('apps/mobile/app/(main)/_layout.tsx'), /<HomeEntryGate>[\s\S]*<Stack[\s\S]*<\/HomeEntryGate>/);
  assert.doesNotMatch(read(stateFile), /storage|supabase|fetch\(/);
});

test('Home observes background/top icons, final button layout, tab icons, and actual video first frame', () => {
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  for (const asset of ['scene', 'menu', 'outfits', 'scenes']) assert.match(home, new RegExp('asset="' + asset + '"'));
  assert.match(home, /markHomeEntryAsset\('home-layout', homeEntry.attempt\)/);
  assert.match(home, /key=\{homeEntry.attempt\}/);
  assert.match(home, /!homeEntry.pending && <AnnouncementGate/);
  const tabs = read('apps/mobile/src/components/main/bottom-tab-bar.tsx');
  assert.match(tabs, /asset=\{`tab:\$\{tab.name\}`\}/);
  assert.match(tabs, /markHomeEntryAsset\('tabs-layout', attempt\)/);
  const video = read('apps/mobile/src/components/main/companion-video.tsx');
  assert.match(video, /onFirstFrameRender=\{onReady\}/);
  assert.match(video, /onDisplay=\{onReady\}/);
  assert.doesNotMatch(video, /status === 'readyToPlay'\) onReady/);
});
