begin;
-- Receipts bind immutable financial intents to their original relationship.
-- Replays return the receipt without re-equipping an older room design.
create table public.burrow_shop_checkout_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 idempotency_key text not null, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,idempotency_key)
);
alter table public.burrow_shop_checkout_receipts enable row level security;
revoke all on public.burrow_shop_checkout_receipts from public,anon,authenticated;

create function public.purchase_room_changes_v1(p_user_id uuid,p_partner_id uuid,p_pair_version text,
 p_changes jsonb,p_expected_prices jsonb,p_expected_total integer,p_key text,p_catalog_release text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; intent jsonb; saved public.burrow_shop_checkout_receipts%rowtype;
 slot_name text; item_id_value text; item public.catalog_items%rowtype;
 total_cost integer:=0; receipt jsonb; previous_item text; changes jsonb:='[]'::jsonb;
begin
 if p_user_id is null or nullif(trim(p_key),'') is null or length(p_key)>120
  or p_changes is null or jsonb_typeof(p_changes)<>'object'
  or (select count(*) from jsonb_object_keys(p_changes)) not between 1 and 16
  or p_expected_prices is null or jsonb_typeof(p_expected_prices)<>'object'
  or p_expected_total is null or p_expected_total not between 0 and 16000000
 then return jsonb_build_object('error','invalid_request'); end if;
 intent:=jsonb_build_object('kind','room','partner',p_partner_id,'version',p_pair_version,
  'changes',p_changes,'prices',p_expected_prices,'total',p_expected_total);
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 perform pg_advisory_xact_lock(hashtextextended('shop-checkout:'||p_user_id::text,0));
 select * into saved from burrow_shop_checkout_receipts where user_id=p_user_id and idempotency_key=p_key;
 if found then
  if saved.request<>intent then return jsonb_build_object('error','idempotency_conflict'); end if;
  return saved.result||jsonb_build_object('applied',false);
 end if;
 partner:=lock_burrow_pair(p_user_id);
 if partner is distinct from p_partner_id or (partner is not null and p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner))
  or (partner is null and p_pair_version is not null) then return jsonb_build_object('error','pair_changed'); end if;
 perform lock_burrow_inventory(p_user_id,coalesce(partner,p_user_id));
 for slot_name,item_id_value in select key,value from jsonb_each_text(p_changes) order by key loop
  select * into item from catalog_items where stable_id=item_id_value and status='active' for share;
  if not found or item.metadata->>'slot' is distinct from slot_name
   or item.category not in('outfits','wallpapers','couple_dolls','cushions','tables','rugs','vases','lamps','windows',
    'cabinets','music_players','frames','dresser_plants','light_strings','ladders','shelves')
   or item.item_type is distinct from (case when slot_name='outfit' then 'outfit' else 'decor' end)
   then return jsonb_build_object('error','invalid_loadout'); end if;
  if not burrow_shop_item_supported_v1(item_id_value,p_catalog_release)
   then return jsonb_build_object('error','client_upgrade_required'); end if;
  if not(p_expected_prices ? item_id_value) or jsonb_typeof(p_expected_prices->item_id_value)<>'number'
   or (p_expected_prices->>item_id_value)!~'^[0-9]{1,7}$'
   then return jsonb_build_object('error','invalid_request'); end if;
  if not exists(select 1 from user_inventory where item_id=item_id_value and
   (owner_id=p_user_id or (slot_name<>'outfit' and partner is not null and owner_id=partner))) then
   if item.price is null or item.price<=0 then return jsonb_build_object('error','not_for_sale'); end if;
   if item.price<>(p_expected_prices->>item_id_value)::integer then return jsonb_build_object('error','price_changed'); end if;
   total_cost:=total_cost+item.price;
  end if;
 end loop;
 if total_cost>p_expected_total then return jsonb_build_object('error','price_changed'); end if;
 -- Nested exception block rolls back ALL sub-purchases on a late rejection.
 begin
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_changes) order by key loop
   if not exists(select 1 from user_inventory where item_id=item_id_value and
    (owner_id=p_user_id or (slot_name<>'outfit' and partner is not null and owner_id=partner))) then
    receipt:=purchase_catalog_item_v2(p_user_id,p_user_id,item_id_value,p_key||':'||slot_name,(p_expected_prices->>item_id_value)::integer);
    if receipt->>'error' is not null then raise exception using message='shop_checkout_rejected',detail=receipt->>'error'; end if;
   end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(case when partner is null then 'loadout:'||p_user_id::text||':solo'
   else 'loadout:'||least(p_user_id,partner)::text||':shared' end,0));
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_changes) order by key loop
   if slot_name='outfit' then
    if partner is null then receipt:=solo_burrow_outfit_v1(p_user_id,item_id_value);
    else receipt:=save_bunny_outfit_v1(p_user_id,item_id_value); end if;
    if receipt->>'error' is not null then raise exception using message='shop_checkout_rejected',detail=receipt->>'error'; end if;
   else
    select item_id into previous_item from room_loadouts where slot=slot_name and
     ((partner is null and room_type='home' and owner_id=p_user_id) or
      (partner is not null and room_type='our' and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)
       and burrow_relation_row_matches_v1(pair_low,pair_high,pair_version)));
    delete from room_loadouts where slot=slot_name and
     ((partner is null and room_type='home' and owner_id=p_user_id) or
      (partner is not null and room_type='our' and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)));
    if partner is null then
     insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by) values('home',p_user_id,slot_name,item_id_value,p_user_id);
    else
     insert into room_loadouts(room_type,pair_low,pair_high,slot,item_id,updated_by)
      values('our',least(p_user_id,partner),greatest(p_user_id,partner),slot_name,item_id_value,p_user_id);
    end if;
    if previous_item is distinct from item_id_value then changes:=changes||jsonb_build_array(jsonb_build_object(
     'slot',slot_name,'previousItemId',previous_item,'itemId',item_id_value)); end if;
   end if;
  end loop;
  if jsonb_array_length(changes)>0 then
   insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,payload,idempotency_key)
   values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,coalesce(partner,p_user_id),
    'room_decor_changed','room_loadout',jsonb_build_object('roomType',case when partner is null then 'home' else 'shared' end,'changes',changes),'room-checkout:'||p_key);
  end if;
  receipt:=jsonb_build_object('error',null,'applied',true,'checkoutId',p_key,'total',total_cost,'appliedChanges',p_changes);
  insert into burrow_shop_checkout_receipts(user_id,idempotency_key,request,result) values(p_user_id,p_key,intent,receipt);
  return receipt;
 exception when raise_exception then
  if sqlerrm<>'shop_checkout_rejected' then raise; end if;
  declare reason text; begin get stacked diagnostics reason=pg_exception_detail;
   return jsonb_build_object('error',reason); end;
 end;
