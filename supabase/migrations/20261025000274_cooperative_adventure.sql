-- Cooperative protocol is opt-in. All NEW solo journeys use Free 6h / Plus 3h;
-- existing journeys retain their dates, reserved results and legacy receipts.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.device_push_tokens add column adventure_version integer not null default 4;
insert into public.app_config(key,value) values('adventure_timing_v5_since',now()::text) on conflict(key) do nothing;
do $$declare target regprocedure;original text;patched text;begin
 foreach target in array array['public.start_adventure_v1(uuid,uuid,text)'::regprocedure,
  'public.solo_burrow_start_adventure_v1(uuid,uuid,text)'::regprocedure] loop
  original:=pg_get_functiondef(target);
  if strpos(original,'then 7200 else 21600')=0 then raise exception 'Unexpected production timing writer: %',target;end if;
  patched:=replace(original,'then 7200 else 21600','then 10800 else 21600');execute patched;
 end loop;
end $$;
create table public.adventure_parties (
 id uuid primary key default gen_random_uuid(),
 leader_adventure_id uuid not null unique references public.adventures(id) on delete cascade,
 leader_id uuid not null references public.profiles(id) on delete cascade,
 follower_id uuid references public.profiles(id) on delete set null,
 partner_id uuid references public.profiles(id) on delete set null,
 pair_version text,
 rule_version integer not null default 5 check(rule_version=5),
 plus_snapshot boolean not null,
 started_at timestamptz not null,
 progress_at timestamptz not null,
 progress_fraction double precision not null default 0 check(progress_fraction>=0 and progress_fraction<=1),
 ends_at timestamptz not null,
 revision integer not null default 1,
 nudged_at timestamptz,
 check(follower_id is null or follower_id<>leader_id)
);
alter table public.adventure_parties enable row level security;
revoke all on public.adventure_parties from public,anon,authenticated;
grant select on public.adventure_parties to service_role;
alter table public.adventures add column party_id uuid references public.adventure_parties(id) on delete set null;
create unique index adventure_party_member on public.adventures(party_id,user_id) where party_id is not null;

create function public.adventure_party_signal_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  for recipient in select distinct x from unnest(array[new.leader_id,new.partner_id]) x where x is not null loop
   perform realtime.send('{}'::jsonb,'adventure_changed','burrow:'||recipient::text,true);
  end loop;
 end if;
 return new;
exception when others then return new;
end $$;
create trigger adventure_party_signal after insert or update on public.adventure_parties
 for each row execute function public.adventure_party_signal_v1();

create function public.adventure_team_json_v1(p_party uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',p.id,'version',p.revision,'ruleVersion',p.rule_version,
  'leaderId',p.leader_id,'followerId',p.follower_id,'partnerId',p.partner_id,'pairVersion',p.pair_version,
  'plus',p.plus_snapshot,'startedAt',p.started_at,'progressAt',p.progress_at,
  'progressFraction',p.progress_fraction,'endsAt',p.ends_at,'nudged',p.nudged_at is not null,
  'leaderVariant',coalesce(a.variant,'biscuit'),'followerVariant',coalesce(b.variant,'biscuit'))
 from adventure_parties p left join bunny_identities a on a.user_id=p.leader_id
 left join bunny_identities b on b.user_id=p.follower_id where p.id=p_party
$$;

