const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');

function flagHarness({ cached, enabled }) {
  const time = clock();
  const deadline = load('apps/mobile/src/lib/async-lifecycle.ts', {}, time.globals);
  let epoch = 0;
  let requests = 0;
  const pending = [];
  const experiences = [];
  const flag = load('apps/mobile/src/lib/use-major-update.ts', {
    './async-lifecycle': deadline,
    react: { useEffect() {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react-native': { AppState: { addEventListener() { return { remove() {} }; } } },
    './app-config-api': {
      getCachedConfig: () => ({ app_major_update_enabled: enabled }),
      hasCachedConfig: () => cached,
      fetchAppConfig: () => {
        requests++;
        const request = deferred();
        pending.push(request);
        return request.promise;
      },
    },
    './home-entry-readiness': { setHomeEntryExperience: value => experiences.push(value) },
    './session-lifecycle': { sessionEpoch: () => epoch },
  }, time.globals);
  return { flag, pending, experiences, time, requests: () => requests, nextEpoch: () => { epoch++; } };
}

test('hung first-launch config resolves to this build’s UI after five seconds', async () => {
  const h = flagHarness({ cached: false, enabled: false });
  const request = h.flag.refreshMajorUpdateFlag();
  h.time.advance(5000); await request;
  assert.equal(h.flag.useMajorUpdateReady(), true);
  assert.equal(h.flag.useMajorUpdateEnabled(), true);
});

test('cached Burrow rollout renders immediately without a legacy frame', () => {
  const h = flagHarness({ cached: true, enabled: true });
  assert.equal(h.flag.useMajorUpdateReady(), true);
  assert.equal(h.flag.useMajorUpdateEnabled(), true);
  assert.deepEqual(h.experiences, ['burrow']);
});

test('missing or stale-off rollout waits for the server before showing legacy Home', async () => {
  const h = flagHarness({ cached: true, enabled: false });
  assert.equal(h.flag.useMajorUpdateReady(), false);
  const request = h.flag.refreshMajorUpdateFlag();
  h.pending[0].resolve({ kind: 'success', config: { app_major_update_enabled: true } });
  await request;
  assert.equal(h.flag.useMajorUpdateReady(), true);
  assert.equal(h.flag.useMajorUpdateEnabled(), true);
});

test('auth hydration during config fetch retries without publishing stale flag', async () => {
  const h = flagHarness({ cached: false, enabled: false });
  const first = h.flag.refreshMajorUpdateFlag();
  h.nextEpoch();
  h.pending[0].resolve({ kind: 'success', config: { app_major_update_enabled: true } });
  await first;
  await flush();
  assert.equal(h.requests(), 2);
  assert.equal(h.flag.useMajorUpdateReady(), false);
  h.pending[1].resolve({ kind: 'success', config: { app_major_update_enabled: true } });
  await flush();
  assert.equal(h.flag.useMajorUpdateReady(), true);
  assert.equal(h.flag.useMajorUpdateEnabled(), true);
});
