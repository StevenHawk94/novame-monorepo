-- Furniture from the chest and the friend's gift are separate receipts.
-- Preserve already-settled snapshots and all legacy reward rules.
alter function public.prepare_adventure_encounters_v2(uuid) rename to prepare_adventure_friend_gifts_v2;
create function public.prepare_adventure_encounters_v2(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare response jsonb; plan adventure_encounter_plans%rowtype; furniture catalog_items%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  response:=prepare_adventure_friend_gifts_v2(p_user_id);
  if response->>'error' is not null then return response; end if;
  for plan in select p.* from adventure_encounter_plans p where p.user_id=p_user_id
    and (p.status='reserved' or (p.status='bound' and p.snapshot->>'treasureVersion'='3'))
    and not(p.snapshot ? 'treasureReserved')
    and not exists(select 1 from adventure_results r where r.adventure_id=p.adventure_id)
    order by p.id for update loop
    furniture:=null;
    select c.* into furniture from catalog_items c
      where c.status='active' and c.revision_id=(select value from app_config where key='app_major_update_content_revision')
      and c.item_type='decor' and c.plus_only=false and c.price>0
      and coalesce(c.metadata->>'starter','false')<>'true'
      and c.category in('windows','lamps','vases','cushions','tables','rugs','cabinets','music_players',
        'frames','couple_dolls','shelves','light_strings','ladders','dresser_plants')
      and not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id)
      and not exists(select 1 from adventure_encounter_plans p where p.user_id=p_user_id
        and p.status in('reserved','bound') and p.snapshot->'treasureSnapshot'->>'stable_id'=c.stable_id)
      order by random() limit 1;
    update adventure_encounter_plans set snapshot=snapshot||jsonb_build_object(
      'treasureReserved',true,'treasureSnapshot',case when furniture.stable_id is not null then to_jsonb(furniture) end)
      where id=plan.id;
  end loop;
  return response;
end $$;

-- V3 explicitly opts into the new chest stage. Installed V2 clients retain
-- their one-gift pipeline and are never forced into an unsupported screen.
alter function public.start_adventure_v2(uuid,uuid,text) rename to start_adventure_friend_gift_v2;
create function public.start_adventure_v2(p_user_id uuid,p_record_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare receipt jsonb;
begin
  receipt:=start_adventure_friend_gift_v2(p_user_id,p_record_id,p_idempotency_key);
  if receipt->>'applied'='true' then
    update adventure_encounter_plans set snapshot=(snapshot-'treasureReserved'-'treasureSnapshot')
      where adventure_id=(receipt->>'adventureId')::uuid and user_id=p_user_id;
  end if;
  return receipt;
end $$;
create function public.start_adventure_v3(p_user_id uuid,p_record_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare receipt jsonb;
begin
  receipt:=start_adventure_friend_gift_v2(p_user_id,p_record_id,p_idempotency_key);
  if receipt->>'applied'='true' then
    update adventure_encounter_plans set snapshot=snapshot||'{"treasureVersion":3}'::jsonb
      where adventure_id=(receipt->>'adventureId')::uuid and user_id=p_user_id;
    perform prepare_adventure_encounters_v2(p_user_id);
  end if;
  return receipt;
end $$;

alter function public.adventure_command_v2(uuid,uuid,text,jsonb) rename to adventure_command_friend_gift_v2;
create function public.adventure_command_v2(p_user_id uuid,p_adventure_id uuid,p_action text,p_response jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; a adventures%rowtype; plan adventure_encounter_plans%rowtype;
  result adventure_results%rowtype; chest_item text;
begin
  if p_action not in('settle','treasure','respond','claim') then return jsonb_build_object('error','invalid_request'); end if;
  partner:=lock_burrow_pair(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if a.status='cancelled' or (a.partner_id<>p_user_id and a.partner_id is distinct from partner)
    then return jsonb_build_object('error','adventure_cancelled'); end if;
  select * into plan from adventure_encounter_plans where adventure_id=a.id and user_id=p_user_id;
  if plan.id is null then
    -- Legacy item+friend claims intentionally return interactionRequired=true.
    return adventure_command_friend_gift_v2(p_user_id,p_adventure_id,
      case when p_action='treasure' then 'claim' else p_action end,p_response);
  end if;
  if p_action='settle' then
    return adventure_command_friend_gift_v2(p_user_id,p_adventure_id,p_action,p_response);
  end if;
  select * into result from adventure_results where adventure_id=a.id for update;
  if not found then return jsonb_build_object('error','result_not_ready'); end if;
  if p_action='treasure' then
    if result.claim_status='claimed' then return jsonb_build_object('error',null,'applied',false,'interactionRequired',false); end if;
    if not(result.metadata ? 'treasureReserved') then
      -- Frozen pre-release V2 encounters have only their original friend gift.
      return jsonb_build_object('error',null,'applied',false,'interactionRequired',true);
    end if;
    chest_item:=result.metadata->'treasureSnapshot'->>'stable_id';
    if coalesce(result.metadata->>'treasureClaimed','false')='true' then
      return jsonb_build_object('error',null,'applied',false,'itemId',chest_item,'interactionRequired',true,'treasureClaimed',true);
    end if;
    if chest_item is not null then
      insert into user_inventory(owner_id,item_id,source,source_reference_id)
        values(p_user_id,chest_item,'adventure',a.id::text) on conflict(owner_id,item_id) do nothing;
    end if;
    update adventure_results set metadata=metadata||jsonb_build_object('treasureClaimed',true),claim_status='interaction_required' where id=result.id;
    update adventures set status='interaction_required',updated_at=now() where id=a.id;
    return jsonb_build_object('error',null,'applied',true,'itemId',chest_item,'interactionRequired',true,'treasureClaimed',true);
  end if;
  if result.claim_status<>'claimed' and result.metadata->>'treasureReserved'='true'
    and coalesce(result.metadata->>'treasureClaimed','false')<>'true' then return jsonb_build_object('error','treasure_required'); end if;
  return adventure_command_friend_gift_v2(p_user_id,p_adventure_id,p_action,p_response);
end $$;
revoke all on function public.prepare_adventure_encounters_v2(uuid),public.adventure_command_v2(uuid,uuid,text,jsonb),
  public.start_adventure_v2(uuid,uuid,text),public.start_adventure_v3(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.prepare_adventure_encounters_v2(uuid),public.adventure_command_v2(uuid,uuid,text,jsonb),
  public.start_adventure_v2(uuid,uuid,text),public.start_adventure_v3(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
