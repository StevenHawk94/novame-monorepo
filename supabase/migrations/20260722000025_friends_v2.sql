-- Friends v2 backend (PRD §6, P4): feed reads, privacy, shared memory boxes.
--
-- Scope of this migration:
--   1. privacy switch -- profiles.share_memory_details (PRD 6.2/视觉稿:
--      Friends 右上角设置). GLOBAL opt-in, default FALSE: a friend's Details
--      button appears only when the owner opted in. Default-private is the
--      deliberate call (plan doc §6-3) — journals are the most sensitive data
--      in the app.
--   2. friend_feed_reads -- per-friend unread cursor for the Messages list
--      (row = "I have seen everything from this friend up to last_read_at").
--   3. shared_memory_boxes/items -- the per-pair 共创回忆盒. pair keys are
--      canonical (user_a < user_b), mirroring friendships. Items arrive from
--      Reflect co-creation (source 'reflect') or the box's Create flow
--      ('manual'). Description is the memory text (rule-matched excerpt or
--      hand-written; AI refinement for Plus arrives with its own pass).
--
-- All writes stay service_role-only (API routes); clients read only their own
-- rows via RLS, same posture as the rest of v2.

-- 1. privacy switch ----------------------------------------------------------
alter table public.profiles
  add column if not exists share_memory_details boolean not null default false;

-- 2. unread cursors ----------------------------------------------------------
create table if not exists public.friend_feed_reads (
  user_id        uuid not null references public.profiles on delete cascade,
  friend_user_id uuid not null references public.profiles on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (user_id, friend_user_id)
);
alter table public.friend_feed_reads enable row level security;
create policy friend_feed_reads_select_own on public.friend_feed_reads
  for select using (auth.uid() = user_id);

-- 3. shared memory boxes -----------------------------------------------------
create table if not exists public.shared_memory_items (
  id             uuid primary key default gen_random_uuid(),
  user_a         uuid not null references public.profiles on delete cascade,
  user_b         uuid not null references public.profiles on delete cascade,
  author_user_id uuid not null references public.profiles on delete cascade,
  item_id        text not null,
  description    text not null default '',
  source         text not null default 'manual' check (source in ('manual', 'reflect')),
  reflect_id     uuid references public.reflects on delete set null,
  created_at     timestamptz default now(),
  check (user_a < user_b)
);
create index if not exists shared_memory_items_pair
  on public.shared_memory_items (user_a, user_b, created_at desc);
alter table public.shared_memory_items enable row level security;
create policy shared_memory_items_select_pair on public.shared_memory_items
  for select using (auth.uid() = user_a or auth.uid() = user_b);
