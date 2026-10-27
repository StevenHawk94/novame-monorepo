-- Cosmetic input is local; aggregate its existing daily counter in one scoped,
-- atomic command. Retries cannot duplicate counts or revive an old pairing.
begin;
create function public.interact_burrow_toy_batch_v1(p_user_id uuid,p_owner_id uuid,p_partner_id uuid,
  p_pair_version text,p_local_date date,p_count integer,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; local_day date; version text; request jsonb; result jsonb;
  receipt public.burrow_command_receipts%rowtype; event_key text; touches integer;
begin
  if p_owner_id is distinct from p_user_id then return jsonb_build_object('error','own_toy_only'); end if;
  if p_count is null or p_count<1 or p_count>50 or nullif(trim(p_key),'') is null or length(p_key)>100
    then return jsonb_build_object('error','invalid_request'); end if;
  partner:=lock_burrow_pair(p_user_id);
  version:=case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end;
  if partner is distinct from p_partner_id or version is distinct from p_pair_version
    then return jsonb_build_object('error','pair_changed'); end if;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  if p_local_date is distinct from local_day then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('toy:'||p_user_id::text||':'||local_day::text,0));
  request:=jsonb_build_object('day',local_day,'partner',partner,'pairVersion',version,'count',p_count);
  select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='toy-batch:'||p_key;
  if found then
    if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return receipt.response||jsonb_build_object('applied',false);
  end if;
  select idempotency_key into event_key from moment_events
    where actor_id=p_user_id and event_type='toy_interacted' and reference_id=local_day::text
      and pair_low=least(p_user_id,coalesce(partner,p_user_id)) and pair_high=greatest(p_user_id,coalesce(partner,p_user_id))
      and burrow_relation_row_matches_v1(pair_low,pair_high,pair_version)
    order by created_at desc limit 1;
  event_key:=coalesce(event_key,'toy-batch:'||local_day::text||':'||coalesce(partner::text,'solo')||':'||coalesce(version,'solo'));
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,p_user_id,
      'toy_interacted','toy',local_day::text,jsonb_build_object('action','touch','count',p_count),event_key)
    on conflict(actor_id,idempotency_key) do update set target_id=excluded.target_id,
      payload=jsonb_set(moment_events.payload,'{count}',to_jsonb(coalesce((moment_events.payload->>'count')::integer,0)+p_count)),created_at=now()
    returning (payload->>'count')::integer into touches;
  result:=jsonb_build_object('error',null,'applied',true,'count',touches);
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'toy-batch:'||p_key,request,result);
  return result;
end $$;
revoke all on function public.interact_burrow_toy_batch_v1(uuid,uuid,uuid,text,date,integer,text) from public,anon,authenticated;
grant execute on function public.interact_burrow_toy_batch_v1(uuid,uuid,uuid,text,date,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
