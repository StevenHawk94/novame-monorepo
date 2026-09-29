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
    create table profiles(id uuid primary key,subscription_tier text default 'free', ai_consent_at timestamptz, timezone_name text default 'UTC');
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
    create table reflect_ai_analyses(reflect_id uuid primary key references reflects(id),user_id uuid,local_date date,
      prompt_version text,weekly_eligible boolean,weekly_evidence jsonb,visual_concepts jsonb,connection_signals jsonb,
      connection_eligible boolean,connection_updates jsonb,connection_mode text,provider text,model text,usage jsonb,
      status text,created_at timestamptz default now(),completed_at timestamptz,error text);
    create table reflect_drafts(id uuid primary key default gen_random_uuid(),user_id uuid,idempotency_key text,prompt_id smallint,
      body text,local_date date,mode text,source_kit text,friend_user_id uuid,matches jsonb default '[]',ai_memories jsonb default '{}',
      bubble text,finalized_reflect_id uuid,created_at timestamptz default now(),expires_at timestamptz default now()+interval '24 hours',
      unique(user_id,idempotency_key));
    insert into items select 'i'||n from generate_series(1,200) n;
  `);
  const submit = read('20260723000027_pairing_reflect_modes.sql');
  await db.exec(submit.slice(submit.indexOf('create or replace function public.submit_reflect(')));
  const old = read('20260823000059_reflect_memories_v2.sql');
  await db.exec(old.slice(old.indexOf('create or replace function public.finalize_reflect_draft('),
    old.indexOf('create or replace function public.broadcast_reflect_feed_change(')));
  const migration = read('20260827000068_reflect_durable_settlement.sql');
  await db.exec(migration);
  await db.exec(migration); // safe SQL-editor retry
  const oursOnly = read('20260905000076_ours_only_and_tame_daily_limit.sql');
  await db.exec(oursOnly.slice(0, oursOnly.indexOf('-- Every account may tame')));
  const connectionTemplates = read('20260910000080_connection_templates_and_journal_slots.sql');
  await db.exec(connectionTemplates);
  await db.exec(connectionTemplates); // legacy fixture
  const files = fs.readdirSync(path.join(root, 'supabase/migrations'));
  await db.exec(read(files.find(n => n.includes('00086_'))));
  await db.exec(`create table app_config(key text primary key,value text);
    insert into app_config values('app_major_update_enabled','true');
    create table adventures(id uuid primary key default gen_random_uuid(),user_id uuid,local_date date);
  `);
  const foundation = read('20260920000116_app_major_update_foundation.sql');
  await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),
    foundation.indexOf('create table public.burrow_command_receipts')));
  const records = read('20260920000122_burrow_records_memories_and_special_quests.sql');
  await db.exec(records.slice(records.indexOf('create or replace function public.validate_burrow_record_insert'),
    records.indexOf('create or replace function public.burrow_special_quests_v1')));
  await db.exec(read('20260920000131_burrow_record_policy.sql'));
  await db.exec(read('20260920000131_burrow_record_policy.sql'));
  await db.exec(`create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,event_type text,reference_type text,reference_id text,visibility text default 'pair',payload jsonb default '{}',created_at timestamptz default now());
    create function broadcast_burrow_change() returns trigger language plpgsql as $$ begin return null; end $$;
    create table memory_room_entries(id uuid,author_id uuid,pair_low uuid,pair_high uuid,body text,prompt_id text,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    create table memory_entry_photos(id uuid,entry_id uuid,slot int,updated_at timestamptz);
  `);
  await db.exec(read('20260920000138_burrow_record_sharing.sql'));
  const pairVersion=read('20260920000137_burrow_pair_generation.sql');
  await db.exec(pairVersion.slice(0,pairVersion.indexOf('alter function public.burrow_bootstrap_v1')));
  await db.exec(`create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,primary key(actor_id,command_key));
    create table friendships(user_a uuid,user_b uuid,status text);
    create table bubble_pops(id uuid default gen_random_uuid(),user_id uuid,friend_user_id uuid,item_id text,local_date date,unique(user_id,friend_user_id,item_id,local_date));`);
  await db.exec(read('20260920000140_burrow_sharing_conflicts.sql'));
  const economy=read('20260722000023_p1_economy.sql');
  await db.exec(economy.slice(economy.indexOf('create or replace function public.pop_bubble('),economy.indexOf('grant execute on function public.pop_bubble(')));
  await db.exec(read('20260920000141_burrow_retired_bubble.sql'));
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

async function pair() {
  const a=await user(),b=await user();
  await db.query('insert into pairings values($1,$2),($2,$1)',[a,b]); return [a,b];
}
async function policy(id) { return rpc('select burrow_record_policy_v1($1) result',[id]); }
async function claim(id,r) { return rpc('select claim_reflect_ai_enhancement($1,$2) result',[id,r]); }
test('Free can save both kinds repeatedly before adventure without XP or AI',async()=>{
  const [id]=await pair();
  for(let i=0;i<5;i++){
    const {draft:d}=await begin(id,randomUUID(),{mode:i%2?'prompt':'typing'});
    assert.ok(d.saved_reflect_id); assert.equal(d.save_receipt.xp_awarded,0);
    assert.equal(d.save_receipt.reflects_remaining,null);
    assert.equal((await claim(id,d.saved_reflect_id)).eligible,false);
  }
  assert.equal((await policy(id)).reflectsToday,5);
  assert.equal((await policy(id)).canRecord,true);
  assert.equal((await row('select count(*)::int n from daily_journal_slots where user_id=$1',[id])).n,0);
});
test('Adventure blocks new saves, never successful-key replay or pending settlement',async()=>{
  const [id]=await pair(),key=randomUUID(), {draft:d}=await begin(id,key);
  await db.query('insert into adventures(user_id,local_date) values($1,burrow_record_date_v1($1))',[id]);
  assert.equal((await policy(id)).reason,'daily_adventure_used');
  await assert.rejects(begin(id),/daily_adventure_used/);
  assert.equal((await begin(id,key)).draft.saved_reflect_id,d.saved_reflect_id);
  assert.equal((await complete(id,d.id)).error,null);
});
test('server profile date replaces stale or forged client date; yesterday adventure does not block',async()=>{
  const [id]=await pair();
  await db.query("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[id]);
  await db.query("insert into adventures(user_id,local_date) values($1,burrow_record_date_v1($1)-1)",[id]);
  const {draft:d}=await begin(id,randomUUID(),{local_date:'2000-01-01'});
  assert.equal(d.local_date,(await policy(id)).localDate);
});
test('shared Plus requires personal AI consent, valid text, and has no two-credit cap',async()=>{
  const [id,b]=await pair();
  await db.query("update profiles set subscription_tier='plus' where id=$1",[b]);
  let {draft:d}=await begin(id);
  assert.equal((await claim(id,d.saved_reflect_id)).eligible,false);
  await db.query("update profiles set ai_consent_at=now() where id=$1",[id]);
  for(let i=0;i<4;i++){
    ({draft:d}=await begin(id));
    assert.equal((await claim(id,d.saved_reflect_id)).eligible,true);
    assert.equal((await claim(id,d.saved_reflect_id)).plus_ai_remaining,null);
  }
  const empty=await begin(id,randomUUID(),{body:'',mode:'prompt'});
  assert.equal((await claim(id,empty.draft.saved_reflect_id)).eligible,false);
  await db.query("update profiles set subscription_tier='free' where id=$1",[b]);
  assert.equal((await claim(id,d.saved_reflect_id)).eligible,false);
});
test('unpair removes permission and AI but preserves a saved retry receipt',async()=>{
  const [id,b]=await pair(),key=randomUUID(),{draft:d}=await begin(id,key);
  await db.query('delete from pairings where user_id in ($1,$2)',[id,b]);
  assert.equal((await policy(id)).reason,'not_paired');
  assert.equal((await begin(id)).error,'not_paired');
  assert.equal((await begin(id,key)).draft.saved_reflect_id,d.saved_reflect_id);
  assert.equal((await claim(id,d.saved_reflect_id)).eligible,false);
});
test('Remember Together is rejected before it can insert a record',async()=>{
  const [id,b]=await pair();
  assert.equal((await begin(id,randomUUID(),{journal_kind:'remember_together'})).error,'journal_kind_disabled');
  assert.equal((await begin(id,randomUUID(),{friend_user_id:b})).error,'journal_kind_disabled');
  assert.equal((await policy(id)).reflectsToday,0);
});
test('rollout off preserves legacy Free kind slot and Plus two-credit policy',async()=>{
  await db.exec("update app_config set value='false'");
  try {
    const [id]=await pair();
    await begin(id);
    assert.equal((await begin(id)).error,'journal_kind_used');
    await db.query("update profiles set subscription_tier='plus',ai_consent_at=now() where id=$1",[id]);
    for(let i=0;i<3;i++){
      const {draft:d}=await begin(id); assert.equal((await claim(id,d.saved_reflect_id)).eligible,i<2);
    }
  } finally { await db.exec("update app_config set value='true'"); }
});
test('policy and write RPCs are service-only',async()=>{
  for(const fn of ['burrow_record_policy_v1(uuid)','begin_saved_reflect(uuid,jsonb,jsonb,integer,text)',
    'claim_reflect_ai_enhancement(uuid,uuid)']){
    const r=await row("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn]);
    assert.equal(r.allowed,false);
  }
});

async function history(viewer,partner){return rpc("select burrow_history_v1($1,$2,'moments') result",[viewer,partner]);}
async function moment(author,partner,record){await db.query("insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$1,'adventure_record_saved','reflect',$3)",[author,partner,record]);}
async function sharing(author,record,shared,expected=null,key=randomUUID(),generation=null){
  const partner=(await row('select partner_user_id from pairings where user_id=$1',[author]))?.partner_user_id;
  const version=expected??(await row('select version from burrow_record_sharing where record_id=$1',[record]))?.version;
  const pairVersion=generation??await rpc('select burrow_pair_version_v1($1,$2) result',[author,partner]);
  return rpc('select set_burrow_record_sharing_v2($1,$2,$3,$4,$5,$6,$7) result',[author,partner,pairVersion,record,shared,version,key]);
}
test('new diary defaults shared; original text and visible memories appear only to the bound pair',async()=>{
  const [a,b]=await pair(),[c,d]=await pair();const {draft:r}=await begin(a);
  await complete(a,r.id,[{itemId:'i1',text:'Soup memory',source:'manual',visible:true,edited:true}],2);
  await moment(a,b,r.saved_reflect_id);
  const projection=(await history(b,a)).rows[0].record;
  assert.equal(projection.body,'Made soup.');assert.equal(projection.shared,true);
  assert.equal(projection.items[0].memory,'Soup memory');
  assert.equal((await row('select shared_to_friends,shared_with_user_id from reflects where id=$1',[r.saved_reflect_id])).shared_to_friends,false);
  assert.equal((await history(c,d)).rows.length,0);
  assert.equal((await sharing(b,r.saved_reflect_id,false)).error,'not_found');
  assert.equal((await sharing(a,r.saved_reflect_id,false)).error,null);
  assert.equal((await history(b,a)).rows.length,0);
  assert.equal((await history(a,b)).rows[0].record.body,'Made soup.');
  await sharing(a,r.saved_reflect_id,true);assert.equal((await history(b,a)).rows[0].record.body,'Made soup.');
  await db.query('delete from pairings where user_id in ($1,$2)',[a,b]);
  assert.equal((await history(b,a)).error,'not_paired');
});
test('explicit private save never enters partner feed and replay cannot change privacy',async()=>{
  const [a,b]=await pair(),key=randomUUID();const {draft:r}=await begin(a,key,{share_to_partner:false});
  await complete(a,r.id);await moment(a,b,r.saved_reflect_id);
  await begin(a,key,{share_to_partner:true});
  assert.equal((await history(b,a)).rows.length,0);
  assert.equal((await history(a,b)).rows[0].record.shared,false);
});
test('legacy saved-key retry does not retroactively share original text',async()=>{
  const [a,b]=await pair();const key=randomUUID();
  await db.exec("update app_config set value='false'");let r;
  try {r=(await begin(a,key)).draft;} finally {await db.exec("update app_config set value='true'");}
  await begin(a,key);await moment(a,b,r.saved_reflect_id);
  assert.equal((await history(b,a)).rows[0].record,null);
});
test('privacy conflicts reject stale writers and successful replay never reopens a withdrawn diary',async()=>{
  const [a,b]=await pair(),{draft:d}=await begin(a),r=d.saved_reflect_id;
  await complete(a,d.id);await moment(a,b,r);
  assert.equal((await history(a,b)).rows[0].record.version,0);
  await sharing(a,r,false,0);
  const key=randomUUID();assert.equal((await sharing(a,r,true,1,key)).version,2);
  assert.equal((await sharing(a,r,false,2)).version,3);
  assert.equal((await sharing(a,r,true,1)).error,'sharing_conflict');
  assert.equal((await sharing(a,r,true,1,key)).version,2); // return receipt, not a new write
  assert.equal((await history(b,a)).rows.length,0);
  assert.equal((await history(a,b)).rows[0].record.version,3);
  assert.equal((await sharing(a,r,false,1,key)).error,'idempotency_conflict');
  assert.equal((await rpc('select set_burrow_record_sharing_v1($1,$2,true) result',[a,r])).error,'client_upgrade_required');
});
test('same-partner reconnection rejects old privacy request generation',async()=>{
  const [a,b]=await pair(),{draft:d}=await begin(a);
  const version=await rpc('select burrow_pair_version_v1($1,$2) result',[a,b]);
  await db.query('delete from pairings where user_id=$1',[a]);await db.query('insert into pairings values($1,$2)',[a,b]);
  assert.equal((await sharing(a,d.saved_reflect_id,false,0,randomUUID(),version)).error,'pair_changed');
});
test('retired bubbles cannot pay in Burrow mode but legacy mode preserves reward and replay limits',async()=>{
  const [a,b]=await pair();await db.query("insert into friendships values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),'accepted')",[a,b]);
  const pop=()=>rpc("select pop_bubble($1,$2,'i1',current_date,'2026-W39',5,3) result",[a,b]);
  assert.equal((await pop()).error,'feature_retired');
  assert.equal((await row('select count(*)::int n from xp_events where user_id=$1',[a])).n,0);
  await db.exec("update app_config set value='false'");
  try {assert.equal((await pop()).xp_awarded,5);assert.equal((await pop()).error,'already_popped');}
  finally {await db.exec("update app_config set value='true'");}
  for(const fn of ['pop_bubble(uuid,uuid,text,date,text,integer,integer)','pop_bubble_pre_burrow_v1(uuid,uuid,text,date,text,integer,integer)',
    'set_burrow_record_sharing_v2(uuid,uuid,text,uuid,boolean,bigint,text)','burrow_shared_record_pre_version_v1(uuid,text,uuid,uuid)'])
    assert.equal((await row("select has_function_privilege('authenticated',$1,'EXECUTE') ok",[fn])).ok,false);
});
