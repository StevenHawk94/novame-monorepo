// Offline contract test for the temporary Adventure timer and atomic care wrappers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(resolve(process.env.BURROW_PGLITE_PATH)).href);
const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const c = '00000000-0000-0000-0000-000000000003';
async function rpc(name, args) {
  const result = await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args);
  return result.rows[0].result;
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb);
    create table public.moment_events(id bigint generated always as identity,actor_id uuid,target_id uuid,
      event_type text,payload jsonb,created_at timestamptz default now(),idempotency_key text);
    create table public.adventures(started_at timestamptz,ends_at timestamptz,duration_seconds integer);
    create function public.lock_burrow_pair(actor uuid) returns uuid language sql as $$
      select case when actor='${a}'::uuid then '${b}'::uuid
        when actor='${b}'::uuid then '${a}'::uuid else null::uuid end $$;
    create function public.interact_room_need_v1(actor uuid,owner uuid,need text,key text) returns jsonb
      language plpgsql as $$ begin
        if exists(select 1 from burrow_command_receipts where actor_id=actor and command_key='refill:'||key)
          then return jsonb_build_object('error',null,'applied',false); end if;
        insert into moment_events(actor_id,target_id,event_type,payload,idempotency_key)
          values(actor,owner,'room_need_refilled',jsonb_build_object('need',need),'room-need:'||key);
        insert into burrow_command_receipts values(actor,'refill:'||key,jsonb_build_object('need',need),
          jsonb_build_object('error',null,'applied',true));
        return jsonb_build_object('error',null,'applied',true);
      end $$;
    create function public.solo_burrow_care_v1(actor uuid,need text,key text) returns jsonb
      language plpgsql as $$ begin
        if exists(select 1 from moment_events where actor_id=actor and idempotency_key='room-need:'||key)
          then return jsonb_build_object('error',null,'applied',false); end if;
        insert into moment_events(actor_id,target_id,event_type,payload,idempotency_key)
          values(actor,actor,'room_need_refilled',jsonb_build_object('need',need),'room-need:'||key);
        return jsonb_build_object('error',null,'applied',true);
      end $$;
  `);
  await db.exec(readFileSync(resolve('supabase/migrations/20261001000153_care_cooldown_and_test_adventure.sql'), 'utf8'));
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, a, 'food', 'one'])).applied, true);
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, a, 'food', 'one'])).applied, false);
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, a, 'food', 'two'])).error, 'care_cooldown');
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, a, 'water', 'three'])).applied, true);
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, c, 'food', 'wrong'])).error, 'not_paired');
  assert.equal((await rpc('solo_burrow_care_with_cooldown_v1', [c, 'water', 'solo-one'])).applied, true);
  assert.equal((await rpc('solo_burrow_care_with_cooldown_v1', [c, 'water', 'solo-two'])).error, 'care_cooldown');
  await db.query("update moment_events set created_at=now()-interval '12 hours 1 second' where actor_id=$1 and payload->>'need'='food'", [a]);
  assert.equal((await rpc('interact_room_need_with_cooldown_v1', [a, a, 'food', 'after-twelve'])).applied, true);
  const start = new Date('2026-10-01T20:00:00Z');
  const result = await db.query('insert into adventures(started_at,ends_at,duration_seconds) values($1,$2,28800) returning *',
    [start, new Date(start.getTime() + 28800_000)]);
  assert.equal(result.rows[0].duration_seconds, 60);
  assert.equal(new Date(result.rows[0].ends_at).getTime() - start.getTime(), 60_000);
  console.log('Care cooldown and one-minute Adventure migration: passed.');
} finally { await db.close(); }
