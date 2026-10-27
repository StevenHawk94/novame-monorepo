-- Extend the existing Shop settings transaction; retain the RPC name so older
-- price-only Admin clients remain compatible. No assets or inventory changes.
alter table public.burrow_shop_price_audit add column if not exists old_plus_only boolean;
alter table public.burrow_shop_price_audit add column if not exists new_plus_only boolean;

create or replace function public.audit_burrow_shop_price_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare context jsonb:=coalesce(nullif(current_setting('burrow.price_admin',true),''),'{}')::jsonb;
begin
  if new.price is distinct from old.price or new.plus_only is distinct from old.plus_only then
    new.shop_price_version:=old.shop_price_version+1;
    new.updated_at:=now();
    insert into burrow_shop_price_audit(batch_id,item_id,old_price,new_price,old_plus_only,new_plus_only,
      version,admin_id,admin_email,reason)
      values(coalesce((context->>'batch')::uuid,gen_random_uuid()),old.stable_id,old.price,new.price,
        old.plus_only,new.plus_only,new.shop_price_version,(context->>'id')::uuid,context->>'email',context->>'reason');
  else new.shop_price_version:=old.shop_price_version; end if;
  return new;
end $$;

create or replace function public.set_burrow_shop_prices_v1(p_admin uuid,p_email text,p_updates jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row record; requested jsonb; revision text; batch uuid:=gen_random_uuid(); updated jsonb:='[]';
begin
  if p_admin is null or nullif(trim(p_email),'') is null or length(p_email)>320
    or length(coalesce(p_reason,''))>500 or p_updates is null or jsonb_typeof(p_updates)<>'array'
    then return jsonb_build_object('error','invalid_request'); end if;
  if jsonb_array_length(p_updates) not between 1 and 200 then return jsonb_build_object('error','invalid_request'); end if;
  for requested in select value from jsonb_array_elements(p_updates) loop
    if jsonb_typeof(requested)<>'object' then return jsonb_build_object('error','invalid_request'); end if;
    if not(requested ?& array['id','version']) or not(requested ?| array['price','plus_only'])
      or exists(select 1 from jsonb_object_keys(requested) k where k not in('id','version','price','plus_only'))
      or jsonb_typeof(requested->'id')<>'string' or length(trim(requested->>'id')) not between 1 and 160
      or length(requested->>'id')>160
      or jsonb_typeof(requested->'version')<>'number' or (requested->>'version') !~ '^[0-9]{1,15}$'
      then return jsonb_build_object('error','invalid_request'); end if;
    if requested ? 'price' then
      if jsonb_typeof(requested->'price')<>'number' or (requested->>'price') !~ '^[0-9]{1,7}$'
        then return jsonb_build_object('error','invalid_request'); end if;
      if (requested->>'price')::integer not between 1 and 1000000 then return jsonb_build_object('error','invalid_request'); end if;
    end if;
    if requested ? 'plus_only' and jsonb_typeof(requested->'plus_only')<>'boolean'
      then return jsonb_build_object('error','invalid_request'); end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates)
    then return jsonb_build_object('error','invalid_request'); end if;
  -- The same exclusive lock also serializes membership changes with purchases.
  perform pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
  select value into revision from app_config where key='app_major_update_content_revision';
  if (select count(*) from catalog_items c join jsonb_array_elements(p_updates) u on c.stable_id=u->>'id')<>jsonb_array_length(p_updates)
    then return jsonb_build_object('error','not_found'); end if;
  -- Validate every row before publishing any part of the batch. Starter price
  -- protections remain intact, while every live Shop row gets a Plus switch.
  for row in select c.*,u.value as requested from catalog_items c
    join jsonb_array_elements(p_updates) u on c.stable_id=u.value->>'id'
    order by c.stable_id for update of c loop
    if row.status<>'active' or row.revision_id is distinct from revision
      or row.category not in('wallpapers','seasons','outfits','cushions','tables','rugs','vases','lamps','windows',
        'cabinets','shelves','music_players','frames','couple_dolls','light_strings','ladders','dresser_plants')
      or not exists(select 1 from content_revisions where id=row.revision_id and status='published')
      then return jsonb_build_object('error','read_only_item','itemId',row.stable_id); end if;
    if row.requested ? 'price' and (row.item_type not in('decor','outfit') or row.price is null or row.price<=0
      or coalesce((row.metadata->>'starter')::boolean,false))
      then return jsonb_build_object('error','read_only_item','itemId',row.stable_id); end if;
    if row.shop_price_version<>(row.requested->>'version')::bigint
      then return jsonb_build_object('error','price_conflict','itemId',row.stable_id); end if;
  end loop;
  perform set_config('burrow.price_admin',jsonb_build_object('id',p_admin,'email',p_email,'batch',batch,'reason',p_reason)::text,true);
  for requested in select value from jsonb_array_elements(p_updates) order by value->>'id' loop
    update catalog_items set
      price=case when requested ? 'price' then (requested->>'price')::integer else price end,
      plus_only=case when requested ? 'plus_only' then (requested->>'plus_only')::boolean else plus_only end
      where stable_id=requested->>'id';
    select jsonb_build_object('id',stable_id,'price',price,'plus_only',plus_only,'version',shop_price_version) into requested
      from catalog_items where stable_id=requested->>'id';
    updated:=updated||jsonb_build_array(requested);
  end loop;
  perform set_config('burrow.price_admin','',true);
  return jsonb_build_object('error',null,'batchId',batch,'updated',updated);
end $$;

revoke all on function public.audit_burrow_shop_price_v1(),public.set_burrow_shop_prices_v1(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.set_burrow_shop_prices_v1(uuid,text,jsonb,text) to service_role;
