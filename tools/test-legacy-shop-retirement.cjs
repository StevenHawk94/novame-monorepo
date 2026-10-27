const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = readFileSync('supabase/migrations/20261012000225_retire_unmapped_legacy_shop_items.sql', 'utf8');
const ids = ['adventure_fossil_lamp_01', 'friend_visit_lamp_1', 'friend_visit_lamp_2',
  'friend_visit_lamp_3', 'friend_visit_vase_1', 'friend_visit_vase_2', 'friend_visit_vase_3'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table catalog_items(stable_id text primary key, status text default 'active',
      item_type text default 'decor', category text, price integer, plus_only boolean default false,
      tradable boolean default true, drop_weight integer default 10,
      asset jsonb default '{"renderer":"native"}', metadata jsonb default '{}',
      updated_at timestamptz default now());
    create table history(kind text, item_id text references catalog_items(stable_id));
  `);
  for (const id of [...ids, 'other_unmapped_lamp', 'real_lamp']) {
    await db.query('insert into catalog_items(stable_id, category, metadata) values($1,$2,$3)',
      [id, id.includes('vase') ? 'vases' : 'lamps', {slot: id.includes('vase') ? 'vase' : 'lamp'}]);
  }
  for (const kind of ['inventory', 'gift', 'purchase', 'adventure']) {
    await db.query('insert into history values($1,$2)', [kind, ids[0]]);
  }
  return db;
}

test('only seven placeholders retire; historical records and product data survive; retry is idempotent', async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from catalog_items order by stable_id')).rows;
    await db.exec(migration);
    const after = (await db.query('select * from catalog_items order by stable_id')).rows;
    assert.equal(after.length, before.length);
    assert.deepEqual(after.filter(r => r.status === 'retired').map(r => r.stable_id).sort(), [...ids].sort());
    for (const row of after) {
      const original = before.find(r => r.stable_id === row.stable_id);
      if (!ids.includes(row.stable_id)) { assert.deepEqual(row, original); continue; }
      assert.equal(row.tradable, false);
      assert.equal(row.drop_weight, 0);
      assert.equal(row.price, original.price);
      assert.equal(row.plus_only, original.plus_only);
      assert.deepEqual(row.asset, original.asset);
      assert.equal(row.metadata.slot, original.metadata.slot);
    }
    assert.equal((await db.query('select * from history')).rows.length, 4);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from catalog_items order by stable_id')).rows, after);
  } finally { await db.close(); }
});

test('a target with newly assigned real artwork is not retired', async () => {
  const db = await fixture();
  try {
    await db.query(`update catalog_items set metadata = metadata || '{"artOrdinal":1}' where stable_id=$1`, [ids[0]]);
    await db.query(`update catalog_items set asset = '{"renderer":"bundled"}' where stable_id=$1`, [ids[1]]);
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::integer n from catalog_items where status='retired'")).rows[0].n, 5);
  } finally { await db.close(); }
});
