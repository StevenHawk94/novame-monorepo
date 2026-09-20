const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Quests tab is the requested product-action reward board', () => {
  const screen = read('apps/mobile/app/(main)/(tabs)/quests.tsx');
  const route = read('apps/api/src/app/api/quests/rewards/route.js');
  assert.match(screen, /Daily Quests/);
  assert.match(screen, /Special Quests/);
  assert.doesNotMatch(screen, /Weekly Goal|themesForScope|checkTask/);
  for (const title of [
    'Finish a reflection', 'Finish a case to sync up', 'Send a Good Vibe',
    'Tame your inner enemy', 'Celebrate a small win', 'Check a new perspective',
  ]) assert.match(route, new RegExp(title));
  for (const key of [
    'memory_items', 'cases_finished', 'small_wins', 'tame_enemy',
    'good_vibes', 'scenes_unlocked', 'outfits_unlocked',
  ]) assert.match(route, new RegExp(`key:'${key}'`));
  assert.match(route, /reward:20/);
  assert.match(route, /reward:30/);
  assert.match(route, /progress:nextTarget===null[^\n]+:safeCount/);
});

test('server owns eligibility and atomic claiming stays behind service role', () => {
  const route = read('apps/api/src/app/api/quests/rewards/route.js');
  const migration = read('supabase/migrations/20260919000097_quest_rewards_v2.sql');
  assert.match(route, /get_quest_activity_counts_v2/);
  assert.match(route, /claim_quest_rewards_v2/);
  assert.match(route, /verified\.id!==userId/);
  assert.match(migration, /unique\(user_id, claim_key\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /on conflict\(user_id,claim_key\) do nothing/);
  assert.match(migration, /grant execute on function public\.claim_quest_rewards_v2[^;]+to service_role/s);
  assert.doesNotMatch(migration, /grant execute on function public\.claim_quest_rewards_v2[^;]+authenticated/s);
});

test('Quests v2 migration compiles twice and never pays the same claim twice', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create type xp_source as enum ('quest');
      create type kit_t as enum ('quiet_wins','tame_enemy','new_lens');
      create table profiles(id uuid primary key,timezone_name text);
      create table companions(user_id uuid primary key references profiles(id),xp bigint default 0,
        clovers_spent integer default 0,last_opened_at timestamptz);
      create table xp_events(id uuid primary key,user_id uuid,source xp_source,amount integer,
        ref_id uuid,local_date date,iso_week text,created_at timestamptz default now(),
        unique(user_id,source,ref_id));
      create table reflects(id uuid primary key,user_id uuid,local_date date);
      create table court_sessions(id uuid primary key,pair_low uuid,pair_high uuid,status text,completed_at timestamptz);
      create table good_vibes(id uuid primary key,sender_user_id uuid,sender_local_date date);
      create table kit_completions(id uuid primary key,user_id uuid,kit kit_t,local_date date);
      create table item_memories(id uuid primary key,user_id uuid);
      create table cosmetic_unlocks(id uuid primary key,user_id uuid,cosmetic_type text);
    `);
    const migration = read('supabase/migrations/20260919000097_quest_rewards_v2.sql');
    await db.exec(migration);
    await db.exec(migration);
    const user = '00000000-0000-4000-8000-000000000001';
    await db.query("insert into profiles(id,timezone_name) values($1,'America/Los_Angeles')", [user]);
    await db.query('insert into companions(user_id) values($1)', [user]);
    await db.query("insert into reflects(id,user_id,local_date) values(gen_random_uuid(),$1,'2026-09-19')", [user]);
    for (let i = 0; i < 20; i++) {
      await db.query('insert into item_memories(id,user_id) values(gen_random_uuid(),$1)', [user]);
    }
    const counts = await db.query(
      "select public.get_quest_activity_counts_v2($1,'2026-09-19') result", [user],
    );
    assert.equal(counts.rows[0].result.daily.reflection, true);
    assert.equal(counts.rows[0].result.totals.memory_items, 20);
    const claims = JSON.stringify([
      { kind: 'daily', claimKey: '2026-09-19:reflection', questKey: 'reflection' },
      { kind: 'special', claimKey: 'memory_items:1', questKey: 'memory_items', milestone: 1 },
    ]);
    const first = await db.query(
      "select public.claim_quest_rewards_v2($1,$2::jsonb,'2026-09-19','2026-W38') result",
      [user, claims],
    );
    const second = await db.query(
      "select public.claim_quest_rewards_v2($1,$2::jsonb,'2026-09-19','2026-W38') result",
      [user, claims],
    );
    assert.equal(first.rows[0].result.clovers_earned, 50);
    assert.equal(second.rows[0].result.clovers_earned, 0);
    const totals = await db.query('select count(*)::int claims,(select xp from companions where user_id=$1)::int xp from quest_reward_claims where user_id=$1', [user]);
    assert.deepEqual(totals.rows[0], { claims: 2, xp: 50 });
  } finally {
    await db.close();
  }
});
