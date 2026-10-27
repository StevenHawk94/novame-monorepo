// Real migration/transaction tests in disposable WASM PostgreSQL. No live data.
import fs from 'node:fs';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
export async function securityTestDb({beforeCalendar}={}){
 const h=await personalRoomTestDb(),{db}=h;
 await h.migrate();
 const migration=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
 await db.exec(`
 create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,public boolean);
 create table if not exists storage.objects(bucket_id text,name text);
 alter table storage.objects enable row level security;
 create schema if not exists extensions;
 create type kit_t as enum('test');
 alter table burrow_surprises add column if not exists recipient_id uuid;
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat('ab',n),'hex')$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
 create table auth.users(id uuid primary key,is_anonymous boolean default false,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
 alter table profiles add column if not exists updated_at timestamptz default now();
 create table subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid unique references auth.users on delete cascade,
  plan text default 'free',plan_type text default 'solo',status text default 'active',billing_cycle text default 'monthly',
  current_period_start timestamptz,current_period_end timestamptz,updated_at timestamptz default now(),
  apple_transaction_id text,apple_original_transaction_id text,apple_product_id text,
  google_purchase_token text,google_product_id text,google_base_plan_id text,google_auto_renewing boolean,
  pending_plan text,pending_billing_cycle text,pending_product_id text,pending_base_plan_id text);
 create table duo_memberships(id uuid primary key default gen_random_uuid(),owner_id uuid unique references profiles on delete cascade,
  member_id uuid references profiles on delete set null,invite_code text unique,status text default 'pending',claimed_at timestamptz);
 create table love_note_send_limits(user_id uuid primary key,day_start timestamptz,day_end timestamptz,daily_count integer,minute_sends timestamptz[]);
 alter table storage.buckets add column if not exists file_size_limit bigint;
 alter table storage.buckets add column if not exists allowed_mime_types text[];
 insert into storage.buckets(id,name,public) values('avatars','avatars',true) on conflict do nothing;
 create policy "Users can upload avatars" on storage.objects for insert to authenticated with check(bucket_id='avatars');
 `);
 await db.exec(migration('20260820000052_entitlement_security_and_realtime'));
 await db.exec(migration('20260824000061_iap_store_environment'));
 for(const n of ['20261009000207_burrow_coin_sandbox_wallet','20261009000208_burrow_coin_sandbox_testers',
  '20261009000209_burrow_coin_prospective_testing','20261009000211_burrow_coin_environment_testing'])await db.exec(migration(n));
 await db.exec(`create function burrow_has_plus_v1(p_user uuid) returns boolean language sql as $$select exists(select 1 from profiles where id=p_user and subscription_tier::text<>'free')$$;`);
 const offers=migration('20261015000238_burrow_free_games');
 await db.exec(offers.slice(offers.indexOf('create or replace function public.burrow_service_offer_v1'),offers.indexOf('create or replace function public.burrow_game_unlock_v2')));
 const quota=migration('20261023000263_affection_daily_limits');
 await db.exec(quota.slice(quota.indexOf('create or replace function public.burrow_affection_state_v1'),quota.indexOf('-- Add fields without changing')));
 // Calendar migration audits 28 existing functions. Fill schema-only gaps in
 // the deliberately small fixture from their latest repository definitions;
 // never read/copy production user data or skip an audited migration target.
 const calendarMigration=migration('20261024000272_fixed_economic_calendar');
 const calendarNames=[...calendarMigration.matchAll(/\('([a-z_0-9]+)','(?:p_[a-z_]+|new.author_id)'\)/g)].map(m=>m[1]);
 const sourceFiles=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')&&n<'20261024000269').sort().reverse();
 for(const name of [...calendarNames,'claim_daily_plus_bonus_v1']){
  if((await h.query('select 1 from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1',[name])).length)continue;
  let definition;
  for(const file of sourceFiles){
   const sql=fs.readFileSync('supabase/migrations/'+file,'utf8');
   const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);
   if(!start)continue;
   const tail=sql.slice(start.index),delimiter=/\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
   if(!delimiter)continue;
   const end=tail.indexOf(delimiter[1],delimiter.index+delimiter[0].length);
   definition=tail.slice(0,end+delimiter[1].length)+';';break;
  }
  if(!definition)throw Error('Missing calendar fixture '+name);
  await db.exec(definition);
 }
 // Extra audited deployed readers can be exercised without copying credentials,
 // content or user data. This is a schema-only fixture supplied explicitly.
 if(process.env.BURROW_SECURITY_DEPLOYED_FUNCTIONS){
  const rows=JSON.parse(fs.readFileSync(process.env.BURROW_SECURITY_DEPLOYED_FUNCTIONS)).rows;
  const excluded=new Set(['handle_new_user','broadcast_entitlement_change','burrow_bootstrap_v1']);
  for(const r of rows)if(!excluded.has(r.signature.split('(')[0]))await db.exec(r.definition);
 }
 if(process.env.BURROW_SECURITY_CALENDAR_FUNCTIONS){
  for(const r of JSON.parse(fs.readFileSync(process.env.BURROW_SECURITY_CALENDAR_FUNCTIONS)).rows) {
   const name=r.signature.split('(')[0];if(calendarNames.includes(name))await db.exec(r.definition);
  }
 }
 for(const n of ['20261024000269_security_boundaries','20261024000270_store_subscription_state','20261024000271_economic_domains'])await db.exec(migration(n));
 if(beforeCalendar)await beforeCalendar(h);
 const untouched=await h.query(`select p.oid::text,p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text grants
  from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and not(p.proname=any($1)) order by p.oid`,[calendarNames]);
 await db.exec(calendarMigration);
 const afterCalendar=await h.query(`select p.oid::text,p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text grants
  from pg_proc p where p.oid::text=any($1) order by p.oid`,[untouched.map(r=>r.oid)]);
 h.calendarUntouched={before:untouched,after:afterCalendar};
 return h;
}
