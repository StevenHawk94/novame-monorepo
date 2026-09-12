const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const { runCompanionDependentRpc } = load('apps/api/src/lib/companion-boundary.js');

test('established account runs the business RPC once with no extra query', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: { error: null, success: true }, error: null };
  } };
  const result = await runCompanionDependentRpc(client, 'submit_kit', { p_user_id: 'u' }, 'u');
  assert.equal(result.data.success, true);
  assert.deepEqual(calls.map(([name]) => name), ['submit_kit']);
});

test('missing companion is initialized once and the exact business RPC is retried', async () => {
  const calls = [];
  let attempts = 0;
  const args = { p_user_id: 'u', p_period_key: 'same-key' };
  const client = { rpc: async (name, received) => {
    calls.push([name, received]);
    if (name === 'complete_onboarding') return { data: { error: null }, error: null };
    attempts++;
    return attempts === 1
      ? { data: { error: 'companion_not_initialized' }, error: null }
      : { data: { error: null, success: true }, error: null };
  } };
  const result = await runCompanionDependentRpc(client, 'submit_kit', args, 'u');
  assert.equal(result.data.success, true);
  assert.deepEqual(calls.map(([name]) => name), [
    'submit_kit', 'complete_onboarding', 'submit_kit',
  ]);
  assert.equal(calls[0][1], args);
  assert.equal(calls[2][1], args);
});

test('raised companion error is also repaired; unrelated errors are untouched', async () => {
  let attempts = 0;
  const missingClient = { rpc: async (name) => {
    if (name === 'complete_onboarding') return { data: { error: null }, error: null };
    attempts++;
    return attempts === 1
      ? { data: null, error: { message: 'companion_not_initialized' } }
      : { data: { ok: true }, error: null };
  } };
  assert.equal((await runCompanionDependentRpc(missingClient, 'check_quest_task', {}, 'u')).data.ok, true);

  let calls = 0;
  const failed = { data: null, error: { message: 'database unavailable' } };
  const otherClient = { rpc: async () => { calls++; return failed; } };
  assert.equal(await runCompanionDependentRpc(otherClient, 'submit_kit', {}, 'u'), failed);
  assert.equal(calls, 1);
});
