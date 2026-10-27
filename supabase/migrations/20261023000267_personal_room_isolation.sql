begin;
-- Immutable recovery evidence. Never transfer inventory or photos to repair a layout.
create table public.burrow_room_recovery_archive (
 source_id uuid not null, snapshot_hash text not null,
 owner_low uuid not null references public.profiles(id) on delete cascade,
 owner_high uuid references public.profiles(id) on delete cascade,
 original_row jsonb not null, archived_at timestamptz not null default now(),primary key(source_id,snapshot_hash)
);
alter table public.burrow_room_recovery_archive enable row level security;
revoke all on public.burrow_room_recovery_archive from public,anon,authenticated;
insert into public.burrow_room_recovery_archive(source_id,snapshot_hash,owner_low,owner_high,original_row)
 select id,md5(to_jsonb(l)::text),coalesce(owner_id,pair_low),pair_high,to_jsonb(l) from public.room_loadouts l on conflict do nothing;

-- A legacy personal row is evidence, not proof of entitlement. Archive above
-- keeps the exact layout recoverable; ambiguous selections fall back to defaults.
delete from public.room_loadouts l where l.room_type='home' and not exists(
 select 1 from public.catalog_items c where c.stable_id=l.item_id and c.status='active'
  and c.metadata->>'slot'=l.slot and (c.metadata->>'starter'='true'
   or exists(select 1 from public.user_inventory i where i.owner_id=l.owner_id and i.item_id=l.item_id)));

create table public.burrow_personal_room_activation (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 activated_at timestamptz not null default now()
);
alter table public.burrow_personal_room_activation enable row level security;
revoke all on public.burrow_personal_room_activation from public,anon,authenticated;
-- Activate at that account's first capable startup, not at deployment. This
-- also captures purchases made by an older installed client during rollout.
create function public.activate_personal_room_v1(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 perform pg_advisory_xact_lock(hashtextextended('loadout:'||p_user_id::text||':personal',0));
 if exists(select 1 from burrow_personal_room_activation where owner_id=p_user_id) then return; end if;
 insert into burrow_room_recovery_archive(source_id,snapshot_hash,owner_low,owner_high,original_row)
  select id,md5(to_jsonb(l)::text),coalesce(owner_id,pair_low),pair_high,to_jsonb(l) from room_loadouts l where l.owner_id=p_user_id or
   (l.room_type='our' and l.pair_low=least(p_user_id,partner) and l.pair_high=greatest(p_user_id,partner))
  on conflict do nothing;
 insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by)
  select 'home',p_user_id,l.slot,l.item_id,p_user_id from room_loadouts l
   join catalog_items c on c.stable_id=l.item_id and c.status='active'
  where partner is not null and l.room_type='our' and l.pair_low=least(p_user_id,partner) and l.pair_high=greatest(p_user_id,partner)
   and burrow_relation_row_matches_v1(l.pair_low,l.pair_high,l.pair_version)
   and (c.metadata->>'starter'='true' or exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=l.item_id))
  on conflict(owner_id,slot) where room_type='home' do nothing;
 insert into burrow_personal_room_activation(owner_id) values(p_user_id);
end $$;

