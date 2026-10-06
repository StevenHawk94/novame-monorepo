/* Real migration SQL in an isolated engine; never contacts Supabase.
 * PGLITE_MODULE=/tmp/.../node_modules/@electric-sql/pglite node --test tools/test-burrow-reliability-database.cjs
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const sql = name => readFileSync(resolve('supabase/migrations', name), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
let db;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const rpc = async (name, args) => (await query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))[0].result;
const pair = async () => query('insert into pairings values($1,$2),($2,$1)', [A, B]);
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,timezone_name text default 'UTC');
    create table pairings(user_id uuid primary key references profiles,partner_user_id uuid references profiles);
    create table app_config(key text primary key,value text);
    insert into app_config values('app_major_update_enabled','true');
    create table reflects(id uuid primary key,user_id uuid,body text,shared_to_friends boolean,shared_with_user_id uuid);
    create table reflect_items(reflect_id uuid,user_id uuid,item_id text,match_label text,visible_to_paired boolean);
    create table reflect_drafts(user_id uuid,idempotency_key text,saved_reflect_id uuid,finalized_reflect_id uuid);
    create table item_memories(id uuid,user_id uuid,reflect_id uuid,item_id text,description text,created_at timestamptz);
    create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,
      event_type text,reference_type text,reference_id text,visibility text default 'pair',payload jsonb default '{}',
      created_at timestamptz default now(),idempotency_key text,unique(actor_id,idempotency_key));
    create table memory_room_entries(id uuid primary key,author_id uuid,pair_low uuid,pair_high uuid,body text,prompt_id text,
      created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
    create table memory_entry_photos(id uuid,entry_id uuid,slot int,updated_at timestamptz);
    create function broadcast_burrow_change() returns trigger language plpgsql as $$ begin return null; end $$;
    -- The sharing migration wraps this unrelated settlement function. Its
    -- implementation is not exercised by this focused history/journal test.
    create function begin_saved_reflect(uuid,jsonb,jsonb,integer,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);
  const foundation = sql('20260920000116_app_major_update_foundation.sql');
  await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'), foundation.indexOf('create table public.burrow_command_receipts')));
  const generation = sql('20260920000137_burrow_pair_generation.sql');
  await db.exec(generation.slice(0, generation.indexOf('alter function public.burrow_bootstrap_v1')));
  await db.exec(sql('20260920000138_burrow_record_sharing.sql'));
  await db.exec(sql('20261001000151_couple_journal.sql'));
  await db.exec(sql('20261001000152_couple_journal_solo.sql'));
  await db.exec(sql('20261005000201_burrow_solo_history.sql'));
  await db.exec(sql('20261005000201_burrow_solo_history.sql')); // safe SQL-editor retry
  await query('insert into profiles(id) values($1),($2)', [A, B]);
});
after(async () => { await db?.close(); });

test('solo history paginates without overlap, filters dates, and resolves only owner records', async () => {
  const record = randomUUID();
  await query('insert into reflects values($1,$2,$3,false,null)', [record, A, 'A private day']);
  for (let n = 0; n < 65; n++) await query(`insert into moment_events(pair_low,pair_high,actor_id,event_type,created_at,reference_type,reference_id)
    values($1,$1,$1,'record_created',now()-($2::int*interval '1 minute'),'reflect',$3)`, [A, n, record]);
  const first = await rpc('solo_burrow_history_v1', [A, 'moments', null, null, null]);
  assert.equal(first.rows.length, 30); assert.equal(first.hasMore, true);
  assert.equal(first.rows[0].record.body, 'A private day');
  const second = await rpc('solo_burrow_history_v1', [A, 'moments', first.next.at, first.next.id, null]);
  const third = await rpc('solo_burrow_history_v1', [A, 'moments', second.next.at, second.next.id, null]);
  assert.equal(second.rows.length, 30); assert.equal(third.rows.length, 5); assert.equal(third.hasMore, false);
  assert.equal(new Set([...first.rows, ...second.rows, ...third.rows].map(row => row.id)).size, 65);
  assert.deepEqual((await rpc('solo_burrow_history_v1', [A, 'moments', null, null, '2000-01-01'])).rows, []);
  assert.equal((await rpc('burrow_moment_detail_v1', [B, first.rows[0].id])).error, 'not_found');
  assert.equal((await rpc('burrow_moment_detail_v1', [A, first.rows[0].id])).record.body, 'A private day');
});

test('journal completion emits once; replay and edit do not add Moments; solo history remains private after pairing', async () => {
  const today = (await rpc('couple_journal_snapshot_v1', [A, null])).today;
  assert.equal(today.answers.length, 0);
  const key = randomUUID();
  const saved = await rpc('save_couple_journal_answer_v1', [A, today.id, 'Our small memory', null, key]);
  assert.equal(saved.page.answers[0].body, 'Our small memory');
  await rpc('save_couple_journal_answer_v1', [A, today.id, 'Our small memory', null, key]);
  const edited = await rpc('save_couple_journal_answer_v1', [A, today.id, 'An edited memory', saved.page.answers[0].updatedAt, randomUUID()]);
  assert.equal(edited.page.answers[0].body, 'An edited memory');
  const events = await query('select id from moment_events where reference_id=$1', [today.id]);
  assert.equal(events.length, 1);
  await pair();
  assert.equal((await rpc('solo_burrow_history_v1', [A, 'moments', null, null, null])).error, 'pair_changed');
  assert.equal((await rpc('read_couple_journal_page_v1', [A, today.id])).page.answers[0].body, 'An edited memory');
  assert.equal((await rpc('read_couple_journal_page_v1', [B, today.id])).error, 'pair_changed');
  assert.equal((await rpc('burrow_moment_detail_v1', [B, events[0].id])).error, 'not_found');
  assert.equal((await rpc('burrow_moment_detail_v1', [A, events[0].id])).page.id, today.id);
});

test('current partners can open exact journal pages; reconnecting cannot expose a previous generation', async () => {
  const today = (await rpc('couple_journal_snapshot_v1', [A, null])).today;
  await rpc('save_couple_journal_answer_v1', [A, today.id, 'Together', null, randomUUID()]);
  assert.equal((await rpc('read_couple_journal_page_v1', [B, today.id])).page.answers.length, 1);
  const event = (await query('select id from moment_events where reference_id=$1', [today.id]))[0];
  assert.equal((await rpc('burrow_moment_detail_v1', [B, event.id])).page.id, today.id);
  await db.exec('delete from pairings'); await pair();
  assert.equal((await rpc('read_couple_journal_page_v1', [B, today.id])).error, 'pair_changed');
  assert.equal((await rpc('burrow_moment_detail_v1', [B, event.id])).error, 'pair_changed');
});

test('letter details show the exact saved body and respect deletion; RPCs are service-only', async () => {
  const letter = randomUUID();
  await query(`insert into memory_room_entries(id,author_id,pair_low,pair_high,body) values($1,$2,$2,$3,'💌 A real letter')`, [letter, A, B]);
  const event = (await query(`insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id)
    values($1,$2,$1,'memory_created','memory_room_entry',$3) returning id`, [A, B, letter]))[0];
  assert.equal((await rpc('burrow_moment_detail_v1', [B, event.id])).memory.body, '💌 A real letter');
  await query('update memory_room_entries set deleted_at=now() where id=$1', [letter]);
  assert.equal((await rpc('burrow_moment_detail_v1', [B, event.id])).error, 'not_found');
  for (const name of ['burrow_moment_detail_v1(uuid,uuid)', 'read_couple_journal_page_v1(uuid,uuid)', 'solo_burrow_history_v1(uuid,text,timestamptz,uuid,date)']) {
    assert.equal((await query('select has_function_privilege($1,$2,$3) ok', ['authenticated', name, 'execute']))[0].ok, false);
    assert.equal((await query('select has_function_privilege($1,$2,$3) ok', ['service_role', name, 'execute']))[0].ok, true);
  }
});
