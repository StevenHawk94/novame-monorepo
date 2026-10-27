-- Only explicitly opted-in clients use this finite, server-selected pipeline.
insert into app_config(key,value) values('adventure_friends_v2_enabled','false') on conflict(key) do nothing;

create function public.prepare_adventure_encounters_v2(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare previous text; f friend_definitions%rowtype; d adventure_dialogues_v2%rowtype;
  g catalog_items%rowtype; n integer; revision text;
begin
  if not exists(select 1 from app_config where key='adventure_friends_v2_enabled' and value='true')
    then return jsonb_build_object('error','feature_disabled'); end if;
  if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  -- A cancelled relationship journey must not consume its reserved dialogue or gift.
  update adventure_encounter_plans p set status='cancelled' from adventures a
    where p.adventure_id=a.id and p.user_id=p_user_id and p.status='bound' and a.status='cancelled';
  select value into revision from app_config where key='app_major_update_content_revision';
  select count(*) into n from adventure_encounter_plans where user_id=p_user_id and status in('reserved','bound');
  while n<2 loop
    f:=null;d:=null;g:=null;previous:=null;
    select friend_id into previous from adventure_encounter_plans where user_id=p_user_id and status<>'cancelled' order by id desc limit 1;
    select x.* into f from friend_definitions x where x.status='active' and x.revision_id=revision
      and x.metadata->>'adventureV2'='true' and x.stable_id is distinct from previous
      and exists(select 1 from adventure_dialogues_v2 y where y.friend_id=x.stable_id and y.status='active'
        and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id=y.id)
        and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id and p.dialogue_id=y.id and p.status<>'cancelled'))
      and exists(select 1 from catalog_items y where y.status='active' and y.revision_id=revision and y.metadata->>'friendId'=x.stable_id
        and 'adventure_v2_gift'=any(y.tags)
        and not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=y.stable_id)
        and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id and p.gift_id=y.stable_id and p.status<>'cancelled'))
      order by random() limit 1;
    if f.stable_id is not null then
      select y.* into d from adventure_dialogues_v2 y where y.friend_id=f.stable_id and y.status='active'
        and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id=y.id)
        and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id and p.dialogue_id=y.id and p.status<>'cancelled')
        order by case when y.phase='Intro' then 0 else 1 end,
          case when y.phase='Intro' then y.seq::numeric else -ln(greatest(random(),0.000001))/y.weight end limit 1;
    end if;
    select y.* into g from catalog_items y where y.status='active' and y.revision_id=revision
      and 'adventure_v2_gift'=any(y.tags) and (f.stable_id is null or y.metadata->>'friendId'=f.stable_id)
      and not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=y.stable_id)
      and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id and p.gift_id=y.stable_id and p.status<>'cancelled')
      -- Direct gifts first come from friends whose dialogue is exhausted.
      -- Otherwise a single remaining friend could lose its gift pool to the
      -- interleaved no-friend days before its final dialogue is reached.
      order by case when not exists(select 1 from adventure_dialogues_v2 z
        where z.friend_id=y.metadata->>'friendId' and z.status='active'
          and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id=z.id)
          and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id and p.dialogue_id=z.id and p.status<>'cancelled'))
        then 0 else 1 end,random() limit 1;
    -- At full exhaustion a quiet return is preferable to inventing a duplicate reward.
    if g.stable_id is null then exit; end if;
    insert into adventure_encounter_plans(user_id,friend_id,dialogue_id,gift_id,snapshot)
      values(p_user_id,f.stable_id,d.id,g.stable_id,jsonb_build_object('encounterV2',true,
        'friendSnapshot',case when f.stable_id is not null then to_jsonb(f) end,
        'dialogue',case when d.id is not null then d.content end,'giftSnapshot',to_jsonb(g)));
    n:=n+1;
  end loop;
  return jsonb_build_object('error',null,'gifts',coalesce((select jsonb_agg(jsonb_build_object(
    'id',gift_id,'url',snapshot->'giftSnapshot'->'asset'->>'url') order by id)
    from adventure_encounter_plans where user_id=p_user_id and status in('reserved','bound')),'[]'::jsonb));
end $$;

