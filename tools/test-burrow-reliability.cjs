const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');
const lib = 'apps/mobile/src/lib/';
const plain = value => JSON.parse(JSON.stringify(value));
function identity() {
  let user = 'A', epoch = 1; const listeners = new Set();
  return { sessionUserId: () => user, sessionEpoch: () => epoch,
    subscribeSessionIdentity(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    change(next) { user = next; epoch++; listeners.forEach(fn => fn()); } };
}
function disk() {
  const values = new Map();
  return { values, storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value), remove: key => values.delete(key) } };
}
const keys = { kBurrowSnapshot: { name: 'snapshot' }, kBurrowActionKeys: { name: 'commands' },
  kBurrowTextDrafts: { prefix: 'text:' }, kBurrowJournal: { keyFor: suffix => `journal:${suffix}` }, kReflectFeed: { name: 'feed' } };
const snapshot = (owner = 'A') => ({ profile: { id: owner }, partner: { id: 'B' }, pairVersion: 'one',
  serverNow: '2026-10-05T12:00:00Z', catalog: [], inventory: [], loadouts: [], musicTrackId: null,
  roomPhotos: [{ id: 'mine', ownerId: owner, kind: 'frame', updatedAt: '2026-10-05T11:00:00Z' }, { id: 'theirs', ownerId: 'B', kind: 'frame' }],
  memoryEntries: [{ author_id: owner, body: 'mine' }, { author_id: 'B', body: 'partner private' }],
  moments: [{ actor_id: owner }, { actor_id: 'B' }], affectionInbox: [{ secret: true }], gifts: [{ secret: true }] });

for (const module of ['subscription', 'me-stats', 'reflect-feed-api']) test(`${module}: an old account response cannot repopulate private disk cache`, async () => {
  const session = identity(), store = disk(), pending = deferred(), time = clock();
  const dependencies = { './session-lifecycle': session, './storage': store, './api': { apiClient: { get: () => pending.promise } },
    './async-lifecycle': { withDeadline: value => value }, './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: session.sessionUserId() } } } }) } } },
    './remote-items': { mergedItemDictionary: () => ({ items: {} }) }, '../shared/storage/keys': keys };
  const api = load(lib + module + '.ts', dependencies, time.globals);
  const request = module === 'subscription' ? api.fetchSubscriptionTier('A') : module === 'me-stats' ? api.fetchMeStats('A') : api.fetchReflectFeed();
  const completion = request.catch(error => error.message);
  await flush(); session.change('C'); store.values.clear();
  pending.resolve({ success: true, data: { subscriptionTier: 'plus' }, stats: {}, profile: { displayName: 'private A' },
    days: [{ date: 'today', reflects: [{ id: 'private', body: 'private A', mode: 'typing', hasMemories: false }], itemIds: [] }] });
  await completion;
  assert.equal(store.values.size, 0);
  const cached = module === 'subscription' ? api.getCachedSubscription() : module === 'me-stats' ? api.getCachedMeStats() : api.getCachedFeed();
  assert.ok(cached === null || cached.length === 0);
});

test('Home snapshot is owner-bound, durable, personal-only, and preserves server clock age', () => {
  const store = disk(), time = clock();
  const cache = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  cache.persistBurrowSnapshot(snapshot(), 2000);
  const restarted = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  const value = restarted.readBurrowSnapshot('A');
  assert.equal(value.savedAt, 8000);
  assert.equal(value.data.roomPhotos.length, 1); assert.equal(value.data.memoryEntries.length, 1);
  assert.equal(value.data.moments.length, 1); assert.equal(value.data.affectionInbox.length, 0);
  assert.ok(!store.values.get('snapshot').includes('partner private'));
  assert.equal(restarted.readBurrowSnapshot('B'), null);
  time.advance(8 * 86_400_000); assert.equal(restarted.readBurrowSnapshot('A'), null);
});

test('storage exhaustion cannot make a successful server command look rejected', () => {
  const cache = load(lib + 'burrow-cache.ts', { './storage': { storage: { set() { throw Error('full'); }, remove() { throw Error('full'); } } }, '../shared/storage/keys': keys });
  assert.doesNotThrow(() => cache.persistBurrowSnapshot(snapshot()));
  assert.doesNotThrow(() => cache.persistBurrowActionKeys('A', new Map([['claim', 'key']])));
  assert.doesNotThrow(() => cache.clearBurrowSnapshot());
});

