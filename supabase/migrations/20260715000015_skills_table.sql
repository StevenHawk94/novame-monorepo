-- Skills: lessons the user extracts from reflections (C9, test phase).
--
-- The pgvector signature column (768-dim) is DEFERRED: dedup is keyword-overlap
-- for now (packages/engine skill-dedup), upgraded to semantic before launch. So
-- this table carries the text and dimension the dedup needs, but no vector
-- column yet -- that's an additive alter when embedding lands.
--
-- rarity: 'normal' or 'secret' (10% roll at generation, the glowing card).
-- source: 'self' (own reflect) or 'friend' (taught). Both usable in Tame Enemy;
-- only 'self' counts toward the Skills-tab "learned" total.
--
-- Two-pass note: the two enums are created first, then the table. Run the enums,
-- then the rest, per the C1 lesson on mixed DDL.
create type skill_rarity as enum ('normal', 'secret');
create type skill_source as enum ('self', 'friend');

create table if not exists public.skills (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  reflect_id   uuid references public.reflects on delete set null,
  dimension    dimension_t not null,
  title        text not null,
  body         text not null,
  rarity       skill_rarity not null default 'normal',
  source       skill_source not null default 'self',
  created_at   timestamptz default now()
);

create index if not exists skills_by_dim
  on public.skills (user_id, dimension, created_at desc);
create index if not exists skills_by_user
  on public.skills (user_id, created_at desc);

alter table public.skills enable row level security;

create policy skills_own on public.skills
  for select to authenticated using (auth.uid() = user_id);
create policy skills_service on public.skills
  for all to service_role using (true) with check (true);
