-- Interactive room/catalog/navigation foundation. Content remains replaceable;
-- the rollout stays OFF until the release checklist has been completed.
update public.catalog_items set category=case category
  when 'plants' then 'vases' when 'storage' then 'cabinets'
  when 'wall_art' then 'posters' else category end;

update public.catalog_items set metadata=metadata || jsonb_build_object('slot',case category
  when 'outfits' then 'outfit' when 'windows' then 'window' when 'lamps' then 'lamp'
  when 'vases' then 'vase' when 'cushions' then 'cushion' when 'tables' then 'table'
  when 'rugs' then 'rug' when 'cabinets' then 'cabinet' when 'posters' then 'poster'
  when 'decor' then 'decor' when 'our_room' then 'bed' else null end);
update public.catalog_items set metadata=metadata || '{"starter":true}',drop_weight=0
  where price=0;

insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,
  price,tradable,asset,metadata,is_placeholder)
select 'placeholder_'||category||'_'||variant,'burrow-v1-placeholder','decor',category,
  title||case when variant='01' then '' else ' · Sunset' end,
  'Replaceable artwork. Fixed-slot room decoration.',case when variant='01' then 0 else 150 end,true,
  jsonb_build_object('renderer','native','symbol',slot),
  jsonb_build_object('slot',slot,'starter',variant='01'),true
from (values ('music_players','music_player','Little Radio'),('frames','frame','Photo Frame'),
  ('couple_dolls','couple_doll','Together Doll')) x(category,slot,title)
cross join (values ('01'),('02')) y(variant)
on conflict(stable_id) do nothing;

create or replace function public.save_room_loadout_v1(p_user_id uuid,p_room_type text,p_slots jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; slot_name text; item_id_value text; item public.catalog_items%rowtype;
begin
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_room_type not in ('home','our') or p_slots is null or jsonb_typeof(p_slots)<>'object'
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if (select count(*) from jsonb_object_keys(p_slots))>13
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if p_room_type='our' and not exists(select 1 from profiles where id in(p_user_id,partner)
    and coalesce(subscription_tier::text,'free')<>'free') then return jsonb_build_object('error','plus_required'); end if;
  -- Last successful save wins, including simultaneous shared-room edits.
  perform pg_advisory_xact_lock(hashtextextended('loadout:'||case when p_room_type='home'
    then p_user_id::text else least(p_user_id,partner)::text end||':'||p_room_type,0));
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_slots) loop
    select * into item from catalog_items where stable_id=item_id_value and status='active';
    if not found or item.metadata->>'slot' is distinct from slot_name
      or (p_room_type='home' and item.item_type not in ('decor','outfit'))
      or (p_room_type='our' and item.item_type<>'our_room')
      then return jsonb_build_object('error','invalid_loadout'); end if;
    if not exists(select 1 from user_inventory where item_id=item_id_value
      and (owner_id=p_user_id or (p_room_type='our' and owner_id=partner)))
      then return jsonb_build_object('error','item_not_owned'); end if;
  end loop;
  delete from room_loadouts where (p_room_type='home' and room_type='home' and owner_id=p_user_id)
    or (p_room_type='our' and room_type='our' and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner));
  insert into room_loadouts(room_type,owner_id,pair_low,pair_high,slot,item_id,updated_by)
  select p_room_type,case when p_room_type='home' then p_user_id end,
    case when p_room_type='our' then least(p_user_id,partner) end,
    case when p_room_type='our' then greatest(p_user_id,partner) end,key,value,p_user_id
    from jsonb_each_text(p_slots);
  return jsonb_build_object('error',null,'applied',true);
end $$;

