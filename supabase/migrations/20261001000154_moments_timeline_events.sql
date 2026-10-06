-- Moments records completed actions only. Toy touches are counted on one daily
-- event, while Rage gets an event only after its completion row is committed.
alter table public.moment_events drop constraint if exists moment_events_event_type_check;
alter table public.moment_events add constraint moment_events_event_type_check check (event_type in (
  'adventure_record_saved','adventure_completed','friend_discovered',
  'affection_sent','room_need_refilled','room_media_updated',
  'gift_sent','gift_claimed','memory_created','game_played',
  'toy_interacted','room_decor_changed','rage_room_completed'
));

-- The love-note composer stores the letter in Memories Room. Label the
-- resulting moment without changing the journal entry's body or visibility.
create or replace function public.burrow_classify_memory_moment_v1()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.event_type='memory_created' and new.reference_type='memory_room_entry'
    and exists(select 1 from public.memory_room_entries e
      where e.id::text=new.reference_id and left(e.body,2)='💌 ') then
    new.payload:=coalesce(new.payload,'{}'::jsonb)||jsonb_build_object('kind','love_note');
  end if;
  return new;
end $$;
drop trigger if exists burrow_classify_memory_moment on public.moment_events;
create trigger burrow_classify_memory_moment before insert on public.moment_events
  for each row execute function public.burrow_classify_memory_moment_v1();
update public.moment_events m set payload=coalesce(m.payload,'{}'::jsonb)||jsonb_build_object('kind','love_note')
  from public.memory_room_entries e
  where m.event_type='memory_created' and m.reference_type='memory_room_entry'
    and m.reference_id=e.id::text and left(e.body,2)='💌 '
    and m.payload->>'kind' is distinct from 'love_note';

create or replace function public.burrow_rage_completion_moment_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  if new.kit::text<>'tame_enemy' or new.payload->>'economy'<>'carrots' then return new; end if;
  partner:=public.lock_burrow_pair(new.user_id);
  if partner is null then return new; end if;
  insert into public.moment_events(pair_low,pair_high,actor_id,target_id,event_type,
    reference_type,reference_id,payload,idempotency_key)
  values(least(new.user_id,partner),greatest(new.user_id,partner),new.user_id,partner,
    'rage_room_completed','kit_completion',new.id::text,
    jsonb_build_object('monsterId',new.payload->>'monster_id'),'rage-completed:'||new.id::text)
  on conflict(actor_id,idempotency_key) do nothing;
  return new;
end $$;
drop trigger if exists burrow_rage_completion_moment on public.kit_completions;
create trigger burrow_rage_completion_moment after insert on public.kit_completions
  for each row execute function public.burrow_rage_completion_moment_v1();

create or replace function public.interact_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; local_day date; request jsonb; result jsonb; event_key text;
  receipt public.burrow_command_receipts%rowtype; touches integer;
begin
  if nullif(trim(p_key),'') is null or length(p_key)>200 then return jsonb_build_object('error','invalid_request'); end if;
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day
    from public.profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('toy:'||p_user_id::text||':'||local_day::text,0));
  request:=jsonb_build_object('day',local_day,'partner',partner);
  select * into receipt from public.burrow_command_receipts
    where actor_id=p_user_id and command_key='toy-touch:'||p_key;
  if found then
    if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return receipt.response||jsonb_build_object('applied',false);
  end if;
  -- Reuse an existing same-pair daily event, but never update an old
  -- partner's event if the user changed partners during the same day.
  select idempotency_key into event_key from public.moment_events
    where actor_id=p_user_id and event_type='toy_interacted' and reference_id=local_day::text
      and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)
    order by created_at desc limit 1;
  event_key:=coalesce(event_key,'toy-v2:'||local_day::text||':'||partner::text);
  insert into public.moment_events(pair_low,pair_high,actor_id,target_id,event_type,
    reference_type,reference_id,payload,idempotency_key)
  values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,partner,
    'toy_interacted','toy',local_day::text,jsonb_build_object('action','touch','count',1),
    event_key)
  on conflict(actor_id,idempotency_key) do update set
    payload=jsonb_set(public.moment_events.payload,'{count}',
      to_jsonb(coalesce((public.moment_events.payload->>'count')::integer,1)+1)),
    created_at=now()
  returning (payload->>'count')::integer into touches;
  result:=jsonb_build_object('error',null,'applied',true,'count',touches);
  insert into public.burrow_command_receipts(actor_id,command_key,request,response)
    values(p_user_id,'toy-touch:'||p_key,request,result);
  return result;
end $$;
revoke all on function public.interact_burrow_toy_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.interact_burrow_toy_v1(uuid,text) to service_role;

create or replace function public.solo_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare local_day date; request jsonb; result jsonb; event_key text;
  receipt public.burrow_command_receipts%rowtype; touches integer;
begin
  if nullif(trim(p_key),'') is null or length(p_key)>200 then return jsonb_build_object('error','invalid_request'); end if;
  if public.lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day
    from public.profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('toy:'||p_user_id::text||':'||local_day::text,0));
  request:=jsonb_build_object('day',local_day,'partner',null);
  select * into receipt from public.burrow_command_receipts
    where actor_id=p_user_id and command_key='toy-touch:'||p_key;
  if found then
    if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return receipt.response||jsonb_build_object('applied',false);
  end if;
  select idempotency_key into event_key from public.moment_events
    where actor_id=p_user_id and event_type='toy_interacted' and reference_id=local_day::text
      and pair_low=p_user_id and pair_high=p_user_id
    order by created_at desc limit 1;
  event_key:=coalesce(event_key,'toy-v2:'||local_day::text||':solo');
  insert into public.moment_events(pair_low,pair_high,actor_id,target_id,event_type,
    reference_type,reference_id,payload,idempotency_key)
  values(p_user_id,p_user_id,p_user_id,p_user_id,'toy_interacted','toy',local_day::text,
    jsonb_build_object('action','touch','count',1),event_key)
  on conflict(actor_id,idempotency_key) do update set
    payload=jsonb_set(public.moment_events.payload,'{count}',
      to_jsonb(coalesce((public.moment_events.payload->>'count')::integer,1)+1)),
    created_at=now()
  returning (payload->>'count')::integer into touches;
  result:=jsonb_build_object('error',null,'applied',true,'count',touches);
  insert into public.burrow_command_receipts(actor_id,command_key,request,response)
    values(p_user_id,'toy-touch:'||p_key,request,result);
  return result;
end $$;
revoke all on function public.solo_burrow_toy_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.solo_burrow_toy_v1(uuid,text) to service_role;
notify pgrst,'reload schema';