function storeHarness() {
  const session = identity(), time = clock(), store = disk(), requests = [];
  const cache = load(lib + 'burrow-cache.ts', { './storage': store, '../shared/storage/keys': keys }, time.globals);
  let key = 0;
  const api = load(lib + 'burrow-store.ts', {
    react: { useCallback: value => value, useSyncExternalStore() {} }, 'expo-router': { useFocusEffect() {} },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } }, 'expo-crypto': { randomUUID: () => `key-${++key}` },
    './session-lifecycle': session, './burrow-cache': cache,
    './app-major-update-api': { fetchMajorUpdateBootstrap: () => { const pending = deferred(); requests.push(pending); return pending.promise; } },
  }, { ...time.globals, performance: { now: () => time.globals.Date.now() } });
  return { api, requests, time, session, store };
}
test('page entry shares one bootstrap; mutations batch into a single followup', async () => {
  const h = storeHarness(), first = h.api.refreshBurrow();
  const entry = h.api.refreshBurrowAfterCurrent();
  assert.equal(first, entry); assert.equal(h.requests.length, 1);
  h.time.advance(1);
  const mutation = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  const duplicate = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  assert.equal(mutation, duplicate);
  h.requests[0].resolve(snapshot()); await first; await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(snapshot()); await mutation;
  await Promise.all(Array.from({ length: 10 }, (_, i) => h.api.runBurrowAction(`tap:${i}`, async () => {}, { silent: true })));
  assert.equal(h.requests.length, 2, 'confirmed taps do not wait on whole-page reads');
  h.time.advance(400); assert.equal(h.requests.length, 3);
  h.requests[2].resolve(snapshot()); await flush();
});
test('uncertain command keeps its key across retries and double taps share a write', async () => {
  const h = storeHarness(), pending = deferred(), used = [];
  const one = h.api.runBurrowAction('claim', key => { used.push(key); return pending.promise; }, { silent: true });
  const two = h.api.runBurrowAction('claim', () => { throw Error('duplicate'); }, { silent: true });
  assert.equal(one, two); pending.reject(Error('offline')); assert.equal(await one, false);
  const retry = await h.api.runBurrowAction('claim', async key => { used.push(key); }, { silent: true });
  assert.equal(retry, true); assert.equal(used[0], used[1]);
});

test('a mutation during the followup read schedules one further authoritative read', async () => {
  const h = storeHarness(), first = h.api.refreshBurrow();
  h.time.advance(1); const followup = h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() });
  h.requests[0].resolve(snapshot()); await first; await flush();
  assert.equal(h.requests.length, 2);
  h.time.advance(1); assert.equal(h.api.refreshBurrowAfterCurrent({ after: h.api.burrowClock() }), followup);
  h.requests[1].resolve(snapshot()); await flush(); assert.equal(h.requests.length, 3);
  h.requests[2].resolve(snapshot()); await followup;
});
test('photo receipt wins over a read begun before upload, but later deletion remains authoritative', async () => {
  const h = storeHarness();
  let read = h.api.refreshBurrow(); h.requests[0].resolve(snapshot()); await read;
  read = h.api.refreshBurrow(); h.time.advance(1);
  const photo = { id: 'mine', ownerId: 'A', kind: 'frame', updatedAt: '2026-10-05T12:00:00Z' };
  h.api.setBurrowPhotoLocally(photo);
  h.requests[1].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.find(row => row.id === 'mine').updatedAt, photo.updatedAt);
  h.time.advance(1); read = h.api.refreshBurrow();
  h.requests[2].resolve({ ...snapshot(), roomPhotos: [] }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.roomPhotos.length, 0);
});
test('background reads cannot overwrite the latest local music selection', async () => {
  const h = storeHarness(); let read = h.api.refreshBurrow(); h.requests[0].resolve(snapshot()); await read;
  read = h.api.refreshBurrow(); h.time.advance(1);
  const token = h.api.selectBurrowMusicLocally('calm'); h.api.confirmBurrowMusicLocally(token);
  h.requests[1].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data.musicTrackId, 'calm');
});