-- Events and their task progress commit together, never via a client-supplied
-- "complete task" command. An idempotent event replay does not fire this trigger.
create or replace function public.burrow_moment_quest_progress()
returns trigger language plpgsql security definer set search_path=public as $$
declare quest text;
begin
  quest:=case new.event_type
    when 'affection_sent' then 'send_affection'
    when 'adventure_record_saved' then 'write_adventure_record'
    when 'adventure_completed' then 'finish_adventure'
    when 'friend_discovered' then 'finish_adventure'
    when 'room_need_refilled' then case when new.target_id<>new.actor_id
      then case new.payload->>'need' when 'water' then 'water_partner_flower'
        when 'food' then 'feed_partner_bunny' end end end;
  if quest is not null then
    perform public.assign_daily_quests_v1(new.actor_id);
    perform public.advance_daily_quest_v1(new.actor_id,quest,1);
  end if;
  return new;
end $$;
create trigger burrow_moment_progress after insert on public.moment_events
  for each row execute function public.burrow_moment_quest_progress();

create or replace function public.visit_partner_room_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.lock_burrow_pair(p_user_id) is null then return jsonb_build_object('error','not_paired'); end if;
  perform public.assign_daily_quests_v1(p_user_id);
  perform public.advance_daily_quest_v1(p_user_id,'visit_partner_room',1);
  return jsonb_build_object('error',null,'applied',true);
end $$;

