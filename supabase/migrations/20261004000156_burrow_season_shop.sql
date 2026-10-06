-- Keep Autumn as the free default; other seasons are optional purchases.
-- The background slot changes the cave rim/floor only, not the wallpaper,
-- furniture, photos or personal outfit. No saved loadout is reset.
with seasons(stable_id, ordinal, title, file) as (values
  ('burrow_season_autumn_01', 1, 'Autumn', 'Default-Background-Autumn.webp'),
  ('burrow_season_spring_02', 2, 'Spring', 'Background-Spring.webp'),
  ('burrow_season_summer_03', 3, 'Summer', 'Background-Summer.webp'),
  ('burrow_season_winter_04', 4, 'Winter', 'Background-Winter.webp')
)
insert into public.catalog_items (stable_id, revision_id, item_type, category,
  title, description, price, plus_only, tradable, tags, drop_weight, asset, metadata, is_placeholder)
select stable_id, coalesce((select value from public.app_config
  where key='app_major_update_content_revision'), 'burrow-v1-placeholder'),
  'decor', 'seasons', title, 'A seasonal background for your Burrow.',
  case when ordinal=1 then 0 else 150 end, false, true,
  array['burrow','seasons'], 0,
  jsonb_build_object('renderer','bundled','artCategory','backgrounds','ordinal',ordinal,
    'file','burrow-webp/room decoration/background-season/'||file),
  jsonb_build_object('slot','background','starter',ordinal=1,'artOrdinal',ordinal,'artName',title), false
from seasons
on conflict (stable_id) do update set title=excluded.title,
  asset=catalog_items.asset || excluded.asset,
  metadata=catalog_items.metadata || excluded.metadata,
  is_placeholder=false, updated_at=now();

-- Existing and future users own Autumn. Initialization grants future profiles
-- all active starter decorations; grant existing profiles without replacing
-- their background selection or spending any carrots.
insert into public.user_inventory(owner_id,item_id,source)
select id,'burrow_season_autumn_01','starter' from public.profiles
on conflict (owner_id,item_id) do nothing;

-- Add capacity for the new background slot while preserving live purchase,
-- ownership, pairing, atomic-checkout and moment-recording implementations.
do $$
declare signature text; definition text; updated_definition text;
begin
  foreach signature in array array[
    'public.save_room_loadout_v1(uuid,text,jsonb)',
    'public.solo_burrow_loadout_v1(uuid,jsonb)',
    'public.purchase_room_loadout_v1(uuid,jsonb,text,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    updated_definition := replace(definition, 'not between 1 and 18', 'not between 1 and 19');
    if updated_definition=definition and position('not between 1 and 19' in definition)=0 then
      raise exception 'Unexpected room slot validation in %', signature;
    end if;
    if updated_definition<>definition then execute updated_definition; end if;
  end loop;
end $$;
