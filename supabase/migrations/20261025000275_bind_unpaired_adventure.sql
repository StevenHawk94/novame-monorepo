-- A v5 solo journey may start BEFORE connecting. Bind only its still-empty
-- relationship scope once the reciprocal pair AND both generation rows exist.
-- Do not reset a timer, upgrade speed, merge existing trips, or touch rewards.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Qualify the relationship-version variable. The v274 snapshot used the same
-- name as a table column and failed for paired, same-domain users. Replacing
-- the body preserves its existing service-only grants and response contract.
create or replace function public.adventure_team_snapshot_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; own_id uuid; own_party uuid; candidate uuid; v_pair_version text;begin
 partner:=lock_burrow_pair(p_user);
 if partner is not null then v_pair_version:=burrow_pair_version_v1(p_user,partner);end if;
 select id,party_id into own_id,own_party from adventures where user_id=p_user
  and status in('in_progress','result_ready','interaction_required') order by created_at desc limit 1;
 if partner is not null and same_economic_domain_v1(p_user,partner) then
  select p.id into candidate from adventure_parties p join adventures a on a.id=p.leader_adventure_id
   where p.leader_id=partner and p.partner_id=p_user and p.pair_version=v_pair_version
    and p.follower_id is null and a.status='in_progress' and p.ends_at>now()+interval '10 minutes'
   order by p.started_at desc limit 1;
 end if;
 return jsonb_build_object('userId',p_user,'partnerId',partner,'pairVersion',v_pair_version,'adventureId',own_id,
  'team',adventure_team_json_v1(own_party),'joinable',adventure_team_json_v1(candidate),
  'nudgeAvailable',coalesce(adventure_nudge_eligible_v1(p_user,own_party),false));
end $$;

create index adventure_unbound_leader on public.adventure_parties(leader_id)
 where partner_id is null and pair_version is null and follower_id is null;

create function public.bind_unpaired_adventures_v1(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;version text;cutoff timestamptz;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null or not same_economic_domain_v1(p_user,partner) then return;end if;
 version:=burrow_pair_version_v1(p_user,partner);
 if version is null then return;end if;
 -- Same pair/inventory -> ordered adventure locks as start_adventure_v5.
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||least(p_user,partner)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||greatest(p_user,partner)::text,0));
 cutoff:=clock_timestamp()+interval '10 minutes';
 update adventure_parties p set partner_id=case when p.leader_id=p_user then partner else p_user end,
  pair_version=version,revision=p.revision+1
 where p.leader_id in(p_user,partner) and p.partner_id is null and p.pair_version is null
  and p.follower_id is null and p.rule_version=5 and p.ends_at>cutoff
  and exists(select 1 from adventures a where a.id=p.leader_adventure_id and a.user_id=p.leader_id
   and a.party_id=p.id and a.status='in_progress' and a.ends_at>cutoff);
 -- The existing party trigger emits only adventure_changed after commit.
end $$;

create function public.bind_adventure_after_pair_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare who uuid;begin
 -- Statement-level transition rows are intentional: a row trigger could bind
 -- before the OTHER pairing row's generation trigger has rotated its version.
 for who in select distinct user_id from adventure_pair_new_rows order by user_id loop
  perform bind_unpaired_adventures_v1(who);
 end loop;
 return null;
end $$;
create trigger adventure_bind_pair_insert after insert on public.pairings
 referencing new table as adventure_pair_new_rows for each statement
 execute function public.bind_adventure_after_pair_v1();
create trigger adventure_bind_pair_update after update on public.pairings
 referencing new table as adventure_pair_new_rows for each statement
 execute function public.bind_adventure_after_pair_v1();

-- Recover the same case for pairs established before this patch. Eligibility
-- and relationship generation are rechecked under the same locks. A formerly
-- bound party (even with a deleted partner FK) is NEVER rebound to a new pair.
do $$declare who uuid;begin
 for who in select distinct p.leader_id from public.adventure_parties p
  join public.pairings a on a.user_id=p.leader_id
  join public.pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
  where p.partner_id is null and p.pair_version is null and p.follower_id is null
   and p.ends_at>clock_timestamp()+interval '10 minutes' order by p.leader_id loop
  perform public.bind_unpaired_adventures_v1(who);
 end loop;
end $$;

revoke all on function public.bind_unpaired_adventures_v1(uuid),public.bind_adventure_after_pair_v1()
 from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
