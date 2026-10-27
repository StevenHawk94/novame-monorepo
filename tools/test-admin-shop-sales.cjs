const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const helpers = load('apps/admin/src/lib/shop-sales.js');
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

test('sales filters are bounded, typed and computed on the server in UTC', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  assert.deepEqual(plain(helpers.salesQuery(new URLSearchParams('days=7&kind=gift'), now)), {
    p_since: '2026-10-12T10:00:00.000Z', p_until: now.toISOString(), p_kind: 'gift',
  });
  assert.equal(helpers.salesQuery(new URLSearchParams(), now).p_since, null);
  for (const query of ['days=0','days=-1','days=365','kind=reward','kind=','days=7&days=30','kind=self&kind=gift','user_id=private']) {
    assert.equal(helpers.salesQuery(new URLSearchParams(query), now), null, query);
  }
  assert.equal(Object.keys(helpers.SALES_CATEGORIES).length, 16);
});

function route({ denied = null, error = null, data = [] } = {}) {
  let calls = 0;
  const api = load('apps/admin/src/app/api/admin/shop-sales/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/lib/auth/require-admin': { requireAdmin: async () => ({ error: denied }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name, args) => {
      calls++; assert.equal(name, 'admin_shop_sales_v1'); assert.equal(args.p_kind, 'all'); return { data: { rows: data }, error };
    } }) },
    '@/lib/burrow-shop-pricing': { shopPreview: row => ({ url: '/shop-art/example.webp', name: row.title }) },
    '@/lib/shop-sales': helpers,
  }, { URL });
  return { ...api, calls: () => calls };
}
test('reporting fails closed before touching service credentials for unauthorized or invalid requests', async () => {
  const denied = { status: 403 }, h = route({ denied });
  assert.equal(await h.GET({ url: 'https://admin.example/api/admin/shop-sales' }), denied);
  assert.equal(h.calls(), 0);
  const validAuth = route();
  assert.equal((await validAuth.GET({ url: 'https://admin.example/api/admin/shop-sales?days=10000' })).status, 400);
  assert.equal(validAuth.calls(), 0);
});
const rows = [
  { item_id: 'lamp', category: 'lamps', title: 'Lamp', item_status: 'active', purchases: 3, self_purchases: 2, gift_purchases: 1, coins_spent: 450 },
  { item_id: 'rug', category: 'rugs', title: 'Rug', item_status: 'retired', purchases: 1, self_purchases: 1, gift_purchases: 0, coins_spent: 100 },
];
test('reports contain aggregates and canonical previews, no buyer identities; retired art is not guessed', async () => {
  const h = route({ data: rows }), response = await h.GET({ url: 'https://admin.example/api/admin/shop-sales' });
  assert.equal(response.status, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.purchases, 4); assert.equal(response.body.coinsSpent, 550);
  assert.equal(response.body.categories[0].label, 'Floor Lamps');
  assert.equal(response.body.categories[0].purchases, 3);
  assert.equal(response.body.rows[0].preview.name, 'Lamp'); assert.equal(response.body.rows[1].preview, null);
  assert.equal(response.body.categories.find(c => c.id === 'outfits').purchases, 0);
  const failure = await route({ error: { message: 'private database details' } }).GET({ url: 'https://admin.example/api/admin/shop-sales' });
  assert.equal(failure.status, 503); assert.doesNotMatch(JSON.stringify(failure.body), /private database/);
});
test('sales UI discards old filter responses and aborts requests when the tab unmounts', async () => {
  const h = hooks(), requests = [], jsx = (type, props) => ({ type, props });
  const { default: Sales } = load('apps/admin/src/app/admin/_components/ShopSalesTab.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
  }, { fetch: (url, options) => { const d = deferred(); requests.push({ url, options, ...d }); return d.promise; } });
  let tree = h.render(() => Sales());
  assert.equal(requests.length, 1);
  nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: '7' } });
  tree = h.render(() => Sales()); assert.equal(requests.length, 2);
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve({ ok: true, json: async () => ({ rows, ...plain(helpers.summarizeSales(rows)), since: null, until: '2026-10-19T10:00:00Z' }) });
  await flush();
  requests[0].resolve({ ok: true, json: async () => ({ rows: [], categories: [], purchases: 999 }) });
  await flush(); tree = h.render(() => Sales());
  assert.ok(nodes(tree).some(n => n.type === 'strong' && Array.isArray(n.props.children) && n.props.children[0] === '4'));
  h.unmount(); assert.equal(requests[1].options.signal.aborted, true);
});
test('new Admin tab and updated local Home tab pairs remain wired without resizing layout', () => {
  const dashboard = fs.readFileSync('apps/admin/src/app/admin/page.tsx', 'utf8');
  assert.match(dashboard, /id: 'shop-sales'/); assert.match(dashboard, /<ShopSalesTab/);
  const tabs = fs.readFileSync('apps/mobile/src/components/main/bottom-tab-bar.tsx', 'utf8');
  const pairs = [...tabs.matchAll(/require\('([^']+home tab icons\/[^']+)'\)/g)];
  assert.equal(pairs.length, 10);
  const path = require('node:path');
  for (const [, asset] of pairs) assert.ok(fs.statSync(path.resolve('apps/mobile/src/components/main', asset)).size > 0);
  assert.match(tabs, /width: 64 \* scale, height: 64 \* scale/);
  assert.match(tabs, /isFocused \|\| pressed \? burrowIcons\[name\]\.active/);
});
