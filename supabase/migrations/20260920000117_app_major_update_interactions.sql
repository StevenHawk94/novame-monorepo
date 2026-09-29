-- NovaMe Burrow major update: affection, adventure, friends, Moments,
-- Memories Room and new quest persistence.

-- ---- Affection -------------------------------------------------------------

create table if not exists public.affection_events (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  affection_type text not null check (affection_type in ('hug', 'spicy', 'cuddle', 'gratitude', 'kiss', 'miss_you')),
  gesture_metrics jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  reward_granted integer not null default 0 check (reward_granted between 0 and 10),
  completed_at timestamptz not null default now(),
  received_at timestamptz,
  read_at timestamptz,
  check (sender_id <> recipient_id),
  unique(sender_id, idempotency_key)
);

create index if not exists affection_recipient_unread
  on public.affection_events(recipient_id, completed_at desc) where read_at is null;
create index if not exists affection_sender_completed
  on public.affection_events(sender_id, completed_at desc);

alter table public.affection_events enable row level security;
drop policy if exists affection_read_involved on public.affection_events;
create policy affection_read_involved on public.affection_events
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists affection_service on public.affection_events;
create policy affection_service on public.affection_events
  for all to service_role using (true) with check (true);
grant select on public.affection_events to authenticated;
grant all on public.affection_events to service_role;

-- ---- Friend content --------------------------------------------------------

create table if not exists public.friend_definitions (
  stable_id text primary key,
  revision_id text not null references public.content_revisions(id),
  name text not null,
  subtitle text not null default '',
  rarity text not null default 'common',
  art jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  is_placeholder boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friend_content (
  id uuid primary key default gen_random_uuid(),
  friend_id text not null references public.friend_definitions(stable_id) on delete cascade,
  content_type text not null check (content_type in ('insight', 'question', 'emotional_help')),
  prompt text not null,
  choices jsonb not null default '[]'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  rage_monster_id text,
  locale text not null default 'en',
  position integer not null default 0,
  is_placeholder boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now()
);

alter table public.friend_definitions enable row level security;
alter table public.friend_content enable row level security;
drop policy if exists friend_definitions_public_read on public.friend_definitions;
create policy friend_definitions_public_read on public.friend_definitions
  for select to anon, authenticated using (status = 'active');
drop policy if exists friend_content_public_read on public.friend_content;
create policy friend_content_public_read on public.friend_content
  for select to anon, authenticated using (status = 'active');
drop policy if exists friend_definitions_service on public.friend_definitions;
create policy friend_definitions_service on public.friend_definitions
  for all to service_role using (true) with check (true);
drop policy if exists friend_content_service on public.friend_content;
create policy friend_content_service on public.friend_content
  for all to service_role using (true) with check (true);
grant select on public.friend_definitions, public.friend_content to anon, authenticated;
grant all on public.friend_definitions, public.friend_content to service_role;

-- ---- Adventure -------------------------------------------------------------

create table if not exists public.adventures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  record_id uuid,
  status text not null check (status in (
    'record_saved', 'memories_confirmed', 'ready_to_start', 'in_progress',
    'result_ready', 'interaction_required', 'completed', 'cancelled'
  )),
  started_at timestamptz,
  ends_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  plus_snapshot boolean not null default false,
  content_revision text not null references public.content_revisions(id),
  result_type text check (result_type is null or result_type in ('item', 'friend', 'quiet')),
  result_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_date),
  unique(user_id, idempotency_key)
);

create index if not exists adventures_user_status
  on public.adventures(user_id, status, created_at desc);
create unique index adventures_record_once on public.adventures(record_id) where record_id is not null;
create unique index adventures_one_pending on public.adventures(user_id)
  where status in ('in_progress','result_ready','interaction_required');
create index if not exists adventures_completion_due
  on public.adventures(ends_at) where status = 'in_progress';

create table if not exists public.adventure_logs (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references public.adventures(id) on delete cascade,
  minute_offset integer not null check (minute_offset >= 0),
  event_type text not null,
  copy text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adventure_results (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null unique references public.adventures(id) on delete cascade,
  result_type text not null check (result_type in ('item', 'friend', 'quiet')),
  item_id text references public.catalog_items(stable_id),
  friend_id text references public.friend_definitions(stable_id),
  claim_status text not null default 'pending' check (claim_status in ('pending', 'interaction_required', 'claimed')),
  gift_id uuid references public.gifts(id),
  claimed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (result_type = 'item' and item_id is not null)
    or (result_type = 'friend' and friend_id is not null and item_id is null)
    or (result_type = 'quiet' and friend_id is null and item_id is null)
  )
);

