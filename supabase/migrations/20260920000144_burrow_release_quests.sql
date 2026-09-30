-- Burrow release quest cadence and durable game/toy events.
-- Existing reward claims remain untouched; legacy same-day assignments are
-- retained for audit but excluded from the new three-card response.
alter table public.moment_events
  drop constraint if exists moment_events_event_type_check;
alter table public.moment_events
  add constraint moment_events_event_type_check check (event_type in (
    'adventure_record_saved','adventure_completed','friend_discovered',
    'affection_sent','room_need_refilled','room_media_updated',
    'gift_sent','gift_claimed','memory_created','game_played','toy_interacted'
  ));

create or replace function public.assign_daily_quests_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_timezone text := 'UTC';
  v_local_date date;
  v_rotation text;
  v_required text[];
  v_result jsonb;
begin
  select coalesce(nullif(timezone_name,''),'UTC') into v_timezone
    from public.profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  v_local_date := (now() at time zone v_timezone)::date;
  v_rotation := (array[
    'play_game','water_partner_flower','feed_partner_bunny','interact_with_toy'
  ])[1 + mod(v_local_date - date '2026-01-01',4)];
  v_required := array['write_adventure_record','send_affection',v_rotation];
  perform pg_advisory_xact_lock(hashtextextended('daily-quests:'||p_user_id::text||':'||v_local_date::text,0));

  insert into public.daily_quest_assignments(user_id,local_date,quest_id,target)
  select p_user_id,v_local_date,quest_id,1 from unnest(v_required) as q(quest_id)
  on conflict(user_id,local_date,quest_id) do nothing;

  insert into public.quest_progress_vnext(assignment_id)
  select id from public.daily_quest_assignments
  where user_id=p_user_id and local_date=v_local_date and quest_id=any(v_required)
  on conflict(assignment_id) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId',q.id,'questId',q.quest_id,'target',q.target,
    'progress',p.progress,'completedAt',p.completed_at,'claimedAt',p.claimed_at
  ) order by array_position(v_required,q.quest_id)),'[]'::jsonb)
  into v_result
  from public.daily_quest_assignments q
  join public.quest_progress_vnext p on p.assignment_id=q.id
  where q.user_id=p_user_id and q.local_date=v_local_date and q.quest_id=any(v_required);

  return jsonb_build_object('error',null,'localDate',v_local_date,'quests',v_result);
end $$;

create or replace function public.burrow_moment_quest_progress()
returns trigger language plpgsql security definer set search_path=public as $$
declare quest text;
begin
  quest:=case new.event_type
    when 'affection_sent' then 'send_affection'
    when 'adventure_record_saved' then 'write_adventure_record'
    when 'game_played' then 'play_game'
    when 'toy_interacted' then 'interact_with_toy'
    when 'room_need_refilled' then case new.payload->>'need'
      when 'water' then 'water_partner_flower'
      when 'food' then 'feed_partner_bunny' end
    else null end;
  if quest is not null then
    perform public.assign_daily_quests_v1(new.actor_id);
    perform public.advance_daily_quest_v1(new.actor_id,quest,1);
  end if;
  return new;
end $$;

create or replace function public.interact_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_day date; v_inserted uuid;
begin
  if nullif(trim(p_key),'') is null then return jsonb_build_object('error','invalid_request'); end if;
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into v_day
    from public.profiles where id=p_user_id;
  insert into public.moment_events(
    pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,
    payload,idempotency_key
  ) values (
    least(p_user_id,v_partner),greatest(p_user_id,v_partner),
    p_user_id,v_partner,'toy_interacted','toy',v_day::text,
    jsonb_build_object('action','squeeze'),'toy:'||v_day::text
  ) on conflict(actor_id,idempotency_key) do nothing returning id into v_inserted;
  return jsonb_build_object('error',null,'applied',v_inserted is not null);
end $$;
revoke all on function public.interact_burrow_toy_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.interact_burrow_toy_v1(uuid,text) to service_role;

create or replace function public.burrow_game_completion_moment_v1()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.completed_at is not null or new.completed_at is null then return new; end if;
  insert into public.moment_events(
    pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,
    payload,idempotency_key
  ) values
    (new.pair_low,new.pair_high,new.pair_low,new.pair_high,'game_played',
     'game_session',new.id::text,jsonb_build_object('gameId',new.game_id),
     'game:'||new.id::text||':'||new.pair_low::text),
    (new.pair_low,new.pair_high,new.pair_high,new.pair_low,'game_played',
     'game_session',new.id::text,jsonb_build_object('gameId',new.game_id),
     'game:'||new.id::text||':'||new.pair_high::text)
  on conflict(actor_id,idempotency_key) do nothing;
  return new;
end $$;
drop trigger if exists burrow_game_completion_moment on public.burrow_game_sessions;
create trigger burrow_game_completion_moment
  after update of completed_at on public.burrow_game_sessions
  for each row execute function public.burrow_game_completion_moment_v1();

create or replace function public.burrow_special_quests_v1(p_user_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'questId',q.id,'stage',coalesce(s.claimed_stage,0)+1,
    'target',(coalesce(s.claimed_stage,0)+1)*q.step,
    'progress',q.progress,'reward',15
  ) order by q.id),'[]'::jsonb)
  from (values
    ('adventures_completed',5,(select count(*) from adventures where user_id=p_user_id and status='completed')),
    ('items_collected',10,(select count(*) from user_inventory where owner_id=p_user_id and source<>'starter')),
    ('friends_met',2,(select count(*) from user_friend_discoveries where user_id=p_user_id and interaction_completed_at is not null)),
    ('games_played',5,(select count(*) from burrow_game_sessions where completed_at is not null and p_user_id in(pair_low,pair_high)))
  ) q(id,step,progress)
  left join special_quest_progress_vnext s on s.user_id=p_user_id and s.quest_id=q.id;
$$;

create or replace function public.claim_special_quest_v1(p_user_id uuid,p_quest_id text,p_stage integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare quest jsonb; reward jsonb;
begin
  if public.lock_burrow_pair(p_user_id) is null then return jsonb_build_object('error','not_paired'); end if;
  if p_stage is null or p_stage<1 or p_quest_id not in(
    'adventures_completed','items_collected','friends_met','games_played'
  ) then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('special-quest:'||p_user_id::text,0));
  select value into quest from jsonb_array_elements(burrow_special_quests_v1(p_user_id))
    where value->>'questId'=p_quest_id;
  if p_stage<(quest->>'stage')::int then return jsonb_build_object('error',null,'applied',false); end if;
  if p_stage<>(quest->>'stage')::int or (quest->>'progress')::int<(quest->>'target')::int
    then return jsonb_build_object('error','not_completed'); end if;
  reward:=change_carrot_balance_v1(
    p_user_id,15,'special_quest','special_quest',p_quest_id||':'||p_stage,
    'special:'||p_quest_id||':'||p_stage
  );
  insert into special_quest_progress_vnext(user_id,quest_id,claimed_stage,stage,progress)
    values(p_user_id,p_quest_id,p_stage,p_stage+1,(quest->>'progress')::int)
    on conflict(user_id,quest_id) do update set claimed_stage=excluded.claimed_stage,
      stage=excluded.stage,progress=excluded.progress,updated_at=now();
  return jsonb_build_object('error',null,'applied',true,'reward',reward->'delta');
end $$;
