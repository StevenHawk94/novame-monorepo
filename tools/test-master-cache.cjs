const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let now = Date.parse('2026-09-11T12:00:00.000Z');
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

class MockApiError extends Error {
  constructor(body) { super('API error'); this.body = body; }
}

const values = new Map();
let getCalls = 0;
let getImpl = async () => { throw new Error('offline'); };
let postImpl = async () => { throw new Error('offline'); };
const source = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/master-api.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(code, {
  module: moduleBox,
  exports: moduleBox.exports,
  Date: TestDate,
  Promise,
  console,
  require(name) {
    if (name === '@novame/api-client') return { ApiError: MockApiError };
    if (name === '../shared/storage/keys') return { kMasterState: { name: 'master' } };
    if (name === './storage') return {
      storage: {
        getString: (key) => values.get(key),
        set: (key, value) => values.set(key, value),
      },
    };
    if (name === './api') return {
      apiClient: {
        get: async (...args) => { getCalls++; return getImpl(...args); },
        post: async (...args) => postImpl(...args),
      },
    };
    if (name === './cosmetics-api') return { confirmCloverAward() {} };
    if (name === './supabase') return {
      supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) } },
    };
    throw new Error(`Unexpected import: ${name}`);
  },
});
const master = moduleBox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

function writeCache(status, fetchedAtMs = now) {
  values.set('master', JSON.stringify({ version: 2, status, fetchedAtMs }));
}

test('fresh status cache prevents repeat requests and an offline forced read preserves it', async () => {
  values.clear(); getCalls = 0;
  const status = {
    isPaid: true,
    available: false,
    nextAvailableAt: new TestDate(now + 60 * 60 * 1000).toISOString(),
    history: [{ id: 'old', question: 'Old?', createdAt: '2026-09-10T12:00:00.000Z' }],
  };
  writeCache(status);
  assert.deepEqual(plain(await master.fetchMasterStatus()), status);
  assert.equal(getCalls, 0);

  getImpl = async () => { throw new Error('offline'); };
  assert.deepEqual(plain(await master.fetchMasterStatus({ force: true })), status);
  assert.equal(getCalls, 1);
});

test('the cached cooldown unlocks exactly from its persisted deadline', () => {
  values.clear();
  const deadline = now + 1_000;
  writeCache({
    isPaid: true,
    available: false,
    nextAvailableAt: new TestDate(deadline).toISOString(),
    history: [],
  });
  now = deadline + 1;
  assert.deepEqual(plain(master.refreshCachedMasterClock()), {
    isPaid: true,
    available: true,
    nextAvailableAt: null,
    history: [],
  });
});

test('a successful visit immediately persists its history and 72-hour cooldown', async () => {
  values.clear();
  const createdAt = new TestDate(now).toISOString();
  const nextAvailableAt = new TestDate(now + 72 * 60 * 60 * 1000).toISOString();
  postImpl = async () => ({
    success: true,
    visitId: 'visit-1',
    createdAt,
    nextAvailableAt,
    response: { sections: [{ header: 'A', text: 'B' }] },
    xpAwarded: 50,
  });
  const result = await master.askMaster('What now?');
  assert.equal(result.ok, true);
  assert.equal(result.status.available, false);
  assert.equal(result.status.nextAvailableAt, nextAvailableAt);
  assert.deepEqual(plain(result.status.history), [{
    id: 'visit-1', question: 'What now?', createdAt,
  }]);
});

test('server cooldown errors update the cache instead of becoming network errors', async () => {
  values.clear();
  const nextAvailableAt = new TestDate(now + 30 * 60 * 1000).toISOString();
  postImpl = async () => { throw new MockApiError({ error: 'on_cooldown', nextAvailableAt }); };
  const result = await master.askMaster('Again?');
  assert.deepEqual(plain(result), { ok: false, error: 'on_cooldown', nextAvailableAt });
  assert.equal(master.getCachedMasterStatus().nextAvailableAt, nextAvailableAt);
});
