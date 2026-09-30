/** Isolated offline Game Room SQL integration test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testGameRoom } from './test-burrow-game-room-database.mjs';
import { testSoloBurrow } from './test-burrow-solo-database.mjs';
import { seedLegacyRoomPhotos } from './test-burrow-room-photo-cleanup-database.mjs';
import { scoreGameRoomRound } from '../apps/api/src/lib/burrow-game-room.mjs';

const runtime=process.env.BURROW_PGLITE_PATH;
if(!runtime)throw new Error('Set BURROW_PGLITE_PATH to an isolated PGlite install.');
const {PGlite}=await import(pathToFileURL(resolve(runtime)).href);
const db=new PGlite();
let assertions=0;
const check=(condition,message)=>{assert.ok(condition,message);assertions++;};
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
async function rpc(name,args) {
  return (await query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
}
try {
  const catalog=JSON.parse(readFileSync(resolve('apps/api/src/data/burrow-game-room-v1.json'),'utf8'));
  check(catalog.categories.length===7 && catalog.games.length===70,'catalog has seven categories and 70 games');
  check(new Set(catalog.games.map(game=>game.id)).size===70,'every game ID is unique');
  for(const category of catalog.categories)check(catalog.games.filter(game=>game.category===category).length===10,`${category} has ten games`);
  check(catalog.games.every(game=>game.questions.length===6 && game.questions.every(q=>q.self && q.partner && q.options.length===4 && q.options.every(Boolean))),'all 420 questions have four choices');
  const sample={completedAt:'now',ownAnswers:[0,0,0,0,0,0],partnerOwnAnswers:[1,1,1,1,1,1],guesses:[1,1,1,0,0,0],partnerGuesses:[0,0,0,0,0,0]};
  check(scoreGameRoomRound(sample).outcome==='lose','lower score loses');
  check(scoreGameRoomRound({...sample,guesses:[1,1,1,1,1,1]}).outcome==='tie','equal score draws');
  check(scoreGameRoomRound({...sample,partnerGuesses:[0,0,0,1,1,1],guesses:[1,1,1,1,1,1]}).outcome==='win','higher score wins');
  check(scoreGameRoomRound({...sample,completedAt:null})===null,'scores unavailable before both finish');
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema realtime;
    create table public.test_broadcasts(payload jsonb,event text,topic text,private boolean);
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as
      $$ insert into public.test_broadcasts values(payload,event,topic,private) $$;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic',true) $$;
    create table realtime.messages(id int);
    alter table realtime.messages enable row level security;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create table profiles(id uuid primary key,subscription_tier text default 'free',timezone_name text default 'UTC',display_name text,avatar_url text);
    create table pairings(user_id uuid primary key references profiles,partner_user_id uuid references profiles);
    create table notification_outbox(recipient_user_id uuid not null,event_key text not null,event_type text not null default 'partner_reflect',payload jsonb not null default '{}',primary key(recipient_user_id,event_key));
    create table app_config(key text primary key,value text,updated_by text,updated_at timestamptz default now());
    create table reflects(id uuid primary key,user_id uuid references profiles,journal_kind text,body text default '',local_date date default current_date);
    create table reflect_drafts(id uuid primary key default gen_random_uuid(),user_id uuid references profiles,finalized_reflect_id uuid references reflects);
    create table items(id text primary key,category text not null);
    create table reflect_items(reflect_id uuid references reflects,user_id uuid references profiles,item_id text references items);
    create table kit_completions(id uuid primary key default gen_random_uuid(),user_id uuid references profiles,kit text,period_key text,payload jsonb default '{}',local_date date,created_at timestamptz default now(),unique(user_id,kit,period_key));
    create table monster_battle_progress(user_id uuid references profiles,monster_id text,points bigint default 0,milestones_paid int default 0,updated_at timestamptz default now(),primary key(user_id,monster_id));
  `);
  for(const suffix of ['116_app_major_update_foundation','117_app_major_update_interactions','118_app_major_update_placeholder_content',
    '119_app_major_update_commands','120_app_major_update_rewards_and_shop','121_burrow_interactive_screens',
    '122_burrow_records_memories_and_special_quests','123_burrow_room_activity','124_burrow_rage_rewards',
    '125_burrow_personalization','126_burrow_adventure_content','127_burrow_character_state',
    '128_burrow_memory_photos','129_burrow_sync_and_memory_outbox','130_burrow_room_photo_cleanup',
    '132_burrow_history','133_burrow_content_editor','134_burrow_accessible_affection',
    '135_burrow_photo_pair_binding','136_burrow_pair_adventure_lifecycle','137_burrow_pair_generation',
    '139_burrow_coin_purchases','142_burrow_game_room',
    '143_burrow_webp_catalog','144_burrow_release_quests',
    '145_burrow_room_decoration_moments','146_burrow_illustrated_friends',
    '147_burrow_solo_core','148_burrow_solo_adventure','149_burrow_solo_photos',
    '150_burrow_solo_memory_photos','151_burrow_solo_diary','152_burrow_solo_plus_diary']) {
    if(suffix.startsWith('130_'))await seedLegacyRoomPhotos({db,rpc});
    await db.exec(readFileSync(resolve(`supabase/migrations/20260920000${suffix}.sql`),'utf8'));
  }
  // The isolated game harness omits the older journal-policy migration; only
  // its date helper is needed to exercise the new solo policy here.
  await db.exec(`create function public.burrow_record_date_v1(p_user_id uuid) returns date
    language sql stable as $$ select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date
      from profiles where id=p_user_id $$`);
  await db.exec(`alter table reflect_drafts add column saved_reflect_id uuid references reflects;
    alter table reflect_drafts add column created_at timestamptz default now()`);
  await testGameRoom({db,query,rpc,check});
  await testSoloBurrow({db,query,rpc,check});
  console.log(`Game Room and Solo Burrow PostgreSQL integration: ${assertions} assertions passed.`);
} catch(error) {
  console.error(`Game Room PostgreSQL integration failed after ${assertions} assertions: ${error.message}`);
  process.exitCode=1;
} finally { await db.close(); }
