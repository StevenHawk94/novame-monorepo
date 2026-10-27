// Actual migration + actual purchase functions in isolated PostgreSQL/WASM.
// Support functions below stand in only for unrelated wallet/pair/loadout APIs.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const sql = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
let db;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const rpc = async (name, args) => (await query(`select ${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args))[0].result;
const prices = updates => rpc('set_burrow_shop_prices_v1', [A, 'admin@example.com', JSON.stringify(updates), 'Test adjustment']);
const product = (id, price, version = 0) => ({ id, price, version });
const buy = (id, price, key = id, recipient = A) => rpc('purchase_catalog_item_v2', [A, recipient, id, key, price]);
const balance = async () => (await query('select carrot_balance from wallets where user_id=$1', [A]))[0].carrot_balance;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,subscription_tier text default 'free');
    create table pairings(user_id uuid primary key,partner_user_id uuid);
    create table app_config(key text primary key,value text);
    insert into app_config values('app_major_update_content_revision','live');
    create table content_revisions(id text primary key,status text);
    insert into content_revisions values('live','published'),('old','published'),('draft','draft');
    create table catalog_items(stable_id text primary key,revision_id text,item_type text,category text,
      title text,price integer,plus_only boolean default false,tradable boolean default true,
      status text default 'active',metadata jsonb default '{}',updated_at timestamptz default now());
    create table wallets(user_id uuid primary key,carrot_balance integer);
    create table catalog_purchases(id uuid primary key default gen_random_uuid(),buyer_id uuid,recipient_id uuid,item_id text,
      price_snapshot integer,idempotency_key text,unique(buyer_id,idempotency_key));
    create table user_inventory(owner_id uuid,item_id text,source text,source_reference_id text,unique(owner_id,item_id));
    create table gifts(id uuid primary key default gen_random_uuid(),sender_id uuid,recipient_id uuid,item_id text,reason text,
      reference_type text,reference_id text,idempotency_key text,status text default 'pending');
    create table adventures(id uuid,user_id uuid,partner_id uuid);
    create table adventure_results(adventure_id uuid,item_id text,claim_status text);
    create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,
      reference_type text,reference_id text,payload jsonb,idempotency_key text,unique(actor_id,idempotency_key));
    create function lock_burrow_pair(uuid) returns uuid language sql as $$select partner_user_id from pairings where user_id=$1$$;
    create function lock_burrow_inventory(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
    create function change_carrot_balance_v1(uuid,integer,text,text,text,text) returns jsonb language plpgsql as $$
    declare total integer; begin
      select carrot_balance+$2 into total from wallets where user_id=$1 for update;
      if total<0 then return '{"error":"insufficient_balance"}'::jsonb; end if;
      update wallets set carrot_balance=total where user_id=$1;
      return jsonb_build_object('balance',total); end$$;
    create function solo_burrow_loadout_v1(uuid,jsonb) returns jsonb language sql as $$select '{"error":null}'::jsonb$$;
    create function save_room_loadout_v1(uuid,text,jsonb) returns jsonb language sql as $$select '{"error":null}'::jsonb$$;
    create function solo_burrow_outfit_v1(uuid,text) returns jsonb language sql as $$select '{"error":null}'::jsonb$$;
    create function save_bunny_outfit_v1(uuid,text) returns jsonb language sql as $$select '{"error":null}'::jsonb$$;
    insert into profiles(id) values('${A}'),('${B}');
    insert into wallets values('${A}',1000),('${B}',1000);
    insert into catalog_items(stable_id,revision_id,item_type,category,title,price,metadata) values
      ('lamp','live','decor','lamps','Lamp',100,'{"slot":"lamp"}'),
      ('table','live','decor','tables','Table',200,'{"slot":"table"}'),
      ('outfit','live','outfit','outfits','Outfit',150,'{"slot":"outfit"}'),
      ('free','live','decor','lamps','Starter',0,'{"slot":"lamp","starter":true}'),
      ('old','old','decor','lamps','Old',50,'{}'),('draft','draft','decor','lamps','Draft',50,'{}'),
      ('music','live','music','music','Music',50,'{}');
  `);
  const paired = sql('20260920000120_app_major_update_rewards_and_shop.sql');
  const purchaseEnd = paired.indexOf('grant execute on function public.purchase_catalog_item_v1');
  await db.exec(paired.slice(paired.indexOf('create or replace function public.purchase_catalog_item_v1'), paired.indexOf(';',purchaseEnd)+1));
  const solo = sql('20260920000147_burrow_solo_core.sql');
  await db.exec(solo.slice(solo.indexOf('create or replace function public.solo_burrow_purchase_v1'), solo.indexOf('create or replace function public.solo_burrow_care_v1')));
  await db.exec(sql('20261001000149_burrow_shop_room_checkout.sql'));
  const migration = sql('20261008000203_burrow_shop_pricing.sql');
  await db.exec(migration); await db.exec(migration); // SQL-editor retry must not duplicate guards
  const plusMigration=sql('20261012000224_burrow_shop_plus_toggle.sql');
  await db.exec(plusMigration);await db.exec(plusMigration);
});
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => db?.close());

