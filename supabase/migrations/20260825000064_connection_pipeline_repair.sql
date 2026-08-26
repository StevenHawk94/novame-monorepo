-- Repair environments where Connection v2 was applied without the earlier
-- reflection-analysis pipeline migration. Every statement is idempotent so
-- this can safely run whether the original pipeline was fully, partly, or
-- never installed.

alter table public.profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists timezone_name text,
  add column if not exists connection_resume_required boolean not null default false;

create table if not exists public.reflect_ai_analyses (
  reflect_id uuid primary key references public.reflects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  prompt_version text not null,
  weekly_eligible boolean not null default false,
  weekly_evidence jsonb,
  visual_concepts jsonb not null default '[]'::jsonb,
  connection_eligible boolean not null default false,
  connection_updates jsonb,
  connection_mode text not null default 'disabled'
    check (connection_mode in ('disabled', 'inactive', 'immediate', 'deferred', 'caught_up')),
  provider text,
  model text,
  usage jsonb,
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index if not exists reflect_ai_analyses_user_date
  on public.reflect_ai_analyses(user_id, local_date desc);
create index if not exists reflect_ai_analyses_connection
  on public.reflect_ai_analyses(user_id, connection_mode, completed_at desc);

create table if not exists public.connection_update_candidates (
  id uuid primary key default gen_random_uuid(),
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  writer_user_id uuid not null references public.profiles(id) on delete cascade,
  for_user uuid not null references public.profiles(id) on delete cascade,
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  writer_local_date date not null,
  updates jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'discarded')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(reflect_id, for_user),
  check (user_a < user_b)
);

create index if not exists connection_update_candidates_pending
  on public.connection_update_candidates(status, writer_local_date, created_at);

create table if not exists public.item_learning_jobs (
  id uuid primary key default gen_random_uuid(),
  reflect_id uuid not null references public.reflects(id) on delete cascade unique,
  concepts jsonb not null default '[]'::jsonb,
  matched_item_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists item_learning_jobs_pending
  on public.item_learning_jobs(status, created_at);

create table if not exists public.weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  for_user uuid not null references public.profiles(id) on delete cascade,
  writer_user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  evidence_count integer not null,
  scores jsonb not null,
  payload jsonb not null,
  prompt_version text not null,
  provider text,
  model text,
  usage jsonb,
  created_at timestamptz not null default now(),
  unique(user_a, user_b, for_user, period_start, period_end),
  check (user_a < user_b),
  check (period_end = period_start + 6)
);

create index if not exists weekly_recaps_reader_period
  on public.weekly_recaps(for_user, period_end desc);

create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  feature text not null,
  prompt_version text not null,
  provider text,
  model text,
  usage jsonb,
  latency_ms integer,
  success boolean not null,
  ref_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_feature_created
  on public.ai_usage_events(feature, created_at desc);

alter table public.reflect_ai_analyses enable row level security;
alter table public.connection_update_candidates enable row level security;
alter table public.item_learning_jobs enable row level security;
alter table public.weekly_recaps enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists reflect_ai_analyses_service on public.reflect_ai_analyses;
create policy reflect_ai_analyses_service on public.reflect_ai_analyses
  for all to service_role using (true) with check (true);

drop policy if exists connection_update_candidates_service on public.connection_update_candidates;
create policy connection_update_candidates_service on public.connection_update_candidates
  for all to service_role using (true) with check (true);

drop policy if exists item_learning_jobs_service on public.item_learning_jobs;
create policy item_learning_jobs_service on public.item_learning_jobs
  for all to service_role using (true) with check (true);

drop policy if exists weekly_recaps_service on public.weekly_recaps;
create policy weekly_recaps_service on public.weekly_recaps
  for all to service_role using (true) with check (true);

drop policy if exists weekly_recaps_reader on public.weekly_recaps;
create policy weekly_recaps_reader on public.weekly_recaps
  for select to authenticated using (auth.uid() = for_user);

drop policy if exists ai_usage_events_service on public.ai_usage_events;
create policy ai_usage_events_service on public.ai_usage_events
  for all to service_role using (true) with check (true);

notify pgrst, 'reload schema';
