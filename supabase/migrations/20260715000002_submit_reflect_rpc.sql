-- submit_reflect: the atomic write for one Reflect submission (C2.2).
--
-- The engine (TypeScript, in /api/reflect) has already decided the numbers: how
-- much XP, which dimensions get gems and how much each. This function does NOT
-- re-derive any of that -- it is the transactional writer, not a second copy of
-- the rules. Passing computed values in (rather than recomputing in plpgsql) is
-- what keeps the economy rules in exactly one place and kills the exp.js-style
-- drift where client and server each had their own formula.
--
-- What it owns, all inside one advisory-locked transaction:
--   1. the daily-count gate (3/day) -- concurrency-sensitive, must be in the lock
--   2. inserting the reflect, xp_events, gem_events rows
--   3. keeping companions.xp and user_gems.total in sync (same txn, atomic)
--   4. returning a complete state snapshot for the client to adopt as-is
--
-- The pet must already exist: onboarding creates the companions row before a
-- user can ever reach Reflect, so a missing row is a bug, and this fails loud
-- (companion_not_initialized) rather than writing xp nothing will sum.
--
-- Called only by /api/reflect (service_role); revoked from anon/authenticated
-- so PostgREST does not expose it, matching insert_wisdom_card_if_under_quota.
create or replace function public.submit_reflect(
  p_user_id        uuid,
  p_prompt_id      smallint,
  p_body           text,
  p_local_date     date,
  p_iso_week       text,
  p_xp_amount      int,
  p_dimension_hits jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_count int;
  v_reflect_id  uuid;
  v_hit         jsonb;
  v_new_xp      bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- The pet must exist (onboarding guarantees it). Fail loud rather than write
  -- xp nothing will sum. perform + "if not found" checks existence without
  -- binding the row to a variable.
  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  -- Daily gate: three reflects a day, checked in the lock so two concurrent
  -- submits cannot both see "2 so far" and both write a fourth.
  select count(*) into v_today_count
  from public.reflects
  where user_id = p_user_id and local_date = p_local_date;
  if v_today_count >= 3 then
    return jsonb_build_object('error', 'daily_limit_reached', 'used', v_today_count);
  end if;

  insert into public.reflects (user_id, prompt_id, body, dimension_hits, local_date)
  values (p_user_id, p_prompt_id, p_body, p_dimension_hits, p_local_date)
  returning id into v_reflect_id;

  -- XP ledger (skip a zero award). ref_id ties the event to this reflect; the
  -- unique index dedups a retried submit.
  if p_xp_amount > 0 then
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'reflect', p_xp_amount, v_reflect_id, p_local_date, p_iso_week);
  end if;

  -- Gem ledger + summary, one dimension at a time, from the engine's list.
  for v_hit in select * from jsonb_array_elements(p_dimension_hits)
  loop
    insert into public.gem_events (user_id, dimension, amount, source, ref_id, local_date)
    values (
      p_user_id,
      (v_hit->>'dimension')::dimension_t,
      (v_hit->>'gems')::int,
      'reflect',
      v_reflect_id,
      p_local_date
    );
    insert into public.user_gems (user_id, dimension, total)
    values (p_user_id, (v_hit->>'dimension')::dimension_t, (v_hit->>'gems')::int)
    on conflict (user_id, dimension)
      do update set total = public.user_gems.total + excluded.total;
  end loop;

  -- Keep companions.xp in sync in the same transaction. Recomputed from the
  -- ledger (sum) rather than += so it is self-correcting, not drift-prone.
  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  -- Complete snapshot for the client to adopt as-is (server authority).
  return jsonb_build_object(
    'error', null,
    'reflect_id', v_reflect_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'dimension_hits', p_dimension_hits,
    'companion_xp', v_new_xp,
    'reflects_today', v_today_count + 1,
    'reflects_remaining', 3 - (v_today_count + 1)
  );
end;
$$;

revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb) from public;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb) from anon;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb) from authenticated;
grant execute on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb) to service_role;
