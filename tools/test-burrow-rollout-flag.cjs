const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, deferred, flush } = require('./lifecycle-test-utils.cjs');

function flagHarness({ cached, enabled }) {
  let epoch = 0;
  let requests = 0;
  const pending = [];
  const experiences = [];
  const flag = load('apps/mobile/src/lib/use-major-update.ts', {
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
  });
  return { flag, pending, experiences, requests: () => requests, nextEpoch: () => { epoch++; } };
}

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
