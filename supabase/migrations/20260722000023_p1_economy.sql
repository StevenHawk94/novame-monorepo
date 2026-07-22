-- P1 economy alignment (PRD v2.0 §8.1 + 2026-07 product rulings Q8/Q12/Q13/Q16).
--
-- Ruling Q8: the XP ledger IS the currency ledger. Levels are abandoned;
-- companions.xp now reads as the clover balance source (balance = xp -
-- clovers_spent, unchanged mechanically). Engine-side value changes (focus
-- x2/day, true_north 100, tame 30, quests 30/200) need no schema change --
-- the RPCs take amounts from the API, which takes them from @novame/engine.
--
-- This migration owns the parts the schema must know about:
--   1. enum gaps -- visit_master/bubble pay currency now; focus was NEVER
--      added to kit_t (the /api/focus RPC call only worked where the enum
--      was patched by hand in the SQL editor; this makes it real)
--   2. gem_source widening -- PRD §1.2 scores dimensions from quiet wins and
--      tame enemy too (focus joins once its scene→dimension map is defined)
--   3. the 99999 currency cap (PRD §1) as a companions trigger, so every
--      writer (submit_reflect / submit_kit / submit_lens / quest pay) is
--      clamped in one place, today and tomorrow
--   4. submit_kit v2: gem hits are no longer true_north-exclusive -- any kit
--      whose xp_source is also a valid gem_source may credit dimensions
--
-- NOTE (added-value visibility): enum values added in a transaction cannot be
-- USED in that same transaction. This file only defines them; the first rows
-- using 'visit_master'/'bubble' arrive from API calls after deploy.

-- 1 + 2. enum gaps ----------------------------------------------------------
alter type public.xp_source add value if not exists 'visit_master';
alter type public.xp_source add value if not exists 'bubble';
alter type public.kit_t     add value if not exists 'focus';

alter type public.gem_source add value if not exists 'focus';
alter type public.gem_source add value if not exists 'quiet_wins';
alter type public.gem_source add value if not exists 'tame_enemy';

-- 3. currency cap (PRD: max 99999) ------------------------------------------
-- One trigger instead of editing every RPC's recompute: whatever writes
-- companions.xp, the stored value never exceeds the cap. The ledger itself
-- keeps the true sum (auditable); only the spendable balance is clamped.
create or replace function public.clamp_companion_xp()
returns trigger
language plpgsql
as $$
begin
  new.xp := least(coalesce(new.xp, 0), 99999);
  return new;
end;
$$;

drop trigger if exists trg_clamp_companion_xp on public.companions;
create trigger trg_clamp_companion_xp
  before insert or update of xp on public.companions
  for each row execute function public.clamp_companion_xp();

-- 4. submit_kit v2: dimension scores from any kit ----------------------------
-- Same signature (no caller churn). Changes against v1:
--   - the true_north-only gem guard is replaced by a source-based one: gems
--     are accepted when p_source casts to gem_source ('reflect'/'true_north'/
--     'focus'/'quiet_wins'/'tame_enemy'), rejected otherwise
--   - gem_events.source records the actual source instead of hardcoding
--     'true_north'
create or replace function public.submit_kit(
  p_user_id    uuid,
  p_kit        kit_t,
  p_source     xp_source,
  p_period_key text,
  p_local_date date,
  p_iso_week   text,
  p_xp_amount  int,
  p_gem_hits   jsonb,
  p_payload    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_id uuid;
  v_hit           jsonb;
  v_new_xp        bigint;
  v_gem_source    gem_source;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  -- Gems ride only on sources that are valid gem sources (PRD 1.2). An
  -- invalid pairing is a caller bug -- reject, never mis-record.
  if jsonb_array_length(coalesce(p_gem_hits, '[]'::jsonb)) > 0 then
    begin
      v_gem_source := p_source::text::gem_source;
    exception when invalid_text_representation then
      return jsonb_build_object('error', 'gems_not_allowed_for_source');
    end;
  end if;

  -- Once-per-period gate: the unique row is the flag. Claim it; a conflict means
  -- this Kit was already done this period. (Multi-per-day kits -- focus x2,
  -- paid tame per-enemy -- vary p_period_key at the API layer.)
  insert into public.kit_completions (user_id, kit, period_key, payload, local_date)
  values (p_user_id, p_kit, p_period_key, p_payload, p_local_date)
  on conflict (user_id, kit, period_key) do nothing
  returning id into v_completion_id;

  if v_completion_id is null then
    return jsonb_build_object('error', 'already_done_this_period');
  end if;

  if p_xp_amount > 0 then
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, p_source, p_xp_amount, v_completion_id, p_local_date, p_iso_week);
  end if;

  for v_hit in select * from jsonb_array_elements(coalesce(p_gem_hits, '[]'::jsonb))
  loop
    insert into public.gem_events (user_id, dimension, amount, source, ref_id, local_date)
    values (
      p_user_id,
      (v_hit->>'dimension')::dimension_t,
      (v_hit->>'gems')::int,
      v_gem_source,
      v_completion_id,
      p_local_date
    );
    insert into public.user_gems (user_id, dimension, total)
    values (p_user_id, (v_hit->>'dimension')::dimension_t, (v_hit->>'gems')::int)
    on conflict (user_id, dimension)
      do update set total = public.user_gems.total + excluded.total;
  end loop;

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'completion_id', v_completion_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'gem_hits', coalesce(p_gem_hits, '[]'::jsonb),
    'companion_xp', least(v_new_xp, 99999)
  );
