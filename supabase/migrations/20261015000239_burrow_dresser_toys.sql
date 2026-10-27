-- Existing 29 toy identities and all owned/photo/loadout records stay intact.
-- Their refreshed artwork is bundled in the mobile registry. Append four new
-- identities at ordinals 30-33; only the new items default to 300 coins.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
begin
 if not exists(select 1 from public.app_config a join public.content_revisions r on r.id=a.value
   where a.key='app_major_update_content_revision' and r.status='published') then
  raise exception 'A published Burrow content revision is required';
 end if;
 if exists(select 1 from public.catalog_items c join (values
  ('burrow_art_couple_dolls_30','Racing Ace'),('burrow_art_couple_dolls_31','Rockstar'),
  ('burrow_art_couple_dolls_32','Skater Boy'),('burrow_art_couple_dolls_33','Y2K Idol')
 ) x(id,name) on c.stable_id=x.id where c.category is distinct from 'couple_dolls'
  or c.item_type is distinct from 'decor' or c.metadata->>'artName' is distinct from x.name) then
  raise exception 'New toy ID collision; refusing to replace another product';
 end if;
end $$;
with toys(stable_id,ordinal,title,file) as (values
 ('burrow_art_couple_dolls_30',30,'Racing Ace','Racing Ace.webp'),
 ('burrow_art_couple_dolls_31',31,'Rockstar','Rockstar.webp'),
 ('burrow_art_couple_dolls_32',32,'Skater Boy','Skater Boy.webp'),
 ('burrow_art_couple_dolls_33',33,'Y2K Idol','Y2K Idol.webp')
)
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,
 tags,drop_weight,asset,metadata,is_placeholder,status)
select stable_id,(select value from public.app_config where key='app_major_update_content_revision'),
 'decor','couple_dolls',title,'An interactive toy for your Burrow.',300,false,true,array['burrow','couple_dolls'],0,
 jsonb_build_object('renderer','bundled','artCategory','couple_dolls','ordinal',ordinal,
  'file','burrow-webp/room decoration/interative toys on dresser/'||file),
 jsonb_build_object('slot','couple_doll','starter',false,'artOrdinal',ordinal,'artName',title),false,'active'
from toys
on conflict(stable_id) do update set title=excluded.title,
 asset=catalog_items.asset||excluded.asset,metadata=catalog_items.metadata||excluded.metadata,
 is_placeholder=false,updated_at=now();
notify pgrst,'reload schema';
commit;
