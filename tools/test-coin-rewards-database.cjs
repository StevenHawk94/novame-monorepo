// Execute the actual migration in isolated PostgreSQL/WASM. No Supabase writes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
let db;
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const state = async (id = A) => (await db.query('select burrow_reward_wallet_state_v1($1) as value', [id])).rows[0].value;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key, timezone_name text);
    create table wallets(user_id uuid primary key, carrot_balance integer, version bigint);
    create table currency_ledger(user_id uuid, idempotency_key text, delta integer, requested_delta integer, reason text, created_at timestamptz default now());
    insert into profiles values('${A}','Pacific/Auckland'),('${B}','UTC');
    insert into wallets values('${A}',1240,2),('${B}',25,1);
    insert into currency_ledger(user_id,idempotency_key,delta,requested_delta,reason) values
      ('${A}','daily-quest:a',10,10,'daily_quest'),('${B}','private-b',25,25,'daily_quest'),
      ('${A}','at-cap',0,10,'first_daily_affection'),('${A}','purchase',-20,-20,'catalog_purchase');
    insert into currency_ledger values('${A}','expired',10,10,'daily_quest',now()-interval '9 days');
  `);
  await db.exec(readFileSync('supabase/migrations/20261007000202_burrow_reward_wallet_state.sql', 'utf8'));
});
after(async () => db?.close());
test('migration returns wallet version and only this user’s recent positive credit receipts', async () => {
  const value = await state();
  assert.deepEqual(value.wallet, { balance: 1240, version: 2 });
  assert.deepEqual(value.credits.map(row => row.key).sort(), ['at-cap', 'daily-quest:a']);
  assert.equal(value.credits.find(row => row.key === 'at-cap').amount, 0);
  assert.deepEqual((await state(B)).credits.map(row => row.key), ['private-b']);
});
test('reward day uses the server-owned profile timezone, not caller clock or region', async () => {
  const value = await state();
  const expected = (await db.query("select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as day")).rows[0].day;
  assert.equal(value.localDate, expected); assert.equal(value.timezone, 'Pacific/Auckland');
});
test('wallet and receipt changes commit and roll back together in the returned snapshot', async () => {
  await db.exec(`begin; update wallets set carrot_balance=1255,version=3 where user_id='${A}';
    insert into currency_ledger(user_id,idempotency_key,delta,requested_delta,reason) values('${A}','special:b',15,15,'special_quest');`);
  let value = await state(); assert.equal(value.wallet.balance, 1255);
  assert.ok(value.credits.some(row => row.key === 'special:b')); await db.exec('rollback');
  value = await state(); assert.equal(value.wallet.balance, 1240);
  assert.ok(!value.credits.some(row => row.key === 'special:b'));
});
test('anonymous and authenticated clients cannot inspect another account’s wallet', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => state(), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role'); assert.equal((await state()).wallet.balance, 1240);
  await db.exec('reset role');
});
test('unknown accounts return no wallet rather than fabricating a starting balance', async () => {
  assert.equal(await state('33333333-3333-4333-8333-333333333333'), null);
});