create table if not exists public.user_friend_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id text not null references public.friend_definitions(stable_id),
  source_adventure_id uuid references public.adventures(id),
  first_seen_at timestamptz not null default now(),
  interaction_completed_at timestamptz,
  unique(user_id, friend_id)
);

create table if not exists public.friend_visits (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  friend_id text not null references public.friend_definitions(stable_id),
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  visit_date date not null,
  content_id uuid references public.friend_content(id),
  completed_at timestamptz,
  gift_id uuid references public.gifts(id),
  created_at timestamptz not null default now(),
  check (pair_low < pair_high),
  check (host_user_id in (pair_low, pair_high)),
  unique(pair_low, pair_high, visit_date)
);

create index if not exists friend_visits_pair_friend_recent
  on public.friend_visits(pair_low, pair_high, friend_id, visit_date desc);

alter table public.adventures enable row level security;
alter table public.adventure_logs enable row level security;
alter table public.adventure_results enable row level security;
alter table public.user_friend_discoveries enable row level security;
alter table public.friend_visits enable row level security;

drop policy if exists adventures_read_pair on public.adventures;
create policy adventures_read_pair on public.adventures
  for select to authenticated using (public.is_self_or_current_partner(user_id));
drop policy if exists adventure_logs_read_pair on public.adventure_logs;
create policy adventure_logs_read_pair on public.adventure_logs
  for select to authenticated using (
    exists (
      select 1 from public.adventures a
      where a.id = adventure_id and public.is_self_or_current_partner(a.user_id)
    )
  );
drop policy if exists adventure_results_read_pair on public.adventure_results;
create policy adventure_results_read_pair on public.adventure_results
  for select to authenticated using (
    exists (
      select 1 from public.adventures a
      where a.id = adventure_id and public.is_self_or_current_partner(a.user_id)
    )
  );
drop policy if exists discoveries_read_pair on public.user_friend_discoveries;
create policy discoveries_read_pair on public.user_friend_discoveries
  for select to authenticated using (public.is_self_or_current_partner(user_id));
drop policy if exists friend_visits_read_pair on public.friend_visits;
create policy friend_visits_read_pair on public.friend_visits
  for select to authenticated using (public.can_read_burrow_pair(pair_low, pair_high));

drop policy if exists adventures_service on public.adventures;
create policy adventures_service on public.adventures for all to service_role using (true) with check (true);
drop policy if exists adventure_logs_service on public.adventure_logs;
create policy adventure_logs_service on public.adventure_logs for all to service_role using (true) with check (true);
drop policy if exists adventure_results_service on public.adventure_results;
create policy adventure_results_service on public.adventure_results for all to service_role using (true) with check (true);
drop policy if exists discoveries_service on public.user_friend_discoveries;
create policy discoveries_service on public.user_friend_discoveries for all to service_role using (true) with check (true);
drop policy if exists friend_visits_service on public.friend_visits;
create policy friend_visits_service on public.friend_visits for all to service_role using (true) with check (true);

grant select on public.adventures, public.adventure_logs, public.adventure_results,
  public.user_friend_discoveries, public.friend_visits to authenticated;
grant all on public.adventures, public.adventure_logs, public.adventure_results,
  public.user_friend_discoveries, public.friend_visits to service_role;

-- ---- Moments and Memories Room --------------------------------------------

create table if not exists public.moment_events (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'adventure_record_saved', 'adventure_completed', 'friend_discovered',
    'affection_sent', 'room_need_refilled', 'room_media_updated',
    'gift_sent', 'gift_claimed', 'memory_created'
  )),
  visibility text not null default 'pair' check (visibility in ('pair', 'actor_only')),
  reference_type text,
  reference_id text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  check (pair_low < pair_high),
  check (actor_id in (pair_low, pair_high)),
  check (target_id is null or target_id in (pair_low, pair_high)),
  unique(actor_id, idempotency_key)
);

create index if not exists moment_events_pair_created
  on public.moment_events(pair_low, pair_high, created_at desc);

create table if not exists public.memory_prompts (
  stable_id text primary key,
  revision_id text not null references public.content_revisions(id),
  prompt text not null,
  locale text not null default 'en',
  position integer not null default 0,
  is_placeholder boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired'))
);

