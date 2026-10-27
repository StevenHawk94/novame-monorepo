-- Real WebP outfits replace the five retired placeholders. User explicitly
-- approved dropping their old test inventory/entitlements (no live customers).
-- One transaction: fail closed if an unexpected reward/history references an
-- old product rather than deleting unrelated adventure or purchase records.
begin;
select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
create temporary table retiring_outfits(id text primary key) on commit drop;
insert into retiring_outfits values ('outfit_explorer_01'),('placeholder_outfits_02'),('placeholder_outfit_cozy_01'),('placeholder_outfit_rain_01'),('placeholder_outfit_night_01');
do $$
begin
  if exists(select 1 from catalog_items where stable_id in(select id from retiring_outfits) and category<>'outfits') then
    raise exception 'Old outfit identity has changed; abort release';
  end if;
  if exists(select 1 from catalog_purchases where item_id in(select id from retiring_outfits))
    or exists(select 1 from gifts where item_id in(select id from retiring_outfits))
    or exists(select 1 from adventure_results where item_id in(select id from retiring_outfits))
    or exists(select 1 from friend_visits where reward_item_id in(select id from retiring_outfits))
    or exists(select 1 from adventure_encounter_plans where gift_id in(select id from retiring_outfits))
    or exists(select 1 from adventure_gift_display where gift_id in(select id from retiring_outfits))
    or exists(select 1 from room_music where track_id in(select id from retiring_outfits))
    or exists(select 1 from burrow_shop_price_audit where item_id in(select id from retiring_outfits)) then
    raise exception 'Unexpected old outfit history/reward reference; abort release';
  end if;
end $$;
with outfits(key,title,ordinal) as (values
  ('01_red_gingham','Cherry Gingham',1),
  ('02_denim_overalls','Denim Overalls',2),
  ('04_bowtie_vest','Little Gentleman',3),
  ('05_green_cardigan','Sage Cardigan',4),
  ('06_blue_halfzip','Alpine Fleece',5),
  ('07_halloween_cardigan','Bat Cardigan',6),
  ('08_blue_gift_cardigan','Christmas Gift',7),
  ('09_beige_cardigan','Classic Cardigan',8),
  ('10_blue_floral_romper','Daisy Dress',9),
  ('11_christmas_sweater','Merry Knit',10),
  ('12_wave_shirt','Ocean Breeze',11),
  ('13_black_sweater_vest','Office Cozy',12),
  ('14_pumpkin_sweater','Pumpkin Sweater',13),
  ('15_reindeer_sweater','Reindeer Sweater',14),
  ('16_green_stripe_polo','Rugby Stripes',15),
  ('17_red_jacket_cargo','Rustic Utility',16),
  ('18_teal_puffer','Winter Puffer',17),
  ('19_brown_vest','Woodland Layers',18),
  ('default','Default',0)
)
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,
  price,plus_only,tradable,tags,drop_weight,asset,metadata,is_placeholder)
select 'burrow_outfit_'||key,(select value from app_config where key='app_major_update_content_revision'),
  'outfit','outfits',title,'A layered outfit for your bunny.',
  case when key='default' then 0 else 300 end,false,key<>'default',array['burrow','outfit','purchase_only'],0,
  jsonb_build_object('renderer','layered_bunny','outfitKey',key),
  jsonb_build_object('slot','outfit','starter',key='default','artOrdinal',ordinal,'artName',title),false
from outfits
on conflict(stable_id) do update set revision_id=excluded.revision_id,title=excluded.title,
  description=excluded.description,plus_only=false,tradable=excluded.tradable,
  tags=excluded.tags,drop_weight=0,asset=excluded.asset,metadata=excluded.metadata,
  is_placeholder=false,status='active',updated_at=now();
-- Reset ONLY the explicitly retired outfit slot. No photos/decor/wallet changes.
update room_loadouts set item_id='burrow_outfit_default',version=version+1,updated_at=now()
  where slot='outfit' and item_id in(select id from retiring_outfits);
delete from room_loadouts where item_id in(select id from retiring_outfits);
delete from user_inventory where item_id in(select id from retiring_outfits);
delete from catalog_items where stable_id in(select id from retiring_outfits);
insert into user_inventory(owner_id,item_id,source)
select id,'burrow_outfit_default','starter' from profiles
on conflict(owner_id,item_id) do nothing;
-- New users are granted metadata.starter items by the existing bootstrap.
-- The existing service-only Admin pricing RPC already supports category outfits.
notify pgrst,'reload schema';
commit;
