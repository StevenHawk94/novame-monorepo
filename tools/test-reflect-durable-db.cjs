/* Runs the REAL PL/pgSQL in an isolated PostgreSQL engine. No remote database.
 * PGLITE_MODULE=/temporary/path/node_modules/@electric-sql/pglite node --test tools/test-reflect-durable-db.cjs
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create type kit_t as enum ('new_lens'); create type dimension_t as enum ('test');
    create table profiles(id uuid primary key,subscription_tier text default 'plus');
    create table companions(user_id uuid primary key,xp bigint default 0,last_opened_at timestamptz);
    create table pairings(user_id uuid primary key,partner_user_id uuid);
    create table items(id text primary key);
    create table reflects(id uuid primary key default gen_random_uuid(),user_id uuid,prompt_id smallint,body text,dimension_hits jsonb,
      local_date date,source_kit kit_t,shared_to_friends boolean,mode text,shared_with_user_id uuid,created_at timestamptz default now());
    create table xp_events(user_id uuid,source text,amount int,ref_id uuid,local_date date,iso_week text);
    create table reflect_items(reflect_id uuid references reflects(id),user_id uuid,item_id text,position smallint,
      match_label text,source_excerpt text,visible_to_paired boolean default true,primary key(reflect_id,item_id));
    create table item_memories(id uuid primary key default gen_random_uuid(),user_id uuid,item_id text,reflect_id uuid,
      raw_excerpt text,refined_desc text,description text,memory_source text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table user_items(user_id uuid,item_id text,count int,first_seen_at timestamptz,primary key(user_id,item_id));
    create table shared_memory_items(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,author_user_id uuid,
      item_id text,description text,source text,reflect_id uuid,created_at timestamptz default now());
    create table reflect_drafts(id uuid primary key default gen_random_uuid(),user_id uuid,idempotency_key text,prompt_id smallint,
      body text,local_date date,mode text,source_kit text,friend_user_id uuid,matches jsonb default '[]',ai_memories jsonb default '{}',
      bubble text,finalized_reflect_id uuid,created_at timestamptz default now(),expires_at timestamptz default now()+interval '24 hours',
      unique(user_id,idempotency_key));
    insert into items select 'i'||n from generate_series(1,150) n;
  `);
  const submit = read('20260723000027_pairing_reflect_modes.sql');
  await db.exec(submit.slice(submit.indexOf('create or replace function public.submit_reflect(')));
  const old = read('20260823000059_reflect_memories_v2.sql');
  await db.exec(old.slice(old.indexOf('create or replace function public.finalize_reflect_draft('),
    old.indexOf('create or replace function public.broadcast_reflect_feed_change(')));
  const migration = read('20260827000068_reflect_durable_settlement.sql');
  await db.exec(migration);
  await db.exec(migration); // safe SQL-editor retry
});
after(async () => { await db?.close(); });
async function user() {
  const id = randomUUID();
  await db.query('insert into profiles(id) values($1)', [id]);
  await db.query('insert into companions(user_id) values($1)', [id]);
  return id;
}
async function rpc(sql,args) { return (await db.query(sql,args)).rows[0].result; }
async function begin(id, key = randomUUID(), extra = {}, memories = {i1:'Made soup.'}) {
  return rpc('select begin_saved_reflect($1,$2::jsonb,$3::jsonb,30,\'2026-W35\') result', [id, JSON.stringify({
    idempotency_key:key,prompt_id:9,body:'Made soup.',local_date:new Date().toISOString().slice(0,10),
    mode:'typing',matches:[{itemId:'i1',displayName:'Soup'}],...extra,
  }),JSON.stringify(memories)]);
}
async function row(sql,args=[]) { return (await db.query(sql,args)).rows[0]; }
async function complete(id,d,memories=null,revision=1) {
  return rpc('select complete_saved_reflect($1,$2,$3::jsonb,$4) result',[id,d,memories==null?null:JSON.stringify(memories),revision]);
}
test('Save commits record/count/reward/fallback BEFORE AI and keeps all partner paths private',async()=>{
  const id=await user(), {draft:d}=await begin(id);
  assert.ok(d.saved_reflect_id); assert.equal(d.finalized_reflect_id,null);
  assert.equal(d.save_receipt.reflects_today,1); assert.equal(d.save_receipt.xp_awarded,30);
  assert.equal((await row('select count(*)::int n from xp_events where user_id=$1',[id])).n,1);
  assert.equal((await row('select shared_to_friends from reflects where id=$1',[d.saved_reflect_id])).shared_to_friends,false);
  assert.equal((await row('select visible_to_paired from reflect_items where reflect_id=$1',[d.saved_reflect_id])).visible_to_paired,false);
  assert.equal((await row('select description from item_memories where reflect_id=$1',[d.saved_reflect_id])).description,'Made soup.');
});
test('new request keys cannot bypass three-per-day; lost-response retry still succeeds at quota',async()=>{
  const id=await user(), key=randomUUID(), first=await begin(id,key);
  await begin(id); await begin(id);
  assert.equal((await begin(id)).error,'daily_limit_reached');
  assert.equal((await begin(id,key)).draft.saved_reflect_id,first.draft.saved_reflect_id);
  assert.equal((await row('select count(*)::int n from reflects where user_id=$1',[id])).n,3);
  assert.equal((await row('select sum(amount)::int n from xp_events where user_id=$1',[id])).n,90);
  assert.equal((await begin(id,randomUUID(),{local_date:'2000-01-01'})).error,'invalid_local_date');
});
test('manual clearing and privacy survive late AI, stale checkpoints, recovery and duplicate Done',async()=>{
  const id=await user(), {draft:d}=await begin(id);
  const changed=[{itemId:'i1',text:'',source:'manual',edited:true,visible:false}];
  await rpc('select checkpoint_reflect_settlement($1,$2,$3::jsonb,2) result',[id,d.id,JSON.stringify(changed)]);
  await rpc('select store_reflect_generation($1,$2,$3::jsonb,\'hello\') result',[id,d.id,JSON.stringify({i1:'Late AI'})]);
  await rpc('select checkpoint_reflect_settlement($1,$2,$3::jsonb,1) result',[id,d.id,JSON.stringify([{...changed[0],text:'stale',visible:true}])]);
  const saved=await complete(id,d.id);
  assert.equal(saved.memories[0].text,''); assert.equal(saved.memories[0].visible,false);
  assert.equal((await row('select count(*)::int n from item_memories where reflect_id=$1',[d.saved_reflect_id])).n,0);
  assert.equal((await row('select visible_to_paired from reflect_items where reflect_id=$1',[d.saved_reflect_id])).visible_to_paired,false);
  const retry=await complete(id,d.id,[{...changed[0],text:'bad retry'}],9);
  assert.equal(retry.already_finalized,true); assert.equal(retry.xp_awarded,0);
  assert.equal(retry.memories[0].text,'');
});
test('untouched client fallback cannot clobber a newer saved AI result; privacy-only edits retain copy',async()=>{
  const id=await user(), {draft:d}=await begin(id);
  await rpc('select store_reflect_generation($1,$2,$3::jsonb,null) result',[id,d.id,JSON.stringify({i1:'Made vegetable soup tonight.'})]);
  const saved=await complete(id,d.id,[{itemId:'i1',text:'Made soup.',source:'ai',edited:false,visible:false}],3);
  assert.equal(saved.memories[0].text,'Made vegetable soup tonight.');
  assert.equal(saved.memories[0].visible,false);
});
test('Shared/Ours only publishes after completion, once; lost pairing retains a private record',async()=>{
  const id=await user(), friend=await user();
  await db.query('insert into pairings values($1,$2)',[id,friend]);
  const {draft:d}=await begin(id,randomUUID(),{friend_user_id:friend});
  assert.equal((await row('select count(*)::int n from shared_memory_items where reflect_id=$1',[d.saved_reflect_id])).n,0);
  const saved=await complete(id,d.id);
  assert.equal(saved.sharedItems.length,1);
  await complete(id,d.id);
  assert.equal((await row('select count(*)::int n from shared_memory_items where reflect_id=$1',[d.saved_reflect_id])).n,1);
  const {draft:abandoned}=await begin(id,randomUUID(),{friend_user_id:friend});
  await db.query('delete from pairings where user_id=$1',[id]);
  assert.equal((await complete(id,abandoned.id)).shared_to_friends,false);
  assert.equal((await row('select visible_to_paired from reflect_items where reflect_id=$1',[abandoned.saved_reflect_id])).visible_to_paired,false);
});
test('process death does not lose the saved baseline; saved settlements can finish beyond old 24h draft expiry',async()=>{
  const id=await user(), {draft:d}=await begin(id);
  await db.query("update reflect_drafts set expires_at=now()-interval '2 days' where id=$1",[d.id]);
  assert.equal((await complete(id,d.id)).reflect_id,d.saved_reflect_id);
  const legacy = randomUUID();
  await db.query("insert into reflect_drafts(id,user_id,idempotency_key,prompt_id,body,local_date,mode,matches) values($1,$2,$3,9,'old',current_date,'typing','[]')",[legacy,id,randomUUID()]);
  const old=await rpc("select finalize_reflect_draft($1,$2,'[]','[]',30,'2026-W35') result",[id,legacy]);
  assert.ok(old.reflect_id); assert.equal(old.reflects_today,2);
});
test('the model claim is durable and single-use; all 131 selections survive reservation',async()=>{
  const id=await user(), matches=Array.from({length:131},(_,i)=>({itemId:'i'+(i+1)}));
  const {draft:d}=await begin(id,randomUUID(),{matches,mode:'prompt'}, {});
  assert.equal((await row('select count(*)::int n from reflect_items where reflect_id=$1',[d.saved_reflect_id])).n,131);
  const claim=()=>db.query('update reflect_drafts set ai_claimed_at=now() where id=$1 and ai_claimed_at is null and finalized_reflect_id is null returning id',[d.id]);
  const [a,b]=await Promise.all([claim(),claim()]);
  assert.equal(a.rows.length+b.rows.length,1);
  assert.equal((await claim()).rows.length,0);
});
test('My Logs edits win regardless of whether crash recovery completes first or second',async()=>{
  const id=await user();
  for (const recoveryFirst of [true,false]) {
    const {draft:d}=await begin(id);
    if (recoveryFirst) await complete(id,d.id);
    await rpc('select edit_durable_reflect_memories($1,$2,$3::jsonb) result',[id,d.saved_reflect_id,
      JSON.stringify([{itemId:'i1',text:'Latest manual edit',source:'manual',visible:false}])]);
    await complete(id,d.id);
    assert.equal((await row('select description from item_memories where reflect_id=$1',[d.saved_reflect_id])).description,'Latest manual edit');
    assert.equal((await row('select visible_to_paired from reflect_items where reflect_id=$1',[d.saved_reflect_id])).visible_to_paired,false);
  }
});
