const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

function harness() {
  let onIdentity;
  const cache = load('apps/mobile/src/lib/burrow-game-room-cache.ts', {
    './session-lifecycle': { subscribeSessionIdentity: listener => { onIdentity = listener; } },
  });
  return { ...cache, changeIdentity: () => onIdentity() };
}

test('Game Room opens recent catalogue and session snapshots without a request', () => {
  const cache = harness();
  const overview = { sessions: [{ id: 'round-1', completedAt: null }] };
  const session = { id: 'round-1', ownAnswers: [1], guesses: [] };
  assert.equal(cache.gameOverviewNeedsRefresh(1000), true);
  cache.cacheGameOverview(overview, 1000);
  cache.cacheGameSession(session, 1000);
  assert.equal(cache.getCachedGameOverview(), overview);
  assert.equal(cache.getCachedGameSession('round-1'), session);
  assert.equal(cache.gameOverviewNeedsRefresh(30_999), false);
  assert.equal(cache.gameSessionNeedsRefresh('round-1', 10_999), false);
  assert.equal(cache.gameSessionNeedsRefresh('round-1', 11_000), true);
  assert.equal(cache.gameOverviewNeedsRefresh(31_000), true);
});

test('idle catalogue stays fresh longer and private snapshots clear on account change', () => {
  const cache = harness();
  cache.cacheGameOverview({ sessions: [] }, 1000);
  cache.cacheGameSession({ id: 'old-round' }, 1000);
  assert.equal(cache.gameOverviewNeedsRefresh(120_999), false);
  assert.equal(cache.gameOverviewNeedsRefresh(121_000), true);
  cache.changeIdentity();
  assert.equal(cache.getCachedGameOverview(), null);
  assert.equal(cache.getCachedGameSession('old-round'), null);
});
