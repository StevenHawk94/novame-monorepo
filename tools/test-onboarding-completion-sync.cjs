const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');

function harness(postImpl) {
  const values = new Map();
  const c = clock();
  let posts = 0;
  const onboarding = load('apps/mobile/src/lib/onboarding.ts', {
    './api': { apiClient: { post(...args) { posts++; return postImpl(...args); } } },
    '../shared/storage/keys': {
      kOnboardingIntroSeen: { name: 'intro' },
      kOnboardingState: { name: 'state' },
    },
    './storage': {
      storage: {
        getString: (key) => values.get(key),
        set: (key, value) => values.set(key, value),
      },
    },
  }, { ...c.globals, AbortController });
  return {
    onboarding,
    clock: c,
    values,
    get posts() { return posts; },
    state() { return JSON.parse(values.get('state') || '{}'); },
  };
}

test('successful completion binds the pending task and clears only after server success', async () => {
  const request = deferred();
  const h = harness(() => request.promise);
  h.onboarding.setChosenCompanion('pet1');
  const result = h.onboarding.syncOnboardingCompanion('user-a', { force: true });
  assert.equal(h.state().companionSyncUserId, 'user-a');
  assert.equal(h.state().companionId, 'pet1');
  request.resolve({ success: true });
  assert.equal(await result, true);
  assert.equal(h.state().companionId, undefined);
  assert.equal(h.state().companionSyncUserId, undefined);
  assert.equal(h.posts, 1);
});

test('failure persists retry state, respects backoff, and force resumes immediately', async () => {
  let shouldFail = true;
  const h = harness(async () => {
    if (shouldFail) throw new Error('offline');
    return { success: true };
  });
  h.onboarding.setChosenCompanion('pet1');
  assert.equal(await h.onboarding.syncOnboardingCompanion('user-a', { force: true }), false);
  assert.equal(h.state().companionSyncAttempts, 1);
  assert.equal(h.state().companionSyncNextRetryAtMs, 15_000);
  assert.equal(await h.onboarding.syncOnboardingCompanion('user-a'), false);
  assert.equal(h.posts, 1, 'backoff must not create another network request');
  shouldFail = false;
  assert.equal(await h.onboarding.syncOnboardingCompanion('user-a', { force: true }), true);
  assert.equal(h.posts, 2);
  assert.equal(h.state().companionId, undefined);
});

test('a task bound to one account is never submitted as another account', async () => {
  const h = harness(async () => ({ success: true }));
  h.values.set('state', JSON.stringify({ companionId: 'pet1', companionSyncUserId: 'user-a' }));
  assert.equal(await h.onboarding.syncOnboardingCompanion('user-b', { force: true }), true);
  assert.equal(h.posts, 0);
  assert.equal(h.state().companionSyncUserId, 'user-a');
});

test('30-second network timeout retains the durable task for a later lifecycle retry', async () => {
  const h = harness((_path, _body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));
  h.onboarding.setChosenCompanion('pet1');
  const result = h.onboarding.syncOnboardingCompanion('user-a', { force: true });
  h.clock.advance(30_000);
  await flush();
  assert.equal(await result, false);
  assert.equal(h.state().companionId, 'pet1');
  assert.equal(h.state().companionSyncAttempts, 1);
});
