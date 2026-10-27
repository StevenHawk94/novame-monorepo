const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261011000220_burrow_layered_outfits.sql','utf8');
const old=['outfit_explorer_01','placeholder_outfits_02','placeholder_outfit_cozy_01','placeholder_outfit_rain_01','placeholder_outfit_night_01'];
const A='11111111-1111-4111-8111-111111111111';
async function setup() {
  const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);
    insert into profiles values('${A}');
    create table app_config(key text primary key,value text);
    insert into app_config values('app_major_update_content_revision','live');
    create table content_revisions(id text primary key,status text);
    insert into content_revisions values('live','published');
    create table catalog_items(stable_id text primary key,revision_id text,item_type text,category text,title text,description text,
      price integer,plus_only boolean,tradable boolean,tags text[],drop_weight integer,asset jsonb,metadata jsonb,is_placeholder boolean,
      status text default 'active',updated_at timestamptz default now());
    create table user_inventory(owner_id uuid,item_id text references catalog_items(stable_id),source text,unique(owner_id,item_id));
    create table room_loadouts(owner_id uuid,slot text,item_id text references catalog_items(stable_id),version bigint default 1,updated_at timestamptz default now());
    create table catalog_purchases(item_id text references catalog_items(stable_id));
    create table gifts(item_id text references catalog_items(stable_id));
    create table adventure_results(item_id text references catalog_items(stable_id));
    create table friend_visits(reward_item_id text references catalog_items(stable_id));
    create table adventure_encounter_plans(gift_id text references catalog_items(stable_id));
    create table adventure_gift_display(gift_id text references catalog_items(stable_id));
    create table room_music(track_id text references catalog_items(stable_id));
    insert into catalog_items(stable_id,category,price,metadata,asset) values
      ${old.map(id=>`('${id}','outfits',0,'{}','{}')`).join(',')},
      ('keep-lamp','lamps',150,'{}','{}');
    insert into user_inventory select '${A}',stable_id,'starter' from catalog_items;
    insert into room_loadouts values('${A}','outfit','outfit_explorer_01',2,now());
  `);
  const pricing=fs.readFileSync('supabase/migrations/20261008000203_burrow_shop_pricing.sql','utf8');
  await db.exec(pricing.slice(0,pricing.indexOf('-- This context')));
  return db;
}
test('220 replaces exactly five outfits, grants default, keeps other items and enables real Admin CAS pricing',async()=>{
  const db=await setup();
  try{
    await db.exec(migration);
    const rows=(await db.query("select * from catalog_items where category='outfits'")).rows;
    assert.equal(rows.length,19);
    assert.equal(rows.filter(r=>r.price===300&&!r.plus_only&&!r.metadata.starter&&r.asset.renderer==='layered_bunny').length,18);
    assert.equal(rows.find(r=>r.stable_id==='burrow_outfit_default').price,0);
    assert.equal((await db.query("select item_id,version from room_loadouts")).rows[0].item_id,'burrow_outfit_default');
    assert.equal((await db.query("select version from room_loadouts")).rows[0].version,3);
    assert.equal((await db.query("select item_id from user_inventory order by item_id")).rows.length,2);
    assert.equal((await db.query("select price from catalog_items where stable_id='keep-lamp'")).rows[0].price,150);
    const updates=JSON.stringify([{id:'burrow_outfit_01_red_gingham',price:450,version:0}]);
    const result=(await db.query("select set_burrow_shop_prices_v1($1,'admin@example.com',$2::jsonb,'outfit test') result",[A,updates])).rows[0].result;
    assert.equal(result.error,null);assert.equal(result.updated[0].price,450);assert.equal(result.updated[0].version,1);
    const denied=(await db.query("select set_burrow_shop_prices_v1($1,'admin@example.com',$2::jsonb) result",[A,JSON.stringify([{id:'burrow_outfit_default',price:300,version:0}])])).rows[0].result;
    assert.equal(denied.error,'read_only_item');
    await db.exec(migration);
    assert.equal((await db.query("select price from catalog_items where stable_id='burrow_outfit_01_red_gingham'")).rows[0].price,450,'retry preserves Admin price');
    assert.equal((await db.query("select count(*)::int n from user_inventory")).rows[0].n,2);
  }finally{await db.close();}
});
test('unexpected purchase/history fails closed and cannot partially delete old inventory',async()=>{
  const db=await setup();
  try{
    await db.exec("insert into catalog_purchases values('placeholder_outfit_cozy_01')");
    await assert.rejects(db.exec(migration),/Unexpected old outfit history/);
    await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int n from catalog_items where category='outfits'")).rows[0].n,5);
    assert.equal((await db.query('select count(*)::int n from user_inventory')).rows[0].n,6);
  }finally{await db.close();}
});
