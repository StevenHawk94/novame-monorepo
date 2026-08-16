-- Privacy-safe learning queue. It stores short canonical concepts only; the
-- reflection body and user id are never copied into the admin-facing table.
create table if not exists public.item_learning_candidates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('missing_icon', 'missing_keyword')),
  concept text not null check (char_length(concept) between 1 and 80),
  normalized_concept text not null,
  suggested_item_id text,
  suggested_icon_name text,
  confidence numeric(4,3) not null default 0,
  occurrence_count integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'published')),
  safety_mode text not null default 'AUTO' check (safety_mode in ('AUTO', 'AUTO_UNLESS_EXCLUDED', 'NEVER_AUTO')),
  exclusion_rules text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_version text
);

create unique index if not exists item_learning_candidate_identity
  on public.item_learning_candidates(kind, normalized_concept, coalesce(suggested_item_id, ''));
create index if not exists item_learning_candidates_status_seen
  on public.item_learning_candidates(status, last_seen_at desc);

alter table public.item_learning_candidates enable row level security;
drop policy if exists item_learning_candidates_service on public.item_learning_candidates;
create policy item_learning_candidates_service on public.item_learning_candidates
  for all to service_role using (true) with check (true);

