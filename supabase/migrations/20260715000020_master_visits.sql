-- Visit Master (Kit 5, paid-only). A deliberate consultation with the Master:
-- the user asks, the Master replies with a deep six-module answer. Unlike
-- Skills, this produces NO skill, NO dimension xp, NO items -- it's "consulting
-- a sage", kept isolated from the "your own wisdom" purity of Skills.
--
-- Access is a 48h cooldown (not a weekly quota): one visit, then the Master is
-- "away travelling" for 48h. The cooldown is derived from the latest visit's
-- created_at, so no separate quota table is needed.
create table if not exists public.master_visits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  question     text not null,
  response     jsonb not null,
  created_at   timestamptz default now()
);

create index if not exists master_visits_by_user on public.master_visits (user_id, created_at desc);

alter table public.master_visits enable row level security;

create policy master_visits_own on public.master_visits
  for select to authenticated using (auth.uid() = user_id);
create policy master_visits_service on public.master_visits
  for all to service_role using (true) with check (true);
