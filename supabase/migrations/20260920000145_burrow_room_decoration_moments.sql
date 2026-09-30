-- Home and Our Room now refer to one pair-owned design. Personal home rows
-- remain intact for compatibility until someone saves the new shared design.
-- A save is a shared moment only when its contents changed.
alter table public.moment_events
  drop constraint if exists moment_events_event_type_check;
alter table public.moment_events
  add constraint moment_events_event_type_check check (event_type in (
    'adventure_record_saved','adventure_completed','friend_discovered',
    'affection_sent','room_need_refilled','room_media_updated',
    'gift_sent','gift_claimed','memory_created','game_played',
    'toy_interacted','room_decor_changed'
  ));

create or replace function public.save_room_loadout_v1(p_user_id uuid,p_room_type text,p_slots jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  partner uuid;
  slot_name text;
  item_id_value text;
  item public.catalog_items%rowtype;
  prior_slots jsonb;
  changes jsonb;
begin
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_room_type not in ('home','our') or p_slots is null or jsonb_typeof(p_slots)<>'object'
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if (select count(*) from jsonb_object_keys(p_slots)) not between 1 and 18
    then return jsonb_build_object('error','invalid_loadout'); end if;
  perform pg_advisory_xact_lock(hashtextextended('loadout:'||least(p_user_id,partner)::text||':shared',0));
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_slots) loop
    select * into item from catalog_items where stable_id=item_id_value and status='active';
    if not found or item.metadata->>'slot' is distinct from slot_name
      or item.item_type<>'decor'
      then return jsonb_build_object('error','invalid_loadout'); end if;
    if not exists(select 1 from user_inventory where item_id=item_id_value
      and owner_id in(p_user_id,partner))
      then return jsonb_build_object('error','item_not_owned'); end if;
  end loop;
  select coalesce(jsonb_object_agg(slot,item_id),'{}'::jsonb) into prior_slots
    from room_loadouts where room_type='our' and pair_low=least(p_user_id,partner)
      and pair_high=greatest(p_user_id,partner);
  select coalesce(jsonb_agg(jsonb_build_object('slot',coalesce(old_slot.key,new_slot.key),
    'previousItemId',old_slot.value,'itemId',new_slot.value)
    order by coalesce(old_slot.key,new_slot.key)),'[]'::jsonb) into changes
  from jsonb_each_text(prior_slots) old_slot
  full join jsonb_each_text(p_slots) new_slot on old_slot.key=new_slot.key
  where old_slot.value is distinct from new_slot.value;
  delete from room_loadouts where room_type='our' and pair_low=least(p_user_id,partner)
    and pair_high=greatest(p_user_id,partner);
  insert into room_loadouts(room_type,owner_id,pair_low,pair_high,slot,item_id,updated_by)
  select 'our',null,least(p_user_id,partner),greatest(p_user_id,partner),key,value,p_user_id
    from jsonb_each_text(p_slots);
  if jsonb_array_length(changes)>0 then
    insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,
      reference_type,payload,idempotency_key)
    values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,partner,
      'room_decor_changed','room_loadout',jsonb_build_object('roomType','shared',
      'changes',changes),'room-decor:'||gen_random_uuid()::text);
  end if;
  return jsonb_build_object('error',null,'applied',true,'changes',changes);
end $$;

-- Bunny clothing belongs to each person; furniture belongs to the pair.
create or replace function public.save_bunny_outfit_v1(p_user_id uuid,p_item_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.catalog_items%rowtype;
begin
  if public.lock_burrow_pair(p_user_id) is null
    then return jsonb_build_object('error','not_paired'); end if;
  select * into v_item from public.catalog_items
    where stable_id=p_item_id and status='active' and item_type='outfit'
      and metadata->>'slot'='outfit';
  if not found then return jsonb_build_object('error','invalid_item'); end if;
  if not exists(select 1 from public.user_inventory
    where owner_id=p_user_id and item_id=p_item_id)
    then return jsonb_build_object('error','item_not_owned'); end if;
  perform pg_advisory_xact_lock(hashtextextended('outfit:'||p_user_id::text,0));
  if exists(select 1 from public.room_loadouts
    where room_type='home' and owner_id=p_user_id and slot='outfit' and item_id=p_item_id)
    then return jsonb_build_object('error',null,'applied',false); end if;
  delete from public.room_loadouts
    where room_type='home' and owner_id=p_user_id and slot='outfit';
  insert into public.room_loadouts(room_type,owner_id,slot,item_id,updated_by)
    values('home',p_user_id,'outfit',p_item_id,p_user_id);
  return jsonb_build_object('error',null,'applied',true);
end $$;
revoke all on function public.save_bunny_outfit_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.save_bunny_outfit_v1(uuid,text) to service_role;
