-- Personal Burrow actions remain available before a reciprocal pairing exists.
-- Solo rows use (user,user), never a former partner's pair scope.
alter table public.moment_events drop constraint if exists moment_events_check;
alter table public.moment_events add constraint moment_events_check check (pair_low <= pair_high);
alter table public.memory_room_entries drop constraint if exists memory_room_entries_check;
alter table public.memory_room_entries add constraint memory_room_entries_check check (pair_low <= pair_high);

create or replace function public.can_read_burrow_pair(p_low uuid,p_high uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when p_low=p_high then auth.uid()=p_low
    else auth.uid() in(p_low,p_high) and exists(
      select 1 from pairings p join pairings q
        on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id
      where p.user_id=p_low and p.partner_user_id=p_high)
    end;
$$;

create or replace function public.solo_burrow_initialize_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare revision text; paid boolean; local_day date; zone text;
begin
  if not exists(select 1 from profiles where id=p_user_id) then
    return jsonb_build_object('error','profile_not_found'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  select value into revision from app_config where key='app_major_update_content_revision';
  if not exists(select 1 from content_revisions where id=revision and status='published')
    then return jsonb_build_object('error','feature_disabled'); end if;
  insert into wallets(user_id) values(p_user_id) on conflict do nothing;
  insert into room_needs(owner_id) values(p_user_id) on conflict do nothing;
  insert into user_inventory(owner_id,item_id,source)
    select p_user_id,stable_id,'starter' from catalog_items
      where revision_id=revision and status='active' and metadata->>'starter'='true'
    on conflict(owner_id,item_id) do nothing;
  select coalesce(subscription_tier::text,'free')<>'free',coalesce(nullif(timezone_name,''),'UTC')
    into paid,zone from profiles where id=p_user_id;
  local_day:=(now() at time zone zone)::date;
  if paid then perform change_carrot_balance_v1(p_user_id,50,'plus_daily_login',null,null,
    'plus-login:'||local_day::text); end if;
  return jsonb_build_object('error',null,'initialized',true);
end $$;

create or replace function public.solo_burrow_purchase_v1(p_user_id uuid,p_item_id text,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item catalog_items%rowtype; purchase_id uuid; wallet jsonb; paid boolean;
begin
  if nullif(trim(p_item_id),'') is null or nullif(trim(p_key),'') is null then
    return jsonb_build_object('error','invalid_request'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  select id into purchase_id from catalog_purchases where buyer_id=p_user_id and idempotency_key=p_key;
  if found then
    if not exists(select 1 from catalog_purchases where id=purchase_id and recipient_id=p_user_id and item_id=p_item_id)
      then return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error',null,'applied',false,'purchaseId',purchase_id);
  end if;
  select * into item from catalog_items where stable_id=p_item_id and status='active' for share;
  if not found or item.price is null or item.price<=0
    or not exists(select 1 from content_revisions where id=item.revision_id and status='published')
    then return jsonb_build_object('error','not_for_sale'); end if;
  select coalesce(subscription_tier::text,'free')<>'free' into paid from profiles where id=p_user_id;
  if item.plus_only and not coalesce(paid,false) then return jsonb_build_object('error','plus_required'); end if;
  if exists(select 1 from user_inventory where owner_id=p_user_id and item_id=p_item_id)
    then return jsonb_build_object('error','already_owned'); end if;
  wallet:=change_carrot_balance_v1(p_user_id,-item.price,'catalog_purchase','catalog_item',p_item_id,'purchase:'||p_key);
  if wallet->>'error' is not null then return wallet; end if;
  insert into catalog_purchases(buyer_id,recipient_id,item_id,price_snapshot,idempotency_key)
    values(p_user_id,p_user_id,p_item_id,item.price,p_key) returning id into purchase_id;
  insert into user_inventory(owner_id,item_id,source,source_reference_id)
    values(p_user_id,p_item_id,'purchase',purchase_id::text);
  return jsonb_build_object('error',null,'applied',true,'purchaseId',purchase_id,'balance',wallet->'balance');
end $$;

create or replace function public.solo_burrow_care_v1(p_user_id uuid,p_need text,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare stored smallint; updated timestamptz; current_value integer; event_id uuid;
begin
  if p_need not in('food','water') or nullif(trim(p_key),'') is null then
    return jsonb_build_object('error','invalid_request'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  perform pg_advisory_xact_lock(hashtextextended('room-need:'||p_user_id::text,0));
  select id into event_id from moment_events where actor_id=p_user_id and idempotency_key='room-need:'||p_key;
  if found then return jsonb_build_object('error',null,'applied',false,'value',100,'reward',0); end if;
  insert into room_needs(owner_id) values(p_user_id) on conflict do nothing;
  if p_need='food' then
    select food_value,food_updated_at into stored,updated from room_needs where owner_id=p_user_id for update;
  else
    select water_value,water_updated_at into stored,updated from room_needs where owner_id=p_user_id for update;
  end if;
  current_value:=greatest(0,stored-floor(extract(epoch from(now()-updated))/300)::integer);
  if current_value>=100 then return jsonb_build_object('error','already_full','value',100); end if;
  if p_need='food' then update room_needs set food_value=100,food_updated_at=now() where owner_id=p_user_id;
  else update room_needs set water_value=100,water_updated_at=now() where owner_id=p_user_id; end if;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,payload,idempotency_key)
    values(p_user_id,p_user_id,p_user_id,p_user_id,'room_need_refilled',jsonb_build_object('need',p_need),'room-need:'||p_key);
  return jsonb_build_object('error',null,'applied',true,'previousValue',current_value,'value',100,'reward',0);
end $$;

create or replace function public.solo_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare local_day date; inserted_id uuid;
begin
  if nullif(trim(p_key),'') is null then return jsonb_build_object('error','invalid_request'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day
    from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(p_user_id,p_user_id,p_user_id,p_user_id,'toy_interacted','toy',local_day::text,
      jsonb_build_object('action','squeeze'),'toy:'||local_day::text)
    on conflict(actor_id,idempotency_key) do nothing returning id into inserted_id;
  return jsonb_build_object('error',null,'applied',inserted_id is not null);
end $$;

create or replace function public.solo_burrow_loadout_v1(p_user_id uuid,p_slots jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare slot_name text; item_id_value text; item catalog_items%rowtype; previous jsonb; changes jsonb;
begin
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  if p_slots is null or jsonb_typeof(p_slots)<>'object' or
    (select count(*) from jsonb_object_keys(p_slots)) not between 1 and 18
    then return jsonb_build_object('error','invalid_loadout'); end if;
  perform pg_advisory_xact_lock(hashtextextended('loadout:'||p_user_id::text||':solo',0));
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_slots) loop
    select * into item from catalog_items where stable_id=item_id_value and status='active';
    if not found or item.metadata->>'slot' is distinct from slot_name or item.item_type<>'decor'
      then return jsonb_build_object('error','invalid_loadout'); end if;
    if not exists(select 1 from user_inventory where owner_id=p_user_id and item_id=item_id_value)
      then return jsonb_build_object('error','item_not_owned'); end if;
  end loop;
  select coalesce(jsonb_object_agg(slot,item_id),'{}'::jsonb) into previous from room_loadouts
    where room_type='home' and owner_id=p_user_id and slot<>'outfit';
  select coalesce(jsonb_agg(jsonb_build_object('slot',coalesce(old_slot.key,new_slot.key),
    'previousItemId',old_slot.value,'itemId',new_slot.value)),'[]'::jsonb) into changes
    from jsonb_each_text(previous) old_slot full join jsonb_each_text(p_slots) new_slot
      on old_slot.key=new_slot.key where old_slot.value is distinct from new_slot.value;
  delete from room_loadouts where room_type='home' and owner_id=p_user_id and slot<>'outfit';
  insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by)
    select 'home',p_user_id,key,value,p_user_id from jsonb_each_text(p_slots);
  if jsonb_array_length(changes)>0 then
    insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,payload,idempotency_key)
      values(p_user_id,p_user_id,p_user_id,p_user_id,'room_decor_changed','room_loadout',
        jsonb_build_object('roomType','home','changes',changes),'room-decor:'||gen_random_uuid()::text);
  end if;
  return jsonb_build_object('error',null,'applied',true,'changes',changes);
end $$;

create or replace function public.solo_burrow_outfit_v1(p_user_id uuid,p_item_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  if not exists(select 1 from catalog_items where stable_id=p_item_id and status='active'
    and item_type='outfit' and metadata->>'slot'='outfit')
    then return jsonb_build_object('error','invalid_item'); end if;
  if not exists(select 1 from user_inventory where owner_id=p_user_id and item_id=p_item_id)
    then return jsonb_build_object('error','item_not_owned'); end if;
  perform pg_advisory_xact_lock(hashtextextended('outfit:'||p_user_id::text,0));
  if exists(select 1 from room_loadouts where room_type='home' and owner_id=p_user_id and slot='outfit' and item_id=p_item_id)
    then return jsonb_build_object('error',null,'applied',false); end if;
  delete from room_loadouts where room_type='home' and owner_id=p_user_id and slot='outfit';
  insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by)
    values('home',p_user_id,'outfit',p_item_id,p_user_id);
  return jsonb_build_object('error',null,'applied',true);
end $$;

create or replace function public.solo_burrow_memory_v1(
  p_user_id uuid,p_entry_id uuid,p_body text,p_prompt_id text,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entry_id uuid; local_day date;
begin
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  if nullif(trim(p_body),'') is null or char_length(p_body)>5000 or nullif(trim(p_key),'') is null
    then return jsonb_build_object('error','invalid_request'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day
    from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  if p_prompt_id is not null and not exists(select 1 from memory_prompts where stable_id=p_prompt_id and status='active')
    then return jsonb_build_object('error','invalid_prompt'); end if;
  perform pg_advisory_xact_lock(hashtextextended('solo-memory:'||p_user_id::text,0));
  if p_entry_id is not null then
    update memory_room_entries set body=trim(p_body),prompt_id=p_prompt_id,updated_at=now()
      where id=p_entry_id and author_id=p_user_id and pair_low=p_user_id and pair_high=p_user_id
        and deleted_at is null returning id into entry_id;
    if entry_id is null then return jsonb_build_object('error','not_found'); end if;
  else
    select reference_id::uuid into entry_id from moment_events
      where actor_id=p_user_id and idempotency_key='memory:'||p_key and reference_type='memory_room_entry';
    if entry_id is not null then return jsonb_build_object('error',null,'applied',false,'entryId',entry_id); end if;
    insert into memory_room_entries(pair_low,pair_high,author_id,local_date,prompt_id,body)
      values(p_user_id,p_user_id,p_user_id,local_day,p_prompt_id,trim(p_body)) returning id into entry_id;
    insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
      values(p_user_id,p_user_id,p_user_id,p_user_id,'memory_created','memory_room_entry',entry_id::text,
        jsonb_build_object('promptId',p_prompt_id),'memory:'||p_key);
  end if;
  return jsonb_build_object('error',null,'applied',true,'entryId',entry_id);
end $$;

create or replace function public.solo_burrow_delete_memory_v1(p_user_id uuid,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  update memory_room_entries set deleted_at=now(),updated_at=now()
    where id=p_entry_id and author_id=p_user_id and pair_low=p_user_id and pair_high=p_user_id
      and deleted_at is null;
  get diagnostics affected=row_count;
  return jsonb_build_object('error',null,'applied',affected>0);
end $$;

-- Music is private to the owner's room, so it has no paired dependency.
create or replace function public.select_room_music_v1(p_user_id uuid,p_track_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_track_id is not null and not exists(
    select 1 from catalog_items c join user_inventory i on i.item_id=c.stable_id
      join content_revisions r on r.id=c.revision_id
    where i.owner_id=p_user_id and c.stable_id=p_track_id
      and c.item_type='music' and c.status='active' and r.status='published')
    then return jsonb_build_object('error','item_not_owned'); end if;
  insert into room_music(owner_id,track_id) values(p_user_id,p_track_id)
    on conflict(owner_id) do update set track_id=excluded.track_id,updated_at=now();
  return jsonb_build_object('error',null,'applied',true);
end $$;

-- Claims are self-scoped; pairing is not an eligibility condition.
create or replace function public.claim_daily_quest_v1(p_user_id uuid,p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare assignment daily_quest_assignments%rowtype; progress quest_progress_vnext%rowtype; reward jsonb;
begin
  select * into assignment from daily_quest_assignments where id=p_assignment_id and user_id=p_user_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into progress from quest_progress_vnext where assignment_id=p_assignment_id for update;
  if progress.completed_at is null then return jsonb_build_object('error','not_completed'); end if;
  if progress.claimed_at is not null then return jsonb_build_object('error',null,'applied',false,'reward',0); end if;
  reward:=change_carrot_balance_v1(p_user_id,10,'daily_quest','daily_quest_assignment',p_assignment_id::text,
    'daily-quest:'||p_assignment_id::text);
  if reward->>'error' is not null then return reward; end if;
  update quest_progress_vnext set claimed_at=now(),updated_at=now() where assignment_id=p_assignment_id;
  insert into reward_claims_vnext(user_id,reward_type,period_key,reference_id,amount,idempotency_key)
    values(p_user_id,'daily_quest',assignment.local_date::text,p_assignment_id::text,10,
      'daily-quest:'||p_assignment_id::text) on conflict(user_id,idempotency_key) do nothing;
  return jsonb_build_object('error',null,'applied',true,'reward',coalesce((reward->>'delta')::integer,0),
    'balance',(reward->>'balance')::integer);
end $$;

create or replace function public.claim_special_quest_v1(p_user_id uuid,p_quest_id text,p_stage integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare quest jsonb; reward jsonb;
begin
  if p_stage is null or p_stage<1 or p_quest_id not in
    ('adventures_completed','items_collected','friends_met','games_played')
    then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('special-quest:'||p_user_id::text,0));
  select value into quest from jsonb_array_elements(burrow_special_quests_v1(p_user_id))
    where value->>'questId'=p_quest_id;
  if p_stage<(quest->>'stage')::int then return jsonb_build_object('error',null,'applied',false); end if;
  if p_stage<>(quest->>'stage')::int or (quest->>'progress')::int<(quest->>'target')::int
    then return jsonb_build_object('error','not_completed'); end if;
  reward:=change_carrot_balance_v1(p_user_id,15,'special_quest','special_quest',p_quest_id||':'||p_stage,
    'special:'||p_quest_id||':'||p_stage);
  if reward->>'error' is not null then return reward; end if;
  insert into special_quest_progress_vnext(user_id,quest_id,claimed_stage,stage,progress)
    values(p_user_id,p_quest_id,p_stage,p_stage+1,(quest->>'progress')::int)
    on conflict(user_id,quest_id) do update set claimed_stage=excluded.claimed_stage,
      stage=excluded.stage,progress=excluded.progress,updated_at=now();
  return jsonb_build_object('error',null,'applied',true,'reward',reward->'delta');
end $$;

revoke all on function public.solo_burrow_initialize_v1(uuid),
  public.solo_burrow_purchase_v1(uuid,text,text),
  public.solo_burrow_care_v1(uuid,text,text),public.solo_burrow_toy_v1(uuid,text),
  public.solo_burrow_loadout_v1(uuid,jsonb),public.solo_burrow_outfit_v1(uuid,text),
  public.solo_burrow_memory_v1(uuid,uuid,text,text,text),
  public.solo_burrow_delete_memory_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.solo_burrow_initialize_v1(uuid),
  public.solo_burrow_purchase_v1(uuid,text,text),
  public.solo_burrow_care_v1(uuid,text,text),public.solo_burrow_toy_v1(uuid,text),
  public.solo_burrow_loadout_v1(uuid,jsonb),public.solo_burrow_outfit_v1(uuid,text),
  public.solo_burrow_memory_v1(uuid,uuid,text,text,text),
  public.solo_burrow_delete_memory_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
