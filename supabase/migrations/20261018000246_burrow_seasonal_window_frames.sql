-- Explicit test-stage replacement authorized by the owner: delete ONLY old
-- window items and their references, not other products/accounts/balances.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));

create temporary table _window_frames_246(ordinal integer primary key,frame_key text unique) on commit drop;
insert into _window_frames_246 values
 (1,'Cross_Dark_Wood'),(2,'Cross_Green'),(3,'Cross_Light_Wood'),(4,'Cross_Navy'),
 (5,'Cross_Orange'),(6,'Cross_Pink'),(7,'Cross_Purple'),(8,'Cross_White'),
 (9,'Curtain_Dark_Wood'),(10,'Curtain_Green'),(11,'Curtain_Light_Wood'),(12,'Curtain_Navy'),
 (13,'Curtain_Orange'),(14,'Curtain_Pink'),(15,'Curtain_Purple'),(16,'Curtain_White'),
 (17,'Pattern_Clouds'),(18,'Pattern_Flowers'),(19,'Pattern_Gingham'),(20,'Pattern_Hearts'),
 (21,'Pattern_Polka_Dots'),(22,'Pattern_Rainbow'),(23,'Pattern_Stars'),(24,'Pattern_Waves'),
 (25,'Theme_Christmas'),(26,'Theme_Gingerbread'),(27,'Theme_Halloween'),(28,'Theme_Mushroom'),
 (29,'Theme_Snowman'),(30,'Theme_Sunflower'),(31,'Theme_Sweetheart'),
 (32,'Valance_Dark_Wood'),(33,'Valance_Green'),(34,'Valance_Light_Wood'),(35,'Valance_Navy'),
 (36,'Valance_Orange'),(37,'Valance_Pink'),(38,'Valance_Purple'),(39,'Valance_White');

do $$begin
 if not exists(select 1 from public.app_config a join public.content_revisions r on r.id=a.value
   where a.key='app_major_update_content_revision' and r.status='published') then
  raise exception 'Published Burrow revision required';
 end if;
 if exists(select 1 from public.catalog_items c join _window_frames_246 f
   on c.stable_id='window_frame_'||lower(f.frame_key)
   where c.category is distinct from 'windows' or c.item_type is distinct from 'decor'
    or c.metadata->>'windowFrameKey' is distinct from f.frame_key) then
  raise exception 'Window ID collision; refusing to replace an unrelated item';
 end if;
end $$;

create temporary table _old_windows_246 on commit drop as
 select stable_id from public.catalog_items where category='windows'
 and stable_id not in(select 'window_frame_'||lower(frame_key) from _window_frames_246);
create temporary table _old_window_gifts_246 on commit drop as
 select id from public.gifts where item_id in(select stable_id from _old_windows_246);
create temporary table _old_window_purchases_246 on commit drop as
 select id from public.catalog_purchases where item_id in(select stable_id from _old_windows_246);
create temporary table _old_window_adventures_246 on commit drop as
 select adventure_id from public.adventure_results where item_id in(select stable_id from _old_windows_246)
 or gift_id in(select id from _old_window_gifts_246);

create function pg_temp.has_old_window_246(value jsonb) returns boolean language sql stable as $$
 select exists(select 1 from _old_windows_246 old where jsonb_path_exists(coalesce(value,'{}'::jsonb),
  '$.** ? (@ == $id)',jsonb_build_object('id',old.stable_id)))
$$;

-- Clear stale serialized item snapshots/receipts as well as foreign keys.
delete from public.moment_events where pg_temp.has_old_window_246(payload)
 or reference_type='catalog_item' and reference_id in(select stable_id from _old_windows_246)
 or reference_type='gift' and reference_id in(select id::text from _old_window_gifts_246)
 or reference_type='catalog_purchase' and reference_id in(select id::text from _old_window_purchases_246)
 or reference_type='adventure' and reference_id in(select adventure_id::text from _old_window_adventures_246);
delete from public.burrow_command_receipts where pg_temp.has_old_window_246(request) or pg_temp.has_old_window_246(response);
delete from public.adventure_logs where pg_temp.has_old_window_246(payload);
update public.friend_visits set
 reward_item_id=case when reward_item_id in(select stable_id from _old_windows_246) then null else reward_item_id end,
 gift_id=case when gift_id in(select id from _old_window_gifts_246) then null else gift_id end,
 content_snapshot=case when pg_temp.has_old_window_246(content_snapshot)
   then content_snapshot-'giftSnapshot'-'treasureSnapshot'-'rewardItemId'-'giftId' else content_snapshot end
 where reward_item_id in(select stable_id from _old_windows_246) or gift_id in(select id from _old_window_gifts_246)
 or pg_temp.has_old_window_246(content_snapshot);
delete from public.adventure_results where adventure_id in(select adventure_id from _old_window_adventures_246);
update public.adventures set result_type='quiet',result_id=null,
 status=case when status in('result_ready','interaction_required') then 'cancelled' else status end,updated_at=now()
 where id in(select adventure_id from _old_window_adventures_246);
delete from public.adventure_gift_display where gift_id in(select stable_id from _old_windows_246);
delete from public.adventure_encounter_plans where gift_id in(select stable_id from _old_windows_246);
delete from public.room_music where track_id in(select stable_id from _old_windows_246);
delete from public.room_loadouts where item_id in(select stable_id from _old_windows_246);
delete from public.user_inventory where item_id in(select stable_id from _old_windows_246);
delete from public.gifts where id in(select id from _old_window_gifts_246);
delete from public.catalog_purchases where id in(select id from _old_window_purchases_246);
delete from public.burrow_shop_price_audit where item_id in(select stable_id from _old_windows_246);
-- Exact old-item references only. Wallets and mixed room-checkout ledger rows
-- are not recalculated/refunded; no other product's transaction is removed.
delete from public.currency_ledger where reference_type='catalog_item'
 and reference_id in(select stable_id from _old_windows_246);
delete from public.catalog_items where stable_id in(select stable_id from _old_windows_246);

insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,
 tags,drop_weight,asset,metadata,is_placeholder,status)
select 'window_frame_'||lower(frame_key),(select value from public.app_config where key='app_major_update_content_revision'),
 'decor','windows',replace(frame_key,'_',' '),'A window frame with a seasonal day and night view.',200,false,true,
 array['burrow','windows'],0,
 jsonb_build_object('renderer','bundled','artCategory','windows','ordinal',ordinal,
  'file','burrow-webp/room decoration/windows/'||frame_key||'.webp'),
 jsonb_build_object('slot','window','starter',ordinal=1,'artOrdinal',ordinal,
  'artName',replace(frame_key,'_',' '),'windowFrameKey',frame_key),false,'active'
from _window_frames_246
on conflict(stable_id) do update set title=excluded.title,asset=excluded.asset,
 metadata=catalog_items.metadata||excluded.metadata,status='active',is_placeholder=false,updated_at=now();

-- The default is a starter entitlement, while its catalogue value is 200 like
-- all 38 other frames. New-profile starter grants already use metadata.starter.
insert into public.user_inventory(owner_id,item_id,source)
 select id,'window_frame_cross_dark_wood','starter' from public.profiles
on conflict(owner_id,item_id) do nothing;

drop function pg_temp.has_old_window_246(jsonb);
notify pgrst,'reload schema';
commit;