create function public.purchase_personal_room_changes_v1(p_user_id uuid,
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
 intent:=jsonb_build_object('kind','personal-room','owner',p_user_id,
  'changes',p_changes,'prices',p_expected_prices,'total',p_expected_total);
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 perform pg_advisory_xact_lock(hashtextextended('shop-checkout:'||p_user_id::text,0));
 select * into saved from burrow_shop_checkout_receipts where user_id=p_user_id and idempotency_key=p_key;
 if found then
  if saved.request<>intent then return jsonb_build_object('error','idempotency_conflict'); end if;
  return saved.result||jsonb_build_object('applied',false);
 end if;
 partner:=lock_burrow_pair(p_user_id);
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
  if not exists(select 1 from user_inventory where item_id=item_id_value and owner_id=p_user_id)
    and coalesce(item.metadata->>'starter','false')<>'true' then
   if item.price is null or item.price<=0 then return jsonb_build_object('error','not_for_sale'); end if;
   if item.price<>(p_expected_prices->>item_id_value)::integer then return jsonb_build_object('error','price_changed'); end if;
   total_cost:=total_cost+item.price;
  end if;
 end loop;
 if total_cost>p_expected_total then return jsonb_build_object('error','price_changed'); end if;
 begin
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_changes) order by key loop
   if not exists(select 1 from user_inventory where item_id=item_id_value and owner_id=p_user_id)
    and not exists(select 1 from catalog_items where stable_id=item_id_value and metadata->>'starter'='true') then
    receipt:=purchase_catalog_item_v2(p_user_id,p_user_id,item_id_value,p_key||':'||slot_name,(p_expected_prices->>item_id_value)::integer);
    if receipt->>'error' is not null then raise exception using message='shop_checkout_rejected',detail=receipt->>'error'; end if;
   end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('loadout:'||p_user_id::text||':personal',0));
  for slot_name,item_id_value in select key,value from jsonb_each_text(p_changes) order by key loop
   select item_id into previous_item from room_loadouts where room_type='home' and owner_id=p_user_id and slot=slot_name;
   insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by)
    values('home',p_user_id,slot_name,item_id_value,p_user_id)
    on conflict(owner_id,slot) where room_type='home' do update
     set item_id=excluded.item_id,updated_by=excluded.updated_by,version=room_loadouts.version+1,updated_at=now();
   if previous_item is distinct from item_id_value then changes:=changes||jsonb_build_array(jsonb_build_object(
    'slot',slot_name,'previousItemId',previous_item,'itemId',item_id_value)); end if;
  end loop;
  if jsonb_array_length(changes)>0 then
   insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,payload,idempotency_key)
   values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,coalesce(partner,p_user_id),
    'room_decor_changed','room_loadout',jsonb_build_object('roomType','home','ownerId',p_user_id,'changes',changes),'room-checkout:'||p_key);
  end if;
  receipt:=jsonb_build_object('error',null,'applied',true,'checkoutId',p_key,'ownerId',p_user_id,'roomModel','personal-v2','total',total_cost,'appliedChanges',p_changes);
  insert into burrow_shop_checkout_receipts(user_id,idempotency_key,request,result) values(p_user_id,p_key,intent,receipt);
  return receipt;
 exception when raise_exception then
  if sqlerrm<>'shop_checkout_rejected' then raise; end if;
  declare reason text; begin get stacked diagnostics reason=pg_exception_detail;
   return jsonb_build_object('error',reason); end;
 end;
end $$;