create function public.adventure_nudge_eligible_v1(p_user uuid,p_party uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare p adventure_parties%rowtype; partner uuid;begin
 select * into p from adventure_parties where id=p_party;
 if not found or p.leader_id<>p_user or p.follower_id is not null or p.ends_at<=now()+interval '10 minutes' then return false;end if;
 partner:=lock_burrow_pair(p_user);
 if partner is null or partner is distinct from p.partner_id or p.pair_version is distinct from burrow_pair_version_v1(p_user,partner)
  or not same_economic_domain_v1(p_user,partner) then return false;end if;
 return exists(select 1 from adventures where id=p.leader_adventure_id and status='in_progress')
  and not exists(select 1 from adventures where user_id=partner and (status in('in_progress','result_ready','interaction_required')
   or local_date=(now() at time zone economic_timezone_v1(partner))::date));
end $$;

create function public.adventure_team_snapshot_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; own_id uuid; own_party uuid; candidate uuid; pair_version text;begin
 partner:=lock_burrow_pair(p_user);
 if partner is not null then pair_version:=burrow_pair_version_v1(p_user,partner);end if;
 select id,party_id into own_id,own_party from adventures where user_id=p_user
  and status in('in_progress','result_ready','interaction_required') order by created_at desc limit 1;
 if partner is not null and same_economic_domain_v1(p_user,partner) then
  select p.id into candidate from adventure_parties p join adventures a on a.id=p.leader_adventure_id
   where p.leader_id=partner and p.partner_id=p_user and p.pair_version=pair_version
    and p.follower_id is null and a.status='in_progress' and p.ends_at>now()+interval '10 minutes'
   order by p.started_at desc limit 1;
 end if;
 return jsonb_build_object('userId',p_user,'partnerId',partner,'pairVersion',pair_version,'adventureId',own_id,
  'team',adventure_team_json_v1(own_party),'joinable',adventure_team_json_v1(candidate),
  'nudgeAvailable',coalesce(adventure_nudge_eligible_v1(p_user,own_party),false));
end $$;

create function public.start_adventure_v5(p_user_id uuid,p_record_id uuid,p_idempotency_key text,p_catalog_release text,p_partner_id uuid,p_pair_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; version text; candidate adventure_parties%rowtype; mine adventures%rowtype;
 receipt jsonb; old burrow_command_receipts%rowtype; intent jsonb; duration_value integer;
 party uuid; fraction double precision; deadline timestamptz; accepted_at timestamptz;
begin
 if nullif(trim(p_idempotency_key),'') is null or p_record_id is null or p_catalog_release is null
  then return jsonb_build_object('error','invalid_request');end if;
 partner:=lock_burrow_pair(p_user_id);
 if partner is distinct from p_partner_id or (case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end) is distinct from p_pair_version
  then return jsonb_build_object('error','pair_changed');end if;
 -- Pair inventory locks above already serialize both starts. Explicitly order
 -- Adventure locks too; no reverse lock acquisition in join/settlement.
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||least(p_user_id,coalesce(partner,p_user_id))::text,0));
 if partner is not null then perform pg_advisory_xact_lock(hashtextextended('adventure:'||greatest(p_user_id,partner)::text,0));end if;
 intent:=jsonb_build_object('action','start_adventure_v5','recordId',p_record_id,'catalogRelease',p_catalog_release,'partnerId',p_partner_id,'pairVersion',p_pair_version);
 select * into old from burrow_command_receipts where actor_id=p_user_id and command_key='adventure-v5:'||trim(p_idempotency_key);
 if found then
  if old.request<>intent then return jsonb_build_object('error','idempotency_conflict');end if;
  return old.response;
 end if;
 if not exists(select 1 from app_config where key='adventure_friends_v2_enabled' and value='true')
  then return jsonb_build_object('error','feature_disabled');end if;
 -- Reuse ALL personal log/quota/entitlement/content/reward reservation rules.
 receipt:=start_burrow_adventure_catalog_v1(p_user_id,p_record_id,p_idempotency_key,p_catalog_release);
 if receipt->>'error' is not null then return receipt;end if;
 select * into mine from adventures where id=(receipt->>'adventureId')::uuid and user_id=p_user_id for update;
 -- An old protocol receipt is not permission to reinterpret an old journey.
 if receipt->>'applied'<>'true' then return jsonb_build_object('error','idempotency_conflict');end if;
 accepted_at:=clock_timestamp(); -- evaluate cutoff AFTER lock waits/reservations
 if partner is not null then version:=burrow_pair_version_v1(p_user_id,partner);end if;
 if partner is not null and same_economic_domain_v1(p_user_id,partner) then
  select p.* into candidate from adventure_parties p join adventures a on a.id=p.leader_adventure_id
   where p.leader_id=partner and p.partner_id=p_user_id and p.pair_version=version
    and p.follower_id is null and a.status='in_progress' and p.ends_at>accepted_at+interval '10 minutes'
   order by p.started_at desc limit 1 for update of p;
 end if;
 if candidate.id is not null then
  fraction:=least(1,greatest(candidate.progress_fraction,
   candidate.progress_fraction+(1-candidate.progress_fraction)*extract(epoch from(accepted_at-candidate.progress_at))
    /greatest(0.001,extract(epoch from(candidate.ends_at-candidate.progress_at)))));
  deadline:=accepted_at+(candidate.ends_at-accepted_at)/1.5;
  update adventure_parties set follower_id=p_user_id,progress_at=accepted_at,progress_fraction=fraction,
   ends_at=deadline,revision=revision+1 where id=candidate.id;
  party:=candidate.id;
  update adventures set ends_at=deadline,duration_seconds=greatest(1,extract(epoch from(deadline-started_at))::integer),updated_at=accepted_at
   where id=candidate.leader_adventure_id;
 else
  duration_value:=case when mine.plus_snapshot then 10800 else 21600 end;
  deadline:=accepted_at+make_interval(secs=>duration_value);
  insert into adventure_parties(leader_adventure_id,leader_id,partner_id,pair_version,plus_snapshot,started_at,progress_at,ends_at)
   values(mine.id,p_user_id,partner,version,mine.plus_snapshot,accepted_at,accepted_at,deadline) returning id into party;
 end if;
 update adventures set party_id=party,started_at=accepted_at,ends_at=deadline,
  duration_seconds=greatest(1,extract(epoch from(deadline-accepted_at))::integer),updated_at=accepted_at where id=mine.id;
 receipt:=receipt||jsonb_build_object('endsAt',deadline,'durationSeconds',greatest(1,extract(epoch from(deadline-accepted_at))::integer),
  'team',adventure_team_json_v1(party),'joined',candidate.id is not null);
 insert into burrow_command_receipts(actor_id,command_key,request,response)
  values(p_user_id,'adventure-v5:'||trim(p_idempotency_key),intent,receipt);
 return receipt;
