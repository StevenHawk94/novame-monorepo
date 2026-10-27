-- Games alone may be free. Preserve Admin CAS/audit, pair locks and paid
-- ownership; do not change any product's configured price or Plus switch.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.burrow_game_unlocks drop constraint burrow_game_unlocks_price_paid_check;
alter table public.burrow_game_unlocks add constraint burrow_game_unlocks_price_paid_check check(price_paid between 0 and 1000000);

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
   or length(requested->>'id')>160 or jsonb_typeof(requested->'version')<>'number'
   or (requested->>'version') !~ '^[0-9]{1,15}$' then return jsonb_build_object('error','invalid_request'); end if;
  if requested ? 'price' then
   if jsonb_typeof(requested->'price')<>'number' or (requested->>'price') !~ '^[0-9]{1,7}$'
    then return jsonb_build_object('error','invalid_request'); end if;
   if (requested->>'price')::integer not between 0 and 1000000 then return jsonb_build_object('error','invalid_request'); end if;
  end if;
  if requested ? 'plus_only' and jsonb_typeof(requested->'plus_only')<>'boolean'
   then return jsonb_build_object('error','invalid_request'); end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates)
  then return jsonb_build_object('error','invalid_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
 select value into revision from app_config where key='app_major_update_content_revision';
 if (select count(*) from catalog_items c join jsonb_array_elements(p_updates) u on c.stable_id=u->>'id')<>jsonb_array_length(p_updates)
  then return jsonb_build_object('error','not_found'); end if;
 -- Validate the entire batch before applying anything, including zero prices.
 for row in select c.*,u.value as requested from catalog_items c
  join jsonb_array_elements(p_updates) u on c.stable_id=u.value->>'id' order by c.stable_id for update of c loop
  if row.status<>'active' or row.revision_id is distinct from revision
   or row.category not in('wallpapers','seasons','outfits','cushions','tables','rugs','vases','lamps','windows',
    'cabinets','shelves','music_players','frames','couple_dolls','light_strings','ladders','dresser_plants','games','surprises')
   or not exists(select 1 from content_revisions where id=row.revision_id and status='published')
   then return jsonb_build_object('error','read_only_item','itemId',row.stable_id); end if;
  if row.requested ? 'price' then
   if row.item_type not in('decor','outfit','game','surprise') or row.price is null
    or (row.price<=0 and row.item_type<>'game') or coalesce((row.metadata->>'starter')::boolean,false)
    then return jsonb_build_object('error','read_only_item','itemId',row.stable_id); end if;
   if (row.requested->>'price')::integer=0 and row.item_type<>'game'
    then return jsonb_build_object('error','invalid_request','itemId',row.stable_id); end if;
   if row.item_type in('game','surprise') and (row.requested->>'price')::integer>99999
    then return jsonb_build_object('error','price_out_of_range','itemId',row.stable_id); end if;
  end if;
  if row.shop_price_version<>(row.requested->>'version')::bigint
   then return jsonb_build_object('error','price_conflict','itemId',row.stable_id); end if;
 end loop;
 perform set_config('burrow.price_admin',jsonb_build_object('id',p_admin,'email',p_email,'batch',batch,'reason',p_reason)::text,true);
 for requested in select value from jsonb_array_elements(p_updates) order by value->>'id' loop
  update catalog_items set price=case when requested ? 'price' then (requested->>'price')::integer else price end,
   plus_only=case when requested ? 'plus_only' then (requested->>'plus_only')::boolean else plus_only end
   where stable_id=requested->>'id';
  select jsonb_build_object('id',stable_id,'price',price,'plus_only',plus_only,'version',shop_price_version) into requested
   from catalog_items where stable_id=requested->>'id';
  updated:=updated||jsonb_build_array(requested);
 end loop;
 perform set_config('burrow.price_admin','',true);
 return jsonb_build_object('error',null,'batchId',batch,'updated',updated);
end $$;

create or replace function public.burrow_service_offer_v1(p_user uuid,p_id text,p_kind text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item catalog_items%rowtype;
begin
 select c.* into item from catalog_items c join content_revisions r on r.id=c.revision_id
 where c.stable_id=p_id and c.item_type=p_kind and c.status='active' and r.status='published'
  and c.revision_id=(select value from app_config where key='app_major_update_content_revision');
 if not found or item.price is null or item.price<0 or item.price>99999
  or (item.price=0 and item.item_type<>'game') then return jsonb_build_object('error','not_for_sale'); end if;
 if item.plus_only and not burrow_has_plus_v1(p_user) then return jsonb_build_object('error','plus_required'); end if;
 return jsonb_build_object('price',item.price,'version',item.shop_price_version,'plus_only',item.plus_only);
end $$;

create or replace function public.burrow_game_unlock_v2(p_user_id uuid,p_game_id text,p_key uuid,p_expected_price integer default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; offer jsonb; payment jsonb:='{}'; prior burrow_game_purchase_receipts%rowtype; price integer;
begin
 if p_key is null or p_game_id is null then return jsonb_build_object('error','invalid_request'); end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into prior from burrow_game_purchase_receipts where actor_id=p_user_id and key=p_key;
 if found and prior.game_id<>p_game_id then return jsonb_build_object('error','idempotency_conflict'); end if;
 if exists(select 1 from burrow_game_unlocks where game_id=p_game_id and owner_id in(p_user_id,partner)) then
  return jsonb_build_object('error',null,'unlocked',true,'charged',false); end if;
 offer:=burrow_service_offer_v1(p_user_id,'game:'||p_game_id,'game');
 if offer->>'error' is not null then return offer; end if;
 price:=(offer->>'price')::integer;
 -- A stale Free label can NEVER authorize a paid unlock, including old clients.
 if p_expected_price is null and (price<>150 or (offer->>'version')::bigint<>0)
  then return jsonb_build_object('error','price_confirmation_required'); end if;
 if p_expected_price is not null and p_expected_price<>price
  then return jsonb_build_object('error','price_changed','price',price); end if;
 if price>0 then
  payment:=change_carrot_balance_v1(p_user_id,-price,'game_unlock','game',p_game_id,'game-unlock:'||p_key::text);
  if payment->>'error' is not null then return payment; end if;
 end if;
 -- Free unlocks share the same durable ownership and idempotency semantics,
 -- without calling the wallet or creating a zero-delta currency transaction.
 insert into burrow_game_unlocks(owner_id,game_id,price_paid) values(p_user_id,p_game_id,price);
 insert into burrow_game_purchase_receipts values(p_user_id,p_key,p_game_id,price);
 return payment||jsonb_build_object('error',null,'unlocked',true,'charged',price>0 and coalesce((payment->>'applied')::boolean,false));
end $$;

revoke all on function public.set_burrow_shop_prices_v1(uuid,text,jsonb,text),public.burrow_service_offer_v1(uuid,text,text),
 public.burrow_game_unlock_v2(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.set_burrow_shop_prices_v1(uuid,text,jsonb,text),public.burrow_game_unlock_v2(uuid,text,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
