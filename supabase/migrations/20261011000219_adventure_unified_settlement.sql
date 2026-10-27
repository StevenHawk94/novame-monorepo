-- Home's nested bootstrap still uses the legacy settlement entry point.
-- Route every planned journey through its immutable encounter plan instead.
-- Repair only unclaimed planned results written by that old entry point;
-- genuine legacy journeys and completed inventory receipts remain untouched.
alter function public.adventure_command_v2(uuid,uuid,text,jsonb) rename to adventure_command_treasure_v3;
create function public.adventure_command_v2(p_user_id uuid,p_adventure_id uuid,p_action text,p_response jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; a adventures%rowtype; p adventure_encounter_plans%rowtype;
  r adventure_results%rowtype; kind text; recovered jsonb;
begin
  if p_action not in('settle','treasure','respond','claim') then return jsonb_build_object('error','invalid_request'); end if;
  partner:=lock_burrow_pair(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if a.status='cancelled' or (a.partner_id<>p_user_id and a.partner_id is distinct from partner)
    then return jsonb_build_object('error','adventure_cancelled'); end if;
  select * into p from adventure_encounter_plans where adventure_id=a.id and user_id=p_user_id;
  select * into r from adventure_results where adventure_id=a.id for update;
  if p.id is not null and p.snapshot->>'encounterV2'='true'
    and r.id is not null and r.claim_status<>'claimed' and a.status<>'completed'
    and r.metadata->>'encounterV2' is distinct from 'true' then
    kind:=case when p.friend_id is not null then 'friend' when p.gift_id is not null then 'item' else 'quiet' end;
    recovered:=p.snapshot;
    -- A valid answer accepted by the planned dispatcher must survive recovery.
    if r.metadata->>'dialogueCompleted'='true' and exists(select 1
      from jsonb_array_elements(p.snapshot->'dialogue'->'choices') c
      where c->>'id'=r.metadata->'response'->>'choiceId') then
      recovered:=recovered||jsonb_build_object('dialogueCompleted',true,
        'response',r.metadata->'response','reaction',r.metadata->'reaction');
    end if;
    update adventure_results set result_type=kind,
      item_id=case when kind='item' then p.gift_id end,friend_id=p.friend_id,
      metadata=recovered,claim_status=case when recovered->>'dialogueCompleted'='true'
        then 'interaction_required' else 'pending' end where id=r.id;
    update adventures set result_type=kind,result_id=coalesce(p.friend_id,p.gift_id),
      status=case when recovered->>'dialogueCompleted'='true' then 'interaction_required' else 'result_ready' end,
      updated_at=now() where id=a.id;
  end if;
  return adventure_command_treasure_v3(p_user_id,p_adventure_id,p_action,p_response);
end $$;

alter function public.settle_adventure_v1(uuid,uuid) rename to settle_adventure_legacy_v1;
create function public.settle_adventure_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from adventure_encounter_plans where user_id=p_user_id and adventure_id=p_adventure_id) then
    return adventure_command_v2(p_user_id,p_adventure_id,'settle');
  end if;
  return settle_adventure_legacy_v1(p_user_id,p_adventure_id);
end $$;
alter function public.solo_burrow_settle_adventure_v1(uuid,uuid) rename to solo_burrow_settle_adventure_legacy_v1;
create function public.solo_burrow_settle_adventure_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from adventure_encounter_plans where user_id=p_user_id and adventure_id=p_adventure_id) then
    return adventure_command_v2(p_user_id,p_adventure_id,'settle');
  end if;
  return solo_burrow_settle_adventure_legacy_v1(p_user_id,p_adventure_id);
end $$;
revoke all on function public.adventure_command_v2(uuid,uuid,text,jsonb),public.settle_adventure_v1(uuid,uuid),
  public.solo_burrow_settle_adventure_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.adventure_command_v2(uuid,uuid,text,jsonb),public.settle_adventure_v1(uuid,uuid),
  public.solo_burrow_settle_adventure_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
