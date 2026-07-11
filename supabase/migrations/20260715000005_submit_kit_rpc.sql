-- submit_kit: the atomic write for one completed Kit run (C5).
--
-- The generalization of submit_reflect for the three rule-driven Kits (Quiet
-- Wins, New Lens, True North). Same contract: the engine (in the API) decides
-- the numbers -- xp amount, which dimensions get gems -- and this function is
-- the transactional writer, never a second copy of the rules. It differs from
-- submit_reflect only in that it writes a generic kit_completions row instead of
-- the Reflect-specific reflects table, and its period is a text key (day or
-- week) rather than always a date.
--
-- Owns, in one advisory-locked transaction:
--   1. the once-per-period gate (the kit_completions unique row IS the flag)
--   2. inserting kit_completions, xp_events, and (true_north only) gem_events
--   3. keeping companions.xp and user_gems.total in sync
--   4. returning a snapshot
--
-- p_gem_hits is [] for quiet_wins/new_lens (xp only) and the ranked top-3 for
-- true_north. Only true_north bears gems, so gem_events.source is hardcoded to
-- 'true_north' rather than cast from p_source -- quiet_wins/new_lens are not
-- valid gem_source values, and a caller passing gems for an xp-only kit is
-- rejected outright.
--
-- service_role only, matching submit_reflect.
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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  -- Only true_north bears gems; reject gem_hits for an xp-only kit rather than
  -- mis-record them as true_north.
  if jsonb_array_length(coalesce(p_gem_hits, '[]'::jsonb)) > 0 and p_kit <> 'true_north' then
    return jsonb_build_object('error', 'gems_only_from_true_north');
  end if;

  -- Once-per-period gate: the unique row is the flag. Claim it; a conflict means
  -- this Kit was already done this period.
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
      'true_north',
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
    'companion_xp', v_new_xp
  );
end;
$$;

revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from public;
revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from anon;
revoke all on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) from authenticated;
grant execute on function public.submit_kit(uuid, kit_t, xp_source, text, date, text, int, jsonb, jsonb) to service_role;
