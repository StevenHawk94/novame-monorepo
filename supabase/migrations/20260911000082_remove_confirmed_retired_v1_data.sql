-- Permanently remove the retired v1 systems confirmed on 2026-09-11.
-- No CASCADE is used: an unexpected retained dependency aborts and rolls back
-- the entire migration instead of deleting additional objects.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Refuse to run unless every explicitly retained system is present.
do $$
begin
  if to_regclass('public.monster_battle_progress') is null
     or to_regclass('public.battle_progress') is null
     or to_regclass('public.skills') is null
     or to_regclass('public.lens_cards') is null
     or to_regclass('public.lens_progress') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.book_orders') is null
     or to_regclass('public.companions') is null
     or to_regclass('public.xp_events') is null then
    raise exception 'retained Burrow system is missing; refusing retired-v1 cleanup';
  end if;
end
$$;

-- Exact snapshot guard from the production audit. Old writers were disabled by
-- migration 81 and removed from the deployed API/Admin. If any count changes,
-- stop so a human can review the new rows instead of deleting them implicitly.
do $$
declare
  v_character_growth bigint;
  v_wisdom_community bigint;
  v_seek bigint;
  v_growth_gems bigint;
  v_orders bigint;
begin
  select
      (select count(*) from public.character_data)
    + (select count(*) from public.user_characters)
    + (select count(*) from public.companion_skins)
    + (select count(*) from public.user_seen_skin_unlocks)
    + (select count(*) from public.daily_tasks)
    + (select count(*) from public.weekly_reports)
  into v_character_growth;

  select
      (select count(*) from public.wisdoms)
    + (select count(*) from public.wisdom_cards)
    + (select count(*) from public.wisdom_comments)
    + (select count(*) from public.card_saves)
    + (select count(*) from public.likes)
    + (select count(*) from public.listens)
    + (select count(*) from public.user_liked_wisdoms)
    + (select count(*) from public.user_liked_defaults)
    + (select count(*) from public.wisdom_blocks)
    + (select count(*) from public.wisdom_card_blocks)
    + (select count(*) from public.wisdom_card_reports)
    + (select count(*) from public.blocked_users)
    + (select count(*) from public.reports)
    + (select count(*) from public.default_creators)
    + (select count(*) from public.leaderboard_seeds)
    + (select count(*) from public.card_keywords)
  into v_wisdom_community;

  select
      (select count(*) from public.seek_questions)
    + (select count(*) from public.seek_question_cards)
  into v_seek;

  select
      (select count(*) from public.gem_events)
    + (select count(*) from public.user_gems)
  into v_growth_gems;

  select
      (select count(*) from public.orders)
    + (select count(*) from public.book_orders)
  into v_orders;

  if v_character_growth <> 1381
     or v_wisdom_community <> 1566
     or v_seek <> 528
     or v_growth_gems <> 410
     or v_orders <> 42 then
    raise exception
      'retired-v1 snapshot changed (character %, wisdom %, seek %, gems %, orders %); refusing cleanup',
      v_character_growth, v_wisdom_community, v_seek, v_growth_gems, v_orders;
  end if;
end
$$;

-- legacy_wisdom_id originally referenced wisdoms, so remove the obsolete
-- Reflect compatibility fields before dropping the retired content tables.
alter table if exists public.reflects
  drop column if exists dimension_hits,
  drop column if exists companion_message,
  drop column if exists friend_tags,
  drop column if exists legacy_wisdom_id;

drop view if exists public.leaderboard;
drop view if exists public.user_stats;

-- Trigger dependencies must be removed explicitly before their functions.
-- They belong only to tables being dropped below; naming them avoids CASCADE.
drop trigger if exists on_like_change on public.likes;
drop trigger if exists on_listen_insert on public.listens;
drop trigger if exists trg_seek_questions_assign_display_order on public.seek_questions;