create or replace function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; low_id uuid; high_id uuid; revision text; paid boolean;
  tz text; today date; adventure public.adventures%rowtype; result jsonb; ready_record uuid;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  low_id:=least(p_user_id,partner); high_id:=greatest(p_user_id,partner);
  perform public.lock_burrow_inventory(p_user_id,partner);
  select value into revision from app_config where key='app_major_update_content_revision';
  if not exists(select 1 from content_revisions where id=revision and status='published')
    then return jsonb_build_object('error','feature_disabled'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
  today:=(now() at time zone tz)::date;
  select exists(select 1 from profiles where id in(p_user_id,partner)
    and coalesce(subscription_tier::text,'free')<>'free') into paid;
  insert into wallets(user_id) values(p_user_id) on conflict do nothing;
  insert into room_needs(owner_id) values(p_user_id),(partner) on conflict do nothing;
  insert into user_inventory(owner_id,item_id,source)
    select p_user_id,stable_id,'starter' from catalog_items where revision_id=revision
      and status='active' and metadata->>'starter'='true' on conflict(owner_id,item_id) do nothing;
  if paid then perform change_carrot_balance_v1(p_user_id,50,'plus_daily_login',null,null,'plus-login:'||today::text); end if;
  select * into adventure from adventures where user_id=p_user_id
    and partner_id=partner and status in('in_progress','result_ready','interaction_required')
    order by created_at desc limit 1;
  if adventure.id is not null then
    if paid and adventure.status='in_progress' then
      perform accelerate_adventure_for_plus_v1(p_user_id,adventure.id);
      select * into adventure from adventures where id=adventure.id;
    end if;
    if adventure.status='in_progress' and adventure.ends_at<=now() then
      result:=settle_adventure_v1(p_user_id,adventure.id);
      if result->>'error' is not null then return result; end if;
      select * into adventure from adventures where id=adventure.id;
    end if;
  end if;
  select r.id into ready_record from reflects r
    where r.user_id=p_user_id and r.local_date=today and r.journal_kind in('write_freely','tap_your_day')
      and exists(select 1 from reflect_drafts d where d.user_id=p_user_id and d.finalized_reflect_id=r.id)
      and not exists(select 1 from adventures a where a.record_id=r.id)
    order by r.id limit 1;
  if ready_record is not null then perform register_adventure_record_v1(p_user_id,ready_record); end if;
  return jsonb_build_object(
    'error',null,'rollout',jsonb_build_object('enabled',true,'contentRevision',revision),
    'serverNow',now(),'localDate',today,'hasPlus',paid,
    'profile',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url,
      'subscription_tier',subscription_tier,'timezone_name',timezone_name) from profiles where id=p_user_id),
    'partner',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url,
      'subscription_tier',subscription_tier) from profiles where id=partner),
    'wallet',(select jsonb_build_object('balance',carrot_balance,'version',version) from wallets where user_id=p_user_id),
    'roomNeeds',(select jsonb_build_object('food',greatest(0,food_value-floor(extract(epoch from(now()-food_updated_at))/300)),
      'foodUpdatedAt',food_updated_at,'water',greatest(0,water_value-floor(extract(epoch from(now()-water_updated_at))/300)),
      'waterUpdatedAt',water_updated_at,'serverNow',now()) from room_needs where owner_id=p_user_id),
    'partnerNeeds',(select jsonb_build_object('food',greatest(0,food_value-floor(extract(epoch from(now()-food_updated_at))/300)),
      'water',greatest(0,water_value-floor(extract(epoch from(now()-water_updated_at))/300))) from room_needs where owner_id=partner),
    'activeAdventure',case when adventure.id is not null then to_jsonb(adventure) end,
    'adventureResult',(select to_jsonb(r) from adventure_results r where r.adventure_id=adventure.id),
    'readyRecordId',ready_record,
    'dailyAdventureUsed',exists(select 1 from adventures where user_id=p_user_id and local_date=today),
    'quests',assign_daily_quests_v1(p_user_id),
    'specialQuests',burrow_special_quests_v1(p_user_id),
    'memoryPrompts',coalesce((select jsonb_agg(jsonb_build_object('id',stable_id,'prompt',prompt) order by position)
      from memory_prompts where status='active' and revision_id=revision),'[]'::jsonb),
    'memoryEntries',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from
      (select id,author_id,body,prompt_id,created_at,updated_at from memory_room_entries
      where pair_low=low_id and pair_high=high_id and deleted_at is null order by created_at desc limit 100) e),'[]'::jsonb),
    'catalog',coalesce((select jsonb_agg(to_jsonb(c) order by c.category,c.stable_id)
      from catalog_items c where status='active' and revision_id=revision),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(to_jsonb(i)) from user_inventory i where owner_id in(p_user_id,partner)),'[]'::jsonb),
    'loadouts',coalesce((select jsonb_agg(to_jsonb(l)) from room_loadouts l where
      (room_type='home' and owner_id in(p_user_id,partner)) or
      (room_type='our' and pair_low=low_id and pair_high=high_id)),'[]'::jsonb),
    'moments',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc) from
      (select * from moment_events where pair_low=low_id and pair_high=high_id
        and (visibility='pair' or actor_id=p_user_id) order by created_at desc,id desc limit 50) m),'[]'::jsonb),
    'gifts',coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at desc) from gifts g
      where recipient_id=p_user_id and sender_id=partner and status='pending'),'[]'::jsonb),
    'friends',coalesce((select jsonb_agg(to_jsonb(f)) from friend_definitions f
      where status='active' and revision_id=revision),'[]'::jsonb),
    'discoveries',coalesce((select jsonb_agg(to_jsonb(d)) from user_friend_discoveries d where user_id in(p_user_id,partner)),'[]'::jsonb),
    'friendContent',coalesce((select jsonb_agg(to_jsonb(c) order by position) from friend_content c
      where status='active' and friend_id=(select friend_id from adventure_results where adventure_id=adventure.id)),'[]'::jsonb),
    'affectionInbox',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,affection_type,completed_at from affection_events
      where recipient_id=p_user_id and sender_id=partner and read_at is null order by completed_at desc limit 100) e),'[]'::jsonb),
    'lastAffectionAt',(select max(completed_at) from affection_events where sender_id=p_user_id),
    'unread',jsonb_build_object('affection',(select count(*) from affection_events where recipient_id=p_user_id and sender_id=partner and read_at is null),
      'gifts',(select count(*) from gifts where recipient_id=p_user_id and sender_id=partner and status='pending'))
  );
end $$;

revoke all on function public.save_room_loadout_v1(uuid,text,jsonb),public.burrow_moment_quest_progress(),
  public.visit_partner_room_v1(uuid),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.save_room_loadout_v1(uuid,text,jsonb),public.visit_partner_room_v1(uuid),
  public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