-- The original immutable gift claim still grants inventory. Replacing now
-- targets ONLY the authenticated recipient's room, in the same transaction.
create function public.claim_personal_shop_gift_v1(p_recipient_id uuid,p_gift_id uuid,p_replace boolean,p_pair_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receipt jsonb; item public.catalog_items%rowtype; slot_name text; gift public.gifts%rowtype;
begin
 -- Use the same lock order as checkout/legacy claims to avoid pair↔gift deadlocks.
 perform lock_burrow_pair(p_recipient_id);
 perform lock_burrow_inventory(p_recipient_id,p_recipient_id);
 select * into gift from gifts where id=p_gift_id and recipient_id=p_recipient_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 select * into item from catalog_items where stable_id=gift.item_id;
 slot_name:=item.metadata->>'slot';
 if p_replace and (item.status is distinct from 'active' or item.item_type not in('decor','outfit') or slot_name is null)
  then return jsonb_build_object('error','invalid_loadout'); end if;
 receipt:=claim_shop_gift_v1(p_recipient_id,p_gift_id,false,p_pair_version);
 if receipt->>'error' is not null or receipt->>'applied'='false' then return receipt; end if;
 if p_replace then
  perform pg_advisory_xact_lock(hashtextextended('loadout:'||p_recipient_id::text||':personal',0));
  insert into room_loadouts(room_type,owner_id,slot,item_id,updated_by)
   values('home',p_recipient_id,slot_name,gift.item_id,p_recipient_id)
   on conflict(owner_id,slot) where room_type='home' do update
    set item_id=excluded.item_id,updated_by=excluded.updated_by,version=room_loadouts.version+1,updated_at=now();
 end if;
 return receipt||jsonb_build_object('replaced',p_replace,'ownerId',p_recipient_id);
end $$;

create function public.current_personal_burrow_toy_v1(p_owner uuid,p_partner uuid)
returns text language sql stable security definer set search_path=public as $$
 select coalesce((select item_id from room_loadouts where room_type='home' and owner_id=p_owner and slot='couple_doll' limit 1),
  (select stable_id from catalog_items where category='couple_dolls' and item_type='decor'
   and metadata->>'slot'='couple_doll' and metadata->>'starter'='true' and status='active' order by stable_id limit 1))
$$;
create function public.personal_burrow_toy_photo_target_allowed_v1(p_actor uuid,p_owner uuid,p_toy text,p_partner uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select p_owner is not null and (p_owner=p_actor or p_owner=p_partner)
  and (p_owner=p_actor or p_toy=current_personal_burrow_toy_v1(p_owner,p_actor))
  and exists(select 1 from catalog_items c join content_revisions r on r.id=c.revision_id
   where c.stable_id=p_toy and c.item_type='decor' and c.category='couple_dolls' and c.metadata->>'slot'='couple_doll'
    and c.status='active' and r.status='published' and (c.metadata->>'starter'='true'
     or exists(select 1 from user_inventory i where i.owner_id=p_owner and i.item_id=p_toy)))
$$;

-- Keep ticket/digest/quota/receipt semantics identical; only the ownership
-- resolver is versioned. Old installed clients retain their original protocol.
do $$ declare old_name text; body text; begin
 foreach old_name in array array['prepare_toy_photo_v1','complete_toy_photo_v1'] loop
  select pg_get_functiondef(p.oid) into strict body from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=old_name;
  body:=replace(body,'public.'||old_name||'(', 'public.'||replace(old_name,'_toy_','_personal_toy_')||'(');
  body:=replace(body,'current_burrow_toy_v1(', 'current_personal_burrow_toy_v1(');
  body:=replace(body,'burrow_toy_photo_target_allowed_v1(', 'personal_burrow_toy_photo_target_allowed_v1(');
  execute body;
 end loop;
end $$;

create function public.burrow_bootstrap_v2(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 perform activate_personal_room_v1(p_user_id);
 snapshot:=burrow_bootstrap_v1(p_user_id);
 if snapshot->>'error' is not null then return snapshot; end if;
 return snapshot||jsonb_build_object('roomModel','personal-v2','loadouts',coalesce((select jsonb_agg(to_jsonb(l))
  from room_loadouts l where l.room_type='home' and (l.owner_id=p_user_id or l.owner_id=partner)),'[]'::jsonb));
end $$;

-- Personal receipts use the same reservation namespace as existing room edits.
do $$ declare body text; begin
 select pg_get_functiondef('public.burrow_reward_wallet_state_v1(uuid)'::regprocedure) into body;
 if position('r.request->>''kind''=''room''' in body)=0 then raise exception 'wallet_receipt_contract_changed'; end if;
 execute replace(body,'r.request->>''kind''=''room''','r.request->>''kind'' in(''room'',''personal-room'')');
end $$;
revoke all on function public.purchase_personal_room_changes_v1(uuid,jsonb,jsonb,integer,text,text),
 public.claim_personal_shop_gift_v1(uuid,uuid,boolean,text),public.burrow_bootstrap_v2(uuid),
 public.activate_personal_room_v1(uuid),
 public.current_personal_burrow_toy_v1(uuid,uuid),public.personal_burrow_toy_photo_target_allowed_v1(uuid,uuid,text,uuid),
 public.prepare_personal_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),public.complete_personal_toy_photo_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.purchase_personal_room_changes_v1(uuid,jsonb,jsonb,integer,text,text),
 public.claim_personal_shop_gift_v1(uuid,uuid,boolean,text),public.burrow_bootstrap_v2(uuid),
 public.activate_personal_room_v1(uuid),
 public.current_personal_burrow_toy_v1(uuid,uuid),public.personal_burrow_toy_photo_target_allowed_v1(uuid,uuid,text,uuid),
 public.prepare_personal_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),public.complete_personal_toy_photo_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
