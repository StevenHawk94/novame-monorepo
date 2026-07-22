-- Battle points + milestone rewards (PRD §2.4, 2026-07 ruling Q15).
--
-- Each tame banks the defeated monster's max HP (50 / 150 / 250 / 300 —
-- staged by prior tames of that monster, capped at 300) as battle points.
-- Milestones sit at growing intervals: the n-th gap is n × 1000, cumulative
-- thresholds 1000, 3000, 6000, 10000, … = 1000 × n(n+1)/2. Each crossed
-- milestone pays a currency bonus (amount comes from the API/engine — the
-- placeholder until product prices it).
--
-- record_tame_points is the atomic writer: under the per-user advisory lock
-- it banks the points, computes newly crossed milestones with the closed
-- form (mirroring engine's battleMilestoneCount — the rule lives in both
-- deliberately, like the daily gates: the RPC must not trust a caller-side
-- count), pays the bonus into xp_events, and recomputes companions.xp
-- (clamped by the 99999 trigger from the p1_economy migration).

create table if not exists public.battle_progress (
  user_id         uuid primary key references public.profiles on delete cascade,
  points          bigint not null default 0,
  milestones_paid int not null default 0,
  updated_at      timestamptz default now()
);
alter table public.battle_progress enable row level security;
create policy battle_progress_select_own on public.battle_progress
  for select using (auth.uid() = user_id);

create or replace function public.record_tame_points(
  p_user_id    uuid,
  p_points     int,
  p_local_date date,
  p_iso_week   text,
  p_base       int,   -- milestone base gap (1000)
  p_reward     int    -- currency per crossed milestone
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points     bigint;
  v_paid       int;
  v_now        int;
  v_crossed    int;
  v_bonus      int := 0;
  v_new_xp     bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  insert into public.battle_progress (user_id, points)
  values (p_user_id, greatest(0, p_points))
  on conflict (user_id) do update
    set points = public.battle_progress.points + greatest(0, p_points),
        updated_at = now()
  returning points, milestones_paid into v_points, v_paid;

  -- milestones(points) = largest n with base*n(n+1)/2 <= points
  v_now := floor((sqrt(1 + 8.0 * v_points / p_base) - 1) / 2);
  v_crossed := greatest(0, v_now - v_paid);

  if v_crossed > 0 and p_reward > 0 then
    v_bonus := v_crossed * p_reward;
    update public.battle_progress
       set milestones_paid = v_now, updated_at = now()
     where user_id = p_user_id;
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'tame_enemy', v_bonus, null, p_local_date, p_iso_week);

    select coalesce(sum(amount), 0) into v_new_xp
    from public.xp_events where user_id = p_user_id;
    update public.companions set xp = v_new_xp, last_opened_at = now()
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

revoke all on function public.record_tame_points(uuid, int, date, text, int, int) from public;
revoke all on function public.record_tame_points(uuid, int, date, text, int, int) from anon;
revoke all on function public.record_tame_points(uuid, int, date, text, int, int) from authenticated;
grant execute on function public.record_tame_points(uuid, int, date, text, int, int) to service_role;
