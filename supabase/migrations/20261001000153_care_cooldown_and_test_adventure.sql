-- Care is once per twelve hours per room/need. The existing refill routines
-- remain the single writers of needs, rewards, and moment events. These
-- wrappers hold their room lock while checking the durable care event, so two
-- devices cannot both pass the cooldown test.
create index if not exists moment_events_room_care_recent
  on public.moment_events(target_id, created_at desc)
  where event_type = 'room_need_refilled';

create or replace function public.interact_room_need_with_cooldown_v1(
  p_actor_id uuid, p_owner_id uuid, p_need text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_partner uuid; v_last timestamptz;
begin
  if p_need is null or p_need not in ('food','water') or nullif(trim(p_idempotency_key),'') is null
    then return jsonb_build_object('error','invalid_request'); end if;
  v_partner := public.lock_burrow_pair(p_actor_id);
  if v_partner is null or (p_actor_id <> p_owner_id and v_partner is distinct from p_owner_id)
    then return jsonb_build_object('error','not_paired'); end if;
  perform pg_advisory_xact_lock(hashtextextended('room-need:'||p_owner_id::text,0));
  -- A network retry with the same key must replay its receipt, not become a
  -- new attempt blocked by the successful first call.
  if exists(select 1 from public.burrow_command_receipts
    where actor_id=p_actor_id and command_key='refill:'||trim(p_idempotency_key))
    then return public.interact_room_need_v1(p_actor_id,p_owner_id,p_need,p_idempotency_key); end if;
  select max(created_at) into v_last from public.moment_events
    where target_id=p_owner_id and event_type='room_need_refilled' and payload->>'need'=p_need;
  if v_last > now()-interval '12 hours'
    then return jsonb_build_object('error','care_cooldown','nextAt',v_last+interval '12 hours'); end if;
  return public.interact_room_need_v1(p_actor_id,p_owner_id,p_need,p_idempotency_key);
end $$;

create or replace function public.solo_burrow_care_with_cooldown_v1(
  p_user_id uuid, p_need text, p_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  if p_need is null or p_need not in ('food','water') or nullif(trim(p_key),'') is null
    then return jsonb_build_object('error','invalid_request'); end if;
  if public.lock_burrow_pair(p_user_id) is not null
    then return jsonb_build_object('error','pair_changed'); end if;
  perform pg_advisory_xact_lock(hashtextextended('room-need:'||p_user_id::text,0));
  if exists(select 1 from public.moment_events
    where actor_id=p_user_id and idempotency_key='room-need:'||p_key)
    then return public.solo_burrow_care_v1(p_user_id,p_need,p_key); end if;
  select max(created_at) into v_last from public.moment_events
    where target_id=p_user_id and event_type='room_need_refilled' and payload->>'need'=p_need;
  if v_last > now()-interval '12 hours'
    then return jsonb_build_object('error','care_cooldown','nextAt',v_last+interval '12 hours'); end if;
  return public.solo_burrow_care_v1(p_user_id,p_need,p_key);
end $$;

revoke all on function public.interact_room_need_with_cooldown_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.interact_room_need_with_cooldown_v1(uuid,uuid,text,text) to service_role;
revoke all on function public.solo_burrow_care_with_cooldown_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.solo_burrow_care_with_cooldown_v1(uuid,text,text) to service_role;

-- Temporary one-minute Adventure for hands-on testing. This applies only to
-- newly started journeys; existing in-progress journeys are left intact.
create or replace function public.burrow_test_adventure_duration_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  new.duration_seconds := 60;
  new.ends_at := new.started_at + interval '1 minute';
  return new;
end $$;
drop trigger if exists burrow_test_adventure_duration on public.adventures;
create trigger burrow_test_adventure_duration before insert on public.adventures
  for each row execute function public.burrow_test_adventure_duration_v1();
