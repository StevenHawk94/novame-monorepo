-- Approved ongoing-page states and previous-day claim recovery. Local candidate;
-- no journey merge, quota reset, reward mutation or new economic-domain access.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$begin
 if to_regprocedure('public.adventure_team_snapshot_before288_v1(uuid)') is null
  or to_regprocedure('public.apply_active_adventure_plus_v1(uuid)') is null
 then raise exception 'Adventure timing migration 288 must be installed first';end if;
end $$;

create function public.adventure_nudge_status_v1(p_user uuid,p_party uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p adventure_parties%rowtype; partner uuid; today date; trip adventures%rowtype;
 used_today boolean; reason text;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('reason','unpaired');end if;
 select * into p from adventure_parties where id=p_party;
 if not found or p.leader_id<>p_user or p.partner_id is distinct from partner
  or p.pair_version is distinct from burrow_pair_version_v1(p_user,partner)
  then return jsonb_build_object('reason','relationship_unavailable');end if;
 if not burrow_pair_economy_allowed_v1(p_user,partner)
  then return jsonb_build_object('reason','economy_restricted');end if;
 if p.follower_id is not null then return jsonb_build_object('reason','couple');end if;
 if p.ends_at<=now()+interval '10 minutes'
  or not exists(select 1 from adventures where id=p.leader_adventure_id and user_id=p_user and status='in_progress')
  then return jsonb_build_object('reason','own_finishing');end if;
 today:=(now() at time zone economic_timezone_v1(partner))::date;
 select exists(select 1 from adventures where user_id=partner and local_date=today) into used_today;
 select * into trip from adventures where user_id=partner and status='in_progress' and ends_at>now()
  order by created_at desc,id desc limit 1;
 if found then
  reason:=case when trip.ends_at<=now()+interval '10 minutes' then 'partner_finishing' else 'partner_adventuring' end;
  return jsonb_build_object('reason',reason,'partnerEndsAt',trip.ends_at,'partnerUsedToday',used_today);
 end if;
 -- A due/settled previous-day trip still needs its original complete claim
 -- before Start. It does NOT consume today's invitation eligibility. The
 -- original Start transaction still enforces claim order, day and >600s.
 return jsonb_build_object('reason',case when used_today then 'partner_finished' else 'available' end);
end $$;

create or replace function public.adventure_nudge_eligible_v1(p_user uuid,p_party uuid) returns boolean
language sql security definer set search_path=public,pg_temp as $$
 select coalesce(adventure_nudge_status_v1(p_user,p_party)->>'reason'='available',false);
$$;

-- Preserve 285's scoped recovery and 288's verified one-time speed repair.
-- Only append narrow availability metadata; no partner log/results are read out.
alter function public.adventure_team_snapshot_v1(uuid) rename to adventure_team_snapshot_before289_v1;
create function public.adventure_team_snapshot_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshot jsonb;availability jsonb;
begin
 snapshot:=adventure_team_snapshot_before289_v1(p_user);
 availability:=adventure_nudge_status_v1(p_user,(snapshot->'team'->>'id')::uuid);
 return snapshot||jsonb_build_object('nudgeStatus',availability,
  'nudgeAvailable',coalesce(availability->>'reason'='available',false));
end $$;

revoke all on function public.adventure_nudge_status_v1(uuid,uuid),public.adventure_nudge_eligible_v1(uuid,uuid),
 public.adventure_team_snapshot_before289_v1(uuid),public.adventure_team_snapshot_v1(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.adventure_team_snapshot_v1(uuid) to service_role;
notify pgrst,'reload schema';
commit;
