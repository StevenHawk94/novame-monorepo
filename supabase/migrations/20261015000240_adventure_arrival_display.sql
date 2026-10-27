-- A display plan is not a reward receipt. Read it while the journey is running
-- so countdown completion never waits for settlement or the full Home read.
create function public.adventure_display_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; a adventures%rowtype; p adventure_encounter_plans%rowtype;
  r adventure_results%rowtype; kind text; display_plan jsonb;
begin
  partner:=lock_burrow_pair(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if a.status='cancelled' or (a.partner_id<>p_user_id and a.partner_id is distinct from partner)
    then return jsonb_build_object('error','adventure_cancelled'); end if;
  select * into r from adventure_results where adventure_id=a.id;
  select * into p from adventure_encounter_plans where adventure_id=a.id and user_id=p_user_id;
  if a.status in('in_progress','result_ready','interaction_required') and p.snapshot->>'encounterV2'='true' then
    kind:=case when p.friend_id is not null then 'friend' when p.gift_id is not null then 'item' else 'quiet' end;
    display_plan:=jsonb_build_object('adventureId',a.id,'version',p.id::text||':'||md5(p.snapshot::text),
      'readAt',clock_timestamp(),'result',jsonb_build_object('id','plan:'||p.id::text,
        'result_type',kind,'item_id',case when kind='item' then p.gift_id end,
        'friend_id',p.friend_id,'claim_status','pending','metadata',p.snapshot));
  end if;
  return jsonb_build_object('error',null,'userId',p_user_id,'partnerId',partner,
    'pairVersion',case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end,
    'serverNow',clock_timestamp(),'activeAdventure',case when a.status='completed' then null else to_jsonb(a) end,
    'adventureResult',case when r.id is not null then to_jsonb(r) end,'adventurePlan',display_plan);
end $$;

-- An immediate open/claim can beat the background settle request. Settle and
-- claim under the existing locks in ONE transaction, retaining all original
-- ownership, due-time, choice validation and unique inventory receipts.
alter function public.adventure_command_v2(uuid,uuid,text,jsonb) rename to adventure_command_before_arrival_v3;
create function public.adventure_command_v2(p_user_id uuid,p_adventure_id uuid,p_action text,p_response jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare settled jsonb;
begin
  if p_action not in('settle','treasure','respond','claim') then return jsonb_build_object('error','invalid_request'); end if;
  if p_action<>'settle' and exists(select 1 from adventure_encounter_plans where user_id=p_user_id and adventure_id=p_adventure_id) then
    settled:=adventure_command_before_arrival_v3(p_user_id,p_adventure_id,'settle');
    if settled->>'error' is not null then return settled; end if;
  end if;
  return adventure_command_before_arrival_v3(p_user_id,p_adventure_id,p_action,p_response);
end $$;
revoke all on function public.adventure_display_v1(uuid,uuid),public.adventure_command_v2(uuid,uuid,text,jsonb),
  public.adventure_command_before_arrival_v3(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.adventure_display_v1(uuid,uuid),public.adventure_command_v2(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
