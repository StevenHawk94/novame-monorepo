-- Local artwork remains unchanged. Only existing paid Shop items can be priced.
alter table public.catalog_items add column if not exists shop_price_version bigint not null default 0;
create table if not exists public.burrow_shop_price_audit (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  item_id text not null references public.catalog_items(stable_id),
  old_price integer,
  new_price integer,
  version bigint not null,
  admin_id uuid,
  admin_email text,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.burrow_shop_price_audit enable row level security;
revoke all on public.burrow_shop_price_audit from public,anon,authenticated;
grant select on public.burrow_shop_price_audit to service_role;

create or replace function public.audit_burrow_shop_price_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare context jsonb:=coalesce(nullif(current_setting('burrow.price_admin',true),''),'{}')::jsonb;
begin
  if new.price is distinct from old.price then
    new.shop_price_version:=old.shop_price_version+1;
    new.updated_at:=now();
    insert into burrow_shop_price_audit(batch_id,item_id,old_price,new_price,version,admin_id,admin_email,reason)
      values(coalesce((context->>'batch')::uuid,gen_random_uuid()),old.stable_id,old.price,new.price,
        new.shop_price_version,(context->>'id')::uuid,context->>'email',context->>'reason');
  else new.shop_price_version:=old.shop_price_version; end if;
  return new;
end $$;
drop trigger if exists burrow_shop_price_audit_trigger on public.catalog_items;
create trigger burrow_shop_price_audit_trigger before update on public.catalog_items
  for each row execute function public.audit_burrow_shop_price_v1();

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
    if (select count(*) from jsonb_object_keys(requested))<>3 or not(requested ?& array['id','price','version'])
      or jsonb_typeof(requested->'id')<>'string' or length(requested->>'id') not between 1 and 160
      or jsonb_typeof(requested->'price')<>'number' or (requested->>'price') !~ '^[0-9]{1,7}$'
      or jsonb_typeof(requested->'version')<>'number' or (requested->>'version') !~ '^[0-9]{1,15}$'
      then return jsonb_build_object('error','invalid_request'); end if;
    if (requested->>'price')::integer not between 1 and 1000000 then return jsonb_build_object('error','invalid_request'); end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates)
    then return jsonb_build_object('error','invalid_request'); end if;
  -- Purchases take this shared lock before their normal pair/inventory locks.
  -- Admin batches take it exclusively: no mixed prices or row-order deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
  select value into revision from app_config where key='app_major_update_content_revision';
  if (select count(*) from catalog_items c join jsonb_array_elements(p_updates) u on c.stable_id=u->>'id')<>jsonb_array_length(p_updates)
    then return jsonb_build_object('error','not_found'); end if;
  -- Validate the entire locked batch before touching any price.
  for row in select c.*,u.value as requested from catalog_items c
    join jsonb_array_elements(p_updates) u on c.stable_id=u.value->>'id'
    order by c.stable_id for update of c loop
    if row.status<>'active' or row.revision_id is distinct from revision or row.item_type not in('decor','outfit')
      or row.category not in('wallpapers','seasons','outfits','cushions','tables','rugs','vases','lamps','windows',
        'cabinets','shelves','shelf_decor','music_players','frames','couple_dolls','light_strings','ladders','dresser_plants')
      or row.price is null or row.price<=0 or coalesce((row.metadata->>'starter')::boolean,false)
      or not exists(select 1 from content_revisions where id=row.revision_id and status='published')
      then return jsonb_build_object('error','read_only_item','itemId',row.stable_id); end if;
    if row.shop_price_version<>(row.requested->>'version')::bigint
      then return jsonb_build_object('error','price_conflict','itemId',row.stable_id); end if;
  end loop;
  perform set_config('burrow.price_admin',jsonb_build_object('id',p_admin,'email',p_email,'batch',batch,'reason',p_reason)::text,true);
  for requested in select value from jsonb_array_elements(p_updates) order by value->>'id' loop
    update catalog_items set price=(requested->>'price')::integer where stable_id=requested->>'id';
    select jsonb_build_object('id',stable_id,'price',price,'version',shop_price_version) into requested
      from catalog_items where stable_id=requested->>'id';
    updated:=updated||jsonb_build_array(requested);
  end loop;
  perform set_config('burrow.price_admin','',true);
  return jsonb_build_object('error',null,'batchId',batch,'updated',updated);
end $$;

-- This context is installed only by service-role v2 RPCs, inside the same
-- transaction as their v1 purchase. HTTP clients never control SQL settings.
-- Legacy clients without a displayed-price quote may buy unchanged products;
-- after a price edit they must upgrade rather than silently pay a new price.
create or replace function public.burrow_shop_price_error_v1(p_id text,p_price integer,p_version bigint)
returns jsonb language plpgsql stable set search_path=public as $$
declare prices jsonb:=coalesce(nullif(current_setting('burrow.shop_prices',true),''),'{}')::jsonb;
begin
  if not(prices ? p_id) then
    if p_version>0 then return jsonb_build_object('error','price_confirmation_required','itemId',p_id); end if;
  elsif jsonb_typeof(prices->p_id)<>'number' or (prices->>p_id) !~ '^[0-9]{1,7}$' then
    return jsonb_build_object('error','invalid_request');
  elsif (prices->>p_id)::integer is distinct from p_price then
    return jsonb_build_object('error','price_changed','itemId',p_id,'currentPrice',p_price);
  end if;
  return null;
