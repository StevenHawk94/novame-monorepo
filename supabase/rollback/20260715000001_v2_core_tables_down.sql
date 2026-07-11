-- Rollback for 20260715000001. Safe: the six tables are empty until C2 writes
-- them, and the profiles columns are additive (dropping them loses only NULLs).
drop table if exists public.reflects        cascade;
drop table if exists public.user_gems       cascade;
drop table if exists public.gem_events      cascade;
drop table if exists public.xp_events       cascade;
drop table if exists public.companion_skins cascade;
drop table if exists public.companions      cascade;
drop index if exists public.profiles_friend_code_key;
alter table public.profiles
  drop column if exists first_steps_completed_at,
  drop column if exists onboarding_completed_at,
  drop column if exists active_scene_id,
  drop column if exists companion_id,
  drop column if exists friend_code;
