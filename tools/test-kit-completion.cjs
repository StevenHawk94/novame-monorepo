const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');

const lib = 'apps/mobile/src/lib/';
class ApiError extends Error { constructor(status) { super('request failed'); this.status = status; } }
const keys = Object.fromEntries([
  'kNewLensState', 'kQuietWinsState', 'kQuietWinsFeedbackSequence', 'kTameEnemyState', 'kTameStatus', 'kTrueNorthState',
].map(name => [name, { name }]));
const definitions = Array.from({ length: 8 }, (_, index) => ({
  id: `monster-${index}`, name: `Monster ${index}`, prep: 'Prep', tamed: 'Tamed', dimension: 'unused',
}));
function setup() {
  const timing = clock();
  const values = new Map(), listeners = new Set();
  const storage = {
    getString: key => values.get(key),
    set(key, value) { values.set(key, value); listeners.forEach(fn => fn(key)); },
    remove(key) { values.delete(key); listeners.forEach(fn => fn(key)); },
    addOnValueChangedListener(fn) { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const identity = load(lib + 'session-lifecycle.ts');
  identity.observeSessionIdentity('user-a');
  const pending = load(lib + 'kit-completion-state.ts', {
    '../shared/storage/keys': keys, './storage': { storage }, './session-lifecycle': identity,
  });
  const deadline = load(lib + 'async-lifecycle.ts', {}, timing.globals);
  const response = deferred();
  const calls = [];
  let sessionUser = 'user-a';
  const apiClient = {
    post(path, body) { calls.push({ path, body }); return response.promise; },
    get(path) { calls.push({ path }); return Promise.resolve({ card: { cardId: 'tomorrow' } }); },
  };
  const common = {
    '@novame/api-client': { ApiError }, '../shared/storage/keys': keys,
    './api': { apiClient }, './storage': { storage }, './session-lifecycle': identity,
    './kit-completion-state': pending, './async-lifecycle': deadline,
    './supabase': { supabase: { auth: { getSession: async () => ({
      data: { session: sessionUser ? { user: { id: sessionUser } } : null },
    }) } } },
  };
  const quiet = load(lib + 'quiet-wins-api.ts', common, timing.globals);
  const lens = load(lib + 'lens-api.ts', common, timing.globals);
  const tame = load(lib + 'tame-enemy-api.ts', {
    ...common,
    '@novame/engine': { MONSTERS: definitions, TAME_POINTS_PER_COMPLETION: 50 },
  }, timing.globals);
  return { timing, storage, values, listeners, identity, pending, quiet, lens, tame, response, calls, apiClient,
    setUser(value) { sessionUser = value; identity.observeSessionIdentity(value); },
  };
}
const card = { cardId: 'card-1', theme: 'test', sortOrder: 1, headline: 'A lens', body: 'Body' };
const kitCases = [
  { name: 'Small Wins', field: 'quiet', read: 'isQuietWinsDoneToday', submit: h => h.quiet.submitQuietWins([]), key: 'kQuietWinsState' },
  { name: 'New Lens resonates', field: 'lens', read: 'isNewLensDoneToday', submit: h => h.lens.submitLens('test', card, 'resonates'), key: 'kNewLensState' },
  { name: 'New Lens → Reflect', field: 'lens', read: 'isNewLensDoneToday', submit: h => h.lens.submitLens('test', card, 'different'), key: 'kNewLensState' },
];

function companion(h) {
  const hook = hooks();
  const react = { ...hook.react, useMemo: fn => fn() };
  const jsx = (type, props) => ({ type, props });
  const cosmetic = { balance: 0 };
  const master = { isPaid: false, available: true };
  const { CompanionSheet } = load('apps/mobile/src/components/main/companion-sheet.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: value => value }, useWindowDimensions: () => ({ height: 850 }),
    },
    'expo-router': { useRouter: () => ({ push() {}, back() {} }), useFocusEffect: fn => react.useEffect(fn, [fn]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/lib/haptics': { haptics: {} }, '@/lib/quiet-wins-api': h.quiet, '@/lib/lens-api': h.lens,
    '@/lib/tame-enemy-api': h.tame, '@/lib/kit-completion-state': h.pending,
    '@/lib/true-north-api': { getCachedStatus: () => ({ doneThisWeek: false, nextAvailableAt: null }) },
    '@/lib/icons': { ICONS: {} }, '@/components/ui/grid-background': { GridBackground: 'GridBackground' },
    '@/components/ui/android-compact-typography': { AndroidCompactText: 'Text' },
    '@/lib/cosmetics-api': { getCachedCosmetics: () => cosmetic, fetchCosmetics: async () => cosmetic, subscribeCosmetics: () => () => {} },
    '@/lib/master-api': { getCachedMasterStatus: () => master, fetchMasterStatus: async () => master },
    '@/components/main/feature-guide-modal': { FeatureGuideModal: 'FeatureGuideModal' },
  }, h.timing.globals);
  const text = tree => Array.isArray(tree) ? tree.flatMap(text) : typeof tree === 'string' ? [tree] : tree?.props ? text(tree.props.children) : [];
  return { labels: () => text(hook.render(CompanionSheet)), unmount: () => hook.unmount() };
}

for (const kit of kitCases) {
  test(`${kit.name}: retained Bunny sheet hides immediately and stays hidden after success`, async () => {
    const h = setup(), sheet = companion(h);
    const label = kit.field === 'quiet' ? 'Small Wins' : 'New Lens';
    assert.ok(sheet.labels().includes(label));
    const work = kit.submit(h);
    assert.equal(sheet.labels().includes(label), false, 'no refocus/remount needed while saving');
    assert.equal(h.values.has(kit.key), false, 'pending state is not a persisted completion');
    await flush();
    h.response.resolve({ success: true, xp_awarded: 10 });
    assert.equal((await work).ok, true);
    await flush();
    assert.equal(sheet.labels().includes(label), false);
    assert.equal(JSON.parse(h.values.get(kit.key)).done, true);
    assert.equal(h.calls.filter(call => call.body).length, 1);
    assert.equal(h.calls.filter(call => !call.body).length, kit.field === 'lens' ? 1 : 0, 'only existing tomorrow-card prefetch');
    sheet.unmount();
    assert.equal(h.listeners.size, 0, 'local subscriptions cleaned up');
  });

  test(`${kit.name}: failed/no-session/timed-out request restores entry; 409 keeps it hidden`, async () => {
    for (const outcome of ['failure', 'no-session', 'timeout', 'already-done']) {
      const h = setup(), sheet = companion(h);
      const label = kit.field === 'quiet' ? 'Small Wins' : 'New Lens';
      sheet.labels();
      if (outcome === 'no-session') h.setUser(null);
      const work = kit.submit(h);
      await flush();
      if (outcome === 'failure') h.response.reject(new Error('offline'));
      if (outcome === 'timeout') h.timing.advance(20_001);
      if (outcome === 'already-done') h.response.reject(new ApiError(409));
      const result = await work;
      assert.equal(result.ok, false);
      assert.equal(sheet.labels().includes(label), outcome !== 'already-done');
      if (outcome === 'timeout') {
        h.response.resolve({ success: true });
        await flush();
        assert.equal(h[kit.field][kit.read](), false, 'late timeout response cannot mark a new attempt');
      }
      sheet.unmount();
    }
  });

  test(`${kit.name}: completion belongs to submission day and account only`, async () => {
    const h = setup();
    const work = kit.submit(h);
    await flush();
    h.timing.advance(5000);
    // Move calendar without firing request deadline.
    const oldDate = h.timing.globals.Date;
    oldDate.prototype.getDate = () => 2;
    h.response.resolve({ success: true });
    await work;
    assert.equal(h[kit.field][kit.read](), false, 'yesterday completion cannot spend today');

    const switched = setup();
    const late = kit.submit(switched);
    await flush();
    switched.setUser('user-b');
    switched.response.resolve({ success: true });
    await late;
    assert.equal(switched.values.has(kit.key), false, 'old account response never writes current cache');
  });
}

function seedTames(h, { paid = false, count = 0, dailyCount = 0, used = [] } = {}) {
  const date = h.timing.globals.Date;
  const now = new date();
  const statusDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  h.storage.set('kTameEnemyState', JSON.stringify({ date: statusDate, count: dailyCount }));
  h.storage.set('kTameStatus', JSON.stringify({
    statusDate, perEnemyDaily: paid, doneToday: false,
    monsters: definitions.map((m, index) => ({
      ...m,
      tamedCount: index === 0 ? count : 0,
      tamedBefore: index === 0 && count > 0,
      tamedToday: used.includes(m.id),
      skillCount: 0,
      battlePoints: index === 0 ? 100 : 0,
    })),
  }));
}
const submitTame = h => h.tame.submitTame({ monsterId: 'monster-0', skillsUsed: ['final-1'], hits: 20 });

test('every monster starts with an independent zero-point Tame History', () => {
  const h = setup();
  const status = h.tame.getCachedTameStatus();
  assert.ok(status.monsters.every(monster => monster.battlePoints === 0));
});

test('legacy shared score cache is split by each monster completion history', () => {
  const h = setup();
  h.storage.set('kTameStatus', JSON.stringify({
    battlePoints: 50,
    perEnemyDaily: false,
    doneToday: false,
    monsters: definitions.map((monster, index) => ({
      ...monster,
      skillCount: 0,
      tamedCount: index === 0 ? 1 : 0,
      tamedBefore: index === 0,
      tamedToday: false,
    })),
  }));
  const status = h.tame.getCachedTameStatus();
  assert.equal(status.monsters[0].battlePoints, 50);
  assert.equal(status.monsters[1].battlePoints, 0);
});

test('tame completion updates cached and subscribed counts/points before any next entry', async () => {
  for (const count of [0, 11]) {
    const h = setup();
    seedTames(h, { count });
    let rendered = h.tame.getCachedTameStatus();
    const unsubscribe = h.tame.subscribeTameStatus(() => { rendered = h.tame.getCachedTameStatus(); });
    const work = submitTame(h);
    await flush();
    h.response.resolve({ success: true, battleTotalPoints: 150, battlePoints: 50 });
    assert.equal((await work).ok, true);
    assert.equal(rendered.monsters[0].tamedCount, count + 1);
    assert.equal(rendered.monsters[0].tamedBefore, true);
    assert.equal(rendered.monsters[0].tamedToday, true);
    assert.equal(rendered.monsters[0].battlePoints, 150);
    assert.equal(rendered.monsters[1].tamedCount, 0, 'other monsters unchanged');
    assert.equal(rendered.monsters[1].battlePoints, 0, 'other monster score unchanged');
    assert.equal(JSON.parse(h.values.get('kTameEnemyState')).count, 1, 'counted once, not again by screen');
    assert.equal(h.calls.length, 1, 'no refresh request required for completion');
    unsubscribe();
  }
});

test('tame failed/invalid/account-switched submissions never increment cached counts', async () => {
  for (const outcome of ['error', 'missing-success', 'switched']) {
    const h = setup();
    seedTames(h, { count: 11 });
    const before = h.values.get('kTameStatus');
    const work = submitTame(h);
    await flush();
    if (outcome === 'switched') h.setUser('user-b');
    h.response.resolve(outcome === 'error' ? { error: 'already_done' } : outcome === 'missing-success' ? {} : { success: true });
    assert.equal((await work).ok, false);
    assert.equal(h.values.get('kTameStatus'), before);
  }
});

test('entry GET arriving after successful tame cannot roll the counter or points back', async () => {
  const h = setup();
  seedTames(h, { count: 11 });
  const stale = JSON.parse(h.values.get('kTameStatus'));
  const read = deferred();
  h.apiClient.get = () => read.promise;
  const refresh = h.tame.fetchTameStatus();
  await flush();
  const work = submitTame(h);
  await flush();
  h.response.resolve({ success: true, battleTotalPoints: 150 });
  await work;
  read.resolve({ success: true, ...stale });
  assert.equal((await refresh).monsters[0].tamedCount, 12);
  assert.equal(h.tame.getCachedTameStatus().monsters[0].battlePoints, 150);
  assert.equal(h.tame.getCachedTameStatus().monsters[1].battlePoints, 0);
});

test('status GET observing the server commit before POST returns cannot double count the same tame', async () => {
  const h = setup();
  seedTames(h, { count: 11 });
  const work = submitTame(h);
  await flush();
  const alreadyCommitted = JSON.parse(h.values.get('kTameStatus'));
  alreadyCommitted.monsters[0].tamedCount = 12;
  h.apiClient.get = async () => ({ success: true, ...alreadyCommitted });
  await h.tame.fetchTameStatus();
  h.response.resolve({ success: true, battleTotalPoints: 150 });
  await work;
  assert.equal(h.tame.getCachedTameStatus().monsters[0].tamedCount, 12);
});

test('Free third tame locks daily entry, Plus third tame does not; Plus eighth does', async () => {
  for (const [paid, used, expected] of [
    [false, [], true], [true, ['monster-1', 'monster-2'], false],
    [true, definitions.slice(1).map(m => m.id), true],
  ]) {
    const h = setup();
    seedTames(h, { paid, dailyCount: paid ? used.length : 2, used });
    const work = submitTame(h);
    await flush();
    h.response.resolve({ success: true });
    await work;
    assert.equal(h.tame.getCachedTameStatus().doneToday, expected);
    assert.equal(h.tame.isTameEnemyDoneToday(), expected);
    h.timing.advance(24 * 60 * 60 * 1000);
    assert.equal(h.tame.isTameEnemyDoneToday(), false);
    assert.ok(h.tame.getCachedTameStatus().monsters.every(m => !m.tamedToday));
    assert.equal(h.tame.getCachedTameStatus().monsters[0].tamedCount, 1, 'lifetime count survives day rollover');
  }
});
