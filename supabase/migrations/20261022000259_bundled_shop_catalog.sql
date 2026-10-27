-- Bundled product identities and transactional publication. No remote artwork.
-- Installing this migration alone does not publish or change the live catalog.
begin;
create table public.burrow_shop_catalog_releases (
 release text primary key check(release ~ '^[a-f0-9]{64}$'),
 app_version text not null, payload jsonb not null, published_at timestamptz not null default now()
);
create table public.burrow_shop_product_identities (
 product_id text primary key references public.catalog_items(stable_id),
 item_type text not null, category text not null, slot text,
 created_at timestamptz not null default now()
);
create table public.burrow_shop_release_support (
 release text not null, product_id text not null,
 primary key(release,product_id)
);
alter table public.burrow_shop_catalog_releases enable row level security;
alter table public.burrow_shop_product_identities enable row level security;
alter table public.burrow_shop_release_support enable row level security;
revoke all on public.burrow_shop_catalog_releases,public.burrow_shop_product_identities,public.burrow_shop_release_support from public,anon,authenticated;
grant all on public.burrow_shop_catalog_releases,public.burrow_shop_product_identities,public.burrow_shop_release_support to service_role;

create function public.guard_burrow_shop_identity_v1() returns trigger
language plpgsql set search_path=public as $$
begin
 if exists(select 1 from burrow_shop_product_identities where product_id=old.stable_id) then
  if tg_op='DELETE' then raise exception 'Retire products; permanent IDs must not be deleted'; end if;
  if (new.stable_id,new.item_type,new.category,new.metadata->>'slot') is distinct from
     (old.stable_id,old.item_type,old.category,old.metadata->>'slot')
   then raise exception 'Permanent product identity cannot change'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger burrow_shop_identity before update or delete on public.catalog_items
 for each row execute function public.guard_burrow_shop_identity_v1();

-- Historical Surprise IDs remain accepted; adding a published frame no longer
-- requires hand-editing a separate database CHECK constraint each release.
create function public.burrow_shop_frame_storage_v1(p_frame text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from catalog_items where item_type='surprise' and metadata->>'frameId'=p_frame);
$$;
do $$
declare previous text;
begin
 if to_regclass('public.burrow_surprises') is not null then
  select pg_get_expr(conbin,conrelid) into previous from pg_constraint
   where conrelid='public.burrow_surprises'::regclass and conname='burrow_surprises_frame_check';
  alter table public.burrow_surprises drop constraint if exists burrow_surprises_frame_check;
  execute format('alter table public.burrow_surprises add constraint burrow_surprises_frame_check check ((%s) or public.burrow_shop_frame_storage_v1(frame))',coalesce(previous,'false'));
 end if;
end $$;

