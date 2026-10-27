-- Old clients keep claim_gift_v1. New claims grant inventory + optionally
-- replace exactly one slot in the SAME transaction, never debit a wallet.
create or replace function public.claim_shop_gift_v1(
  p_recipient_id uuid,p_gift_id uuid,p_replace boolean,p_pair_version text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  partner uuid; gift public.gifts%rowtype; item public.catalog_items%rowtype;
  receipt jsonb; slot_name text; previous_item text; current_version text;
begin
  partner:=public.lock_burrow_pair(p_recipient_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  current_version:=public.burrow_pair_version_v1(p_recipient_id,partner);
  if p_pair_version is null or p_pair_version is distinct from current_version
    then return jsonb_build_object('error','pair_changed'); end if;
  perform public.lock_burrow_inventory(p_recipient_id,partner);
  select * into gift from public.gifts where id=p_gift_id and recipient_id=p_recipient_id
    and sender_id=partner for update;
  if not found or not public.burrow_relation_row_matches_v1(least(p_recipient_id,partner),greatest(p_recipient_id,partner),gift.pair_version)
    then return jsonb_build_object('error','not_found'); end if;
  -- Retry after a lost response MUST NOT re-equip after a newer room change.
  if gift.status='claimed' then return jsonb_build_object('error',null,'applied',false,
    'giftId',p_gift_id,'itemId',gift.item_id); end if;
  if gift.status<>'pending' then return jsonb_build_object('error','not_claimable'); end if;
  select * into item from public.catalog_items where stable_id=gift.item_id;
  if not found then return jsonb_build_object('error','invalid_item'); end if;
  slot_name:=item.metadata->>'slot';
  if p_replace and (item.status<>'active' or item.item_type not in('decor','outfit') or slot_name is null
    or (item.item_type='outfit' and slot_name<>'outfit') or (item.item_type='decor' and slot_name='outfit'))
    then return jsonb_build_object('error','invalid_loadout'); end if;
  if p_replace then
    perform pg_advisory_xact_lock(hashtextextended(case when slot_name='outfit' then 'outfit:'||p_recipient_id::text
      else 'loadout:'||least(p_recipient_id,partner)::text||':shared' end,0));
  end if;
  receipt:=public.claim_gift_v1(p_recipient_id,p_gift_id);
  if receipt->>'error' is not null then return receipt; end if;
  if p_replace then
    select item_id into previous_item from public.room_loadouts where slot=slot_name and
      ((slot_name='outfit' and room_type='home' and owner_id=p_recipient_id) or
       (slot_name<>'outfit' and room_type='our' and pair_low=least(p_recipient_id,partner) and pair_high=greatest(p_recipient_id,partner)
         and public.burrow_relation_row_matches_v1(pair_low,pair_high,pair_version)));
    delete from public.room_loadouts where slot=slot_name and
      ((slot_name='outfit' and room_type='home' and owner_id=p_recipient_id) or
       (slot_name<>'outfit' and room_type='our' and pair_low=least(p_recipient_id,partner) and pair_high=greatest(p_recipient_id,partner)));
    if slot_name='outfit' then
      insert into public.room_loadouts(room_type,owner_id,slot,item_id,updated_by)
        values('home',p_recipient_id,slot_name,gift.item_id,p_recipient_id);
    else
      insert into public.room_loadouts(room_type,pair_low,pair_high,slot,item_id,updated_by)
        values('our',least(p_recipient_id,partner),greatest(p_recipient_id,partner),slot_name,gift.item_id,p_recipient_id);
      if previous_item is distinct from gift.item_id then
        insert into public.moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,payload,idempotency_key)
        values(least(p_recipient_id,partner),greatest(p_recipient_id,partner),p_recipient_id,partner,'room_decor_changed','room_loadout',
          jsonb_build_object('roomType','shared','changes',jsonb_build_array(jsonb_build_object('slot',slot_name,
            'previousItemId',previous_item,'itemId',gift.item_id))),'gift-replace:'||p_gift_id::text)
        on conflict(actor_id,idempotency_key) do nothing;
      end if;
    end if;
  end if;
  return receipt||jsonb_build_object('giftId',p_gift_id,'replaced',p_replace);
end $$;
revoke all on function public.claim_shop_gift_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_shop_gift_v1(uuid,uuid,boolean,text) to service_role;
