-- Release Room: per-person daily entitlement, repeatable monsters and per-run
-- rewards. Keep all existing personal history; no daily/weekly content ceiling.
begin;
create index kit_completions_release_history on public.kit_completions(user_id,(payload->>'monster_id'),created_at desc) where kit='tame_enemy';
create function public.release_room_status_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; today date; paid boolean; used integer; monsters jsonb;
begin
 if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found'); end if;
 partner:=lock_burrow_pair(p_user_id);
 select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into today from profiles where id=p_user_id;
 paid:=burrow_has_plus_v1(p_user_id);
 select count(*) into used from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today;
 select jsonb_agg(jsonb_build_object('id',m.id,
  'tamedCount',(select count(*) from kit_completions where user_id=p_user_id and kit='tame_enemy' and payload->>'monster_id'=m.id),
  'lastTamedAt',(select max(created_at) from kit_completions where user_id=p_user_id and kit='tame_enemy' and payload->>'monster_id'=m.id),
  'partnerTamedCount',case when partner is null then null else (select count(*) from kit_completions where user_id=partner and kit='tame_enemy' and payload->>'monster_id'=m.id) end,
  'partnerLastTamedAt',case when partner is null then null else (select max(created_at) from kit_completions where user_id=partner and kit='tame_enemy' and payload->>'monster_id'=m.id) end
 ) order by m.position) into monsters from (values
  ('the_swallower',1),('overthinking',2),('procrastination',3),('the_fog',4),
  ('the_spiral',5),('the_hollow',6),('the_comparer',7),('the_wall',8)) as m(id,position);
 return jsonb_build_object('error',null,'monsters',monsters,'hasPlus',paid,'dailyLimit',case when paid then 2 else 1 end,
  'tamesToday',used,'localDate',today,'serverNow',now(),'partnerId',partner,
  'pairVersion',case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end);
end $$;

create function public.submit_release_room_v1(p_user_id uuid,p_monster_id text,p_dialogue_id text,p_choice integer,
 p_key text,p_partner_id uuid,p_pair_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; today date; used integer; cap integer; total integer; completion uuid; points_total bigint;
 request jsonb; result jsonb; reward jsonb; receipt burrow_command_receipts%rowtype;
begin
 if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
  then return jsonb_build_object('error','feature_disabled'); end if;
 if p_monster_id is null or p_monster_id not in('the_swallower','overthinking','procrastination','the_fog','the_spiral','the_hollow','the_comparer','the_wall')
  or p_dialogue_id is null or p_dialogue_id !~ '^r(0[1-9]|[1-4][0-9]|50)$' or p_choice is null or p_choice not between 0 and 3
  or nullif(trim(p_key),'') is null or length(p_key)>200 then return jsonb_build_object('error','invalid_request'); end if;
 if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found'); end if;
 partner:=lock_burrow_pair(p_user_id);
 if partner is distinct from p_partner_id or (partner is not null and p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner))
  then return jsonb_build_object('error','pair_changed'); end if;
 if partner is null then perform lock_burrow_inventory(p_user_id,p_user_id); end if;
 -- Same per-user lock as legacy submit_tame_enemy; two devices/old clients
 -- cannot reserve a third completion, or race a Free account past its cap.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 request:=jsonb_build_object('monster',p_monster_id,'dialogue',p_dialogue_id,'choice',p_choice,'partner',partner,'pairVersion',p_pair_version);
 select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='release:'||p_key;
 if found then
  if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
  return receipt.response||jsonb_build_object('applied',false,'carrotsAwarded',0,
   'coinReward',jsonb_build_object('key','release:'||p_key,'amount',0),'status',release_room_status_v1(p_user_id));
 end if;
 select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into today from profiles where id=p_user_id;
 cap:=case when burrow_has_plus_v1(p_user_id) then 2 else 1 end;
 select count(*) into used from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today;
 if used>=cap then return jsonb_build_object('error','daily_limit_reached','tamesToday',used,'dailyLimit',cap,'status',release_room_status_v1(p_user_id)); end if;
 insert into kit_completions(user_id,kit,period_key,local_date,payload)
 values(p_user_id,'tame_enemy',today::text||':release:'||md5(p_key),today,
  jsonb_build_object('monster_id',p_monster_id,'skills_used',jsonb_build_array(p_monster_id||'-final-'||p_dialogue_id||'-'||(p_choice+1)),
   'hits',20,'economy','carrots','release_room',true,'dialogue_id',p_dialogue_id,'choice',p_choice)) returning id into completion;
 insert into monster_battle_progress(user_id,monster_id,points) values(p_user_id,p_monster_id,50)
 on conflict(user_id,monster_id) do update set points=monster_battle_progress.points+50,updated_at=now() returning points into points_total;
 reward:=change_carrot_balance_v1(p_user_id,10,'release_room_completed','kit_completion',completion::text,'release:'||p_key);
 -- An unexpected wallet failure must roll back the completion and quota too.
 if reward->>'error' is not null then raise exception 'Release wallet failure: %',reward->>'error'; end if;
 select count(*) into total from kit_completions where user_id=p_user_id and kit='tame_enemy' and payload->>'monster_id'=p_monster_id;
 result:=jsonb_build_object('error',null,'applied',true,'completionId',completion,'carrotsAwarded',reward->'delta',
  'coinReward',jsonb_build_object('key','release:'||p_key,'amount',reward->'delta'),
  'localDate',today,'tamesToday',used+1,'dailyLimit',cap,'tamedCount',total,'victoryIndex',(total-1)%5,
  'battlePoints',50,'battleTotalPoints',points_total,'xp_awarded',0,'milestoneBonus',0,'tamedToday',true,'status',release_room_status_v1(p_user_id));
 insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'release:'||p_key,request,result);
 return result;
