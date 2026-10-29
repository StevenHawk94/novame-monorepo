-- Approved four-action care contract. No existing balances, needs, receipts,
-- Moments, assignments or histories are rewritten. Production requires approval.
begin;
create table public.room_care_actions_v2 (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  care_action text not null check(care_action in('carrot','water','leaf','fertilizer')),
  completed_at timestamptz not null,
  primary key(owner_id,care_action)
);
alter table public.room_care_actions_v2 enable row level security;
revoke all on public.room_care_actions_v2 from public,anon,authenticated,service_role;
grant select on public.room_care_actions_v2 to service_role;

-- Legacy care remains its original protocol. Attribute its cooldown by role,
-- without rewriting a delayed food command as a leaf command or granting coins.
create function public.room_care_last_v2(p_owner uuid,p_action text)
returns timestamptz language sql stable security definer set search_path=public,pg_temp as $$
 select greatest(
  (select completed_at from room_care_actions_v2 where owner_id=p_owner and care_action=p_action),
  (select max(created_at) from moment_events where target_id=p_owner and event_type='room_need_refilled'
   and payload->>'careVersion' is distinct from '2'
   and payload->>'need'=case when p_action in('carrot','leaf') then 'food' else 'water' end
   and (case when p_action in('carrot','water') then actor_id=p_owner else actor_id<>p_owner end))
 )
$$;
create function public.room_care_state_v2(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;version text;owner uuid;kind text;last_at timestamptz;rooms jsonb:='{}';states jsonb;
begin
 partner:=lock_burrow_pair(p_user_id);
 if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found');end if;
 version:=case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end;
 foreach owner in array array[p_user_id,partner] loop
  if owner is null then continue;end if;
  states:='{}';
  foreach kind in array array['carrot','water','leaf','fertilizer'] loop
   last_at:=room_care_last_v2(owner,kind);
   states:=states||jsonb_build_object(kind,jsonb_build_object('lastAt',last_at,'nextAt',last_at+interval '12 hours'));
  end loop;
  rooms:=rooms||jsonb_build_object(case when owner=p_user_id then 'own' else 'partner' end,states);
 end loop;
 return jsonb_build_object('version',2,'actorId',p_user_id,'partnerId',partner,'pairVersion',version,
  'own',rooms->'own','partner',rooms->'partner');
end $$;

create function public.complete_room_care_v2(p_user_id uuid,p_owner_id uuid,p_action text,
 p_partner_id uuid,p_pair_version text,p_local_date date,p_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;version text;today date;last_at timestamptz;request jsonb;result jsonb;
 receipt burrow_command_receipts%rowtype;credit jsonb;reward integer:=0;reward_key text;reason text;need text;
begin
 if p_owner_id is null or p_action is null or p_action not in('carrot','water','leaf','fertilizer')
  or nullif(trim(p_key),'') is null or length(p_key)>200 or p_local_date is null
  then return jsonb_build_object('error','invalid_request');end if;
 partner:=lock_burrow_pair(p_user_id);
 version:=case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end;
 request:=jsonb_build_object('owner',p_owner_id,'action',p_action,'partner',p_partner_id,'pairVersion',p_pair_version,'day',p_local_date);
 -- A committed actor-owned receipt remains committed after a rematch/day
 -- change. It is inert: no old-room write, new reward or private room read.
 select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='care-v2:'||trim(p_key);
 if found then
  if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict');end if;
  return receipt.response||jsonb_build_object('applied',false,'reward',0,
    'coinReward',jsonb_build_object('key',receipt.response->'coinReward'->>'key','amount',0));
 end if;
 if partner is distinct from p_partner_id or version is distinct from p_pair_version
  then return jsonb_build_object('error','pair_changed');end if;
 if (p_action in('carrot','water') and p_owner_id<>p_user_id)
  or (p_action in('leaf','fertilizer') and (partner is null or p_owner_id is distinct from partner))
  then return jsonb_build_object('error','care_target_not_allowed');end if;
 -- Same canonical pair/room locks as legacy writers. Same actor serializes
 -- the reward check even when two devices submit different action keys.
 perform pg_advisory_xact_lock(hashtextextended('room-need:'||p_owner_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_user_id::text,0));
 -- Recheck after the writer locks (especially concurrent unpaired devices).
 select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='care-v2:'||trim(p_key);
 if found then
  if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict');end if;
  return receipt.response||jsonb_build_object('applied',false,'reward',0,
    'coinReward',jsonb_build_object('key',receipt.response->'coinReward'->>'key','amount',0));
 end if;
 today:=(now() at time zone economic_timezone_v1(p_user_id))::date;
 if today<>p_local_date then return jsonb_build_object('error','day_changed');end if;
 last_at:=room_care_last_v2(p_owner_id,p_action);
 if last_at>now()-interval '12 hours' then return jsonb_build_object('error','care_cooldown','nextAt',last_at+interval '12 hours');end if;
 reward_key:=case p_action when 'leaf' then 'room-need-reward:food:' when 'fertilizer' then 'room-need-reward:water:'
  else 'room-care-reward:'||p_action||':' end||today::text;
 reason:=case p_action when 'leaf' then 'partner_feed' when 'fertilizer' then 'partner_water' else 'self_'||p_action end;
 if not exists(select 1 from currency_ledger where user_id=p_user_id and idempotency_key=reward_key) then
  credit:=change_carrot_balance_v1(p_user_id,5,reason,'room_need',p_owner_id::text,reward_key);
  if credit->>'error' is not null then return credit;end if;
  reward:=coalesce((credit->>'delta')::integer,0);
 end if;
 insert into room_care_actions_v2 values(p_owner_id,p_action,now())
  on conflict(owner_id,care_action) do update set completed_at=excluded.completed_at;
 -- Only the owner's carrot/water actions refill their original need meters.
 if p_action in('carrot','water') then
  insert into room_needs(owner_id) values(p_owner_id) on conflict do nothing;
  if p_action='carrot' then update room_needs set food_value=100,food_updated_at=now() where owner_id=p_owner_id;
  else update room_needs set water_value=100,water_updated_at=now() where owner_id=p_owner_id;end if;
 end if;
 need:=case p_action when 'carrot' then 'food' else p_action end;
 insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
 values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,p_owner_id,
  'room_need_refilled','room_need',p_owner_id::text,jsonb_build_object('careVersion',2,'careAction',p_action,'need',need),'care-v2:'||trim(p_key));
 result:=jsonb_build_object('error',null,'applied',true,'reward',reward,'completedAt',now(),'careAction',p_action,
  'coinReward',jsonb_build_object('key',reward_key,'amount',reward));
 insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'care-v2:'||trim(p_key),request,result);
 return result;
end $$;

-- Owner-only carrot/water quests, including legacy own care. Preserve the toy
-- recording guard, economic calendar and every unrelated trigger branch.
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.burrow_moment_quest_progress()'::regprocedure);
 patched:=replace(original,'quest:=case new.event_type',
  'if new.event_type=''room_need_refilled'' and new.target_id is distinct from new.actor_id then return new;end if;
 quest:=case new.event_type');
 if patched=original then raise exception 'Unexpected care quest trigger';end if;
 execute patched;
end $$;
revoke all on function public.room_care_last_v2(uuid,text),public.room_care_state_v2(uuid),
 public.complete_room_care_v2(uuid,uuid,text,uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.room_care_state_v2(uuid),public.complete_room_care_v2(uuid,uuid,text,uuid,text,date,text) to service_role;
notify pgrst,'reload schema';
commit;