end;
$$;

revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from public;
revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from anon;
revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from authenticated;
grant execute on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) to service_role;

-- 5. Home memory bubbles: +5 per pop, at most 5 a day (PRD 3.5) --------------
-- One row per (user, friend, item, day) is the idempotency key -- popping the
-- same bubble twice can't double-pay, and the daily count is a cheap SELECT.
create table if not exists public.bubble_pops (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles on delete cascade,
  friend_user_id uuid not null references public.profiles on delete cascade,
  item_id        text not null,
  local_date     date not null,
  created_at     timestamptz default now(),
  unique (user_id, friend_user_id, item_id, local_date)
);
alter table public.bubble_pops enable row level security;
create policy bubble_pops_select_own on public.bubble_pops
  for select using (auth.uid() = user_id);

create or replace function public.pop_bubble(
  p_user_id        uuid,
  p_friend_user_id uuid,
  p_item_id        text,
  p_local_date     date,
  p_iso_week       text,
  p_amount         int,
  p_daily_cap      int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pop_id uuid;
  v_today  int;
  v_new_xp bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  -- Only bubbles from an ACCEPTED friend pay out (the feed only shows those,
  -- so a mismatch here is a forged request, not a UX case).
  perform 1 from public.friendships
   where user_a = least(p_user_id, p_friend_user_id)
     and user_b = greatest(p_user_id, p_friend_user_id)
     and status = 'accepted';
  if not found then
    return jsonb_build_object('error', 'not_friends');
  end if;

  select count(*) into v_today from public.bubble_pops
   where user_id = p_user_id and local_date = p_local_date;
  if v_today >= p_daily_cap then
    return jsonb_build_object('error', 'daily_cap_reached');
  end if;

  insert into public.bubble_pops (user_id, friend_user_id, item_id, local_date)
  values (p_user_id, p_friend_user_id, p_item_id, p_local_date)
  on conflict (user_id, friend_user_id, item_id, local_date) do nothing
  returning id into v_pop_id;

  if v_pop_id is null then
    return jsonb_build_object('error', 'already_popped');
  end if;

  insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
  values (p_user_id, 'bubble', p_amount, v_pop_id, p_local_date, p_iso_week);

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'xp_awarded', p_amount,
    'companion_xp', least(v_new_xp, 99999)
  );
end;
$$;

revoke all on function public.pop_bubble(uuid, uuid, text, date, text, int, int) from public;
revoke all on function public.pop_bubble(uuid, uuid, text, date, text, int, int) from anon;
revoke all on function public.pop_bubble(uuid, uuid, text, date, text, int, int) from authenticated;
grant execute on function public.pop_bubble(uuid, uuid, text, date, text, int, int) to service_role;

-- 6. Fixed 81-card skill library support (ruling Q13) -------------------------
-- Cards are keyword-matched from @novame/domain's SKILL_LIBRARY, never AI.
-- card_id ties a row to its library card (idempotency: one card once);
-- tier carries the damage class (normal 20 / intermediate 30 / advanced 50);
-- dimension goes nullable because the 9th group (mega, universal) sits outside
-- the 8-dimension enum on purpose.
alter table public.skills alter column dimension drop not null;
alter table public.skills add column if not exists card_id text;
alter table public.skills add column if not exists tier text
  check (tier is null or tier in ('normal', 'intermediate', 'advanced'));
create unique index if not exists skills_user_card_unique
  on public.skills(user_id, card_id) where card_id is not null;
