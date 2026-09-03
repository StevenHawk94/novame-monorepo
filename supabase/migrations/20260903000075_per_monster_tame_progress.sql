-- Tame History belongs to an individual monster, not to the user globally.
-- Every monster starts at 0 points and each successful tame adds exactly 50
-- points to that monster only. Keep the legacy battle_progress table intact
-- for audit/rollback safety; new reads and writes use this per-monster table.

create table if not exists public.monster_battle_progress (
  user_id         uuid not null references public.profiles on delete cascade,
  monster_id      text not null check (length(monster_id) > 0),
  points          bigint not null default 0 check (points >= 0),
  milestones_paid int not null default 0 check (milestones_paid >= 0),
  updated_at      timestamptz not null default now(),
  primary key (user_id, monster_id)
);

alter table public.monster_battle_progress enable row level security;
drop policy if exists monster_battle_progress_select_own on public.monster_battle_progress;
create policy monster_battle_progress_select_own on public.monster_battle_progress
  for select using (auth.uid() = user_id);
revoke all privileges on table public.monster_battle_progress from public, anon, authenticated;
grant all privileges on table public.monster_battle_progress to service_role;

-- Reconstruct each monster's score from the authoritative completion ledger.
-- Mark already-crossed per-monster milestones as paid so rollout cannot issue
-- historical rewards a second time.
with tame_totals as (
  select
    user_id,
    payload->>'monster_id' as monster_id,
    count(*)::bigint * 50 as points
  from public.kit_completions
  where kit = 'tame_enemy'
    and nullif(payload->>'monster_id', '') is not null
  group by user_id, payload->>'monster_id'
)
insert into public.monster_battle_progress (
  user_id, monster_id, points, milestones_paid, updated_at
)
select
  user_id,
  monster_id,
  points,
  floor((sqrt(1 + 8.0 * points / 1000) - 1) / 2)::int,
  now()
from tame_totals
on conflict (user_id, monster_id) do update
set points = excluded.points,
    milestones_paid = excluded.milestones_paid,
    updated_at = excluded.updated_at;

create or replace function public.record_monster_tame_points(
  p_user_id    uuid,
  p_monster_id text,
  p_points     int,
  p_local_date date,
  p_iso_week   text,
  p_base       int,
  p_reward     int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points  bigint;
  v_paid    int;
  v_now     int;
  v_crossed int;
  v_bonus   int := 0;
  v_new_xp  bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if nullif(p_monster_id, '') is null then
    return jsonb_build_object('error', 'invalid_monster');
  end if;

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  insert into public.monster_battle_progress (user_id, monster_id, points)
  values (p_user_id, p_monster_id, greatest(0, p_points))
  on conflict (user_id, monster_id) do update
    set points = public.monster_battle_progress.points + greatest(0, p_points),
        updated_at = now()
  returning points, milestones_paid into v_points, v_paid;

  -- Milestones now advance independently for each monster.
  v_now := floor((sqrt(1 + 8.0 * v_points / p_base) - 1) / 2);
  v_crossed := greatest(0, v_now - v_paid);

  if v_crossed > 0 and p_reward > 0 then
    v_bonus := v_crossed * p_reward;
    update public.monster_battle_progress
       set milestones_paid = v_now, updated_at = now()
     where user_id = p_user_id and monster_id = p_monster_id;

    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'tame_enemy', v_bonus, null, p_local_date, p_iso_week);

    select coalesce(sum(amount), 0) into v_new_xp
    from public.xp_events where user_id = p_user_id;
    update public.companions
       set xp = v_new_xp, last_opened_at = now()
     where user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'error', null,
    'points', v_points,
    'milestones', v_now,
    'milestones_crossed', v_crossed,
    'bonus_awarded', v_bonus
  );
end;
$$;

revoke all on function public.record_monster_tame_points(uuid, text, int, date, text, int, int) from public;
revoke all on function public.record_monster_tame_points(uuid, text, int, date, text, int, int) from anon;
revoke all on function public.record_monster_tame_points(uuid, text, int, date, text, int, int) from authenticated;
grant execute on function public.record_monster_tame_points(uuid, text, int, date, text, int, int) to service_role;

-- Preserve the API-facing signature while switching the atomic points writer
-- from the shared user total to the selected monster's total.
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
  v_submit     jsonb;
  v_milestone  jsonb;
  v_monster_id text := nullif(p_payload->>'monster_id', '');
begin
  if v_monster_id is null then
    return jsonb_build_object('error', 'invalid_monster');
  end if;

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

  v_milestone := public.record_monster_tame_points(
    p_user_id,
    v_monster_id,
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
    'progress_scope', 'monster',
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

notify pgrst, 'reload schema';
