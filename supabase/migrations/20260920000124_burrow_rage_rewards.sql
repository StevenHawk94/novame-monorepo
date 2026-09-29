-- Preserve Rage gameplay/history, replace its legacy currency awards in vNext.
-- The server owns local day, daily cap, idempotency, history points and +5.
create function public.submit_burrow_rage_v1(p_user_id uuid,p_monster_id text,p_hits integer,p_skills jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; today date; count_today integer; points_total bigint;
  receipt public.burrow_command_receipts%rowtype; request jsonb; result jsonb; reward jsonb;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_monster_id is null or p_monster_id not in('the_swallower','overthinking','procrastination','the_fog',
    'the_spiral','the_hollow','the_comparer','the_wall') or p_hits is distinct from 20
    or p_skills is null or jsonb_typeof(p_skills)<>'array'
    or nullif(trim(p_key),'') is null or length(p_key)>200 then return jsonb_build_object('error','invalid_request'); end if;
  if jsonb_array_length(p_skills)<>1 or jsonb_typeof(p_skills->0)<>'string'
    or (p_skills->>0) !~ ('^'||p_monster_id||'-final-(original|challenge|permission|protective|fallback)-[1-4]$')
    then return jsonb_build_object('error','invalid_request'); end if;
  -- Same legacy per-user lock as submit_tame_enemy during gradual deployment.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  request:=jsonb_build_object('monster',p_monster_id,'hits',p_hits,'skills',p_skills,'partner',partner);
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into today from profiles where id=p_user_id;
  select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='rage:'||p_key;
  if found then
    if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return receipt.response||jsonb_build_object('applied',false,'carrotsAwarded',0,'battlePoints',0,'localDate',today,
      'tamesToday',(select count(*) from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today),
      'tamedToday',exists(select 1 from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today and payload->>'monster_id'=p_monster_id),
      'tamedCount',(select count(*) from kit_completions where user_id=p_user_id and kit='tame_enemy' and payload->>'monster_id'=p_monster_id),
      'battleTotalPoints',(select points from monster_battle_progress where user_id=p_user_id and monster_id=p_monster_id));
  end if;
  select count(*) into count_today from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today;
  if exists(select 1 from kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=today
    and payload->>'monster_id'=p_monster_id) then
    return jsonb_build_object('error','already_done','tamesToday',count_today,'dailyLimit',2); end if;
  if count_today>=2 then return jsonb_build_object('error','daily_limit_reached','tamesToday',count_today,'dailyLimit',2); end if;
  insert into kit_completions(user_id,kit,period_key,payload,local_date)
    values(p_user_id,'tame_enemy',today::text||':'||p_monster_id,
      jsonb_build_object('monster_id',p_monster_id,'skills_used',p_skills,'hits',20,'economy','carrots'),today);
  insert into monster_battle_progress(user_id,monster_id,points) values(p_user_id,p_monster_id,50)
    on conflict(user_id,monster_id) do update set points=monster_battle_progress.points+50,updated_at=now()
    returning points into points_total;
  reward:=change_carrot_balance_v1(p_user_id,5,'first_daily_rage','local_date',today::text,'rage-first:'||today::text);
  result:=jsonb_build_object('error',null,'applied',true,'xp_awarded',0,'milestoneBonus',0,
    'carrotsAwarded',reward->'delta','battlePoints',50,'battleTotalPoints',points_total,
    'tamesToday',count_today+1,'dailyLimit',2,'localDate',today,'tamedToday',true,
    'tamedCount',(select count(*) from kit_completions where user_id=p_user_id and kit='tame_enemy' and payload->>'monster_id'=p_monster_id));
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'rage:'||p_key,request,result);
  return result;
end $$;
revoke all on function public.submit_burrow_rage_v1(uuid,text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_burrow_rage_v1(uuid,text,integer,jsonb,text) to service_role;
notify pgrst,'reload schema';
