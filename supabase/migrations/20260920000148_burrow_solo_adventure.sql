-- A personal adventure is a real, durable journey. Pairing later must not
-- erase its record or turn its reward into a partner-owned object.
create or replace function public.validate_burrow_record_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||new.user_id::text,0));
  if new.journal_kind='remember_together' then raise exception 'journal_kind_disabled'; end if;
  if exists(select 1 from adventures where user_id=new.user_id and local_date=new.local_date)
    then raise exception 'daily_adventure_used'; end if;
  return new;
end $$;

create or replace function public.register_adventure_record_v1(p_user_id uuid,p_record_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; record reflects%rowtype; reward jsonb;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=coalesce(lock_burrow_pair(p_user_id),p_user_id);
  select * into record from reflects where id=p_record_id and user_id=p_user_id
    and journal_kind in('write_freely','tap_your_day');
  if not found or not exists(select 1 from reflect_drafts where user_id=p_user_id and finalized_reflect_id=p_record_id)
    then return jsonb_build_object('error','record_required'); end if;
  reward:=change_carrot_balance_v1(p_user_id,10,'first_daily_record','record_date',record.local_date::text,
    'record-first:'||record.local_date::text);
  if reward->>'error' is not null then return reward; end if;
  insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,'adventure_record_saved','reflect',
      p_record_id::text,jsonb_build_object('journalKind',record.journal_kind),'record:'||p_record_id::text)
    on conflict(actor_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'reward',reward->'delta');
end $$;

