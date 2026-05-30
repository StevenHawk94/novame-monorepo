-- ============================================================
-- Skin-unlock "seen" persistence.
--
-- Problem: which skin-unlock modals a user had already seen was tracked
-- only in MMKV (novame_last_skin_unlock_shown_level), which _layout.tsx
-- clears on SIGNED_OUT and which is lost on cache clear. Result: every
-- re-login re-fired the full backlog of unlock modals. The existing
-- character_data.unlocked_outfits array is NOT a reliable source either
-- (observed inconsistent with level, e.g. level 10 row had [1,2]).
--
-- Fix: a per-user, DB-authoritative record of which outfit unlock modals
-- have been shown. detect = getUnlockedOutfits(level) - seen - {1}.
-- Mirrors the user_read_announcements model (service-role only; mobile
-- reads/writes through apps/api).
--
-- outfit 1 is the default skin (never has an unlock modal), so it is
-- never recorded here.
--
-- Backfill: existing users get the outfits their level already passed
-- pre-seeded as seen, so they are NOT re-notified once on upgrade.
-- Mapping (packages/core OUTFIT_UNLOCK_LEVELS = [1,5,10,20,30,50]):
--   outfit 2 @ lvl 5, 3 @ 10, 4 @ 20, 5 @ 30, 6 @ 50.
-- Idempotent (if not exists / on conflict do nothing); safe to replay.
-- Already applied to the remote DB; this file syncs git.
-- ============================================================
create table if not exists public.user_seen_skin_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_num int not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, outfit_num)
);

alter table public.user_seen_skin_unlocks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_seen_skin_unlocks'
      and policyname = 'Service role manages seen skin unlocks'
  ) then
    create policy "Service role manages seen skin unlocks"
      on public.user_seen_skin_unlocks for all
      to service_role using (true) with check (true);
  end if;
end $$;

-- One-time backfill of existing users (outfit 1 excluded; never notified).
insert into public.user_seen_skin_unlocks (user_id, outfit_num)
select cd.user_id, t.outfit_num
from public.character_data cd
cross join (values
  (2, 5), (3, 10), (4, 20), (5, 30), (6, 50)
) as t(outfit_num, unlock_level)
where cd.level >= t.unlock_level
on conflict (user_id, outfit_num) do nothing;
