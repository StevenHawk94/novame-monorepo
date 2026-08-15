-- Good Vibes (one send per sender per local day) + three-state memory privacy.

alter table public.profiles
  add column if not exists memory_details_mode text not null default 'custom';

alter table public.profiles
  drop constraint if exists profiles_memory_details_mode_check;
alter table public.profiles
  add constraint profiles_memory_details_mode_check
  check (memory_details_mode in ('all', 'none', 'custom'));

-- Product default for every existing account is per-reflection control.
-- This migration runs once; choices made afterwards are not overwritten.
update public.profiles
set memory_details_mode = 'custom';

create table if not exists public.good_vibes (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  message_index smallint not null check (message_index between 0 and 23),
  message text not null check (char_length(message) between 1 and 80),
  sender_local_date date not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_user_id <> recipient_user_id),
  unique (sender_user_id, sender_local_date)
);

create index if not exists good_vibes_recipient_unread
  on public.good_vibes(recipient_user_id, created_at desc) where read_at is null;

alter table public.good_vibes enable row level security;

drop policy if exists good_vibes_own_read on public.good_vibes;
create policy good_vibes_own_read on public.good_vibes
  for select to authenticated
  using (auth.uid() = sender_user_id or auth.uid() = recipient_user_id);

drop policy if exists good_vibes_service_all on public.good_vibes;
create policy good_vibes_service_all on public.good_vibes
  for all to service_role using (true) with check (true);
