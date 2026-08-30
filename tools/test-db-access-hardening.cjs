const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = process.env.NOVAME_TEST_ROOT || path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828000070_private_business_api.sql'), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth; create schema realtime;
    grant usage on schema public,auth,realtime to anon,authenticated,service_role,supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function realtime.topic() returns text language sql stable as
      'select current_setting(''realtime.topic'',true)';
    create table auth.users(id uuid primary key);
    grant insert on auth.users to supabase_auth_admin;
    create table profiles(id uuid primary key);
    create table subscriptions(user_id uuid primary key);
    create table listens(user_id uuid);
    alter table profiles enable row level security;
    alter table subscriptions enable row level security;
    alter table listens enable row level security;
    create policy own_profile on profiles for select using (id=auth.uid());
    create policy "Anyone can insert listens" on listens for insert with check(true);
    insert into profiles values ('00000000-0000-0000-0000-000000000001');
    create view user_stats as select id from profiles;
    create view leaderboard as select id from profiles;
    create sequence test_sequence;
    grant all on all tables in schema public to anon,authenticated,service_role;
    grant all on all sequences in schema public to anon,authenticated,service_role;
    create function handle_new_user() returns trigger language plpgsql security definer as $$
      begin insert into public.profiles values(new.id); return new; end $$;
    create function handle_new_user_subscription() returns trigger language plpgsql security definer set search_path=public as $$
      begin insert into public.subscriptions values(new.id); return new; end $$;
    create trigger signup_profile after insert on auth.users for each row execute function handle_new_user();
    create trigger signup_subscription after insert on auth.users for each row execute function handle_new_user_subscription();
    create function server_profile_count() returns bigint language sql security definer as 'select count(*) from profiles';
    grant execute on all functions in schema public to anon,authenticated,service_role;
    create table realtime.messages(topic text);
    alter table realtime.messages enable row level security;
    grant select on realtime.messages to authenticated;
    create policy receive_own on realtime.messages for select to authenticated using
      (topic = 'pairing:' || auth.uid()::text and topic=realtime.topic());
    insert into realtime.messages values ('pairing:00000000-0000-0000-0000-000000000001'),('pairing:00000000-0000-0000-0000-000000000002');
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  `);
  await db.exec(migration);
  await db.exec(migration); // SQL-editor retries must be safe.
});
after(async () => { await db?.close(); });

test('anon and authenticated cannot directly read tables/views or insert listens', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of ['profiles','subscriptions','listens','leaderboard','user_stats']) {
        await assert.rejects(db.query(`select * from public.${table}`), e => e.code === '42501');
      }
      await assert.rejects(db.query('insert into listens values(null)'), e => e.code === '42501');
      await assert.rejects(db.query('select server_profile_count()'), e => e.code === '42501');
    } finally { await db.exec('reset role'); }
  }
});
test('service role retains table access and RPC execution', async () => {
  await db.exec('set role service_role');
  try {
    assert.ok(Number((await db.query('select server_profile_count() n')).rows[0].n) >= 1);
    assert.ok((await db.query('select * from user_stats')).rows.length >= 1);
    await db.exec('insert into listens values(null)');
  } finally { await db.exec('reset role'); }
});
test('Auth signup still creates the profile and subscription for the same UUID', async () => {
  const id='00000000-0000-0000-0000-000000000003';
  await db.exec('set role supabase_auth_admin');
  try { await db.query('insert into auth.users values($1)',[id]); }
  finally { await db.exec('reset role'); }
  assert.equal((await db.query('select id from profiles where id=$1',[id])).rows[0].id,id);
  assert.equal((await db.query('select user_id from subscriptions where user_id=$1',[id])).rows[0].user_id,id);
});
test('private Realtime policy still allows only the current user topic', async () => {
  await db.exec(`set role authenticated;
    set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    set "realtime.topic"='pairing:00000000-0000-0000-0000-000000000001';`);
  try { assert.equal((await db.query('select * from realtime.messages')).rows.length,1); }
  finally { await db.exec('reset role'); }
});
test('new objects default to server-only access, including global function defaults', async () => {
  await db.exec(`create table future_table(id int); create sequence future_sequence;
    create function future_function() returns int language sql as 'select 1';`);
  const { rows:[r] } = await db.query(`select
    has_table_privilege('anon','future_table','SELECT') a,
    has_table_privilege('authenticated','future_table','INSERT') b,
    has_sequence_privilege('anon','future_sequence','USAGE') c,
    has_function_privilege('anon','future_function()','EXECUTE') d,
    has_function_privilege('authenticated','future_function()','EXECUTE') e,
    has_table_privilege('service_role','future_table','SELECT') f,
    has_function_privilege('service_role','future_function()','EXECUTE') g`);
  assert.deepEqual(r,{a:false,b:false,c:false,d:false,e:false,f:true,g:true});
});
test('legacy views are invoker-safe and missing function search paths are pinned', async () => {
  const views = (await db.query("select reloptions from pg_class where relname in ('user_stats','leaderboard')")).rows;
  assert.equal(views.length,2);
  for (const v of views) assert.ok(v.reloptions.includes('security_invoker=true'));
  const functions = (await db.query("select proconfig from pg_proc where proname='handle_new_user'")).rows;
  assert.ok(functions[0].proconfig.includes('search_path=public, pg_temp'));
});