create function public.publish_burrow_shop_catalog_v1(p_release jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p jsonb; previous jsonb; revision text; client record; ids jsonb; categories jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('burrow-shop-publication',0));
 perform pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
 if p_release->>'schema'<>'1' or coalesce(p_release->>'release','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_release->'products') is distinct from 'array'
  or jsonb_array_length(p_release->'products')<1
  or jsonb_typeof(p_release->'clients') is distinct from 'object'
  or not(p_release->'clients' ? (p_release->>'legacyRelease'))
  or not(p_release->'clients' ? (p_release->>'release'))
  then raise exception 'Invalid Shop release'; end if;
 categories:='["outfits","wallpapers","couple_dolls","cushions","tables","rugs","vases","lamps","windows","cabinets","music_players","frames","dresser_plants","light_strings","ladders","shelves","games","surprises"]';
 if p_release->'categories' is distinct from categories or p_release->'treasureCategories' is distinct from
  '["cushions","tables","rugs","vases","lamps","windows","cabinets","music_players","frames","dresser_plants","light_strings","ladders","shelves"]'::jsonb
  then raise exception 'Invalid Shop category policy'; end if;
 select payload into previous from burrow_shop_catalog_releases where release=p_release->>'release';
 if found then
  if previous is distinct from p_release then raise exception 'Release hash already published with different content'; end if;
  return jsonb_build_object('applied',false,'release',p_release->>'release');
 end if;
 if exists(select 1 from jsonb_array_elements(p_release->'products') x group by x->>'id' having count(*)>1)
  then raise exception 'Duplicate product ID'; end if;
 if exists(select 1 from jsonb_array_elements_text(categories) c where c not in('games','surprises') and
  (select count(*) from jsonb_array_elements(p_release->'products') entry where entry->>'category'=c and
   entry->>'status'='active' and entry->'metadata'->>'starter'='true')<>1)
  then raise exception 'Each room category needs exactly one active default'; end if;
 if exists(select 1 from burrow_shop_product_identities i where not exists(
  select 1 from jsonb_array_elements(p_release->'products') x where x->>'id'=i.product_id))
  then raise exception 'Missing permanent product; retire instead of deleting'; end if;
 if exists(select 1 from app_config where key='burrow_shop_legacy_release' and value<>p_release->>'legacyRelease')
  then raise exception 'Legacy capability baseline cannot change'; end if;
 select value into revision from app_config where key='app_major_update_content_revision';
 if not exists(select 1 from content_revisions where id=revision and status='published')
  then raise exception 'Content revision unavailable'; end if;
 for p in select * from jsonb_array_elements(p_release->'products') loop
  if coalesce(p->>'id','') !~ '^[a-zA-Z0-9_:-]{1,160}$'
   or coalesce(p->>'type','') not in('decor','outfit','game','surprise')
   or not(categories ? (p->>'category')) or coalesce(p->>'status','') not in('active','retired','draft')
   or nullif(trim(p->>'title'),'') is null or coalesce(p->'seed'->>'price','') !~ '^[0-9]+$'
   or (p->'seed'->>'price')::numeric>1000000
   or p->'metadata'->>'catalogManaged' is distinct from 'true'
   then raise exception 'Invalid product %',p->>'id'; end if;
  if exists(select 1 from catalog_items c where c.stable_id=p->>'id' and
   (c.item_type,c.category,c.metadata->>'slot') is distinct from (p->>'type',p->>'category',p->'metadata'->>'slot'))
   then raise exception 'Product identity reused: %',p->>'id'; end if;
  if exists(select 1 from app_config where key='burrow_shop_active_release') and
   exists(select 1 from catalog_items where stable_id=p->>'id') and
   not exists(select 1 from burrow_shop_product_identities where product_id=p->>'id')
   then raise exception 'Product ID already reserved outside this catalog: %',p->>'id'; end if;
  insert into catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,tags,asset,metadata,is_placeholder,status)
   values(p->>'id',revision,p->>'type',p->>'category',p->>'title',coalesce(p->>'description',''),
    (p->'seed'->>'price')::integer,(p->'seed'->>'plusOnly')::boolean,(p->'seed'->>'tradable')::boolean,
    array(select jsonb_array_elements_text(p->'tags')),p->'asset',p->'metadata',false,p->>'status')
   on conflict(stable_id) do update set title=excluded.title,description=excluded.description,
    tags=excluded.tags,asset=excluded.asset,metadata=excluded.metadata,status=excluded.status,updated_at=now();
  -- Existing Admin prices/Plus/tradability, ownership and purchase receipts stay untouched.
  insert into burrow_shop_product_identities(product_id,item_type,category,slot)
   values(p->>'id',p->>'type',p->>'category',p->'metadata'->>'slot') on conflict do nothing;
 end loop;
 for client in select * from jsonb_each(p_release->'clients') loop
  if client.key !~ '^[a-f0-9]{64}$' or jsonb_typeof(client.value)<>'array'
   then raise exception 'Invalid client capabilities'; end if;
  if exists(select 1 from jsonb_array_elements_text(client.value) x where not exists(
   select 1 from burrow_shop_product_identities where product_id=x))
   then raise exception 'Unknown supported product'; end if;
  select jsonb_agg(product_id order by product_id) into ids from burrow_shop_release_support where release=client.key;
  if ids is not null and ids is distinct from (select jsonb_agg(x order by x) from jsonb_array_elements_text(client.value) x)
   then raise exception 'Published client capabilities cannot change'; end if;
  insert into burrow_shop_release_support select client.key,x from jsonb_array_elements_text(client.value) x on conflict do nothing;
 end loop;
 insert into burrow_shop_catalog_releases(release,app_version,payload) values(p_release->>'release',p_release->>'appVersion',p_release);
 insert into app_config(key,value) values('burrow_shop_legacy_release',p_release->>'legacyRelease'),('burrow_shop_active_release',p_release->>'release')
  on conflict(key) do update set value=excluded.value;
 -- Never reroll a bound/revealed chest, friend, dialogue or claim receipt.
 update adventure_encounter_plans set snapshot=snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins'
  where status='reserved' and adventure_id is null;
 return jsonb_build_object('applied',true,'release',p_release->>'release','products',jsonb_array_length(p_release->'products'));
end $$;

create function public.burrow_shop_item_supported_v1(p_item text,p_release text default null) returns boolean
language sql stable security definer set search_path=public as $$
 select not exists(select 1 from app_config where key='burrow_shop_active_release') or exists(
  select 1 from burrow_shop_release_support where product_id=p_item and release=coalesce(
   (select release from burrow_shop_release_support where release=p_release limit 1),
   (select value from app_config where key='burrow_shop_legacy_release')));
