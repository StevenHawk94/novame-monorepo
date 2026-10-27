// Read-only acceptance: no users created, purchases made, or balances changed.
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root, 'apps/api'), false, { info() {}, error() {} });
const { createClient } = require('@supabase/supabase-js');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'qleeohkhbrdvznbwgqad.supabase.co');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(25000) }) } });
const totals = [];
for (const kind of ['all', 'self', 'gift']) {
  const { data, error } = await db.rpc('admin_shop_sales_v1', { p_since: null, p_until: new Date().toISOString(), p_kind: kind });
  assert.ifError(error); assert.ok(Array.isArray(data.rows));
  const ids = new Set(); let previous = Infinity, purchases = 0, coins = 0;
  for (const row of data.rows) {
    assert.ok(!ids.has(row.item_id)); ids.add(row.item_id);
    for (const key of ['purchases', 'self_purchases', 'gift_purchases', 'coins_spent']) assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0);
    assert.equal(row.purchases, row.self_purchases + row.gift_purchases);
    assert.ok(row.purchases <= previous); previous = row.purchases;
    assert.ok(!Object.hasOwn(row, 'buyer_id') && !Object.hasOwn(row, 'recipient_id'));
    if (kind === 'self') assert.equal(row.gift_purchases, 0);
    if (kind === 'gift') assert.equal(row.self_purchases, 0);
    purchases += row.purchases; coins += row.coins_spent;
  }
  totals.push({ kind, styles: data.rows.length, purchases, coins });
}
assert.equal(totals[0].purchases, totals[1].purchases + totals[2].purchases);
assert.equal(totals[0].coins, totals[1].coins + totals[2].coins);
const endpoints = [
  ['https://api.soulsayit.com/api/app-config', 200],
  ['https://api.soulsayit.com/api/vnext/bootstrap', 401],
  ['https://novame-monorepo-admin.vercel.app/admin/login', 200],
  ['https://novame-monorepo-admin.vercel.app/api/admin/shop-sales', 401],
  ['https://novame-monorepo-admin.vercel.app/api/admin/shop-pricing', 401],
];
const checks = [];
for (const [url, expected] of endpoints) {
  // Match the workstation's proxy handling; Node's fetch does not honor a
  // SOCKS ALL_PROXY for the Admin host, while curl does.
  const { stdout } = await run('curl', ['--silent', '--show-error', '--retry', '2', '--connect-timeout', '10', '--max-time', '30',
    ...(process.env.ALL_PROXY?.startsWith('socks5:') ? ['--proxy', process.env.ALL_PROXY.replace(/^socks5:/, 'socks5h:')] : []),
    '--write-out', '\nHTTP_STATUS:%{http_code}', url], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const marker = stdout.lastIndexOf('\nHTTP_STATUS:'), status = Number(stdout.slice(marker + 13));
  const body = stdout.slice(0, marker);
  assert.equal(status, expected, url);
  if (url.endsWith('/api/app-config')) assert.equal(JSON.parse(body).success, true);
  if (url.endsWith('/api/admin/shop-sales')) {
    assert.equal(JSON.parse(body).reason, 'no_session');
  }
  checks.push({ url, status });
}
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), totals, checks, userDataWrites: 0,
  note: 'Authenticated reporting SQL verified through the service role; Admin HTTP access checked unauthenticated, authorized handler tested locally.' }));
