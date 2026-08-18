-- Preserve any Quest Clovers written by the legacy route directly to
-- companions.xp. Without this backfill, the next ledger-based Kit completion
-- would recompute xp from xp_events and erase that historical difference.
with ledger as (
  select user_id, coalesce(sum(amount), 0)::bigint as total
  from public.xp_events
  group by user_id
)
insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
select
  c.user_id,
  'quest'::public.xp_source,
  (c.xp - coalesce(l.total, 0))::int,
  gen_random_uuid(),
  current_date,
  to_char(current_date, 'IYYY-"W"IW')
from public.companions c
left join ledger l on l.user_id = c.user_id
where c.xp > coalesce(l.total, 0);

-- Atomically checks one Quest task, pays its 30 Clover reward plus the final
-- 200 Clover completion bonus, records the ledger event, and updates the
-- cached companion total under the same per-user advisory lock.
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

  select * into v_plan
  from public.quest_plans
  where user_id = p_user_id and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('error', 'no_active_plan');
  end if;
  if v_plan.last_check_date = p_local_date then
    return jsonb_build_object('error', 'already_checked_today');
  end if;
  if p_task_index < 0 or p_task_index >= jsonb_array_length(v_plan.tasks) then
    return jsonb_build_object('error', 'bad_index');
  end if;

  v_task := v_plan.tasks -> p_task_index;
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
