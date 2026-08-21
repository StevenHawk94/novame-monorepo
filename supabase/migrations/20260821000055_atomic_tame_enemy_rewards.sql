-- Atomically record a Tame Enemy completion, its fixed history points and
-- any newly crossed Clover milestones. If any reward write fails, the whole
-- completion rolls back and can be retried safely through submit_kit's unique
-- (user, kit, period_key) gate.

create or replace function public.submit_tame_enemy(
  p_user_id       uuid,
  p_period_key    text,
  p_local_date    date,
  p_iso_week      text,
  p_xp_amount     int,
  p_payload       jsonb,
  p_battle_points int,
  p_base          int,
  p_reward        int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submit    jsonb;
  v_milestone jsonb;
begin
  -- Both child functions run inside this RPC's transaction. Their shared
  -- per-user advisory lock serializes concurrent completion/reward attempts.
  v_submit := public.submit_kit(
    p_user_id,
    'tame_enemy'::public.kit_t,
    'tame_enemy'::public.xp_source,
    p_period_key,
    p_local_date,
    p_iso_week,
    p_xp_amount,
    '[]'::jsonb,
    p_payload
  );

  if v_submit->>'error' is not null then
    return v_submit;
  end if;

  v_milestone := public.record_tame_points(
    p_user_id,
    p_battle_points,
    p_local_date,
    p_iso_week,
    p_base,
    p_reward
  );

  if v_milestone->>'error' is not null then
    raise exception 'tame_enemy_reward_failed: %', v_milestone->>'error';
  end if;

  return v_submit || jsonb_build_object(
    'battle_points', greatest(0, p_battle_points),
    'battle_total_points', v_milestone->'points',
    'milestone_bonus', v_milestone->'bonus_awarded',
    'milestones_crossed', v_milestone->'milestones_crossed'
  );
end;
$$;

revoke all on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int) from public;
revoke all on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int) from anon;
revoke all on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int) from authenticated;
grant execute on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int) to service_role;