end $$;

create function public.purchase_catalog_item_scoped_v1(p_user_id uuid,p_partner_id uuid,p_pair_version text,
 p_recipient_id uuid,p_item_id text,p_expected_price integer,p_key text,p_catalog_release text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; intent jsonb; saved public.burrow_shop_checkout_receipts%rowtype; receipt jsonb;
begin
 if p_user_id is null or nullif(trim(p_key),'') is null or length(p_key)>120
  or p_recipient_id is null or p_expected_price is null or p_expected_price not between 1 and 1000000
  then return jsonb_build_object('error','invalid_request'); end if;
 intent:=jsonb_build_object('kind','item','partner',p_partner_id,'version',p_pair_version,
  'recipient',p_recipient_id,'item',p_item_id,'price',p_expected_price);
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 perform pg_advisory_xact_lock(hashtextextended('shop-checkout:'||p_user_id::text,0));
 select * into saved from burrow_shop_checkout_receipts where user_id=p_user_id and idempotency_key=p_key;
 if found then
  if saved.request<>intent then return jsonb_build_object('error','idempotency_conflict'); end if;
  return saved.result||jsonb_build_object('applied',false);
 end if;
 partner:=lock_burrow_pair(p_user_id);
 if partner is distinct from p_partner_id or (partner is not null and p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner))
  or (partner is null and p_pair_version is not null) then return jsonb_build_object('error','pair_changed'); end if;
 if p_recipient_id<>p_user_id and p_recipient_id is distinct from partner then return jsonb_build_object('error','not_paired'); end if;
 if not burrow_shop_item_supported_v1(p_item_id,p_catalog_release) then return jsonb_build_object('error','client_upgrade_required'); end if;
 receipt:=purchase_catalog_item_v2(p_user_id,p_recipient_id,p_item_id,p_key,p_expected_price);
 if receipt->>'error' is not null then return receipt; end if;
 receipt:=receipt||jsonb_build_object('checkoutId',p_key,'itemId',p_item_id);
 insert into burrow_shop_checkout_receipts(user_id,idempotency_key,request,result) values(p_user_id,p_key,intent,receipt);
 return receipt;
