-- Complete the first vertical slice: purchasable placeholder variants,
-- atomic shop/gift commands, deterministic adventure settlement and claims.

insert into public.catalog_items(
  stable_id, revision_id, item_type, category, title, description, price,
  plus_only, tradable, tags, drop_weight, asset, is_placeholder
)
select
  'placeholder_' || category || '_02',
  'burrow-v1-placeholder',
  case when category = 'rooms' then 'room'
       when category = 'outfits' then 'outfit'
       when category = 'music' then 'music'
       when category = 'our_room' then 'our_room'
       else 'decor' end,
  category,
  title,
  'Replaceable catalog content used to validate purchase, gifting and decoration.',
  price,
  plus_only,
  category <> 'our_room',
  array[category, 'placeholder'],
  0,
  jsonb_build_object('renderer', 'native', 'symbol', symbol),
  true
from (values
  ('rooms', 'Sunset Cave', 350, false, 'room'),
  ('outfits', 'Trail Sweater', 200, false, 'outfit'),
  ('windows', 'Rose Window', 120, false, 'window'),
  ('lamps', 'Fossil Glow Lamp', 240, false, 'lamp'),
  ('plants', 'Fern Basket', 180, false, 'plant'),
  ('decor', 'Star Frame', 160, false, 'frame'),
  ('cushions', 'Carrot Cushion', 140, false, 'cushion'),
  ('tables', 'Old Oak Table', 220, false, 'table'),
  ('rugs', 'Sunset Rug', 190, false, 'rug'),
  ('storage', 'Explorer Chest', 260, false, 'chest'),
  ('wall_art', 'Moon Poster', 170, false, 'poster'),
  ('music', 'Lantern Waltz', 300, false, 'music'),
  ('our_room', 'Starlight Bed', 500, true, 'bed')
) as variants(category, title, price, plus_only, symbol)
on conflict (stable_id) do nothing;

