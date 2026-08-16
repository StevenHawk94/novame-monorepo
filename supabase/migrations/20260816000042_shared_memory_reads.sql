-- Per-viewer cursor for partner-created shared memories. Shared items remain
-- pair-owned; this table only drives the Ours unread indicator.
create table if not exists public.shared_memory_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, partner_user_id),
  check (user_id <> partner_user_id)
);

alter table public.shared_memory_reads enable row level security;

drop policy if exists shared_memory_reads_own on public.shared_memory_reads;
create policy shared_memory_reads_own on public.shared_memory_reads
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists shared_memory_reads_service on public.shared_memory_reads;
create policy shared_memory_reads_service on public.shared_memory_reads
  for all to service_role using (true) with check (true);