drop function if exists public.can_user_record(uuid);
drop function if exists public.record_wisdom_usage(uuid, integer);
drop function if exists public.increment_unread_feedback(uuid);
drop function if exists public.insert_wisdom_card_if_under_quota(uuid, timestamptz, integer, jsonb);
drop function if exists public.match_wisdoms(extensions.vector, text[], integer, double precision);
drop function if exists public.update_wisdom_likes_count();
drop function if exists public.update_wisdom_listens_count();
drop function if exists public.assign_seek_question_display_order();

-- Old character, level and personal-growth storage. battle_progress remains as
-- Tame Enemy compatibility state.
drop table if exists
  public.user_characters,
  public.companion_skins,
  public.user_seen_skin_unlocks,
  public.daily_tasks,
  public.weekly_reports,
  public.character_data;

-- Old Wisdom/community/generated-card content. The order table definitions
-- remain reusable, but the retired content-export feature is unavailable.
drop table if exists
  public.wisdom_card_blocks,
  public.wisdom_card_reports,
  public.wisdom_blocks,
  public.wisdom_comments,
  public.card_saves,
  public.user_liked_wisdoms,
  public.user_liked_defaults,
  public.likes,
  public.listens,
  public.reports,
  public.blocked_users,
  public.wisdom_cards,
  public.wisdoms,
  public.card_keywords,
  public.default_creators,
  public.leaderboard_seeds;

drop table if exists
  public.seek_question_cards,
  public.seek_questions;

-- Growth Gems are retired. Clover state remains in companions/xp_events.
drop table if exists
  public.gem_events,
  public.user_gems;

-- Keep current identity/privacy/entitlement fields plus
-- onboarding_completed_at, onboarding_who and onboarding_blocker.
alter table if exists public.profiles
  drop column if exists zodiac_sign,
  drop column if exists interests,
  drop column if exists selected_character,
  drop column if exists onboarding_completed,
  drop column if exists has_completed_onboarding,
  drop column if exists selected_interests,
  drop column if exists custom_categories,
  drop column if exists is_guest,
  drop column if exists total_mins_created,
  drop column if exists last_wisdom_created_at,
  drop column if exists last_report_viewed_at,
  drop column if exists character_b_message,
  drop column if exists character_b_message_at,
  drop column if exists questions_used,
  drop column if exists questions_reset_at,
  drop column if exists last_book_applied_minutes,
  drop column if exists gacha_date,
  drop column if exists gacha_count,
  drop column if exists active_character_id,
  drop column if exists character_mode,
  drop column if exists wp,
  drop column if exists wp_last_updated,
  drop column if exists mode_changed_at,
  drop column if exists afk_study_seconds,
  drop column if exists afk_play_seconds,
  drop column if exists last_recording_at,
  drop column if exists drain_words,
  drop column if exists aspire_words,
  drop column if exists wisdom_portrait,
  drop column if exists aspire_scores,
  drop column if exists better_self_score,
  drop column if exists community_resonance,
  drop column if exists community_resonance_updated_at,
  drop column if exists last_report_generated_at,
  drop column if exists wisdom_share_count,
  drop column if exists people_impacted_display,
  drop column if exists people_impacted_updated_at,
  drop column if exists study_bonus_task_index,
  drop column if exists friend_code,
  drop column if exists companion_id,
  drop column if exists active_scene_id,
  drop column if exists first_steps_completed_at;

-- Retired subscription usage/Airwallex linkage. Store reconciliation and
-- pending-plan fields remain intact.
alter table if exists public.subscriptions
  drop column if exists minutes_used_this_month,
  drop column if exists records_today,
  drop column if exists last_record_date,
  drop column if exists airwallex_customer_id,
  drop column if exists airwallex_subscription_id;

-- Keep both physical-order table definitions for possible future reuse, but
-- remove all current legacy order rows as explicitly confirmed. Delete the
-- secondary table first so any future FK added between them fails safely.
delete from public.book_orders;
delete from public.orders;

commit;
