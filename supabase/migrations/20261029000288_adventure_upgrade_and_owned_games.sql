-- Approved: one prospective 2x boost per journey, and permanent game unlocks
-- survive Plus expiry. No catalogue, reward, wallet or economic-domain edits.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Keep the original entitlement/reward snapshot immutable. This timestamp is
-- timing-only, including the legacy solo path which has no party row.
alter table public.adventures add column plus_accelerated_at timestamptz;

create or replace function public.accelerate_adventure_for_plus_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a adventures%rowtype; p adventure_parties%rowtype; partner uuid;
 accepted_at timestamptz; deadline timestamptz; fraction double precision;
begin
 partner:=lock_burrow_pair(p_user_id);
 -- Same ordering as Start/join: pair locks, ordered adventure locks, party,
 -- then personal journeys. Never lock a personal journey before its party.
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||least(p_user_id,coalesce(partner,p_user_id))::text,0));
 if partner is not null then
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||greatest(p_user_id,partner)::text,0));
 end if;
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id;
 if not found then return jsonb_build_object('error','not_found');end if;
 if not burrow_has_plus_v1(p_user_id) then return jsonb_build_object('error','plus_required');end if;
 if a.party_id is not null then
  select * into p from adventure_parties where id=a.party_id for update;
  if not found or p_user_id not in(p.leader_id,coalesce(p.follower_id,p.leader_id))
   then return jsonb_build_object('error','not_found');end if;
  -- An old couple must never be accelerated using a new partner's rights.
  if p.follower_id is not null and (partner is distinct from
    case when p_user_id=p.leader_id then p.follower_id else p.leader_id end
    or p.pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
    or not burrow_pair_economy_allowed_v1(p_user_id,partner))
   then return jsonb_build_object('error','pair_changed');end if;
  perform 1 from adventures where party_id=p.id order by user_id for update;
  accepted_at:=clock_timestamp();
  if p.plus_snapshot or a.status<>'in_progress' or p.ends_at<=accepted_at
   or exists(select 1 from adventures where party_id=p.id and status<>'in_progress') then
   return jsonb_build_object('error',null,'adventureId',a.id,'endsAt',a.ends_at,'applied',false,
    'team',adventure_team_json_v1(p.id));
  end if;
  fraction:=least(1,greatest(p.progress_fraction,p.progress_fraction+(1-p.progress_fraction)
    *extract(epoch from(accepted_at-p.progress_at))/greatest(0.001,extract(epoch from(p.ends_at-p.progress_at)))));
  deadline:=accepted_at+(p.ends_at-accepted_at)/2;
  update adventure_parties set plus_snapshot=true,progress_at=accepted_at,progress_fraction=fraction,
   ends_at=deadline,revision=revision+1 where id=p.id;
  update adventures set ends_at=deadline,plus_accelerated_at=accepted_at,
   duration_seconds=greatest(1,extract(epoch from(deadline-started_at))::integer),updated_at=accepted_at
   where party_id=p.id;
  return jsonb_build_object('error',null,'adventureId',a.id,'endsAt',deadline,'applied',true,
   'team',adventure_team_json_v1(p.id));
 end if;
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
 accepted_at:=clock_timestamp();
 if a.plus_snapshot or a.plus_accelerated_at is not null or a.status<>'in_progress' or a.ends_at<=accepted_at then
  return jsonb_build_object('error',null,'adventureId',a.id,'endsAt',a.ends_at,'applied',false);
 end if;
 deadline:=accepted_at+(a.ends_at-accepted_at)/2;
 update adventures set ends_at=deadline,plus_accelerated_at=accepted_at,
  duration_seconds=greatest(1,extract(epoch from(deadline-started_at))::integer),updated_at=accepted_at where id=a.id;
 return jsonb_build_object('error',null,'adventureId',a.id,'endsAt',deadline,'applied',true);
end $$;

create function public.apply_active_adventure_plus_v1(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a record;begin
 if not burrow_has_plus_v1(p_user) then return;end if;
 for a in select id from adventures where user_id=p_user and status='in_progress' and ends_at>clock_timestamp()
  order by id loop
  perform accelerate_adventure_for_plus_v1(p_user,a.id);
 end loop;
end $$;

-- Verified subscription reconciliation already calls this authority. Both
-- eligible accounts' independent current trips are updated, even off-screen.
alter function public.refresh_economic_entitlements_v1(uuid) rename to refresh_economic_entitlements_before288_v1;
create function public.refresh_economic_entitlements_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;partner uuid;begin
 result:=refresh_economic_entitlements_before288_v1(p_user);
 perform apply_active_adventure_plus_v1(p_user);
 partner:=lock_burrow_pair(p_user);
 if partner is not null and burrow_pair_economy_allowed_v1(p_user,partner) then
  perform apply_active_adventure_plus_v1(partner);
 end if;
 return result;
end $$;

-- Recovery for an already-verified upgrade, missed refresh or restored App.
-- Reuse the current (including temporary-pair) snapshot implementation.
alter function public.adventure_team_snapshot_v1(uuid) rename to adventure_team_snapshot_before288_v1;
create function public.adventure_team_snapshot_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user);
 perform apply_active_adventure_plus_v1(p_user);
 if partner is not null and burrow_pair_economy_allowed_v1(p_user,partner) then
  perform apply_active_adventure_plus_v1(partner);
 end if;
 return adventure_team_snapshot_before288_v1(p_user);
end $$;

-- A game-only exception to the Plus acquisition gate. Retain the ENTIRE
-- existing offer validation, including active catalogue and economic domain.
-- Existing durable zero-price/historical unlocks retain their original rights.
do $$declare original text;patched text;old_gate text;begin
 original:=pg_get_functiondef('public.burrow_service_offer_v1(uuid,text,text)'::regprocedure);
 old_gate:='if item.plus_only and not burrow_has_plus_v1(p_user) then';
 if (length(original)-length(replace(original,old_gate,'')))/length(old_gate)<>1 then
  raise exception 'Unexpected service offer Plus gate';end if;
 patched:=replace(original,old_gate,
  'if item.plus_only and not burrow_has_plus_v1(p_user) and not (p_kind=''game'' and exists('
  ||'select 1 from burrow_game_unlocks u where u.game_id=item.metadata->>''gameId'' and (u.owner_id=p_user or exists('
  ||'select 1 from pairings a join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id '
  ||'where a.user_id=p_user and u.owner_id=a.partner_user_id)))) then');
 execute patched;
end $$;

revoke all on function public.apply_active_adventure_plus_v1(uuid),
 public.refresh_economic_entitlements_before288_v1(uuid),public.adventure_team_snapshot_before288_v1(uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.accelerate_adventure_for_plus_v1(uuid,uuid),
 public.refresh_economic_entitlements_v1(uuid),public.adventure_team_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.accelerate_adventure_for_plus_v1(uuid,uuid),
 public.refresh_economic_entitlements_v1(uuid),public.adventure_team_snapshot_v1(uuid) to service_role;
notify pgrst,'reload schema';
commit;
