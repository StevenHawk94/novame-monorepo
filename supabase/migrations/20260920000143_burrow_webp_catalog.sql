-- Bind the existing Burrow catalog to the supplied artwork without replacing
-- stable IDs already present in inventories, gifts, and room loadouts.
with legacy(stable_id, ordinal) as (values
  ('storage_burrow_01', 1), ('placeholder_storage_02', 2),
  ('window_sunny_01', 1), ('placeholder_windows_02', 2),
  ('lamp_acorn_01', 1), ('placeholder_lamps_02', 2),
  ('plant_daisy_01', 1), ('placeholder_plants_02', 2),
  ('cushion_moss_01', 1), ('placeholder_cushions_02', 2),
  ('table_stump_01', 1), ('placeholder_tables_02', 2),
  ('rug_leaf_01', 1), ('placeholder_rugs_02', 2),
  ('wall_art_oak_01', 1), ('placeholder_wall_art_02', 2),
  ('placeholder_music_players_01', 1), ('placeholder_music_players_02', 2),
  ('placeholder_frames_01', 1), ('placeholder_frames_02', 2),
  ('placeholder_couple_dolls_01', 1), ('placeholder_couple_dolls_02', 2)
)
update public.catalog_items item
set metadata = item.metadata || jsonb_build_object('artOrdinal', legacy.ordinal, 'starter', legacy.ordinal = 1),
    asset = item.asset || jsonb_build_object('renderer', 'bundled', 'artCategory', item.category, 'ordinal', legacy.ordinal),
    title = case item.stable_id
      when 'storage_burrow_01' then 'Dresser'
      when 'lamp_acorn_01' then 'Mushroom Lamp'
      when 'plant_daisy_01' then 'Flower Vase'
      when 'rug_leaf_01' then 'Striped Rug'
      when 'table_stump_01' then 'Stump Table'
      when 'wall_art_oak_01' then 'Leaf Poster'
      else item.title end,
    is_placeholder = false
from legacy where item.stable_id = legacy.stable_id;

with groups(category, slot, last_ordinal, first_new, label) as (values
  ('cabinets', 'cabinet', 8, 3, 'Dresser'),
  ('shelves', 'shelf', 8, 1, 'Bookshelf'),
  ('light_strings', 'light_string', 8, 1, 'String lights'),
  ('windows', 'window', 8, 3, 'Window'),
  ('ladders', 'ladder', 8, 1, 'Ladder'),
  ('tables', 'table', 8, 3, 'Table'),
  ('frames', 'frame', 8, 3, 'Photo frame'),
  ('lamps', 'lamp', 8, 3, 'Lamp'),
  ('couple_dolls', 'couple_doll', 6, 3, 'Doll'),
  ('shelf_decor', 'shelf_decor', 6, 1, 'Shelf decoration'),
  ('dresser_plants', 'dresser_plant', 8, 1, 'Dresser plant'),
  ('rugs', 'rug', 8, 3, 'Rug'),
  ('cushions', 'cushion', 9, 3, 'Cushion'),
  ('vases', 'vase', 8, 3, 'Flowers'),
  ('music_players', 'music_player', 8, 3, 'Radio'),
  ('posters', 'poster', 8, 3, 'Poster')
)
insert into public.catalog_items (
  stable_id, revision_id, item_type, category, title, description, price,
  plus_only, tradable, tags, drop_weight, asset, metadata, is_placeholder
)
select 'burrow_art_' || groups.category || '_' || lpad(variant.ordinal::text, 2, '0'),
  'burrow-v1-placeholder', 'decor', groups.category,
  groups.label || ' · ' || variant.ordinal,
  'A room decoration from the Burrow art collection.',
  case when variant.ordinal = 1 then 0 else 150 end,
  false, true, array['burrow', groups.category], 0,
  jsonb_build_object('renderer', 'bundled', 'artCategory', groups.category, 'ordinal', variant.ordinal),
  jsonb_build_object('slot', groups.slot, 'starter', variant.ordinal = 1, 'artOrdinal', variant.ordinal),
  false
from groups cross join lateral generate_series(groups.first_new, groups.last_ordinal) as variant(ordinal)
on conflict (stable_id) do update set
  asset = excluded.asset, metadata = excluded.metadata, is_placeholder = false;

-- The earlier room save limit covered twelve decorations plus the outfit.
-- Five new decorated slots raise the maximum to eighteen without changing the
-- inventory and pair authorization checks in that function.
create or replace function public.save_room_loadout_v1(p_user_id uuid,p_room_type text,p_slots jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; slot_name text; item_id_value text; item public.catalog_items%rowtype;
begin
  partner:=public.lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_room_type not in ('home','our') or p_slots is null or jsonb_typeof(p_slots)<>'object'
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if (select count(*) from jsonb_object_keys(p_slots))>18
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if p_room_type='our' and not exists(select 1 from profiles where id in(p_user_id,partner)
    and coalesce(subscription_tier::text,'free')<>'free') then return jsonb_build_object('error','plus_required'); end if;
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
