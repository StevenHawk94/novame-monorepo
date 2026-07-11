-- submit_reflect (C5 update): add source_kit so a reflect routed in from a Kit
-- (New Lens's "I see it differently") records its origin. Appended with a
-- default of null, so the shape is unchanged for a normal reflect -- only the
-- New Lens path passes it. Everything else is identical to the C2.2 version.
--
-- The parameter list changed, so the old 8-arg function is dropped first;
-- create-or-replace can't alter a signature. Production has no live users, so
-- the drop/recreate window is safe.
drop function if exists public.submit_reflect(uuid, smallint, text, date, text, int, jsonb);

create or replace function public.submit_reflect(
  p_user_id        uuid,
  p_prompt_id      smallint,
  p_body           text,
  p_local_date     date,
  p_iso_week       text,
  p_xp_amount      int,
  p_dimension_hits jsonb,
  p_source_kit     kit_t default null
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

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  select count(*) into v_today_count
  from public.reflects
  where user_id = p_user_id and local_date = p_local_date;
  if v_today_count >= 3 then
    return jsonb_build_object('error', 'daily_limit_reached', 'used', v_today_count);
  end if;

  insert into public.reflects (user_id, prompt_id, body, dimension_hits, local_date, source_kit)
  values (p_user_id, p_prompt_id, p_body, p_dimension_hits, p_local_date, p_source_kit)
  returning id into v_reflect_id;

  if p_xp_amount > 0 then
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'reflect', p_xp_amount, v_reflect_id, p_local_date, p_iso_week);
  end if;

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

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

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

revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t) from public;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t) from anon;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t) from authenticated;
grant execute on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t) to service_role;
