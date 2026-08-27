// Deterministic native-boundary tests, not a substitute for device audio/performance testing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { buildDenseConfetti } = require('./build-reflect-confetti.cjs');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// Drain promises across the VM/native-boundary test realms, not just one microtask.
const flushNative = () => new Promise((resolve) => setImmediate(resolve));
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { warn() {} }, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  return module.exports;
}
function player() {
  let listener;
  const p = {
    loop: true, currentTime: 0, loaded: true, plays: 0, pauses: 0, removes: 0, seeks: 0,
    get currentStatus() { return { isLoaded: this.loaded }; },
    addListener(name, fn) { assert.equal(name, 'playbackStatusUpdate'); listener = fn; return { remove() { listener = null; } }; },
    play() { this.plays++; }, pause() { this.pauses++; }, remove() { this.removes++; },
    async seekTo(seconds) { assert.equal(seconds, 0); this.seeks++; this.currentTime = 0; },
    emit(status) { listener?.(status); },
  };
  return p;
}
function soundHarness() {
  const timers = new Map(); let nextTimer = 0, active = true;
  const globals = {
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const controller = load('apps/mobile/src/lib/completion-sound-player.ts', {}, globals);
  const p = player(), sound = controller.createCompletionSoundPlayer(p, () => active);
  return { p, sound, controller, globals, timers, active: (value) => { active = value; },
    expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}
test('preloading is silent; completion plays once and later completions rewind', async () => {
  const h = soundHarness();
  assert.equal(h.p.loop, false); assert.equal(h.p.plays, 0);
  assert.equal(h.sound.play(), true); assert.equal(h.p.plays, 1);
  assert.equal(h.sound.play(), false);
  h.p.emit({ isLoaded: true }); assert.equal(h.p.plays, 1);
  h.p.currentTime = 2.14; h.p.emit({ didJustFinish: true });
  assert.equal(h.timers.size, 0);
  assert.equal(h.sound.play(), true); await flushNative();
  assert.equal(h.p.seeks, 1); assert.equal(h.p.plays, 2);
  h.sound.dispose(); h.sound.dispose();
  assert.equal(h.p.removes, 1); assert.equal(h.timers.size, 0);
  assert.equal(h.sound.play(), false);
});
test('first-play loading is event driven, bounded and never fires a late chime', () => {
  const h = soundHarness(); h.p.loaded = false;
  assert.equal(h.sound.play(), true); assert.equal(h.p.plays, 0);
  h.p.emit({ isLoaded: true }); assert.equal(h.p.plays, 1);
  h.p.emit({ isLoaded: true }); assert.equal(h.p.plays, 1);
  h.sound.stop(); h.sound.play(); h.expire(1500);
  h.p.emit({ isLoaded: true }); assert.equal(h.p.plays, 1);
  h.sound.dispose();
});
test('foreground guard, interruption and disposal cancel in-flight native seeks', async () => {
  for (const action of ['stop', 'dispose', 'background']) {
    const h = soundHarness(); let finishSeek;
    h.p.currentTime = 2;
    h.p.seekTo = () => new Promise((resolve) => { finishSeek = resolve; });
    h.sound.play();
    if (action === 'background') h.active(false); else h.sound[action]();
    finishSeek(); await flushNative();
    assert.equal(h.p.plays, 0);
    h.active(false); assert.equal(h.sound.play(), false);
    h.sound.dispose(); assert.equal(h.timers.size, 0);
  }
});
test('audio errors do not escape into completion UI; lost end callbacks have a deadline', async () => {
  const h = soundHarness();
  h.p.play = () => { throw new Error('audio interrupted'); };
  assert.doesNotThrow(() => h.sound.play()); await flushNative();
  assert.equal(h.timers.size, 0);
  h.p.play = () => h.p.plays++;
  h.sound.play(); h.expire(6000); assert.equal(h.timers.size, 0);
  h.sound.play(); assert.equal(h.p.plays, 2);
  h.sound.stop();
  Object.defineProperty(h.p, 'currentStatus', { get() { throw new Error('native player released'); } });
  assert.equal(h.sound.play(), false); assert.equal(h.timers.size, 0);
  h.sound.dispose();
});
test('sound hook preloads only while focused, dedupes a draft and cannot auto-resume after background', () => {
  const h = soundHarness(), players = [], callbacks = new Set(), focus = [];
  const appState = {
    currentState: 'active',
    addEventListener(name, fn) { assert.equal(name, 'change'); callbacks.add(fn); return { remove() { callbacks.delete(fn); } }; },
  };
  const { useCompletionSound } = load('apps/mobile/src/lib/use-completion-sound.ts', {
    react: { useRef: (current) => ({ current }), useCallback: (fn) => fn },
    'react-native': { AppState: appState },
    '@react-navigation/native': { useFocusEffect: (fn) => focus.push(fn) },
    'expo-audio': { setAudioModeAsync: async (mode) => {
      assert.equal(mode.playsInSilentMode, true);
      assert.equal(mode.shouldPlayInBackground, false);
      assert.equal(mode.interruptionMode, 'duckOthers');
    }, createAudioPlayer(source, options) {
      assert.equal(source, 123); assert.equal(options.keepAudioSessionActive, false);
      const p = player(); players.push(p); return p;
    } },
    './completion-sound-player': h.controller,
    '../../assets/music/reflection-finished.mp3': 123,
  });
  const hook = useCompletionSound(); assert.equal(players.length, 0);
  const blur = focus[0](); assert.equal(players.length, 1); assert.equal(players[0].plays, 0);
  hook.play('draft-1'); players[0].emit({ didJustFinish: true });
  hook.play('draft-1'); assert.equal(players[0].plays, 1);
  hook.play('draft-2'); assert.equal(players[0].plays, 2);
  appState.currentState = 'background'; callbacks.forEach((fn) => fn('background'));
  assert.equal(players[0].removes, 1); assert.equal(h.timers.size, 0);
  appState.currentState = 'active'; callbacks.forEach((fn) => fn('active'));
  assert.equal(players.length, 2); assert.equal(players[1].plays, 0);
  hook.play('draft-2'); assert.equal(players[1].plays, 0);
  hook.play('draft-3'); assert.equal(players[1].plays, 1);
  blur(); assert.equal(players[1].removes, 1); assert.equal(callbacks.size, 0);
  hook.play('draft-4'); assert.equal(players[1].plays, 1); assert.equal(h.timers.size, 0);
  h.sound.dispose();
});
function descendants(node) { const out = [node]; ts.forEachChild(node, (child) => { out.push(...descendants(child)); }); return out; }
function ast(file) { return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
test('sound wiring is completion-only: Quest guard, Focus didJustFinish, Reflect draft entrance', () => {
  const quests = ast('apps/mobile/app/(main)/(tabs)/quests.tsx');
  const onCheck = descendants(quests).find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'onCheck');
  const questText = onCheck.getText(quests);
  assert.ok(questText.indexOf('checkInFlight.current = true') < questText.indexOf('playCompletionSound()'));
  assert.ok(questText.indexOf('playCompletionSound()') < questText.indexOf('checkTask(index)'));
  assert.equal((questText.match(/playCompletionSound\(\)/g) || []).length, 1);
  const focus = ast('apps/mobile/app/(main)/focus.tsx');
  const endGuard = descendants(focus).find((node) => ts.isIfStatement(node) && node.expression.getText(focus) === 'status.didJustFinish');
  assert.match(endGuard.thenStatement.getText(focus), /creditedRef.current = true;\s*playCompletionSound\(\)/);
  const settlement = read('apps/mobile/src/components/main/reflect-settlement.tsx');
  assert.ok(!settlement.includes('useCompletionSound'));
  assert.match(settlement, /onPresented\(draft.draftId\)/);
  assert.match(settlement, /presented.current === draft.draftId/);
  for (const file of ['reflect-typing', 'reflect-guided', 'shared-memory-create']) {
    const screen = read(`apps/mobile/app/(main)/${file}.tsx`);
    assert.match(screen, /const \{ play: playCompletionSound \} = useCompletionSound\(\)/);
    assert.match(screen, /onPresented=\{playCompletionSound\}/);
    assert.match(screen, /<\/KeyboardAvoidingView>\s*<ReflectCelebration active=\{phase === 'result'\}/);
  }
  assert.ok(fs.statSync(path.join(root, 'apps/mobile/assets/music/reflection-finished.mp3')).size > 0);
});
test('single native confetti composition has exactly double the particles, with different trajectories', () => {
  const original = JSON.parse(read('apps/mobile/assets/animations/reflect.json'));
  const dense = JSON.parse(read('apps/mobile/assets/animations/reflect-dense.json'));
  assert.deepEqual(buildDenseConfetti(original), dense);
  const count = (composition, layers) => layers.reduce((n, layer) => n + (layer.ty === 4 ? 1 :
    layer.ty === 0 ? count(composition, composition.assets.find((a) => a.id === layer.refId).layers) : 0), 0);
  assert.equal(count(original, original.layers), 80);
  assert.equal(count(dense, dense.layers), 160);
  assert.deepEqual(dense.layers, original.layers); // same four emitters, not two full-screen Lotties
  assert.equal((dense.op - dense.ip) / dense.fr, 5);
  for (const asset of dense.assets) {
    assert.equal(new Set(asset.layers.map((l) => l.ind)).size, asset.layers.length);
    assert.ok(asset.layers.every((l) => !l.masksProperties && !l.parent));
    if (asset.layers[0].ty !== 4) continue;
    const before = original.assets.find((a) => a.id === asset.id);
    for (let i = 0; i < before.layers.length; i++) {
      assert.deepEqual(asset.layers[2 * i], before.layers[i]); // originals unchanged
      assert.notDeepEqual(asset.layers[2 * i + 1].ks.p, before.layers[i].ks.p);
    }
  }
});
