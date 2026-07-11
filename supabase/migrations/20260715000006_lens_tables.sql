-- lens_cards + lens_progress: New Lens knowledge cards and per-user cursor (C5).
--
-- Card content is dynamic -- editable live from the server, no app release --
-- so it lives in a table, not the domain package. Eight themes (one per
-- dimension); sort_order gives each theme a stable sequence the cursor walks.
--
-- The cursor (lens_progress) stores the sort_order of the last card seen in a
-- theme, keyed on sort_order rather than an array index so adding or removing
-- cards never misaligns a user mid-sequence.
create table if not exists public.lens_cards (
  id         uuid primary key default gen_random_uuid(),
  theme      dimension_t not null,
  sort_order int not null,
  headline   text not null,
  body       text not null,
  is_active  boolean not null default true,
  created_at timestamptz default now(),
  unique (theme, sort_order)
);

create index if not exists lens_cards_theme_order
  on public.lens_cards (theme, sort_order) where is_active;

create table if not exists public.lens_progress (
  user_id         uuid not null references public.profiles on delete cascade,
  theme           dimension_t not null,
  last_card_order int not null default -1,
  updated_at      timestamptz default now(),
  primary key (user_id, theme)
);

alter table public.lens_cards enable row level security;
alter table public.lens_progress enable row level security;

create policy lens_cards_read on public.lens_cards
  for select to authenticated using (true);
create policy lens_cards_service on public.lens_cards
  for all to service_role using (true) with check (true);

create policy lens_progress_own on public.lens_progress
  for select to authenticated using (auth.uid() = user_id);
create policy lens_progress_service on public.lens_progress
  for all to service_role using (true) with check (true);