end $$;

-- Patch at the locked price-read boundaries. Preserve live idempotency,
-- pairing, Plus, inventory, wallet and atomic-room implementations verbatim.
do $$
declare signature text; definition text; marker text; guard text; variable text;
begin
  foreach signature in array array['public.purchase_catalog_item_v1(uuid,uuid,text,text)',
    'public.solo_burrow_purchase_v1(uuid,text,text)','public.purchase_room_loadout_v1(uuid,jsonb,text,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('burrow_shop_price_error_v1' in definition)>0 then continue; end if;
    if signature like '%purchase_catalog_item_v1%' then
      variable:='v_item'; marker:='  if not exists(select 1 from content_revisions where id=v_item.revision_id';
    elsif signature like '%solo_burrow_purchase_v1%' then
      variable:='item'; marker:='  select coalesce(subscription_tier::text';
    else variable:='item'; marker:='      total_cost:=total_cost+item.price;'; end if;
    if position(marker in definition)=0 then raise exception 'Unknown Shop purchase definition: %',signature; end if;
    guard:=format(E'  if public.burrow_shop_price_error_v1(%1$s.stable_id,%1$s.price,%1$s.shop_price_version) is not null then\n    return public.burrow_shop_price_error_v1(%1$s.stable_id,%1$s.price,%1$s.shop_price_version); end if;\n',variable);
    definition:=replace(definition,marker,guard||marker);
    -- Exact BEGIN newline, not any nested block. Acquisition precedes all
    -- existing pair/inventory/wallet locks; safe for legacy and v2 callers.
    definition:=regexp_replace(definition,E'\nbegin\n',E'\nbegin\n  perform pg_advisory_xact_lock_shared(hashtextextended(''burrow-shop-prices'',0));\n','i');
    execute definition;
  end loop;
end $$;

create or replace function public.purchase_catalog_item_v2(p_buyer_id uuid,p_recipient_id uuid,p_item_id text,p_idempotency_key text,p_expected_price integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_expected_price is null or p_expected_price not between 1 and 1000000 then return jsonb_build_object('error','invalid_request'); end if;
  perform set_config('burrow.shop_prices',jsonb_build_object(p_item_id,p_expected_price)::text,true);
  result:=public.purchase_catalog_item_v1(p_buyer_id,p_recipient_id,p_item_id,p_idempotency_key);
  if result->>'error'='not_paired' and (p_recipient_id is null or p_recipient_id=p_buyer_id) then
    result:=public.solo_burrow_purchase_v1(p_buyer_id,p_item_id,p_idempotency_key);
  end if;
  perform set_config('burrow.shop_prices','',true);
  return result;
end $$;

create or replace function public.purchase_room_loadout_v2(p_user_id uuid,p_slots jsonb,p_key text,p_outfit_item_id text,p_expected_prices jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; item_id text;
begin
  if p_expected_prices is null or jsonb_typeof(p_expected_prices)<>'object' or p_slots is null or jsonb_typeof(p_slots)<>'object'
    then return jsonb_build_object('error','invalid_request'); end if;
  if (select count(*) from jsonb_object_keys(p_expected_prices))>20 then return jsonb_build_object('error','invalid_request'); end if;
  for item_id in select value from jsonb_each_text(p_slots) union select p_outfit_item_id where p_outfit_item_id is not null loop
    if not(p_expected_prices ? item_id) or jsonb_typeof(p_expected_prices->item_id)<>'number'
      or (p_expected_prices->>item_id) !~ '^[0-9]{1,7}$' then return jsonb_build_object('error','invalid_request'); end if;
  end loop;
  perform set_config('burrow.shop_prices',p_expected_prices::text,true);
  result:=public.purchase_room_loadout_v1(p_user_id,p_slots,p_key,p_outfit_item_id);
  perform set_config('burrow.shop_prices','',true);
  return result;
end $$;

revoke all on function public.audit_burrow_shop_price_v1(),public.set_burrow_shop_prices_v1(uuid,text,jsonb,text),
  public.burrow_shop_price_error_v1(text,integer,bigint),public.purchase_catalog_item_v2(uuid,uuid,text,text,integer),
  public.purchase_room_loadout_v2(uuid,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_burrow_shop_prices_v1(uuid,text,jsonb,text),public.burrow_shop_price_error_v1(text,integer,bigint),
  public.purchase_catalog_item_v2(uuid,uuid,text,text,integer),public.purchase_room_loadout_v2(uuid,jsonb,text,text,jsonb) to service_role;
