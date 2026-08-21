-- Launch-test fixes:
--   1. Quest check-off is idempotent for an exact same-task retry. A lost
--      HTTP response can therefore be replayed without paying twice.
--   2. True North uses a rolling seven-day cooldown from completion time,
--      rather than resetting at the next ISO-week boundary.

create or replace function public.check_quest_task(
  p_user_id          uuid,
  p_task_index       int,
  p_local_date       date,
  p_iso_week         text,
  p_default_reward   int,
  p_completion_bonus int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan          public.quest_plans%rowtype;
  v_tasks         jsonb;
  v_task          jsonb;
  v_reward        int;
  v_bonus         int := 0;
  v_total         int;
  v_checked_count int;
  v_all_done      boolean;
  v_event_id      uuid := gen_random_uuid();
  v_new_xp        bigint;
  v_spent         int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Include today's just-completed plan so a retry of the final task can be
  -- acknowledged after the first response was lost. An active plan always
  -- wins if the user has already started another one.
  select * into v_plan
  from public.quest_plans
  where user_id = p_user_id
    and (
      status = 'active'
      or (status = 'completed' and last_check_date = p_local_date)
    )
  order by case when status = 'active' then 0 else 1 end, created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error', 'no_active_plan');
  end if;
  if p_task_index < 0 or p_task_index >= jsonb_array_length(v_plan.tasks) then
    return jsonb_build_object('error', 'bad_index');
  end if;

  v_task := v_plan.tasks -> p_task_index;

  -- Exact replay: report the authoritative state but never insert another
  -- ledger event. A different task on the same date remains rejected below.
  if coalesce((v_task->>'done')::boolean, false)
     and (v_task->>'done_date')::date = p_local_date then
    select coalesce(sum(amount), 0) into v_new_xp
    from public.xp_events where user_id = p_user_id;
    select coalesce(clovers_spent, 0) into v_spent
    from public.companions where user_id = p_user_id;
    return jsonb_build_object(
      'error', null,
      'replayed', true,
      'reward', 0,
      'bonus', 0,
      'checked_count', v_plan.checked_count,
      'all_done', v_plan.status = 'completed',
      'clovers_earned', 0,
      'clover_balance', greatest(0, least(v_new_xp, 99999) - coalesce(v_spent, 0))
    );
  end if;

  if v_plan.last_check_date = p_local_date then
    return jsonb_build_object('error', 'already_checked_today');
  end if;
  if coalesce((v_task->>'done')::boolean, false) then
    return jsonb_build_object('error', 'already_done');
  end if;

  v_reward := coalesce(nullif((v_task->>'reward')::int, 0), p_default_reward);
  v_tasks := jsonb_set(
    v_plan.tasks,
    array[p_task_index::text],
    v_task || jsonb_build_object('done', true, 'done_date', p_local_date),
    false
  );

  select count(*)::int into v_checked_count
  from jsonb_array_elements(v_tasks) as task_entry(value)
  where coalesce((task_entry.value->>'done')::boolean, false);

  v_all_done := v_checked_count = jsonb_array_length(v_tasks);
  if v_all_done and not v_plan.bonus_paid then
    v_bonus := p_completion_bonus;
  end if;

  update public.quest_plans
  set tasks = v_tasks,
      last_check_date = p_local_date,
      checked_count = v_checked_count,
      status = case when v_all_done then 'completed' else status end,
      bonus_paid = case when v_all_done then true else bonus_paid end
  where id = v_plan.id;

  v_total := v_reward + v_bonus;
  insert into public.xp_events (id, user_id, source, amount, ref_id, local_date, iso_week)
  values (v_event_id, p_user_id, 'quest', v_total, v_event_id, p_local_date, p_iso_week);

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;

  update public.companions
  set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id
  returning clovers_spent into v_spent;

  if not found then
    raise exception 'companion_not_initialized';
  end if;

  return jsonb_build_object(
    'error', null,
    'replayed', false,
    'reward', v_reward,
    'bonus', v_bonus,
    'checked_count', v_checked_count,
    'all_done', v_all_done,
    'clovers_earned', v_total,
    'clover_balance', greatest(0, least(v_new_xp, 99999) - coalesce(v_spent, 0))
  );
end;
$$;

revoke all on function public.check_quest_task(uuid, int, date, text, int, int) from public;
revoke all on function public.check_quest_task(uuid, int, date, text, int, int) from anon;
revoke all on function public.check_quest_task(uuid, int, date, text, int, int) from authenticated;
grant execute on function public.check_quest_task(uuid, int, date, text, int, int) to service_role;

-- Keep the established submit_kit reward transaction as the single writer.
-- This wrapper adds only True North's rolling cooldown under the same user
-- advisory lock, then delegates the atomic completion/reward work.
create or replace function public.submit_true_north(
  p_user_id    uuid,
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
  v_last_completed_at timestamptz;
  v_next_available_at timestamptz;
  v_result            jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select created_at into v_last_completed_at
  from public.kit_completions
  where user_id = p_user_id and kit = 'true_north'
  order by created_at desc
  limit 1;

  if v_last_completed_at is not null then
    v_next_available_at := v_last_completed_at + interval '7 days';
    if v_next_available_at > now() then
      return jsonb_build_object(
        'error', 'already_done_this_period',
        'next_available_at', v_next_available_at
      );
    end if;
  end if;

  v_result := public.submit_kit(
    p_user_id,
    'true_north'::public.kit_t,
    'true_north'::public.xp_source,
    p_period_key,
    p_local_date,
    p_iso_week,
    p_xp_amount,
    p_gem_hits,
    p_payload
  );

  if coalesce(v_result->>'error', '') = '' then
    v_result := v_result || jsonb_build_object(
      'next_available_at', now() + interval '7 days'
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.submit_true_north(uuid, text, date, text, int, jsonb, jsonb) from public;
revoke all on function public.submit_true_north(uuid, text, date, text, int, jsonb, jsonb) from anon;
revoke all on function public.submit_true_north(uuid, text, date, text, int, jsonb, jsonb) from authenticated;
grant execute on function public.submit_true_north(uuid, text, date, text, int, jsonb, jsonb) to service_role;
