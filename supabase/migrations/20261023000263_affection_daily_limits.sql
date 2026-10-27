-- Keep the existing gesture, idempotency, reward and Moments writer intact.
-- Its sender advisory lock serializes quota checks across devices/requests.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.complete_affection_v1(uuid,text,jsonb,text)'::regprocedure) into definition;
  if position('affection_daily_quota_263' in definition)=0 then
    if position('v_reward integer := 0;' in definition)=0 or position('v_reward_result := public.change_carrot_balance_v1(' in definition)=0
      or position('v_local_date := (now() at time zone v_timezone)::date;' in definition)=0 then
      raise exception 'Unexpected affection writer; refusing an unsafe patch';
    end if;
    definition:=replace(definition,'v_reward integer := 0;','v_reward integer := 0; v_daily_count integer; v_daily_limit integer;');
    definition:=replace(definition,'v_reward_result := public.change_carrot_balance_v1(', $patch$
    -- affection_daily_quota_263: replay above this check never spends a slot.
    v_daily_limit:=case when v_has_plus then 6 else 1 end;
    select count(*) into v_daily_count from public.affection_events
      where sender_id=p_sender_id
        and completed_at >= (v_local_date::timestamp at time zone v_timezone)
        and completed_at < ((v_local_date+1)::timestamp at time zone v_timezone);
    if v_daily_count>=v_daily_limit then
      return jsonb_build_object('error','daily_limit_reached');
    end if;
    v_reward_result := public.change_carrot_balance_v1($patch$);
    definition:=replace(definition,'''reward'', v_reward, ''hasPlus'', v_has_plus',
      '''reward'', v_reward, ''hasPlus'', v_has_plus, ''affectionUsage'', public.burrow_affection_state_v1(p_sender_id,v_recipient)->''affectionUsage''');
    definition:=replace(definition,'''eventId'', v_event_id, ''applied'', false)',
      '''eventId'', v_event_id, ''applied'', false, ''affectionUsage'', public.burrow_affection_state_v1(p_sender_id,v_recipient)->''affectionUsage'')');
    execute definition;
  end if;
end $$;

create or replace function public.burrow_affection_state_v1(p_user_id uuid,p_partner_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tz text; day date; used integer; allowance integer; groups jsonb; keys jsonb;
begin
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
  if tz is null then return jsonb_build_object('error','profile_not_found'); end if;
  day:=(now() at time zone tz)::date;
  select case when exists(select 1 from profiles where id in(p_user_id,p_partner_id)
    and coalesce(subscription_tier::text,'free')<>'free') then 6 else 1 end into allowance;
  select count(*),coalesce(jsonb_agg(idempotency_key),'[]'::jsonb) into used,keys from affection_events where sender_id=p_user_id
    and completed_at >= (day::timestamp at time zone tz) and completed_at < ((day+1)::timestamp at time zone tz);
  -- No 100-row truncation: six small groups retain exact event membership.
  -- Receive acknowledges these IDs only, never an open-ended type/time range.
  select coalesce(jsonb_agg(to_jsonb(g) order by g.completed_at,g.affection_type),'[]'::jsonb) into groups
    from (select affection_type,min(completed_at) completed_at,jsonb_agg(id order by completed_at,id) ids
      from affection_events where recipient_id=p_user_id and sender_id=p_partner_id and read_at is null group by affection_type) g;
  return jsonb_build_object('affectionUsage',jsonb_build_object('localDate',day,'used',used,'limit',allowance,'remaining',greatest(0,allowance-used),'keys',keys),
    'affectionInboxGroups',groups);
end $$;
revoke all on function public.burrow_affection_state_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_affection_state_v1(uuid,uuid) to service_role;

-- Add fields without changing the legacy inbox or any other bootstrap fields.
do $$ begin
  if to_regprocedure('public.burrow_bootstrap_before_affection263_v1(uuid)') is null then
    alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_before_affection263_v1;
  end if;
end $$;
create or replace function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; extra jsonb;
begin
  result:=burrow_bootstrap_before_affection263_v1(p_user_id);
  if result is null or result ? 'error' and result->>'error' is not null then return result; end if;
  extra:=burrow_affection_state_v1(p_user_id,(result->'partner'->>'id')::uuid);
  if extra->>'error' is not null then return result; end if;
  return result||extra;
end $$;
revoke all on function public.burrow_bootstrap_before_affection263_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
