const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261019000248_admin_shop_sales.sql', 'utf8');
test('sales SQL counts only committed paid receipts across solo, gift and batch checkout; no user state changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table app_config(key text primary key, value text);
      insert into app_config values('app_major_update_content_revision','current');
      create table catalog_items(stable_id text primary key, category text, title text, status text, price integer, metadata jsonb default '{}', item_type text default 'decor', revision_id text default 'current');
      create table catalog_purchases(id text primary key, buyer_id text, recipient_id text, item_id text references catalog_items, status text default 'completed', price_snapshot integer, created_at timestamptz, unique(buyer_id,id));
      insert into catalog_items(stable_id,category,title,status,price) values
        ('lamp','lamps','Lamp','active',999),('rug','rugs','Rug','active',200),
        ('retired','windows','Old Window','retired',200),('zero','tables','Zero sales','active',200),
        ('free','cushions','Free','active',0),('game','games','Game','active',300),
        ('old','lamps','Old revision','active',100);
      update catalog_items set revision_id='previous' where stable_id='old';
      insert into catalog_items(stable_id,category,title,status,price,metadata) values('starter','lamps','Starter','active',100,'{"starter":true}');
      insert into catalog_purchases(id,buyer_id,recipient_id,item_id,price_snapshot,created_at,status) values
        ('direct','me','me','lamp',100,'2026-10-19','completed'),
        ('gift','me','partner','lamp',150,'2026-10-18','completed'),
        ('batch:1','me','me','lamp',120,'2026-10-17','completed'),
        ('batch:2','me','me','rug',200,'2026-10-17','completed'),
        ('old-receipt','me','me','retired',200,'2026-09-01','completed'),
        ('refund','me','me','lamp',100,'2026-10-18','refunded'),
        ('free','me','me','free',0,'2026-10-18','completed'),
        ('game','me','me','game',300,'2026-10-18','completed'),
        ('starter','me','me','starter',100,'2026-10-18','completed');
      grant select on app_config,catalog_items,catalog_purchases to service_role;`);
    const before = (await db.query('select jsonb_agg(to_jsonb(p) order by id) as data from catalog_purchases p')).rows[0].data;
    await db.exec(migration); await db.exec(migration);
    const read = async (since, until, kind) => (await db.query('select admin_shop_sales_v1($1,$2,$3) as report', [since, until, kind])).rows[0].report.rows;
    const report = await read(null, '2026-10-20', 'all');
    assert.deepEqual(report.map(r => r.item_id), ['lamp','rug','retired','zero']);
    const lamp = report[0]; assert.equal(Number(lamp.purchases), 3);
    assert.equal(Number(lamp.self_purchases), 2); assert.equal(Number(lamp.gift_purchases), 1);
    assert.equal(Number(lamp.coins_spent), 370); // Historical snapshots, not current 999.
    assert.equal(Number(report.find(r => r.item_id === 'zero').purchases), 0);
    const gift = await read('2026-10-12', '2026-10-20', 'gift');
    assert.equal(Number(gift[0].purchases), 1); assert.equal(gift[0].item_id, 'lamp');
    assert.ok(!gift.some(r => r.item_id === 'retired'));
    const self = await read('2026-10-17', '2026-10-19', 'self');
    assert.equal(Number(self.find(r => r.item_id === 'lamp').purchases), 1); // Exclusive end.
    for (const role of ['anon','authenticated']) {
      assert.equal((await db.query(`select has_function_privilege('${role}','admin_shop_sales_v1(timestamptz,timestamptz,text)','execute') allowed`)).rows[0].allowed, false);
    }
    assert.equal((await db.query("select has_function_privilege('service_role','admin_shop_sales_v1(timestamptz,timestamptz,text)','execute') allowed")).rows[0].allowed, true);
    await db.exec('set role service_role');
    assert.equal((await read(null, '2026-10-20', 'all')).length, 4);
    await db.exec('reset role');
    await db.exec(`insert into catalog_items(stable_id,category,title,status,price)
      select 'style-'||n,'outfits','Style '||n,'active',200 from generate_series(1,1005) n;`);
    assert.equal((await read(null, '2026-10-20', 'all')).length, 1009, 'one JSON report retains more than 1000 styles');
    assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(p) order by id) as data from catalog_purchases p')).rows[0].data, before);
  } finally { await db.close(); }
});
