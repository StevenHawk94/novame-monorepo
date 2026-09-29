-- Records keep the durable Reflect pipeline; new rewards/Moments are idempotent
-- and independent of legacy clovers. No AI is involved in the Memories Room.
create or replace function public.register_adventure_record_v1(p_user_id uuid,p_record_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; record public.reflects%rowtype; reward jsonb;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into record from reflects where id=p_record_id and user_id=p_user_id
    and journal_kind in('write_freely','tap_your_day');
  if not found or not exists(select 1 from reflect_drafts where user_id=p_user_id and finalized_reflect_id=p_record_id)
    then return jsonb_build_object('error','record_required'); end if;
  reward:=change_carrot_balance_v1(p_user_id,10,'first_daily_record','record_date',record.local_date::text,
    'record-first:'||record.local_date::text);
  insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
  values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,'adventure_record_saved','reflect',p_record_id::text,
    jsonb_build_object('journalKind',record.journal_kind),'record:'||p_record_id::text)
  on conflict(actor_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'reward',reward->'delta');
end $$;

create or replace function public.validate_burrow_record_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1')) then return new; end if;
  if public.lock_burrow_pair(new.user_id) is null then raise exception 'not_paired'; end if;
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||new.user_id::text,0));
  if new.journal_kind='remember_together' then raise exception 'journal_kind_disabled'; end if;
  if exists(select 1 from adventures where user_id=new.user_id and local_date=new.local_date)
    then raise exception 'daily_adventure_used'; end if;
  return new;
end $$;
create trigger validate_burrow_record before insert on public.reflects
  for each row execute function public.validate_burrow_record_insert();

create or replace function public.burrow_special_quests_v1(p_user_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('questId',q.id,'stage',coalesce(s.claimed_stage,0)+1,
    'target',(coalesce(s.claimed_stage,0)+1)*q.step,'progress',q.progress,'reward',15) order by q.id),'[]'::jsonb)
  from (values
    ('adventures_completed',5,(select count(*) from adventures where user_id=p_user_id and status='completed')),
    ('items_collected',10,(select count(*) from user_inventory where owner_id=p_user_id and source<>'starter')),
    ('friends_met',2,(select count(*) from user_friend_discoveries where user_id=p_user_id and interaction_completed_at is not null))
  ) q(id,step,progress) left join special_quest_progress_vnext s on s.user_id=p_user_id and s.quest_id=q.id;
$$;

create or replace function public.claim_special_quest_v1(p_user_id uuid,p_quest_id text,p_stage integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare quest jsonb; reward jsonb;
begin
  if public.lock_burrow_pair(p_user_id) is null then return jsonb_build_object('error','not_paired'); end if;
  if p_stage is null or p_stage<1 or p_quest_id not in('adventures_completed','items_collected','friends_met')
    then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('special-quest:'||p_user_id::text,0));
  select value into quest from jsonb_array_elements(burrow_special_quests_v1(p_user_id)) where value->>'questId'=p_quest_id;
  if p_stage<(quest->>'stage')::int then return jsonb_build_object('error',null,'applied',false); end if;
  if p_stage<>(quest->>'stage')::int or (quest->>'progress')::int<(quest->>'target')::int
    then return jsonb_build_object('error','not_completed'); end if;
  reward:=change_carrot_balance_v1(p_user_id,15,'special_quest','special_quest',p_quest_id||':'||p_stage,
    'special:'||p_quest_id||':'||p_stage);
  insert into special_quest_progress_vnext(user_id,quest_id,claimed_stage,stage,progress)
    values(p_user_id,p_quest_id,p_stage,p_stage+1,(quest->>'progress')::int)
    on conflict(user_id,quest_id) do update set claimed_stage=excluded.claimed_stage,stage=excluded.stage,
      progress=excluded.progress,updated_at=now();
  return jsonb_build_object('error',null,'applied',true,'reward',reward->'delta');
end $$;

create or replace function public.save_memory_room_entry_v1(p_user_id uuid,p_entry_id uuid,p_body text,p_prompt_id text,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; entry_id uuid; prior public.burrow_command_receipts%rowtype; request jsonb; response jsonb;
begin
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_body is null or char_length(trim(p_body))=0 or char_length(p_body)>5000 or nullif(trim(p_key),'') is null
    then return jsonb_build_object('error','invalid_request'); end if;
  if p_prompt_id is not null and not exists(select 1 from memory_prompts where stable_id=p_prompt_id and status='active')
    then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('memory:'||p_user_id::text,0));
  request:=jsonb_build_object('action','save_memory','entryId',p_entry_id,'body',p_body,'promptId',p_prompt_id,'partner',partner);
  select * into prior from burrow_command_receipts where actor_id=p_user_id and command_key='memory:'||p_key;
  if found then
    if prior.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return prior.response||'{"applied":false}';
  end if;
  if p_entry_id is null then
    insert into memory_room_entries(pair_low,pair_high,author_id,local_date,prompt_id,body)
    select least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,
      (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date,p_prompt_id,trim(p_body)
    from profiles where id=p_user_id returning id into entry_id;
    insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,idempotency_key)
      values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,'memory_created','memory_room_entry',entry_id::text,'memory:'||entry_id::text);
  else
    update memory_room_entries set body=trim(p_body),prompt_id=p_prompt_id,updated_at=now()
      where id=p_entry_id and author_id=p_user_id and pair_low=least(p_user_id,partner)
      and pair_high=greatest(p_user_id,partner) and deleted_at is null returning id into entry_id;
    if not found then return jsonb_build_object('error','not_found'); end if;
  end if;
  response:=jsonb_build_object('error',null,'applied',true,'entryId',entry_id);
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'memory:'||p_key,request,response);
  return response;
end $$;

create or replace function public.delete_memory_room_entry_v1(p_user_id uuid,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  update memory_room_entries set deleted_at=coalesce(deleted_at,now()),updated_at=now()
    where id=p_entry_id and author_id=p_user_id and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner);
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('error',null,'applied',true);
end $$;

revoke all on function public.register_adventure_record_v1(uuid,uuid),public.validate_burrow_record_insert(),
  public.burrow_special_quests_v1(uuid),public.claim_special_quest_v1(uuid,text,integer),
  public.save_memory_room_entry_v1(uuid,uuid,text,text,text),public.delete_memory_room_entry_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.register_adventure_record_v1(uuid,uuid),public.burrow_special_quests_v1(uuid),
  public.claim_special_quest_v1(uuid,text,integer),public.save_memory_room_entry_v1(uuid,uuid,text,text,text),
  public.delete_memory_room_entry_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