test('committed room decoration survives an older read and solo receipts use the personal room', async () => {
  const h = storeHarness(); let read = h.api.refreshBurrow(); h.requests[0].resolve({ ...snapshot(), partner: null }); await read;
  read = h.api.refreshBurrow(); h.time.advance(1); h.api.setBurrowLoadoutLocally({ table: 'new-table' }, 'A');
  h.requests[1].resolve({ ...snapshot(), partner: null }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].item_id, 'new-table');
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].room_type, 'home');
  assert.equal(h.api.getBurrowSnapshot().data.loadouts[0].owner_id, 'A');
  h.time.advance(1); read = h.api.refreshBurrow(); h.requests[2].resolve({ ...snapshot(), partner: null }); await read;
  assert.equal(h.api.getBurrowSnapshot().data.loadouts.length, 0, 'later authoritative changes still win');
});
test('late bootstrap after sign-out cannot display or persist the old Home', async () => {
  const h = storeHarness(), read = h.api.refreshBurrow();
  h.session.change(null); h.store.values.clear(); h.requests[0].resolve(snapshot()); await read;
  assert.equal(h.api.getBurrowSnapshot().data, null); assert.equal(h.store.values.size, 0);
});

test('latest selection queue serializes writes and skips intermediate taps', async () => {
  const { createLatestSelectionQueue } = load(lib + 'latest-selection-queue.ts');
  const calls = [], pending = deferred(), failures = [];
  const queue = createLatestSelectionQueue(value => { calls.push(value); return value === 'A' ? pending.promise : Promise.resolve(); }, value => failures.push(value));
  const done = queue.select('A'); queue.select('B'); queue.select('C');
  assert.deepEqual(calls, ['A']); pending.resolve(); await done;
  assert.deepEqual(calls, ['A', 'C']); assert.deepEqual(failures, []);
});
test('queue reset prevents an old-owner failure from rolling back the new selection', async () => {
  const { createLatestSelectionQueue } = load(lib + 'latest-selection-queue.ts');
  const old = deferred(), calls = [], failures = [];
  const queue = createLatestSelectionQueue(value => { calls.push(value); return value === 'A' ? old.promise : Promise.resolve(); }, value => failures.push(value));
  const done = queue.select('A'); queue.reset(); await queue.select('C'); old.reject(Error('offline')); await done;
  assert.deepEqual(calls, ['A', 'C']); assert.deepEqual(failures, []);
});
test('journal/letter drafts survive restart, reuse a retry key, and reject another account', () => {
  const session = identity(), store = disk(); let key = 0;
  const imports = { './storage': store, '../shared/storage/keys': keys, './session-lifecycle': session, 'expo-crypto': { randomUUID: () => `key-${++key}` } };
  const drafts = load(lib + 'burrow-text-drafts.ts', imports);
  const original = drafts.keepBurrowTextDraft('A:one', 'page', 'A memory', 'version-1');
  const restarted = load(lib + 'burrow-text-drafts.ts', imports);
  assert.deepEqual(plain(restarted.readBurrowTextDraft('A:one', 'page')), plain(original));
  assert.equal(restarted.keepBurrowTextDraft('A:one', 'page', 'A memory', 'version-2').key, original.key);
  const edited = restarted.keepBurrowTextDraft('A:one', 'page', 'Edited', 'version-2');
  assert.notEqual(edited.key, original.key);
  restarted.removeBurrowTextDraft('A:one', 'page', original.key); assert.ok(restarted.readBurrowTextDraft('A:one', 'page'));
  assert.throws(() => restarted.rebaseBurrowTextDraft('A:one', 'page', original.key, 'version-3'), /draft_changed/);
  restarted.rebaseBurrowTextDraft('A:one', 'page', edited.key, 'version-3');
  const rebased = restarted.readBurrowTextDraft('A:one', 'page');
  assert.equal(rebased.body, 'Edited'); assert.equal(rebased.expectedUpdatedAt, 'version-3');
  assert.notEqual(rebased.key, edited.key, 'explicit retry after conflict must use a fresh receipt key');
  session.change('B'); assert.equal(restarted.readBurrowTextDraft('A:one', 'page'), null);
  assert.throws(() => restarted.rebaseBurrowTextDraft('A:one', 'page', rebased.key, 'version-4'), /draft_changed/);
});
test('solo history omits partner but binds reads to the active auth epoch', async () => {
  const session = identity(), pending = deferred(); let url;
  const api = load(lib + 'burrow-history.ts', { './api': { apiClient: { get: path => { url = path; return pending.promise; } } }, './session-lifecycle': session, './async-lifecycle': { withDeadline: value => value } }, { URLSearchParams });
  const read = api.fetchBurrowHistory('moments', undefined, null, '');
  assert.equal(url, '/api/vnext/history?kind=moments');
  session.change('B'); pending.resolve({ success: true, rows: [] }); await assert.rejects(read, /session_changed/);
});
