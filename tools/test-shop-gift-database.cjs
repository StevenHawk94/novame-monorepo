const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=fs.readFileSync('supabase/migrations/20261019000250_shop_gift_claim.sql','utf8');
const legacy=fs.readFileSync('supabase/migrations/20260920000120_app_major_update_rewards_and_shop.sql','utf8');
const claim=legacy.slice(legacy.indexOf('create or replace function public.claim_gift_v1'),legacy.indexOf('create or replace function public.settle_adventure_v1'));
test('gift claim is atomic, recipient/pair scoped, wallet-free and idempotent, replacing only the chosen slot',async()=>{
 const db=new PGlite();const query=async(s,args=[])=> (await db.query(s,args)).rows;
 const rpc=async(id,replace=false,user=B,version='v1')=>(await query('select claim_shop_gift_v1($1,$2,$3,$4) value',[user,id,replace,version]))[0].value;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table pairings(user_id uuid,partner_id uuid);insert into pairings values('${A}','${B}'),('${B}','${A}');
   create table catalog_items(stable_id text primary key,item_type text,status text default 'active',metadata jsonb default '{}');
   insert into catalog_items(stable_id,item_type,metadata) values('lamp','decor','{"slot":"lamp"}'),('old','decor','{"slot":"lamp"}'),
    ('rug','decor','{"slot":"rug"}'),('outfit','outfit','{"slot":"outfit"}'),('bad','decor','{}');
   create table gifts(id uuid primary key default gen_random_uuid(),recipient_id uuid,sender_id uuid,item_id text,status text default 'pending',pair_version text default 'v1',claimed_at timestamptz);
   create table user_inventory(owner_id uuid,item_id text,source text,source_reference_id text,unique(owner_id,item_id));
   create table wallets(owner_id uuid,balance integer);insert into wallets values('${A}',1000),('${B}',2000);
   create table room_loadouts(room_type text,owner_id uuid,pair_low uuid,pair_high uuid,slot text,item_id text,updated_by uuid,pair_version text default 'v1');
   insert into room_loadouts values('our',null,'${A}','${B}','lamp','old','${A}','v1'),('our',null,'${A}','${B}','rug','rug','${A}','v1'),
    ('home','${A}',null,null,'outfit','outfit','${A}',null);
   create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,
    payload jsonb,idempotency_key text,unique(actor_id,idempotency_key));
   create function lock_burrow_pair(uuid) returns uuid language sql as $$select partner_id from pairings where user_id=$1$$;
   create function lock_burrow_inventory(uuid,uuid) returns void language plpgsql as $$begin return;end$$;
   create function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select 'v1'::text$$;
   create function burrow_relation_row_matches_v1(uuid,uuid,text) returns boolean language sql as $$select $3='v1'$$;`);
  await db.exec(claim);await db.exec(sql);await db.exec(sql);
  const seed=async(item='lamp',version='v1')=>(await query('insert into gifts(recipient_id,sender_id,item_id,pair_version) values($1,$2,$3,$4) returning id',[B,A,item,version]))[0].id;
  const first=await seed();const before=await query('select * from wallets');
  assert.equal((await rpc(first,false)).applied,true);
  assert.equal((await query("select item_id from room_loadouts where slot='lamp'"))[0].item_id,'old','unchecked means collection only');
  assert.equal((await rpc(first,true)).applied,false,'changing replace on retry cannot re-equip a claimed gift');
  const second=await seed();assert.equal((await rpc(second,true)).replaced,true);
  assert.equal((await query("select item_id from room_loadouts where slot='lamp'"))[0].item_id,'lamp');
  assert.equal((await query("select item_id from room_loadouts where slot='rug'"))[0].item_id,'rug');
  await db.exec("update room_loadouts set item_id='old' where slot='lamp'");assert.equal((await rpc(second,true)).applied,false);
  assert.equal((await query("select item_id from room_loadouts where slot='lamp'"))[0].item_id,'old','lost receipt retry respects newer choice');
  const outfit=await seed('outfit');assert.equal((await rpc(outfit,true)).applied,true);
  assert.equal((await query("select * from room_loadouts where slot='outfit' and owner_id=$1",[B]))[0].room_type,'home');
  assert.equal((await query("select * from room_loadouts where slot='outfit' and owner_id=$1",[A])).length,1);
  assert.equal((await rpc(await seed(),true,C)).error,'not_paired');
  assert.equal((await rpc(await seed(),true,B,'v2')).error,'pair_changed');
  assert.equal((await rpc(await seed('lamp','old-pair'),true)).error,'not_found');
  const invalid=await seed('bad');assert.equal((await rpc(invalid,true)).error,'invalid_loadout');
  assert.equal((await query('select status from gifts where id=$1',[invalid]))[0].status,'pending');
  assert.equal((await query("select * from user_inventory where item_id='bad'")).length,0);
  const failed=await seed();await db.exec(`create function fail_loadout() returns trigger language plpgsql as $$begin raise exception 'test storage error';end$$;
   create trigger fail_insert before insert on room_loadouts for each row execute function fail_loadout();`);
  await assert.rejects(rpc(failed,true),/test storage error/);
  assert.equal((await query('select status from gifts where id=$1',[failed]))[0].status,'pending','native transaction rolls claim back on placement failure');
  assert.equal((await query('select * from moment_events where reference_id=$1',[failed])).length,0);
  assert.deepEqual(await query('select * from wallets'),before);
  for(const role of ['anon','authenticated'])assert.equal((await query(`select has_function_privilege('${role}','claim_shop_gift_v1(uuid,uuid,boolean,text)','execute') allowed`))[0].allowed,false);
 }finally{await db.close();}
});