end $$;

-- Remove retired-placement compatibility, without removing any user rows.
do $$ declare fn regprocedure; body text; begin
 foreach fn in array array['public.save_room_loadout_v1(uuid,text,jsonb)'::regprocedure,
  'public.solo_burrow_loadout_v1(uuid,jsonb)'::regprocedure,'public.save_bunny_outfit_v1(uuid,text)'::regprocedure,
  'public.solo_burrow_outfit_v1(uuid,text)'::regprocedure] loop
  select pg_get_functiondef(fn) into body;
  execute replace(body,'status in(''active'',''retired'')','status=''active''');
 end loop;
 fn:=to_regprocedure('public.burrow_toy_photo_target_allowed_v1(uuid,uuid,text,uuid)');
 if fn is not null then select pg_get_functiondef(fn) into body;
  execute replace(body,'c.status in(''active'',''retired'')','c.status=''active'''); end if;
end $$;

-- Wallet reconciliation acknowledges durable purchase reservations, even if
-- a command response was lost and Bootstrap arrived first.
create or replace function public.burrow_reward_wallet_state_v1(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'wallet',jsonb_build_object('balance',w.carrot_balance,'version',w.version),
  'localDate',(now() at time zone coalesce(nullif(p.timezone_name,''),'UTC'))::date,
  'timezone',coalesce(nullif(p.timezone_name,''),'UTC'),'serverNow',now(),
  'spends',coalesce((select jsonb_agg(k) from (
   select 'surprise-send:'||s.idempotency_key::text k from burrow_surprises s where s.sender_id=p_user_id and s.paid_at is not null
    and s.refunded_at is null and (s.sent_at is null or s.sent_at>=now()-interval '8 days')
   union select 'shop-room:'||r.idempotency_key from burrow_shop_checkout_receipts r where r.user_id=p_user_id
    and r.request->>'kind'='room' and r.created_at>=now()-interval '8 days'
   union select 'shop-room:'||r.idempotency_key from room_checkout_operations r where r.user_id=p_user_id and r.created_at>=now()-interval '8 days'
   union select 'shop-item:'||c.idempotency_key from catalog_purchases c where c.buyer_id=p_user_id and c.created_at>=now()-interval '8 days'
  ) s),'[]'::jsonb),
  'credits',coalesce((select jsonb_agg(jsonb_build_object('key',l.idempotency_key,'amount',l.delta,'reason',l.reason))
   from currency_ledger l where l.user_id=p_user_id and l.requested_delta>0 and l.created_at>=now()-interval '8 days'),'[]'::jsonb)
 ) from wallets w join profiles p on p.id=w.user_id where w.user_id=p_user_id;
$$;
revoke all on function public.purchase_room_changes_v1(uuid,uuid,text,jsonb,jsonb,integer,text,text),
 public.purchase_catalog_item_scoped_v1(uuid,uuid,text,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.purchase_room_changes_v1(uuid,uuid,text,jsonb,jsonb,integer,text,text),
 public.purchase_catalog_item_scoped_v1(uuid,uuid,text,uuid,text,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
