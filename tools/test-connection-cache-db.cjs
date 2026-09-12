/* Executes the real cache registry migration in an isolated PostgreSQL engine. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root, 'supabase/migrations/20260912000084_ai_context_cache_registry.sql',
), 'utf8');
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table reflect_ai_analyses(connection_signals jsonb);
  `);
  await db.exec(migration);
  await db.exec(migration); // SQL-editor/deploy retries remain safe.
});

after(async () => { await db?.close(); });

async function claim(hash, renewBefore = new Date(Date.now() + 86400000).toISOString()) {
  return (await db.query(
    'select * from claim_ai_context_cache($1,$2,$3,$4)',
    ['connection-common', 'gemini-2.5-flash', hash, renewBefore],
  )).rows[0];
}

test('first caller owns creation while concurrent callers wait', async () => {
  assert.equal((await claim('hash-one')).action, 'create');
  assert.equal((await claim('hash-one')).action, 'wait');
});

test('ready cache is reused, renewed near expiry, and recreated after prompt change', async () => {
  await db.query(`update ai_context_caches set
    remote_name='cachedContents/test', expires_at=now()+interval '7 days',
    refresh_lease_until=null, status='ready' where cache_key='connection-common'`);
  assert.equal((await claim('hash-one')).action, 'reuse');

  await db.query(`update ai_context_caches set
    expires_at=now()+interval '12 hours', refresh_lease_until=null
    where cache_key='connection-common'`);
  const renewal = await claim('hash-one');
  assert.equal(renewal.action, 'renew');
  assert.equal(renewal.remote_name, 'cachedContents/test');

  await db.query(`update ai_context_caches set refresh_lease_until=null
    where cache_key='connection-common'`);
  assert.equal((await claim('hash-two')).action, 'create');
});