end $$;

-- Legacy app submissions share the new limits. No older paid endpoint may
-- bypass Free's limit or leave the second Plus completion without its reward.
create or replace function public.submit_burrow_rage_v1(p_user_id uuid,p_monster_id text,p_hits integer,p_skills jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; skill text; variant text; dialogue text; choice integer; prior burrow_command_receipts%rowtype;
begin
 if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
  then return jsonb_build_object('error','feature_disabled'); end if;
 if p_hits is distinct from 20 or p_skills is null or jsonb_typeof(p_skills)<>'array' or nullif(trim(p_key),'') is null or length(p_key)>200
  then return jsonb_build_object('error','invalid_request'); end if;
 if jsonb_array_length(p_skills)<>1 or jsonb_typeof(p_skills->0)<>'string' or p_monster_id is null then return jsonb_build_object('error','invalid_request'); end if;
 skill:=p_skills->>0;
 if skill !~ ('^'||p_monster_id||'-final-(original|challenge|permission|protective|fallback)-[1-4]$') then return jsonb_build_object('error','invalid_request'); end if;
 partner:=lock_burrow_pair(p_user_id);
 select * into prior from burrow_command_receipts where actor_id=p_user_id and command_key='rage:'||p_key;
 if found then
  if prior.request<>jsonb_build_object('monster',p_monster_id,'hits',20,'skills',p_skills,'partner',partner)
   or (partner is not null and prior.created_at<burrow_relation_started_at_v1(p_user_id,partner)) then return jsonb_build_object('error','idempotency_conflict'); end if;
  return prior.response||jsonb_build_object('applied',false,'carrotsAwarded',0,'battlePoints',0);
 end if;
 variant:=substring(skill from '-final-([a-z]+)-');choice:=right(skill,1)::integer-1;
 dialogue:=case variant when 'challenge' then 'r02' when 'permission' then 'r03' when 'protective' then 'r04' else 'r01' end;
 return submit_release_room_v1(p_user_id,p_monster_id,dialogue,choice,p_key,partner,
  case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end);
end $$;
revoke all on function public.release_room_status_v1(uuid),public.submit_release_room_v1(uuid,text,text,integer,text,uuid,text) from public,anon,authenticated;
grant execute on function public.release_room_status_v1(uuid),public.submit_release_room_v1(uuid,text,text,integer,text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