create table if not exists public.memory_room_entries (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  prompt_id text references public.memory_prompts(stable_id),
  body text not null default '' check (char_length(body) <= 5000),
  private_photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (pair_low < pair_high),
  check (author_id in (pair_low, pair_high)),
  check (char_length(trim(body)) > 0 or private_photo_path is not null)
);

create index if not exists memory_room_pair_created
  on public.memory_room_entries(pair_low, pair_high, created_at desc)
  where deleted_at is null;

alter table public.moment_events enable row level security;
alter table public.memory_prompts enable row level security;
alter table public.memory_room_entries enable row level security;

drop policy if exists moments_read_pair on public.moment_events;
create policy moments_read_pair on public.moment_events
  for select to authenticated using (
    public.can_read_burrow_pair(pair_low, pair_high)
    and (visibility = 'pair' or actor_id = auth.uid())
  );
drop policy if exists memory_prompts_public_read on public.memory_prompts;
create policy memory_prompts_public_read on public.memory_prompts
  for select to anon, authenticated using (status = 'active');
drop policy if exists memory_entries_read_pair on public.memory_room_entries;
create policy memory_entries_read_pair on public.memory_room_entries
  for select to authenticated using (deleted_at is null and public.can_read_burrow_pair(pair_low, pair_high));

drop policy if exists moments_service on public.moment_events;
create policy moments_service on public.moment_events for all to service_role using (true) with check (true);
drop policy if exists memory_prompts_service on public.memory_prompts;
create policy memory_prompts_service on public.memory_prompts for all to service_role using (true) with check (true);
drop policy if exists memory_entries_service on public.memory_room_entries;
create policy memory_entries_service on public.memory_room_entries for all to service_role using (true) with check (true);

grant select on public.moment_events, public.memory_room_entries to authenticated;
grant select on public.memory_prompts to anon, authenticated;
grant all on public.moment_events, public.memory_prompts, public.memory_room_entries to service_role;

-- ---- Quests and reward claims ---------------------------------------------

create table if not exists public.daily_quest_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  quest_id text not null,
  target integer not null default 1 check (target > 0),
  assigned_at timestamptz not null default now(),
  unique(user_id, local_date, quest_id)
);

create table if not exists public.quest_progress_vnext (
  assignment_id uuid primary key references public.daily_quest_assignments(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.special_quest_progress_vnext (
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_id text not null,
  stage integer not null default 1 check (stage > 0),
  progress integer not null default 0 check (progress >= 0),
  claimed_stage integer not null default 0 check (claimed_stage >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id, quest_id)
);

create table if not exists public.reward_claims_vnext (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_type text not null,
  period_key text not null,
  reference_id text,
  amount integer not null check (amount > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

alter table public.daily_quest_assignments enable row level security;
alter table public.quest_progress_vnext enable row level security;
alter table public.special_quest_progress_vnext enable row level security;
alter table public.reward_claims_vnext enable row level security;

drop policy if exists daily_quests_read_own on public.daily_quest_assignments;
create policy daily_quests_read_own on public.daily_quest_assignments
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists quest_progress_read_own on public.quest_progress_vnext;
create policy quest_progress_read_own on public.quest_progress_vnext
  for select to authenticated using (
    exists (
      select 1 from public.daily_quest_assignments q
      where q.id = assignment_id and q.user_id = auth.uid()
    )
  );
drop policy if exists special_quests_read_own on public.special_quest_progress_vnext;
create policy special_quests_read_own on public.special_quest_progress_vnext
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists reward_claims_read_own on public.reward_claims_vnext;
create policy reward_claims_read_own on public.reward_claims_vnext
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists daily_quests_service on public.daily_quest_assignments;
create policy daily_quests_service on public.daily_quest_assignments for all to service_role using (true) with check (true);
drop policy if exists quest_progress_service on public.quest_progress_vnext;
create policy quest_progress_service on public.quest_progress_vnext for all to service_role using (true) with check (true);
drop policy if exists special_quests_service on public.special_quest_progress_vnext;
create policy special_quests_service on public.special_quest_progress_vnext for all to service_role using (true) with check (true);
drop policy if exists reward_claims_service on public.reward_claims_vnext;
create policy reward_claims_service on public.reward_claims_vnext for all to service_role using (true) with check (true);

grant select on public.daily_quest_assignments, public.quest_progress_vnext,
  public.special_quest_progress_vnext, public.reward_claims_vnext to authenticated;
grant all on public.daily_quest_assignments, public.quest_progress_vnext,
  public.special_quest_progress_vnext, public.reward_claims_vnext to service_role;

notify pgrst, 'reload schema';
