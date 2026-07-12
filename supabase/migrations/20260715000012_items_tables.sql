-- Items, user collections, and per-match memories (C8).
--
-- items is seeded from the sprite sheets (small sample now, 480 later). The
-- 2,400-entry synonym dictionary does NOT live here -- it's pure data + pure
-- function in packages/engine/src/items/dictionary.json, loaded once at edge
-- cold start, shared by client and server so matching never drifts.
--
-- Two-pass note: this file creates the item_rarity enum and then the tables.
-- Run the enum first, then the rest, per the C1 lesson on mixed DDL.
create type item_rarity as enum ('common', 'uncommon', 'rare');

create table if not exists public.items (
  id           text primary key,
  sheet_id     text not null,
  row          smallint not null,
  col          smallint not null,
  display_name text not null,
  rarity       item_rarity not null default 'common',
  category     text not null
);

create table if not exists public.user_items (
  user_id       uuid not null references public.profiles on delete cascade,
  item_id       text not null references public.items,
  count         int not null default 0,
  first_seen_at timestamptz default now(),
  primary key (user_id, item_id)
);

create table if not exists public.item_memories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  item_id      text not null references public.items,
  reflect_id   uuid not null references public.reflects on delete cascade,
  raw_excerpt  text not null,
  refined_desc text,
  created_at   timestamptz default now()
);

create index if not exists memories_by_item
  on public.item_memories (user_id, item_id, created_at desc);
create index if not exists memories_by_day
  on public.item_memories (user_id, created_at desc);

alter table public.items enable row level security;
alter table public.user_items enable row level security;
alter table public.item_memories enable row level security;

create policy items_read on public.items
  for select to authenticated using (true);
create policy items_service on public.items
  for all to service_role using (true) with check (true);

create policy user_items_own on public.user_items
  for select to authenticated using (auth.uid() = user_id);
create policy user_items_service on public.user_items
  for all to service_role using (true) with check (true);

create policy item_memories_own on public.item_memories
  for select to authenticated using (auth.uid() = user_id);
create policy item_memories_service on public.item_memories
  for all to service_role using (true) with check (true);
