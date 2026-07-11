-- submit_lens: complete one New Lens run (C5).
--
-- Everything submit_kit does -- once-per-day gate, +20 xp, a kit_completions
-- row, companion.xp resync -- PLUS advancing the per-theme cursor, which the
-- generic writer knows nothing about. Keeping both in one transaction means xp
-- and cursor can never disagree. No gems (xp-only). Both responses complete the
-- day and pay the same; 'different' additionally routes the user to Reflect
-- afterward (a client concern).
create or replace function public.submit_lens(
  p_user_id    uuid,
  p_theme      dimension_t,
  p_card_id    uuid,
  p_card_order int,
  p_response   text,
  p_local_date date,
  p_iso_week   text,
  p_xp_amount  int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_id uuid;
  v_new_xp        bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  insert into public.kit_completions (user_id, kit, period_key, payload, local_date)
  values (
    p_user_id, 'new_lens', p_local_date::text,
    jsonb_build_object('theme', p_theme, 'card_id', p_card_id, 'response', p_response),
    p_local_date
  )
  on conflict (user_id, kit, period_key) do nothing
  returning id into v_completion_id;

  if v_completion_id is null then
    return jsonb_build_object('error', 'already_done_this_period');
  end if;

  if p_xp_amount > 0 then
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'new_lens', p_xp_amount, v_completion_id, p_local_date, p_iso_week);
  end if;

  insert into public.lens_progress (user_id, theme, last_card_order, updated_at)
  values (p_user_id, p_theme, p_card_order, now())
  on conflict (user_id, theme)
    do update set last_card_order = excluded.last_card_order, updated_at = now();

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'completion_id', v_completion_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'companion_xp', v_new_xp,
    'response', p_response
  );
end;
$$;

revoke all on function public.submit_lens(uuid, dimension_t, uuid, int, text, date, text, int) from public;
revoke all on function public.submit_lens(uuid, dimension_t, uuid, int, text, date, text, int) from anon;
revoke all on function public.submit_lens(uuid, dimension_t, uuid, int, text, date, text, int) from authenticated;
grant execute on function public.submit_lens(uuid, dimension_t, uuid, int, text, date, text, int) to service_role;