$$;
-- Explicit recovery to a previously validated release. Never delete a newer
-- product or its ownership; temporarily retire it instead. Admin prices stay.
create function public.rollback_burrow_shop_catalog_v1(p_release text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare known jsonb; p jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('burrow-shop-publication',0));
 perform pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
 select payload into known from burrow_shop_catalog_releases where release=p_release;
 if not found then raise exception 'Unknown catalog release'; end if;
 update catalog_items set status='retired',updated_at=now() where stable_id in(
  select product_id from burrow_shop_product_identities) and not exists(
  select 1 from jsonb_array_elements(known->'products') x where x->>'id'=stable_id);
 for p in select * from jsonb_array_elements(known->'products') loop
  update catalog_items set title=p->>'title',description=coalesce(p->>'description',''),
   tags=array(select jsonb_array_elements_text(p->'tags')),asset=p->'asset',metadata=p->'metadata',
   status=p->>'status',updated_at=now() where stable_id=p->>'id';
 end loop;
 update app_config set value=p_release where key='burrow_shop_active_release';
 update adventure_encounter_plans set snapshot=snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins'
  where status='reserved' and adventure_id is null;
 return jsonb_build_object('applied',true,'release',p_release);
end $$;
create function public.start_burrow_adventure_catalog_v1(p_user_id uuid,p_record_id uuid,p_idempotency_key text,p_catalog_release text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 -- Request-local capability, not a financial/entitlement authority. Unknown is legacy.
 perform set_config('burrow.catalog_release',coalesce(p_catalog_release,''),true);
 return start_adventure_v4(p_user_id,p_record_id,p_idempotency_key);
end $$;

-- Keep the existing selector, equal-weight coin tickets and all ownership/Plus
-- checks. Gate only future reservations by the bundle that started the journey.
do $$
declare body text; needle text:='and c.item_type=''decor'' and not c.plus_only and c.price>0';
begin
 select pg_get_functiondef('public.prepare_adventure_encounters_v2(uuid)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'Adventure selector changed; review required'; end if;
 body:=replace(body,needle,needle||E'\n    and public.burrow_shop_item_supported_v1(c.stable_id,coalesce(nullif(current_setting(''burrow.catalog_release'',true),''''),plan.snapshot->>''catalogRelease''))');
 body:=replace(body,'''treasureReserved'',true,''treasureSnapshot'',furniture,''treasureCoins'',coins',
  '''treasureReserved'',true,''treasureSnapshot'',furniture,''treasureCoins'',coins,''catalogRelease'',coalesce(nullif(current_setting(''burrow.catalog_release'',true),''''),plan.snapshot->>''catalogRelease'')');
 execute body;
end $$;

-- Placing owned retired art is valid. Purchase writers still require active.
do $$
declare fn regprocedure; body text; edited text;
begin
 foreach fn in array array['public.save_room_loadout_v1(uuid,text,jsonb)'::regprocedure,
  'public.solo_burrow_loadout_v1(uuid,jsonb)'::regprocedure,
  'public.save_bunny_outfit_v1(uuid,text)'::regprocedure,'public.solo_burrow_outfit_v1(uuid,text)'::regprocedure] loop
  select pg_get_functiondef(fn) into body;
  edited:=replace(body,'status=''active''','status in(''active'',''retired'')');
  if edited=body then raise exception 'Owned placement writer changed: %',fn; end if;
  execute edited; -- Existing locks, slot validation, pair scopes and ownership checks remain.
 end loop;
end $$;
-- Photo updates on an owned retired Plushie retain their existing photo quota,
-- pair binding and ownership checks. Older database fixtures may lack this RPC.
do $$
declare fn regprocedure:=coalesce(to_regprocedure('public.burrow_toy_photo_target_allowed_v1(uuid,uuid,text,uuid)'),
 to_regprocedure('public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text)')); body text; edited text;
begin
 if fn is not null then
  select pg_get_functiondef(fn) into body;
  edited:=replace(body,'c.status=''active''','c.status in(''active'',''retired'')');
  if edited=body then raise exception 'Toy photo writer changed; review required'; end if;
  execute edited;
 end if;
end $$;
revoke all on function public.guard_burrow_shop_identity_v1(),public.publish_burrow_shop_catalog_v1(jsonb),
 public.burrow_shop_frame_storage_v1(text),
 public.rollback_burrow_shop_catalog_v1(text),public.burrow_shop_item_supported_v1(text,text),public.start_burrow_adventure_catalog_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.publish_burrow_shop_catalog_v1(jsonb),public.burrow_shop_item_supported_v1(text,text),
 public.burrow_shop_frame_storage_v1(text),
 public.rollback_burrow_shop_catalog_v1(text),public.start_burrow_adventure_catalog_v1(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