end $$;

create function public.nudge_adventure_v1(p_user uuid,p_party uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p adventure_parties%rowtype; partner uuid; old burrow_command_receipts%rowtype;intent jsonb;receipt jsonb;begin
 if p_key is null then return jsonb_build_object('error','invalid_request');end if;
 partner:=lock_burrow_pair(p_user);
 intent:=jsonb_build_object('action','nudge_adventure_v1','partyId',p_party);
 select * into old from burrow_command_receipts where actor_id=p_user and command_key='adventure-nudge:'||p_key::text;
 if found then
  if old.request<>intent then return jsonb_build_object('error','idempotency_conflict');end if;
  return old.response;
 end if;
 select * into p from adventure_parties where id=p_party and leader_id=p_user for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if p.nudged_at is not null then
  receipt:=jsonb_build_object('alreadySent',true);
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user,'adventure-nudge:'||p_key::text,intent,receipt);
  return receipt;
 end if;
 if not adventure_nudge_eligible_v1(p_user,p_party) then return jsonb_build_object('error','adventure_invite_unavailable');end if;
 insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
  values(partner,'adventure-nudge:'||p.id,'adventure_invite',jsonb_build_object('partyId',p.id,'senderId',p_user,
   'pairVersion',p.pair_version),p.ends_at-interval '10 minutes') on conflict(recipient_user_id,event_key) do nothing;
 update adventure_parties set nudged_at=now(),revision=revision+1 where id=p.id;
 receipt:=jsonb_build_object('alreadySent',false);
 insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user,'adventure-nudge:'||p_key::text,intent,receipt);
 return receipt;
end $$;

-- Existing upgrade commands must not mutate frozen v5 party deadlines.
alter function public.accelerate_adventure_for_plus_v1(uuid,uuid) rename to accelerate_adventure_before_party_v1;
create function public.accelerate_adventure_for_plus_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a adventures%rowtype;begin
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id;
 if found and (a.party_id is not null or a.started_at>=(select value::timestamptz from app_config where key='adventure_timing_v5_since'))
  then return jsonb_build_object('error',null,'adventureId',a.id,'endsAt',a.ends_at,'speedLocked',true);end if;
 return accelerate_adventure_before_party_v1(p_user_id,p_adventure_id);
end $$;

-- Wrap, don't replace, existing game/affection/surprise notification eligibility.
alter function public.system_notification_context_v1(uuid,text,jsonb) rename to system_notification_context_before_party_v1;
create function public.system_notification_context_v1(p_user uuid,p_type text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p adventure_parties%rowtype;name text;begin
 if p_type<>'adventure_invite' then return system_notification_context_before_party_v1(p_user,p_type,p_payload);end if;
 select * into p from adventure_parties where id=(p_payload->>'partyId')::uuid and partner_id=p_user;
 if not found or p.leader_id::text is distinct from p_payload->>'senderId' or p.pair_version is distinct from p_payload->>'pairVersion'
  then return jsonb_build_object('allowed',false);end if;
 select display_name into name from profiles where id=p.leader_id;
 return jsonb_build_object('allowed',adventure_nudge_eligible_v1(p.leader_id,p.id),'partnerName',name);
exception when invalid_text_representation then return jsonb_build_object('allowed',false);
end $$;

create function public.burrow_character_snapshot_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare identity jsonb;adventure jsonb;begin
 identity:=bunny_identity_v1(p_user,false);adventure:=adventure_team_snapshot_v1(p_user);
 return jsonb_build_object('identity',identity,'adventure',adventure);
end $$;

revoke all on function public.burrow_character_snapshot_v1(uuid),public.adventure_party_signal_v1(),public.adventure_team_json_v1(uuid),
 public.adventure_nudge_eligible_v1(uuid,uuid),public.adventure_team_snapshot_v1(uuid),public.start_adventure_v5(uuid,uuid,text,text,uuid,text),
 public.nudge_adventure_v1(uuid,uuid,uuid),public.accelerate_adventure_before_party_v1(uuid,uuid),
 public.accelerate_adventure_for_plus_v1(uuid,uuid),public.system_notification_context_before_party_v1(uuid,text,jsonb),
 public.system_notification_context_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.burrow_character_snapshot_v1(uuid),public.adventure_team_snapshot_v1(uuid),public.start_adventure_v5(uuid,uuid,text,text,uuid,text),
 public.nudge_adventure_v1(uuid,uuid,uuid),public.accelerate_adventure_for_plus_v1(uuid,uuid),
 public.system_notification_context_v1(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