create or replace function public.solo_burrow_start_adventure_v1(p_user_id uuid,p_record_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare timezone_name_value text; local_day date; paid boolean; duration_value integer;
  revision text; adventure adventures%rowtype;
begin
  if nullif(trim(p_key),'') is null or p_record_id is null then
    return jsonb_build_object('error','invalid_request'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  select coalesce(nullif(timezone_name,''),'UTC'),coalesce(subscription_tier::text,'free')<>'free'
    into timezone_name_value,paid from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  local_day:=(now() at time zone timezone_name_value)::date;
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into adventure from adventures where user_id=p_user_id and idempotency_key=p_key;
  if found then
    if adventure.record_id is distinct from p_record_id then return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error',null,'applied',false,'adventureId',adventure.id,'status',adventure.status,'endsAt',adventure.ends_at);
  end if;
  if exists(select 1 from adventures where user_id=p_user_id and local_date=local_day)
    then return jsonb_build_object('error','daily_adventure_used'); end if;
  if exists(select 1 from adventures where user_id=p_user_id and status in('in_progress','result_ready','interaction_required'))
    then return jsonb_build_object('error','adventure_pending'); end if;
  if not exists(select 1 from reflects r join reflect_drafts d on d.finalized_reflect_id=r.id
    where r.id=p_record_id and r.user_id=p_user_id and d.user_id=p_user_id
      and r.local_date=local_day and r.journal_kind in('write_freely','tap_your_day'))
    then return jsonb_build_object('error','record_required'); end if;
  if exists(select 1 from adventures where record_id=p_record_id)
    then return jsonb_build_object('error','record_already_used'); end if;
  select value into revision from app_config where key='app_major_update_content_revision';
  if not exists(select 1 from content_revisions where id=revision and status='published')
    then return jsonb_build_object('error','feature_disabled'); end if;
  duration_value:=case when paid then 7200 else 28800 end;
  insert into adventures(user_id,partner_id,local_date,record_id,status,started_at,ends_at,
    duration_seconds,plus_snapshot,content_revision,idempotency_key)
    values(p_user_id,p_user_id,local_day,p_record_id,'in_progress',now(),
      now()+make_interval(secs=>duration_value),duration_value,paid,revision,p_key)
    returning * into adventure;
  return jsonb_build_object('error',null,'applied',true,'adventureId',adventure.id,
    'status',adventure.status,'endsAt',adventure.ends_at,'durationSeconds',duration_value,'hasPlus',paid);
end $$;

create or replace function public.solo_burrow_settle_adventure_v1(p_user_id uuid,p_adventure_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare adventure adventures%rowtype; result adventure_results%rowtype;
  item catalog_items%rowtype; friend friend_definitions%rowtype; content friend_content%rowtype;
  kind text; snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into adventure from adventures where id=p_adventure_id and user_id=p_user_id and partner_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into result from adventure_results where adventure_id=adventure.id;
  if found then return jsonb_build_object('error',null,'applied',false,'resultId',result.id,
    'resultType',result.result_type,'itemId',result.item_id,'friendId',result.friend_id,'claimStatus',result.claim_status); end if;
  if adventure.status<>'in_progress' then return jsonb_build_object('error','not_in_progress'); end if;
  if adventure.ends_at>now() then return jsonb_build_object('error','not_ready','endsAt',adventure.ends_at); end if;
  if get_byte(decode(md5(adventure.id::text),'hex'),0)/256.0 <
    coalesce((adventure.rules_snapshot->>'friend_probability')::numeric,0.25) then
    select f.* into friend from friend_definitions f where f.status='active' and f.revision_id=adventure.content_revision
      and not exists(select 1 from user_friend_discoveries d where d.user_id=p_user_id and d.friend_id=f.stable_id)
      and exists(select 1 from friend_content c where c.friend_id=f.stable_id and c.status='active'
        and c.trigger_scene in('adventure','both'))
      order by md5(adventure.id::text||':'||f.stable_id) limit 1;
    if friend.stable_id is not null then
      select c.* into content from friend_content c where c.friend_id=friend.stable_id and c.status='active'
        and c.trigger_scene in('adventure','both')
        order by md5(adventure.id::text||':content:'||c.id::text) limit 1;
    end if;
  end if;
  select c.* into item from catalog_items c where c.status='active' and c.revision_id=adventure.content_revision
    and c.item_type in('decor','souvenir','our_room') and c.drop_weight>0 and not c.plus_only
    and 'adventure_obtainable'=any(c.tags) and not(c.tags && array['purchase_only','plus_exclusive','friend_gift'])
    and (c.price is null or c.price<=coalesce((adventure.rules_snapshot->>'maximum_price')::int,300))
    and not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id)
    and not exists(select 1 from adventure_results r join adventures a on a.id=r.adventure_id
      where r.item_id=c.stable_id and r.claim_status='pending' and a.user_id=p_user_id)
    order by md5(adventure.id::text||':'||c.stable_id),c.stable_id limit 1;
  kind:=case when friend.stable_id is not null then 'friend'
    when item.stable_id is not null then 'item' else 'quiet' end;
  if kind='friend' then item:=null; end if;
  snapshot:=jsonb_build_object('itemSnapshot',case when item.stable_id is not null then to_jsonb(item) end,
    'friendSnapshot',case when friend.stable_id is not null then to_jsonb(friend) end,
    'friendContent',case when content.id is not null then to_jsonb(content) end,
    'sourceTags',adventure.source_tags,'rules',adventure.rules_snapshot);
  insert into adventure_results(adventure_id,result_type,item_id,friend_id,claim_status,metadata)
    values(adventure.id,kind,item.stable_id,friend.stable_id,'pending',snapshot) returning * into result;
  update adventures set status='result_ready',result_type=kind,
    result_id=coalesce(item.stable_id,friend.stable_id),updated_at=now() where id=adventure.id;
  return jsonb_build_object('error',null,'applied',true,'resultId',result.id,'resultType',kind,
    'itemId',item.stable_id,'friendId',friend.stable_id,'claimStatus','pending');
end $$;

create or replace function public.solo_burrow_claim_adventure_v1(p_user_id uuid,p_adventure_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare adventure adventures%rowtype; result adventure_results%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into adventure from adventures where id=p_adventure_id and user_id=p_user_id and partner_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into result from adventure_results where adventure_id=adventure.id for update;
  if not found then return jsonb_build_object('error','result_not_ready'); end if;
  if result.claim_status='claimed' then return jsonb_build_object('error',null,'applied',false,
    'resultType',result.result_type); end if;
  if result.claim_status='interaction_required' then return jsonb_build_object('error',null,'applied',false,
    'interactionRequired',true,'friendId',result.friend_id); end if;
  if result.result_type='friend' then
    insert into user_friend_discoveries(user_id,friend_id,source_adventure_id)
      values(p_user_id,result.friend_id,p_adventure_id) on conflict(user_id,friend_id) do nothing;
    update adventure_results set claim_status='interaction_required' where id=result.id;
    update adventures set status='interaction_required',updated_at=now() where id=p_adventure_id;
    return jsonb_build_object('error',null,'applied',true,'resultType','friend',
      'friendId',result.friend_id,'interactionRequired',true);
  end if;
  if result.item_id is not null then
    if exists(select 1 from user_inventory where owner_id=p_user_id and item_id=result.item_id)
      then return jsonb_build_object('error','reward_no_longer_eligible'); end if;
    insert into user_inventory(owner_id,item_id,source,source_reference_id)
      values(p_user_id,result.item_id,'adventure',p_adventure_id::text);
  end if;
  update adventure_results set claim_status='claimed',claimed_at=now() where id=result.id;
  update adventures set status='completed',updated_at=now() where id=p_adventure_id;
  insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(p_user_id,p_user_id,p_user_id,'adventure_completed','adventure',p_adventure_id::text,
      jsonb_build_object('resultType',result.result_type,'itemId',result.item_id),
      'adventure-completed:'||p_adventure_id::text)
    on conflict(actor_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'applied',true,'resultType',result.result_type,
    'itemId',result.item_id,'interactionRequired',false);
end $$;

create or replace function public.solo_burrow_friend_interaction_v1(
  p_user_id uuid,p_adventure_id uuid,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare adventure adventures%rowtype; result adventure_results%rowtype; content jsonb;
  kind text; choice text; feedback text; accepted timestamptz; monster text;
begin
  select * into adventure from adventures where id=p_adventure_id and user_id=p_user_id and partner_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into result from adventure_results where adventure_id=adventure.id and friend_id is not null for update;
  if not found then return jsonb_build_object('error','friend_result_not_found'); end if;
  if adventure.status='completed' then return jsonb_build_object('error',null,'applied',false,
    'friendId',result.friend_id,'feedback',result.metadata->>'feedback'); end if;
  if adventure.status<>'interaction_required' then return jsonb_build_object('error','interaction_not_ready'); end if;
  content:=result.metadata->'friendContent';kind:=content->>'content_type';choice:=p_response->>'choiceId';
  if not coalesce(valid_burrow_friend_content(content),false) or jsonb_typeof(p_response) is distinct from 'object'
    then return jsonb_build_object('error','invalid_response'); end if;
  if kind='insight' then
    if p_response->'acknowledged' is distinct from 'true'::jsonb
      then return jsonb_build_object('error','invalid_response'); end if;
    feedback:='A little thought to carry home.';
  else
    if not exists(select 1 from jsonb_array_elements(content->'choices') c where c->>'id'=choice)
      then return jsonb_build_object('error','invalid_response'); end if;
    feedback:=content->'feedback'->>choice;
    if kind='emotional_help' then
      if choice='not_now' then feedback:='Another time is okay. Your new friend is still part of your collection.';
      else
        monster:=content->>'rage_monster_id';accepted:=(result.metadata->>'acceptedAt')::timestamptz;
        if accepted is null then
          update adventure_results set metadata=metadata||jsonb_build_object('acceptedAt',now()) where id=result.id;
          return jsonb_build_object('error',null,'applied',true,'battleRequired',true,'monsterId',monster);
        end if;
        if not exists(select 1 from kit_completions k where k.user_id=p_user_id and k.kit='tame_enemy'
          and k.payload->>'monster_id'=monster and k.created_at>=accepted)
          then return jsonb_build_object('error','battle_required','monsterId',monster); end if;
        feedback:='Thank you for facing that feeling.';
      end if;
    end if;
  end if;
  update user_friend_discoveries set interaction_completed_at=coalesce(interaction_completed_at,now())
    where user_id=p_user_id and friend_id=result.friend_id;
  update adventure_results set claim_status='claimed',claimed_at=now(),metadata=metadata||jsonb_build_object(
    'response',p_response,'feedback',feedback,'declined',kind='emotional_help' and choice='not_now') where id=result.id;
  update adventures set status='completed',updated_at=now() where id=adventure.id;
  insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(p_user_id,p_user_id,p_user_id,'friend_discovered','adventure',adventure.id::text,
      jsonb_build_object('friendId',result.friend_id),'friend-discovered:'||adventure.id::text)
    on conflict(actor_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'applied',true,'friendId',result.friend_id,'feedback',feedback,
    'declined',kind='emotional_help' and choice='not_now');
end $$;

revoke all on function public.solo_burrow_start_adventure_v1(uuid,uuid,text),
  public.solo_burrow_settle_adventure_v1(uuid,uuid),
  public.solo_burrow_claim_adventure_v1(uuid,uuid),
  public.solo_burrow_friend_interaction_v1(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.solo_burrow_start_adventure_v1(uuid,uuid,text),
  public.solo_burrow_settle_adventure_v1(uuid,uuid),
  public.solo_burrow_claim_adventure_v1(uuid,uuid),
  public.solo_burrow_friend_interaction_v1(uuid,uuid,jsonb)
  to service_role;
notify pgrst,'reload schema';