create or replace function public.purchase_catalog_item_v1(
  p_buyer_id uuid,
  p_recipient_id uuid,
  p_item_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_item public.catalog_items%rowtype;
  v_purchase_id uuid;
  v_gift_id uuid;
  v_wallet jsonb;
  v_has_plus boolean := false;
  v_low uuid;
  v_high uuid;
begin
  if nullif(trim(p_item_id), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  if p_recipient_id is null then p_recipient_id := p_buyer_id; end if;

  v_partner:=public.lock_burrow_pair(p_buyer_id);
  if v_partner is null or p_recipient_id not in(p_buyer_id,v_partner) then
    return jsonb_build_object('error','not_paired'); end if;
  perform public.lock_burrow_inventory(p_buyer_id,v_partner);
  v_low := least(p_buyer_id, p_recipient_id);
  v_high := greatest(p_buyer_id, p_recipient_id);

  select id into v_purchase_id from public.catalog_purchases
  where buyer_id = p_buyer_id and idempotency_key = trim(p_idempotency_key);
  if found then
    if not exists(select 1 from catalog_purchases where id=v_purchase_id
      and recipient_id=p_recipient_id and item_id=p_item_id) then
      return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error', null, 'applied', false, 'purchaseId', v_purchase_id);
  end if;

  if p_recipient_id <> p_buyer_id then
    select partner_user_id into v_partner from public.pairings where user_id = p_buyer_id;
    if v_partner is distinct from p_recipient_id then
      return jsonb_build_object('error', 'not_paired');
    end if;
  else
    select partner_user_id into v_partner from public.pairings where user_id = p_buyer_id;
  end if;

  select * into v_item from public.catalog_items
  where stable_id = p_item_id and status = 'active' for share;
  if not found or v_item.price is null or v_item.price <= 0 then
    return jsonb_build_object('error', 'not_for_sale');
  end if;
  if not exists(select 1 from content_revisions where id=v_item.revision_id and status='published')
    then return jsonb_build_object('error','not_for_sale'); end if;
  if p_recipient_id <> p_buyer_id and not v_item.tradable then
    return jsonb_build_object('error', 'not_tradable');
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id in (p_buyer_id, v_partner)
      and coalesce(p.subscription_tier::text, 'free') <> 'free'
  ) into v_has_plus;
  if v_item.plus_only and not v_has_plus then
    return jsonb_build_object('error', 'plus_required');
  end if;

  if exists (
    select 1 from public.user_inventory
    where owner_id = p_recipient_id and item_id = p_item_id
  ) or exists (
    select 1 from public.gifts
    where recipient_id = p_recipient_id and item_id = p_item_id and status = 'pending'
  ) or exists (
    select 1 from adventure_results r join adventures a on a.id=r.adventure_id
    where r.item_id=p_item_id and r.claim_status='pending' and p_recipient_id in(a.user_id,a.partner_id)
  ) then
    return jsonb_build_object('error', 'already_owned');
  end if;

  v_wallet := public.change_carrot_balance_v1(
    p_buyer_id, -v_item.price, 'catalog_purchase', 'catalog_item', p_item_id,
    'purchase:' || trim(p_idempotency_key)
  );
  if v_wallet->>'error' is not null then return v_wallet; end if;

  insert into public.catalog_purchases(
    buyer_id, recipient_id, item_id, price_snapshot, idempotency_key
  ) values (
    p_buyer_id, p_recipient_id, p_item_id, v_item.price, trim(p_idempotency_key)
  ) returning id into v_purchase_id;

  if p_recipient_id = p_buyer_id then
    insert into public.user_inventory(owner_id, item_id, source, source_reference_id)
    values (p_buyer_id, p_item_id, 'purchase', v_purchase_id::text);
  else
    insert into public.gifts(
      sender_id, recipient_id, item_id, reason, reference_type,
      reference_id, idempotency_key
    ) values (
      p_buyer_id, p_recipient_id, p_item_id, 'shop_gift', 'catalog_purchase',
      v_purchase_id::text, 'purchase-gift:' || trim(p_idempotency_key)
    ) returning id into v_gift_id;

    insert into public.moment_events(
      pair_low, pair_high, actor_id, target_id, event_type,
      reference_type, reference_id, payload, idempotency_key
    ) values (
      v_low, v_high, p_buyer_id, p_recipient_id, 'gift_sent',
      'gift', v_gift_id::text, jsonb_build_object('itemId', p_item_id),
      'purchase-gift:' || trim(p_idempotency_key)
    ) on conflict (actor_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'error', null, 'applied', true, 'purchaseId', v_purchase_id,
    'giftId', v_gift_id, 'balance', (v_wallet->>'balance')::integer
  );
end;
$$;

revoke all on function public.purchase_catalog_item_v1(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.purchase_catalog_item_v1(uuid,uuid,text,text) to service_role;

create or replace function public.claim_gift_v1(
  p_recipient_id uuid,
  p_gift_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gift public.gifts%rowtype;
  v_partner uuid;
  v_low uuid;
  v_high uuid;
begin
  v_partner:=public.lock_burrow_pair(p_recipient_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  perform public.lock_burrow_inventory(p_recipient_id,v_partner);
  select * into v_gift from public.gifts
  where id = p_gift_id and recipient_id = p_recipient_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_gift.sender_id<>v_partner then return jsonb_build_object('error','not_found'); end if;
  if v_gift.status = 'claimed' then
    return jsonb_build_object('error', null, 'applied', false, 'itemId', v_gift.item_id);
  end if;
  if v_gift.status <> 'pending' then return jsonb_build_object('error', 'not_claimable'); end if;
  insert into public.user_inventory(owner_id, item_id, source, source_reference_id)
  values (p_recipient_id, v_gift.item_id, 'gift', v_gift.id::text)
  on conflict(owner_id,item_id) do nothing;
  update public.gifts set status = 'claimed', claimed_at = now() where id = p_gift_id;

  v_low := least(v_gift.sender_id, v_gift.recipient_id);
  v_high := greatest(v_gift.sender_id, v_gift.recipient_id);
  insert into public.moment_events(
    pair_low, pair_high, actor_id, target_id, event_type,
    reference_type, reference_id, payload, idempotency_key
  ) values (
    v_low, v_high, p_recipient_id, v_gift.sender_id, 'gift_claimed',
    'gift', v_gift.id::text, jsonb_build_object('itemId', v_gift.item_id),
    'gift-claimed:' || v_gift.id::text
  ) on conflict (actor_id, idempotency_key) do nothing;

  return jsonb_build_object('error', null, 'applied', true, 'itemId', v_gift.item_id);
end;
$$;

revoke all on function public.claim_gift_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_gift_v1(uuid,uuid) to service_role;

create or replace function public.settle_adventure_v1(
  p_user_id uuid,
  p_adventure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adventure public.adventures%rowtype;
  v_existing public.adventure_results%rowtype;
  v_partner uuid;
  v_item_id text;
  v_friend_id text;
  v_choose_friend boolean := false;
  v_result_id uuid;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  perform public.lock_burrow_inventory(p_user_id,v_partner);
  perform pg_advisory_xact_lock(hashtextextended('adventure:' || p_user_id::text, 0));
  select * into v_adventure from public.adventures
  where id = p_adventure_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  if v_adventure.partner_id<>v_partner then return jsonb_build_object('error','not_paired'); end if;

  select * into v_existing from public.adventure_results
  where adventure_id = p_adventure_id;
  if found then
    return jsonb_build_object(
      'error', null, 'applied', false, 'resultId', v_existing.id,
      'resultType', v_existing.result_type,
      'itemId', v_existing.item_id, 'friendId', v_existing.friend_id,
      'claimStatus', v_existing.claim_status
    );
  end if;
  if v_adventure.status <> 'in_progress' then
    return jsonb_build_object('error', 'not_in_progress');
  end if;
  if v_adventure.ends_at > now() then
    return jsonb_build_object('error', 'not_ready', 'endsAt', v_adventure.ends_at);
  end if;

  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  v_choose_friend := get_byte(decode(md5(p_adventure_id::text), 'hex'), 0) % 4 = 0;

  if v_choose_friend then
    select f.stable_id into v_friend_id
    from public.friend_definitions f
    where f.status = 'active' and f.revision_id=v_adventure.content_revision
      and not exists (
        select 1 from public.user_friend_discoveries d
        where d.user_id = p_user_id and d.friend_id = f.stable_id
      )
    order by md5(p_adventure_id::text || ':' || f.stable_id)
    limit 1;
  end if;

  -- Item and friend discoveries can coexist. Pending rewards reserve their
  -- pair's copy until claimed, preventing shop/other-adventure races.
    select c.stable_id into v_item_id
    from public.catalog_items c
    where c.status = 'active' and c.drop_weight > 0 and not c.plus_only
      and c.revision_id=v_adventure.content_revision
      and not exists(select 1 from gifts g where g.recipient_id=p_user_id and g.item_id=c.stable_id and g.status='pending')
      and not exists(select 1 from adventure_results r join adventures a on a.id=r.adventure_id
        where r.item_id=c.stable_id and r.claim_status='pending' and a.user_id in(p_user_id,v_partner))
      and not (
        exists (select 1 from public.user_inventory i where i.owner_id = p_user_id and i.item_id = c.stable_id)
        and (
          exists (select 1 from public.user_inventory i where i.owner_id = v_partner and i.item_id = c.stable_id)
          or exists (select 1 from public.gifts g where g.recipient_id = v_partner and g.item_id = c.stable_id and g.status = 'pending')
        )
      )
    order by md5(p_adventure_id::text || ':' || c.stable_id)
    limit 1;

  insert into public.adventure_results(
    adventure_id, result_type, item_id, friend_id, claim_status
  ) values (
    p_adventure_id,
    case when v_item_id is not null then 'item' when v_friend_id is not null then 'friend' else 'quiet' end,
    v_item_id, v_friend_id, 'pending'
  ) returning id into v_result_id;

  update public.adventures
  set status = 'result_ready',
      result_type = case when v_item_id is not null then 'item' when v_friend_id is not null then 'friend' else 'quiet' end,
      result_id = coalesce(v_item_id, v_friend_id),
      updated_at = now()
  where id = p_adventure_id;

  return jsonb_build_object(
    'error', null, 'applied', true, 'resultId', v_result_id,
    'resultType', case when v_item_id is not null then 'item' when v_friend_id is not null then 'friend' else 'quiet' end,
    'itemId', v_item_id, 'friendId', v_friend_id, 'claimStatus', 'pending'
  );
end;
$$;

revoke all on function public.settle_adventure_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.settle_adventure_v1(uuid,uuid) to service_role;

create or replace function public.claim_adventure_result_v1(
  p_user_id uuid,
  p_adventure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adventure public.adventures%rowtype;
  v_result public.adventure_results%rowtype;
  v_partner uuid;
  v_gift_id uuid;
  v_low uuid;
  v_high uuid;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  perform public.lock_burrow_inventory(p_user_id,v_partner);
  perform pg_advisory_xact_lock(hashtextextended('adventure:' || p_user_id::text, 0));
  select * into v_adventure from public.adventures
  where id = p_adventure_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_adventure.partner_id<>v_partner then return jsonb_build_object('error','not_paired'); end if;
  select * into v_result from public.adventure_results
  where adventure_id = p_adventure_id for update;
  if not found then return jsonb_build_object('error', 'result_not_ready'); end if;
  if v_result.claim_status = 'claimed' then
    return jsonb_build_object('error', null, 'applied', false, 'resultType', v_result.result_type);
  end if;
  if v_result.claim_status='interaction_required' then
    return jsonb_build_object('error',null,'applied',false,'interactionRequired',true,'friendId',v_result.friend_id); end if;

  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  v_low := least(p_user_id, v_partner);
  v_high := greatest(p_user_id, v_partner);

  if v_result.result_type = 'friend' then
    insert into public.user_friend_discoveries(user_id, friend_id, source_adventure_id)
    values (p_user_id, v_result.friend_id, p_adventure_id)
    on conflict (user_id, friend_id) do nothing;
    update public.adventure_results set claim_status = 'interaction_required'
    where id = v_result.id;
    update public.adventures set status = 'interaction_required', updated_at = now()
    where id = p_adventure_id;
    return jsonb_build_object(
      'error', null, 'applied', true, 'resultType', 'friend',
      'friendId', v_result.friend_id, 'interactionRequired', true
    );
  end if;

  if v_result.item_id is not null then
  if not exists (
    select 1 from public.user_inventory
    where owner_id = p_user_id and item_id = v_result.item_id
  ) then
    insert into public.user_inventory(owner_id, item_id, source, source_reference_id)
    values (p_user_id, v_result.item_id, 'adventure', p_adventure_id::text);
  elsif not exists (
    select 1 from public.user_inventory
    where owner_id = v_partner and item_id = v_result.item_id
  ) and not exists (
    select 1 from public.gifts
    where recipient_id = v_partner and item_id = v_result.item_id and status = 'pending'
  ) then
    insert into public.gifts(
      sender_id, recipient_id, item_id, reason, reference_type,
      reference_id, idempotency_key
    ) values (
      p_user_id, v_partner, v_result.item_id, 'adventure_duplicate',
      'adventure', p_adventure_id::text, 'adventure-gift:' || p_adventure_id::text
    ) returning id into v_gift_id;
  else
    return jsonb_build_object('error', 'reward_no_longer_eligible');
  end if;
  end if;

  if v_result.friend_id is not null then
    insert into user_friend_discoveries(user_id,friend_id,source_adventure_id)
      values(p_user_id,v_result.friend_id,p_adventure_id) on conflict(user_id,friend_id) do nothing;
  end if;

  update public.adventure_results
  set claim_status = case when v_result.friend_id is null then 'claimed' else 'interaction_required' end,
    gift_id = v_gift_id, claimed_at = case when v_result.friend_id is null then now() end
  where id = v_result.id;
  update public.adventures set status = case when v_result.friend_id is null then 'completed' else 'interaction_required' end, updated_at = now()
  where id = p_adventure_id;

  if v_result.friend_id is null then
  insert into public.moment_events(
    pair_low, pair_high, actor_id, target_id, event_type,
    reference_type, reference_id, payload, idempotency_key
  ) values (
    v_low, v_high, p_user_id, null, 'adventure_completed',
    'adventure', p_adventure_id::text,
    jsonb_build_object('resultType', v_result.result_type, 'itemId', v_result.item_id, 'giftId', v_gift_id),
    'adventure-completed:' || p_adventure_id::text
  ) on conflict (actor_id, idempotency_key) do nothing;
  end if;

  if v_gift_id is not null then
    insert into public.moment_events(
      pair_low, pair_high, actor_id, target_id, event_type,
      reference_type, reference_id, payload, idempotency_key
    ) values (
      v_low, v_high, p_user_id, v_partner, 'gift_sent',
      'gift', v_gift_id::text, jsonb_build_object('itemId', v_result.item_id),
      'adventure-gift:' || p_adventure_id::text
    ) on conflict (actor_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'error', null, 'applied', true, 'resultType', v_result.result_type,
    'itemId', v_result.item_id, 'giftId', v_gift_id, 'interactionRequired', v_result.friend_id is not null
  );
end;
$$;

revoke all on function public.claim_adventure_result_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_adventure_result_v1(uuid,uuid) to service_role;

create or replace function public.complete_friend_interaction_v1(
  p_user_id uuid,
  p_adventure_id uuid,
  p_response jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adventure public.adventures%rowtype;
  v_result public.adventure_results%rowtype;
  v_partner uuid;
  v_low uuid;
  v_high uuid;
  v_content public.friend_content%rowtype;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into v_adventure from public.adventures
  where id = p_adventure_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_adventure.partner_id<>v_partner then return jsonb_build_object('error','not_paired'); end if;
  select * into v_result from public.adventure_results
  where adventure_id = p_adventure_id and friend_id is not null for update;
  if not found then return jsonb_build_object('error', 'friend_result_not_found'); end if;
  if v_adventure.status = 'completed' then
    return jsonb_build_object('error', null, 'applied', false, 'friendId', v_result.friend_id);
  end if;
  if v_adventure.status <> 'interaction_required' then
    return jsonb_build_object('error', 'interaction_not_ready');
  end if;

  select * into v_content from friend_content where friend_id=v_result.friend_id
    and status='active' and content_type='question' order by position,id limit 1;
  if not found or not exists(select 1 from jsonb_array_elements(v_content.choices) choice
    where choice->>'id'=p_response->>'choiceId') then
    return jsonb_build_object('error','invalid_response'); end if;

  update public.user_friend_discoveries
  set interaction_completed_at = coalesce(interaction_completed_at, now())
  where user_id = p_user_id and friend_id = v_result.friend_id;
  update public.adventure_results
  set claim_status = 'claimed', claimed_at = now(),
      metadata = metadata || jsonb_build_object('response', coalesce(p_response, '{}'::jsonb))
  where id = v_result.id;
  update public.adventures set status = 'completed', updated_at = now()
  where id = p_adventure_id;

  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  v_low := least(p_user_id, v_partner);
  v_high := greatest(p_user_id, v_partner);
  insert into public.moment_events(
    pair_low, pair_high, actor_id, target_id, event_type,
    reference_type, reference_id, payload, idempotency_key
  ) values (
    v_low, v_high, p_user_id, null, 'friend_discovered',
    'adventure', p_adventure_id::text,
    jsonb_build_object('friendId', v_result.friend_id),
    'friend-discovered:' || p_adventure_id::text
  ) on conflict (actor_id, idempotency_key) do nothing;

  return jsonb_build_object('error', null, 'applied', true, 'friendId', v_result.friend_id);
end;
$$;

revoke all on function public.complete_friend_interaction_v1(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_friend_interaction_v1(uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
