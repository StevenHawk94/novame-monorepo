-- kit_completions: one row per completed Kit run (C5).
--
-- Stores the content (payload) so features that recall it later -- True North's
-- "compare to last week", a Quiet Wins history -- have the data, even though
-- none of the three Kits shipping now allow editing a submitted run.
--
-- unique(user_id, kit, period_key): a Kit fires once per period (day for
-- quiet_wins/new_lens, week for true_north). The row's existence IS the "done
-- this period" flag; submit_kit claims it on conflict-do-nothing and refuses a
-- second run for the period.
--
-- Two-pass note: this file mixes a CREATE TABLE with the policy statements. Per
-- the C1 lesson, run it and verify with a count -- but there is no do-block or
-- $$ here, so the editor does not mis-split it.
create table if not exists public.kit_completions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  kit        kit_t not null,
  period_key text not null,
  payload    jsonb not null default '{}'::jsonb,
  local_date date not null,
  created_at timestamptz default now(),
  unique (user_id, kit, period_key)
);

create index if not exists kit_completions_user_kit
  on public.kit_completions (user_id, kit, period_key);

alter table public.kit_completions enable row level security;

create policy kit_completions_select_own on public.kit_completions
  for select to authenticated using (auth.uid() = user_id);
create policy kit_completions_service_all on public.kit_completions
  for all to service_role using (true) with check (true);
