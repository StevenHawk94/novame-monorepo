-- Friendships + guesses (C11). A "keep your distance" social model: friends see
-- each other's item emoji (the day's collected objects) and guess the day, but
-- never the reflection text. No free-form chat -- guesses are short, replies are
-- fixed templates.
--
-- friendships uses a canonical order (user_a < user_b) with a single row per
-- pair, so a friendship is one row regardless of who requested. status gates
-- visibility; requested_by drives the accept/decline UI for the other side.
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  user_a       uuid not null references public.profiles on delete cascade,
  user_b       uuid not null references public.profiles on delete cascade,
  status       text not null default 'pending',
  requested_by uuid not null references public.profiles on delete cascade,
  created_at   timestamptz default now(),
  accepted_at  timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);

create index if not exists friendships_by_a on public.friendships (user_a, status);
create index if not exists friendships_by_b on public.friendships (user_b, status);

create table if not exists public.guesses (
  id                uuid primary key default gen_random_uuid(),
  from_user_id      uuid not null references public.profiles on delete cascade,
  to_user_id        uuid not null references public.profiles on delete cascade,
  target_date       date not null,
  body              text not null check (char_length(body) <= 50),
  reply_template_id smallint,
  replied_at        timestamptz,
  created_at        timestamptz default now(),
  unique (from_user_id, to_user_id, target_date)
);

create index if not exists guesses_to on public.guesses (to_user_id, created_at desc);
create index if not exists guesses_from on public.guesses (from_user_id, created_at desc);

alter table public.friendships enable row level security;
alter table public.guesses enable row level security;

create policy friendships_own on public.friendships
  for select to authenticated using (auth.uid() = user_a or auth.uid() = user_b);
create policy friendships_service on public.friendships
  for all to service_role using (true) with check (true);

create policy guesses_own on public.guesses
  for select to authenticated using (auth.uid() = from_user_id or auth.uid() = to_user_id);
create policy guesses_service on public.guesses
  for all to service_role using (true) with check (true);

-- Invite code: a short random handle a user shares to be added as a friend.
alter table public.profiles add column if not exists invite_code text unique;
