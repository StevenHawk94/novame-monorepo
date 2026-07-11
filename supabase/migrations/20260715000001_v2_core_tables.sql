-- ⚠ EXECUTION NOTE (Supabase SQL editor): run this file in TWO passes, not one.
-- The editor mis-splits a file that mixes plain DDL with a `do $$ ... $$` block
-- on the $$ delimiter, silently skipping the CREATE TABLEs while reporting
-- success. Pass 1: everything down to the "-- ---- RLS" divider. Pass 2: from
-- the `alter table ... enable row level security` line to EOF. Verified live:
-- 6 tables, 12 policies.
--
-- v2.0 core tables (schema doc §1.3-1.5). Additive only: five new columns on
-- profiles, six new tables. No v1 column, table, or type is touched -- the
-- profiles slimming and all destructive ETL wait for C12.
--
-- RLS on every table: authenticated may SELECT only its own rows; every write
-- goes through a service_role RPC (schema doc §3.2 -- all multi-table writes
-- through Postgres functions). xp/gem/companion rows ARE the economy; letting a
-- client write them directly is letting a client mint XP. The RPCs and the
-- ledger->summary triggers arrive in C2 with Reflect, their first writer.

-- ---- profiles: five additive columns ----------------------------------------
-- ai_consent_at already exists (skipped). onboarding_completed and
-- has_completed_onboarding are v1 booleans; the v2 flow needs a timestamp, so
-- these are new columns rather than a reuse. Nothing here drops a v1 column.
alter table public.profiles
  add column if not exists friend_code               text,
  add column if not exists companion_id              companion_t,
  add column if not exists active_scene_id           text default 'scene_01',
  add column if not exists onboarding_completed_at    timestamptz,
  add column if not exists first_steps_completed_at   timestamptz;

-- Unique when present. Partial index tolerates the existing rows whose
-- friend_code stays NULL until v2 onboarding backfills them.
create unique index if not exists profiles_friend_code_key
  on public.profiles(friend_code) where friend_code is not null;

-- ---- companions -------------------------------------------------------------
create table if not exists public.companions (
  user_id        uuid primary key references public.profiles on delete cascade,
  companion_id   companion_t not null,
  name           text,
  stage          stage_t not null default 'juvenile',
  xp             bigint not null default 0,
  active_skin    text not null default 'none',
  last_opened_at timestamptz,
  awakened_on    date,
  created_at     timestamptz default now()
);

create table if not exists public.companion_skins (
  user_id     uuid not null references public.profiles on delete cascade,
  skin_id     text not null,
  unlocked_at timestamptz default now(),
  source      text not null,
  primary key (user_id, skin_id)
);

-- ---- xp / gems (ledger, not counters) ---------------------------------------
create table if not exists public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  source     xp_source not null,
  amount     int not null,
  ref_id     uuid,
  local_date date not null,
  iso_week   text not null,
  created_at timestamptz default now()
);
create unique index if not exists xp_dedup
  on public.xp_events(user_id, source, ref_id) where ref_id is not null;
create index if not exists xp_daily  on public.xp_events(user_id, source, local_date);
create index if not exists xp_weekly on public.xp_events(user_id, source, iso_week);

create table if not exists public.gem_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  dimension  dimension_t not null,
  amount     int not null,
  source     gem_source not null,
  ref_id     uuid,
  local_date date not null,
  created_at timestamptz default now()
);
create index if not exists gem_daily_dim
  on public.gem_events(user_id, dimension, local_date);

create table if not exists public.user_gems (
  user_id   uuid not null references public.profiles on delete cascade,
  dimension dimension_t not null,
  total     bigint not null default 0,
  primary key (user_id, dimension)
);

-- ---- reflects ---------------------------------------------------------------
create table if not exists public.reflects (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles on delete cascade,
  prompt_id         smallint not null check (prompt_id between 1 and 9),
  body              text not null check (char_length(body) <= 5000),
  dimension_hits    jsonb not null default '[]',
  companion_message text,
  shared_to_friends boolean not null default true,
  friend_tags       uuid[] not null default '{}',
  local_date        date not null,
  created_at        timestamptz default now(),
  legacy_wisdom_id  uuid
);
create index if not exists reflects_daily on public.reflects(user_id, local_date);
create index if not exists reflects_feed  on public.reflects(user_id, created_at desc);

-- ---- RLS: read-own for authenticated, full for service_role -----------------
-- Written out per table rather than looped: static SQL fails at a nameable
-- line, which is what you want when the target is production. Pattern follows
-- 20260531000000_user_seen_skin_unlocks.sql (enable RLS + idempotent policy).
alter table public.companions      enable row level security;
alter table public.companion_skins enable row level security;
alter table public.xp_events       enable row level security;
alter table public.gem_events      enable row level security;
alter table public.user_gems       enable row level security;
alter table public.reflects        enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companions' and policyname='read own companions') then
    create policy "read own companions" on public.companions for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companions' and policyname='service all companions') then
    create policy "service all companions" on public.companions for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companion_skins' and policyname='read own companion_skins') then
    create policy "read own companion_skins" on public.companion_skins for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companion_skins' and policyname='service all companion_skins') then
    create policy "service all companion_skins" on public.companion_skins for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='xp_events' and policyname='read own xp_events') then
    create policy "read own xp_events" on public.xp_events for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='xp_events' and policyname='service all xp_events') then
    create policy "service all xp_events" on public.xp_events for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gem_events' and policyname='read own gem_events') then
    create policy "read own gem_events" on public.gem_events for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gem_events' and policyname='service all gem_events') then
    create policy "service all gem_events" on public.gem_events for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_gems' and policyname='read own user_gems') then
    create policy "read own user_gems" on public.user_gems for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_gems' and policyname='service all user_gems') then
    create policy "service all user_gems" on public.user_gems for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reflects' and policyname='read own reflects') then
    create policy "read own reflects" on public.reflects for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reflects' and policyname='service all reflects') then
    create policy "service all reflects" on public.reflects for all to service_role using (true) with check (true);
  end if;
end $$;