test('single and batch price edits increment versions and audit exact before/after values', async () => {
  const result = await prices([product('lamp',120),product('table',240)]);
  assert.equal(result.error,null); assert.equal(result.updated.length,2);
  assert.equal(result.updated[0].version,1);
  const audit = await query('select * from burrow_shop_price_audit order by item_id');
  assert.equal(audit.length,2); assert.equal(audit[0].old_price,100); assert.equal(audit[0].new_price,120);
  assert.equal(audit[0].batch_id,audit[1].batch_id); assert.equal(audit[0].admin_id,A);
  assert.equal(audit[0].reason,'Test adjustment');
  assert.equal((await prices([product('lamp',120,1)])).updated[0].version,1);
  assert.equal((await query('select * from burrow_shop_price_audit')).length,2,'no-op does not invent history');
});
test('Plus toggles preserve price and inventory, are reversible, and audit exact settings with one CAS version',async()=>{
  await query("insert into user_inventory(owner_id,item_id,source) values($1,'lamp','purchase')",[A]);
  let result=await prices([{id:'lamp',version:0,plus_only:true}]);
  assert.equal(result.error,null);assert.equal(result.updated[0].price,100);assert.equal(result.updated[0].plus_only,true);assert.equal(result.updated[0].version,1);
  assert.equal((await query('select * from user_inventory')).length,1);
  assert.equal((await prices([{id:'lamp',version:1,plus_only:true}])).updated[0].version,1,'no-op');
  result=await prices([{id:'lamp',version:1,plus_only:false}]);assert.equal(result.updated[0].version,2);
  const audit=await query('select * from burrow_shop_price_audit order by id');
  assert.equal(audit.length,2);assert.equal(audit[0].old_plus_only,false);assert.equal(audit[0].new_plus_only,true);
  assert.equal(audit[1].old_plus_only,true);assert.equal(audit[1].new_plus_only,false);
  assert.equal(audit[0].old_price,audit[0].new_price);assert.equal(audit[0].admin_id,A);assert.equal(await balance(),1000);
});
test('combined edits audit once and stale versions between price and Plus reject the complete batch',async()=>{
  const result=await prices([{id:'lamp',version:0,price:160,plus_only:true}]);assert.equal(result.updated[0].version,1);
  const audit=await query('select * from burrow_shop_price_audit');assert.equal(audit.length,1);
  assert.equal(audit[0].old_price,100);assert.equal(audit[0].new_price,160);assert.equal(audit[0].new_plus_only,true);
  assert.equal((await prices([{id:'table',version:0,plus_only:true},{id:'lamp',version:0,price:170}])).error,'price_conflict');
  assert.equal((await query("select plus_only from catalog_items where stable_id='table'"))[0].plus_only,false);
  assert.equal((await prices([{id:'table',version:0,price:260}])).error,null);
  assert.equal((await prices([{id:'table',version:0,plus_only:true}])).error,'price_conflict');
});
test('starter Plus switches are editable but their free prices remain protected; invalid booleans and non-Shop targets fail',async()=>{
  const result=await prices([{id:'free',version:0,plus_only:true}]);assert.equal(result.error,null);assert.equal(result.updated[0].price,0);
  assert.equal((await prices([{id:'free',version:1,plus_only:false,price:10}])).error,'read_only_item');
  for(const plus_only of [null,'true',1,0,{},[]])assert.equal((await prices([{id:'lamp',version:0,plus_only}])).error,'invalid_request');
  assert.equal((await prices([{id:'lamp',version:0}])).error,'invalid_request');
  assert.equal((await prices([{id:' ',version:0,plus_only:true}])).error,'invalid_request');
  for(const id of ['old','draft','music'])assert.equal((await prices([{id,version:0,plus_only:true}])).error,'read_only_item');
});
test('Free solo and paired/gift purchases cannot buy newly Plus-only products; Plus entitlement and owned items still work',async()=>{
  await prices([{id:'lamp',version:0,plus_only:true}]);
  assert.equal((await buy('lamp',100)).error,'plus_required');assert.equal(await balance(),1000);
  assert.equal((await rpc('purchase_room_loadout_v2',[A,JSON.stringify({lamp:'lamp'}),'room',null,JSON.stringify({lamp:100})])).error,'plus_required');
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  assert.equal((await buy('lamp',100,'gift',B)).error,'plus_required');assert.equal((await query('select * from gifts')).length,0);
  await query("update profiles set subscription_tier='plus' where id=$1",[B]);
  assert.equal((await buy('lamp',100,'gift',B)).applied,true);assert.equal(await balance(),900);
  await query("insert into user_inventory(owner_id,item_id,source) values($1,'lamp','purchase')",[A]);
  await query("update profiles set subscription_tier='free' where id=$1",[B]);
  const owned=await rpc('purchase_room_loadout_v2',[A,JSON.stringify({lamp:'lamp'}),'owned',null,JSON.stringify({lamp:100})]);
  assert.equal(owned.error,null);assert.equal(owned.total,0);assert.equal(await balance(),900);
});
test('manual Plus changes cannot bypass versions/audit, and history roles stay private',async()=>{
  await db.exec("update catalog_items set plus_only=true,shop_price_version=0 where stable_id='lamp'");
  assert.equal((await query("select shop_price_version from catalog_items where stable_id='lamp'"))[0].shop_price_version,1);
  const audit=await query('select * from burrow_shop_price_audit');assert.equal(audit.length,1);assert.equal(audit[0].new_plus_only,true);
  for(const role of ['anon','authenticated'])assert.equal((await query('select has_function_privilege($1,$2,$3) ok',[role,'set_burrow_shop_prices_v1(uuid,text,jsonb,text)','execute']))[0].ok,false);
});
test('stale versions and invalid/read-only items reject the whole batch without partial edits', async () => {
  for (const [updates,error] of [
    [[product('lamp',120),product('table',240,99)],'price_conflict'],
    [[product('lamp',120),product('free',12)],'read_only_item'],
    [[product('lamp',120),product('old',12)],'read_only_item'],
    [[product('lamp',120),product('draft',12)],'read_only_item'],
    [[product('lamp',120),product('music',12)],'read_only_item'],
    [[product('lamp',120),product('missing',12)],'not_found'],
  ]) {
    assert.equal((await prices(updates)).error,error);
    assert.equal((await query("select price from catalog_items where stable_id='lamp'"))[0].price,100);
    assert.equal((await query('select * from burrow_shop_price_audit')).length,0);
  }
});
test('negative/zero/fractional/duplicate/extra-field/oversized batches are rejected', async () => {
  for (const updates of [[product('lamp',0)],[product('lamp',-1)],[product('lamp',1.2)],
    [product('lamp',1000001)],[product('lamp',120,-1)],[{...product('lamp',120),asset:'https://evil'}],
    [product('lamp',120),product('lamp',140)],[],Array(201).fill(product('lamp',12))])
    assert.equal((await prices(updates)).error,'invalid_request');
});
test('manual database price edits cannot bypass the audit or legacy-client protection', async () => {
  await db.exec("update catalog_items set price=123,shop_price_version=0 where stable_id='lamp'");
  assert.equal((await query("select shop_price_version from catalog_items where stable_id='lamp'"))[0].shop_price_version,1);
  assert.equal((await query('select * from burrow_shop_price_audit')).length,1);
  assert.equal((await rpc('solo_burrow_purchase_v1',[A,'lamp','legacy'])).error,'price_confirmation_required');
  assert.equal(await balance(),1000);
});
test('solo purchase uses the displayed price and remains idempotent across later price edits', async () => {
  assert.equal((await buy('lamp',99)).error,'price_changed'); assert.equal(await balance(),1000);
  assert.equal((await buy('lamp',100)).applied,true); assert.equal(await balance(),900);
  await prices([product('lamp',130)]);
  assert.equal((await buy('lamp',100)).applied,false); assert.equal(await balance(),900);
  assert.equal((await query('select price_snapshot from catalog_purchases'))[0].price_snapshot,100);
  assert.equal((await query('select * from user_inventory')).length,1);
});
test('paired self purchases and gifts both reject stale prices before any debit or gift creation', async () => {
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  await prices([product('lamp',130)]);
  for (const recipient of [A,B]) assert.equal((await buy('lamp',100,`stale-${recipient}`,recipient)).error,'price_changed');
  assert.equal(await balance(),1000); assert.equal((await query('select * from gifts')).length,0);
  assert.equal((await buy('lamp',130,'gift',B)).applied,true); assert.equal(await balance(),870);
  assert.equal((await query('select * from gifts')).length,1);
});
test('room + outfit checkout validates every price before spending; current quotes commit atomically', async () => {
  await prices([product('lamp',130),product('outfit',175)]);
  const slots = JSON.stringify({lamp:'lamp',table:'table'});
  const room = quote => rpc('purchase_room_loadout_v2',[A,slots,'room','outfit',JSON.stringify(quote)]);
  assert.equal((await room({lamp:100,table:200,outfit:150})).error,'price_changed');
  assert.equal((await room({lamp:130,table:200,outfit:150})).error,'price_changed');
  assert.equal(await balance(),1000); assert.equal((await query('select * from catalog_purchases')).length,0);
  const result = await room({lamp:130,table:200,outfit:175});
  assert.equal(result.error,null); assert.equal(result.total,505); assert.equal(await balance(),495);
  await prices([product('lamp',140,1)]);
  assert.equal((await room({lamp:130,table:200,outfit:175})).applied,false); assert.equal(await balance(),495);
});
test('existing inventory is never recharged when prices change', async () => {
  await buy('lamp',100); await prices([product('lamp',140)]);
  const result = await rpc('purchase_room_loadout_v2',[A,JSON.stringify({lamp:'lamp'}),'owned',null,JSON.stringify({lamp:100})]);
  assert.equal(result.error,null); assert.equal(result.total,0); assert.equal(await balance(),900);
});
test('legacy clients can buy unchanged prices but cannot silently accept edited prices', async () => {
  assert.equal((await rpc('solo_burrow_purchase_v1',[A,'table','unchanged'])).applied,true);
  await prices([product('lamp',130)]);
  assert.equal((await rpc('purchase_catalog_item_v1',[A,A,'lamp','old'])).error,'not_paired');
  assert.equal((await rpc('solo_burrow_purchase_v1',[A,'lamp','old'])).error,'price_confirmation_required');
  assert.equal((await rpc('purchase_room_loadout_v1',[A,JSON.stringify({lamp:'lamp'}),'old-room',null])).error,'price_confirmation_required');
  assert.equal(await balance(),800);
});
test('quotes do not leak to the next purchase; public clients cannot edit prices or inspect audit', async () => {
  await prices([product('lamp',130)]); await buy('lamp',120);
  assert.equal((await query("select current_setting('burrow.shop_prices',true) value"))[0].value,'');
  for (const role of ['anon','authenticated']) {
    for (const signature of ['set_burrow_shop_prices_v1(uuid,text,jsonb,text)','purchase_catalog_item_v2(uuid,uuid,text,text,integer)',
      'purchase_room_loadout_v2(uuid,jsonb,text,text,jsonb)','burrow_shop_price_error_v1(text,integer,bigint)'])
      assert.equal((await query('select has_function_privilege($1,$2,$3) ok',[role,signature,'execute']))[0].ok,false);
    assert.equal((await query('select has_table_privilege($1,$2,$3) ok',[role,'burrow_shop_price_audit','select']))[0].ok,false);
  }
  for (const signature of ['purchase_catalog_item_v1(uuid,uuid,text,text)','solo_burrow_purchase_v1(uuid,text,text)',
    'purchase_room_loadout_v1(uuid,jsonb,text,text)']) {
    const definition = (await query('select pg_get_functiondef($1::regprocedure) text',[signature]))[0].text;
    assert.equal((definition.match(/pg_advisory_xact_lock_shared/g)??[]).length,1);
  }
});
