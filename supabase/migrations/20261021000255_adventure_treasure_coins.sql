-- V4 adds two equally weighted coin tickets to the unowned furniture pool.
-- Friend selection, dialogue, friend gifts and legacy frozen results are unchanged.
create or replace function public.prepare_adventure_encounters_v2(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare response jsonb; plan adventure_encounter_plans%rowtype; furniture jsonb; coins integer; chosen record;
begin
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 response:=prepare_adventure_friend_gifts_v2(p_user_id);
 if response->>'error' is not null then return response;end if;
 for plan in select p.* from adventure_encounter_plans p where p.user_id=p_user_id
  and (p.status='reserved' or (p.status='bound' and p.snapshot->>'treasureVersion' in('3','4')))
  and not(p.snapshot ? 'treasureReserved')
  and not exists(select 1 from adventure_results r where r.adventure_id=p.adventure_id)
  order by p.id for update loop
  furniture:=null;coins:=0;
  -- A candidate is one ticket, not one category. No Plus, outfits, wallpaper,
  -- Plushies, games or Surprise unlocks can pass this positive allowlist.
  with candidates as materialized (
   select c.* from catalog_items c where c.status='active'
    and c.revision_id=(select value from app_config where key='app_major_update_content_revision')
    and c.item_type='decor' and not c.plus_only and c.price>0
    and coalesce(c.metadata->>'starter','false')<>'true'
    and c.category in('windows','lamps','vases','cushions','tables','rugs','cabinets','music_players',
     'frames','shelves','light_strings','ladders','dresser_plants')
    and not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id)
    and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id
     and p.status in('reserved','bound') and p.snapshot->'treasureSnapshot'->>'stable_id'=c.stable_id)
  ), tickets as (
   select to_jsonb(c) item,0 amount from candidates c
   union all select null::jsonb,n from (values(50),(100)) amounts(n)
    where plan.snapshot->>'treasureVersion'='4' and (n=100 or exists(select 1 from candidates))
  ) select * into chosen from tickets order by random() limit 1;
  if found then furniture:=chosen.item;coins:=chosen.amount;end if;
  update adventure_encounter_plans set snapshot=snapshot||jsonb_build_object(
   'treasureReserved',true,'treasureSnapshot',furniture,'treasureCoins',coins) where id=plan.id;
 end loop;
 return response;
end $$;

-- Only unstarted, unexposed reservations are refreshed. Never rewrite a bound
-- journey, a revealed result, claimed inventory or any friend reservation.
update public.adventure_encounter_plans set snapshot=snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins'
where status='reserved' and adventure_id is null and snapshot->'treasureSnapshot'->>'category'='couple_dolls';

create function public.start_adventure_v4(p_user_id uuid,p_record_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare receipt jsonb;
begin
 receipt:=start_adventure_friend_gift_v2(p_user_id,p_record_id,p_idempotency_key);
 if receipt->>'applied'='true' then
  update adventure_encounter_plans set snapshot=(snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins')||'{"treasureVersion":4}'::jsonb
   where adventure_id=(receipt->>'adventureId')::uuid and user_id=p_user_id;
  -- Even when all friend gifts are exhausted, start creates a bound plan.
  -- Reserve its independent chest instead of coupling it to friend availability.
  perform prepare_adventure_encounters_v2(p_user_id);
 end if;
 return receipt;
end $$;

-- Retain the dispatcher/recovery chain introduced by 219/240. Only handle
-- V4 chest receipts here; every other action delegates unchanged.
alter function public.adventure_command_v2(uuid,uuid,text,jsonb) rename to adventure_command_before_coins_v4;
create function public.adventure_command_v2(p_user_id uuid,p_adventure_id uuid,p_action text,p_response jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; a adventures%rowtype; r adventure_results%rowtype; p adventure_encounter_plans%rowtype;
 settled jsonb; chest_item text; coins integer:=0; wallet jsonb; inserted_item text; key text;
begin
 if p_action<>'treasure' or not exists(select 1 from adventure_encounter_plans where user_id=p_user_id
  and adventure_id=p_adventure_id and snapshot->>'treasureVersion'='4') then
  return adventure_command_before_coins_v4(p_user_id,p_adventure_id,p_action,p_response);
 end if;
 partner:=lock_burrow_pair(p_user_id);
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if a.status='cancelled' or (a.partner_id<>p_user_id and a.partner_id is distinct from partner)
  then return jsonb_build_object('error','adventure_cancelled');end if;
 settled:=adventure_command_before_coins_v4(p_user_id,p_adventure_id,'settle',p_response);
 if settled->>'error' is not null then return settled;end if;
 select * into r from adventure_results where adventure_id=a.id for update;
 if not found then return jsonb_build_object('error','result_not_ready');end if;
 key:='adventure-treasure:'||a.id::text;
 if r.metadata->>'treasureClaimed'='true' or r.claim_status='claimed' then
  return jsonb_build_object('error',null,'applied',false,'itemId',r.metadata->>'treasureAwardItemId',
   'coins',coalesce((r.metadata->>'treasureAwardCoins')::integer,0),'reward',0,
   'coinReward',jsonb_build_object('key',key,'amount',0),
   'interactionRequired',r.claim_status<>'claimed','treasureClaimed',true);
 end if;
 if r.metadata->>'treasureReserved' is distinct from 'true' then return jsonb_build_object('error','result_not_ready');end if;
 chest_item:=r.metadata->'treasureSnapshot'->>'stable_id';
 coins:=coalesce((r.metadata->>'treasureCoins')::integer,0);
 if coins not in(0,50,100) then return jsonb_build_object('error','invalid_treasure');end if;
 if coins>0 then chest_item:=null;end if;
 if chest_item is not null and coins=0 then
  insert into user_inventory(owner_id,item_id,source,source_reference_id)
   values(p_user_id,chest_item,'adventure',a.id::text) on conflict(owner_id,item_id) do nothing
   returning item_id into inserted_item;
  if inserted_item is null then coins:=100;chest_item:=null;end if;
 elsif coins=0 then coins:=100;end if;
 if coins>0 then
  wallet:=change_carrot_balance_v1(p_user_id,coins,'adventure_treasure','adventure',a.id::text,key);
  if wallet->>'error' is not null then raise exception 'treasure_wallet_failed: %',wallet->>'error';end if;
 end if;
 -- Coin receipt and claim marker commit atomically. Replay never rerolls.
 update adventure_results set metadata=metadata||jsonb_build_object('treasureClaimed',true,
  'treasureAwardCoins',coins,'treasureAwardItemId',chest_item),claim_status='interaction_required' where id=r.id;
 update adventures set status='interaction_required',updated_at=now() where id=a.id;
 return jsonb_build_object('error',null,'applied',true,'itemId',chest_item,'coins',coins,'reward',coins,
  'coinReward',jsonb_build_object('key',key,'amount',coins),'interactionRequired',true,'treasureClaimed',true);
end $$;
revoke all on function public.start_adventure_v4(uuid,uuid,text),public.adventure_command_before_coins_v4(uuid,uuid,text,jsonb),
 public.adventure_command_v2(uuid,uuid,text,jsonb),public.prepare_adventure_encounters_v2(uuid) from public,anon,authenticated;
grant execute on function public.start_adventure_v4(uuid,uuid,text),public.adventure_command_v2(uuid,uuid,text,jsonb),
 public.prepare_adventure_encounters_v2(uuid) to service_role;
notify pgrst,'reload schema';