create function public.start_adventure_v2(p_user_id uuid,p_record_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; r jsonb; plan_id bigint;
begin
  partner:=lock_burrow_pair(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  if not exists(select 1 from app_config where key='adventure_friends_v2_enabled' and value='true') then
    return case when partner is null then solo_burrow_start_adventure_v1(p_user_id,p_record_id,p_idempotency_key)
      else start_adventure_v1(p_user_id,p_record_id,p_idempotency_key) end; end if;
  r:=case when partner is null then solo_burrow_start_adventure_v1(p_user_id,p_record_id,p_idempotency_key)
    else start_adventure_v1(p_user_id,p_record_id,p_idempotency_key) end;
  if r->>'error' is not null or r->>'applied'<>'true' then return r; end if;
  perform prepare_adventure_encounters_v2(p_user_id);
  select id into plan_id from adventure_encounter_plans where user_id=p_user_id and status='reserved' order by id limit 1 for update;
  if plan_id is null then
    insert into adventure_encounter_plans(user_id,adventure_id,status,snapshot)
      values(p_user_id,(r->>'adventureId')::uuid,'bound','{"encounterV2":true}'::jsonb);
  else
    update adventure_encounter_plans set status='bound',adventure_id=(r->>'adventureId')::uuid where id=plan_id;
  end if;
  return r;
end $$;

-- Dispatcher leaves already-running legacy journeys and their frozen rewards untouched.
create function public.adventure_command_v2(p_user_id uuid,p_adventure_id uuid,p_action text,p_response jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare a adventures%rowtype; r adventure_results%rowtype; p adventure_encounter_plans%rowtype;
  partner uuid; kind text; choice jsonb; old jsonb;
begin
  if p_action not in('settle','respond','claim') then return jsonb_build_object('error','invalid_request'); end if;
  partner:=lock_burrow_pair(p_user_id);
  -- Same lock order as legacy inventory operations.
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into p from adventure_encounter_plans where adventure_id=a.id and user_id=p_user_id;
  if not found then
    if p_action='settle' then
      old:=settle_adventure_v1(p_user_id,p_adventure_id);
      if old->>'error' in('not_paired','not_found') then old:=solo_burrow_settle_adventure_v1(p_user_id,p_adventure_id); end if;
    elsif p_action='respond' then
      old:=complete_friend_interaction_v1(p_user_id,p_adventure_id,p_response);
      if old->>'error' in('not_paired','not_found') then old:=solo_burrow_friend_interaction_v1(p_user_id,p_adventure_id,p_response); end if;
    else
      old:=claim_adventure_result_v1(p_user_id,p_adventure_id);
      if old->>'error' in('not_paired','not_found') then old:=solo_burrow_claim_adventure_v1(p_user_id,p_adventure_id); end if;
    end if;
    return old;
  end if;
  if a.status='cancelled' or (a.partner_id<>p_user_id and a.partner_id is distinct from partner)
    then return jsonb_build_object('error','adventure_cancelled'); end if;
  select * into r from adventure_results where adventure_id=a.id for update;
  if p_action='settle' then
    if r.id is not null then return jsonb_build_object('error',null,'applied',false); end if;
    if a.status<>'in_progress' then return jsonb_build_object('error','not_in_progress'); end if;
    if a.ends_at>now() then return jsonb_build_object('error','not_ready','endsAt',a.ends_at); end if;
    kind:=case when p.friend_id is not null then 'friend' when p.gift_id is not null then 'item' else 'quiet' end;
    insert into adventure_results(adventure_id,result_type,item_id,friend_id,claim_status,metadata)
      values(a.id,kind,case when kind='item' then p.gift_id end,p.friend_id,'pending',p.snapshot);
    update adventures set status='result_ready',result_type=kind,result_id=coalesce(p.friend_id,p.gift_id),updated_at=now() where id=a.id;
    return jsonb_build_object('error',null,'applied',true,'resultType',kind);
  end if;
  if r.id is null then return jsonb_build_object('error','result_not_ready'); end if;
  if r.claim_status='claimed' then return jsonb_build_object('error',null,'applied',false,'itemId',p.gift_id); end if;
  if p_action='respond' then
    if p.friend_id is null then return jsonb_build_object('error','friend_result_not_found'); end if;
    if r.metadata->>'dialogueCompleted'='true' then return jsonb_build_object('error',null,'applied',false,'reaction',r.metadata->'reaction'); end if;
    select c into choice from jsonb_array_elements(p.snapshot->'dialogue'->'choices') c where c->>'id'=p_response->>'choiceId';
    if choice is null then return jsonb_build_object('error','invalid_response'); end if;
    update adventure_results set claim_status='interaction_required',metadata=metadata||jsonb_build_object(
      'dialogueCompleted',true,'response',jsonb_build_object('choiceId',choice->>'id'),'reaction',choice->'reaction') where id=r.id;
    update adventures set status='interaction_required',updated_at=now() where id=a.id;
    return jsonb_build_object('error',null,'applied',true,'reaction',choice->'reaction');
  end if;
  if p.friend_id is not null and coalesce(r.metadata->>'dialogueCompleted','false')<>'true'
    then return jsonb_build_object('error','interaction_required'); end if;
  if p.gift_id is not null then
    insert into user_inventory(owner_id,item_id,source,source_reference_id)
      values(p_user_id,p.gift_id,'adventure',a.id::text) on conflict(owner_id,item_id) do nothing;
  end if;
  if p.friend_id is not null then
    insert into adventure_dialogue_completions(user_id,dialogue_id,adventure_id) values(p_user_id,p.dialogue_id,a.id) on conflict do nothing;
    insert into user_friend_discoveries(user_id,friend_id,source_adventure_id,interaction_completed_at)
      values(p_user_id,p.friend_id,a.id,now()) on conflict(user_id,friend_id) do update set interaction_completed_at=now();
  end if;
  update adventure_encounter_plans set status='completed' where id=p.id;
  update adventure_results set claim_status='claimed',claimed_at=now() where id=r.id;
  update adventures set status='completed',updated_at=now() where id=a.id;
  insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,
      'adventure_completed','adventure',a.id::text,jsonb_build_object('resultType',r.result_type,'itemId',p.gift_id,'friendId',p.friend_id),
      'adventure-completed:'||a.id::text) on conflict(actor_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'applied',true,'itemId',p.gift_id,'interactionRequired',false);
end $$;

create function public.select_adventure_gift_v2(p_user_id uuid,p_item_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  if p_item_id is null then delete from adventure_gift_display where user_id=p_user_id;
  else
    if not exists(select 1 from user_inventory i join catalog_items c on c.stable_id=i.item_id
      where i.owner_id=p_user_id and i.item_id=p_item_id and 'adventure_v2_gift'=any(c.tags))
      then return jsonb_build_object('error','item_not_owned'); end if;
    insert into adventure_gift_display(user_id,gift_id) values(p_user_id,p_item_id)
      on conflict(user_id) do update set gift_id=excluded.gift_id,updated_at=now();
  end if;
  return jsonb_build_object('error',null,'applied',true,'itemId',p_item_id);
end $$;

create function public.adventure_collection_v2(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  partner:=lock_burrow_pair(p_user_id);
  return jsonb_build_object('enabled',exists(select 1 from app_config where key='adventure_friends_v2_enabled' and value='true'),
    'displays',coalesce((select jsonb_agg(to_jsonb(d)) from adventure_gift_display d
      where d.user_id in(p_user_id,partner)),'[]'::jsonb),
    'progress',coalesce((select jsonb_agg(to_jsonb(x)) from(select friend_id,count(*) completed from adventure_dialogue_completions c
      join adventure_dialogues_v2 d on d.id=c.dialogue_id where c.user_id=p_user_id group by friend_id)x),'[]'::jsonb));
end $$;
revoke all on function public.prepare_adventure_encounters_v2(uuid),public.start_adventure_v2(uuid,uuid,text),
  public.adventure_command_v2(uuid,uuid,text,jsonb),public.select_adventure_gift_v2(uuid,text),public.adventure_collection_v2(uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_adventure_encounters_v2(uuid),public.start_adventure_v2(uuid,uuid,text),
  public.adventure_command_v2(uuid,uuid,text,jsonb),public.select_adventure_gift_v2(uuid,text),public.adventure_collection_v2(uuid) to service_role;
notify pgrst,'reload schema';
