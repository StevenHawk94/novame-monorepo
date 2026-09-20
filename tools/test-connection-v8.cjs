const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const content = JSON.parse(read('apps/api/src/data/connection-insight-v8.json'));

test('reviewed workbook compiles completely and expands Same-Vibe pools', () => {
  assert.equal(content.version, 'v8');
  assert.equal(content.templates.length, 357);
  assert.equal(content.betweenMappings.length, 27);
  assert.equal(content.betweenMappings.filter((row) => (
    JSON.stringify(row.poolA) === JSON.stringify(row.poolB)
  )).length, 19);
  assert.doesNotMatch(JSON.stringify(content), /same as Pool A/i);
  assert.equal(content.templates.filter((row) => row.category === 'Between You' && row.waysIn).length, 10);
});

test('all required dynamic sections and Legal Official Matters are present', () => {
  const categories = new Set(content.templates.map((row) => row.category));
  assert.deepEqual([...categories].sort(), [
    'Between You', 'On Their Mind: Us', 'TWL', 'Together Moments', 'WYMM',
  ]);
  assert.ok(content.templates.some((row) => (
    row.group === 'Legal / Official Matters' && row.emotion === 'Negative' && row.category === 'WYMM'
  )));
});

test('pipeline uses three bounded stages and deterministic template copy', () => {
  const copy = read('apps/api/src/lib/reflect-ai.js');
  const pipeline = read('apps/api/src/lib/connection-v8-pipeline.js');
  const matcher = read('apps/api/src/lib/connection-insight-v8.js');
  assert.match(copy, /extractConnectionEvents/);
  assert.match(copy, /WYMM\|TWL\|Together Moments\|On Their Mind: Us/);
  assert.match(pipeline, /runConnectionGroupMatcher/);
  assert.match(pipeline, /runConnectionSubScenarioMatcher/);
  assert.match(matcher, /observation: row\.description/);
  assert.match(matcher, /waysIn: row\.waysIn/);
});

test('database v3 enforces board caps, linked Ways In and append-only History', () => {
  const migration = read('supabase/migrations/20260918000096_connection_insight_v8.sql');
  assert.match(migration, /when 'worth_knowing' then 2 when 'recent_vibe' then 2 else 1/);
  assert.match(migration, /limit 4/);
  assert.match(migration, /parentCardId'=any\(v_allowed_parent_ids\)/);
  assert.match(migration, /insert into public\.connection_card_history/);
  assert.doesNotMatch(migration, /delete from public\.connection_card_history/);
});

test('mobile payload exposes new sections and relative creation time', () => {
  const api = read('apps/mobile/src/lib/friends-api.ts');
  const screen = read('apps/mobile/app/(main)/(tabs)/status.tsx');
  assert.match(api, /schemaVersion: 3/);
  assert.match(api, /together_moments/);
  assert.match(api, /on_their_mind_us/);
  assert.match(screen, /relativeInsightTime\(card\.createdAt\)/);
  assert.match(screen, /card\.waysIn/);
});

test('v8 migration compiles in PostgreSQL and is idempotent', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.role() returns text language sql as 'select ''service_role''::text';
      create table profiles(id uuid primary key);
      create table reflects(id uuid primary key);
      create table reflect_drafts(
        id uuid primary key,user_id uuid,saved_reflect_id uuid,finalized_reflect_id uuid,
        settlement_memories jsonb not null default '[]',ai_memories jsonb not null default '{}',bubble text
      );
      create table connection_card_history(
        id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,for_user uuid,
        source_reflect_id uuid,source_key text,module_key text,card_index smallint,card jsonb,
        for_date date,created_at timestamptz default now(),
        constraint connection_card_history_module_key_check check(module_key in(
          'worth_knowing','recent_vibe','what_theyre_into','how_to_show_up',
          'talk_about','try_together','shared_rhythm')),
        unique(user_a,user_b,for_user,source_key,module_key,card_index)
      );
      create table connection_insights(
        user_a uuid,user_b uuid,for_date date,for_user uuid,payload jsonb,created_at timestamptz,
        unique(user_a,user_b,for_date,for_user)
      );
    `);
    const migration = read('supabase/migrations/20260918000096_connection_insight_v8.sql');
    await db.exec(migration);
    await db.exec(migration);
    const result = await db.query(`
      select exists(select 1 from information_schema.columns
        where table_name='reflect_drafts' and column_name='connection_event_candidates') ok
    `);
    assert.equal(result.rows[0].ok, true);
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const reflect = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into profiles(id) values($1),($2)', [a, b]);
    await db.query('insert into reflects(id) values($1)', [reflect]);
    const cards = [1, 2, 3].map((index) => ({
      contentId: `v8:${reflect}:event_${index}:main`,
      label: 'Test', observation: `Main ${index}`, createdAt: new Date().toISOString(),
    }));
    const ways = cards.map((card, index) => ({
      contentId: `${card.contentId}:ways`, parentCardId: card.contentId,
      label: 'Way', observation: `Way ${index + 1}`, createdAt: new Date().toISOString(),
    }));
    const updates = {
      worth_knowing: { hasUpdate: true, clearExisting: false, cards },
      recent_vibe: { hasUpdate: false, clearExisting: false, cards: [] },
      how_to_show_up: { hasUpdate: true, clearExisting: false, cards: ways },
      shared_rhythm: { hasUpdate: false, clearExisting: false, cards: [] },
      together_moments: { hasUpdate: false, clearExisting: false, cards: [] },
      on_their_mind_us: { hasUpdate: false, clearExisting: false, cards: [] },
    };
    const applied = await db.query(
      'select public.apply_connection_insight_updates_v3($1,$2,$2,$3,$4,$5::jsonb) result',
      [a, b, '2026-09-18', reflect, JSON.stringify(updates)],
    );
    assert.equal(applied.rows[0].result.payload.modules.worth_knowing.length, 2);
    assert.equal(applied.rows[0].result.payload.modules.how_to_show_up.length, 2);
    const history = await db.query('select count(*)::int n from connection_card_history');
    assert.equal(history.rows[0].n, 6);
  } finally {
    await db.close();
  }
});
