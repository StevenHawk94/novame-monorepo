-- A decoration checkout is one database transaction: purchase every missing
-- item, then equip the entire preview. A failed item or save rolls all debits
-- back, so the room can never be half-purchased.
create table if not exists public.room_checkout_operations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  slots jsonb not null,
  outfit_item_id text,
  total integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.room_checkout_operations enable row level security;
revoke all on public.room_checkout_operations from public, anon, authenticated;

create or replace function public.purchase_room_loadout_v1(p_user_id uuid, p_slots jsonb, p_key text, p_outfit_item_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  partner uuid;
  existing public.room_checkout_operations%rowtype;
  slot_name text;
  item_id_value text;
  item public.catalog_items%rowtype;
  total_cost integer := 0;
  balance integer := 0;
  paid boolean := false;
  result jsonb;
  ordinal integer := 0;
begin
  if p_user_id is null or p_slots is null or jsonb_typeof(p_slots)<>'object'
    or (select count(*) from jsonb_object_keys(p_slots)) not between 1 and 18
    or nullif(trim(p_key),'') is null or length(p_key)>120
    then return jsonb_build_object('error','invalid_request'); end if;

  -- Serialize checkouts for this user. Sub-purchases have deterministic keys
  -- and the completed operation is recorded only after the save succeeds.
  perform pg_advisory_xact_lock(hashtextextended('room-checkout:'||p_user_id::text,0));
  select * into existing from public.room_checkout_operations
    where user_id=p_user_id and idempotency_key=p_key;
  if found then
    if existing.slots<>p_slots or existing.outfit_item_id is distinct from p_outfit_item_id
      then return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error',null,'applied',false,'total',existing.total);
  end if;

  partner:=public.lock_burrow_pair(p_user_id);
  select exists(select 1 from public.profiles
    where id in (p_user_id,partner) and coalesce(subscription_tier::text,'free')<>'free') into paid;

  for slot_name,item_id_value in select key,value from jsonb_each_text(p_slots) order by key loop
    select * into item from public.catalog_items
      where stable_id=item_id_value and status='active' for share;
    if not found or item.item_type<>'decor' or item.metadata->>'slot' is distinct from slot_name
      then return jsonb_build_object('error','invalid_loadout'); end if;
    if not exists(select 1 from public.user_inventory
      where item_id=item_id_value and (owner_id=p_user_id or (partner is not null and owner_id=partner))) then
      if item.price is null or item.price<=0 or not exists(select 1 from public.content_revisions
        where id=item.revision_id and status='published') then return jsonb_build_object('error','not_for_sale'); end if;
      if item.plus_only and not paid then return jsonb_build_object('error','plus_required'); end if;
      total_cost:=total_cost+item.price;
    end if;
  end loop;

  if p_outfit_item_id is not null then
    select * into item from public.catalog_items
      where stable_id=p_outfit_item_id and status='active' for share;
    if not found or item.item_type<>'outfit' or item.metadata->>'slot'<>'outfit'
      then return jsonb_build_object('error','invalid_outfit'); end if;
    if not exists(select 1 from public.user_inventory
      where item_id=p_outfit_item_id and owner_id=p_user_id) then
      if item.price is null or item.price<=0 or not exists(select 1 from public.content_revisions
        where id=item.revision_id and status='published') then return jsonb_build_object('error','not_for_sale'); end if;
      if item.plus_only and not paid then return jsonb_build_object('error','plus_required'); end if;
      total_cost:=total_cost+item.price;
    end if;
  end if;

  select carrot_balance into balance from public.wallets where user_id=p_user_id;
  if coalesce(balance,0)<total_cost then return jsonb_build_object('error','insufficient_balance'); end if;

  for slot_name,item_id_value in select key,value from jsonb_each_text(p_slots) order by key loop
    if not exists(select 1 from public.user_inventory
      where item_id=item_id_value and (owner_id=p_user_id or (partner is not null and owner_id=partner))) then
      ordinal:=ordinal+1;
      if partner is null then
        result:=public.solo_burrow_purchase_v1(p_user_id,item_id_value,p_key||':'||ordinal::text);
      else
        result:=public.purchase_catalog_item_v1(p_user_id,p_user_id,item_id_value,p_key||':'||ordinal::text);
      end if;
      if result->>'error' is not null then
        raise exception 'room_checkout_purchase_failed: %', result->>'error';
      end if;
    end if;
  end loop;

  if p_outfit_item_id is not null and not exists(select 1 from public.user_inventory
    where item_id=p_outfit_item_id and owner_id=p_user_id) then
    ordinal:=ordinal+1;
    if partner is null then
      result:=public.solo_burrow_purchase_v1(p_user_id,p_outfit_item_id,p_key||':'||ordinal::text);
    else
      result:=public.purchase_catalog_item_v1(p_user_id,p_user_id,p_outfit_item_id,p_key||':'||ordinal::text);
    end if;
    if result->>'error' is not null then raise exception 'room_checkout_outfit_purchase_failed: %', result->>'error'; end if;
  end if;

  if partner is null then result:=public.solo_burrow_loadout_v1(p_user_id,p_slots);
  else result:=public.save_room_loadout_v1(p_user_id,'home',p_slots); end if;
  if result->>'error' is not null then
    raise exception 'room_checkout_save_failed: %', result->>'error';
  end if;

  if p_outfit_item_id is not null then
    if partner is null then result:=public.solo_burrow_outfit_v1(p_user_id,p_outfit_item_id);
    else result:=public.save_bunny_outfit_v1(p_user_id,p_outfit_item_id); end if;
    if result->>'error' is not null then
      raise exception 'room_checkout_outfit_save_failed: %', result->>'error';
    end if;
  end if;

  insert into public.room_checkout_operations(user_id,idempotency_key,slots,outfit_item_id,total)
    values(p_user_id,p_key,p_slots,p_outfit_item_id,total_cost);
  return jsonb_build_object('error',null,'applied',true,'total',total_cost);
end $$;

revoke all on function public.purchase_room_loadout_v1(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.purchase_room_loadout_v1(uuid,jsonb,text,text) to service_role;
