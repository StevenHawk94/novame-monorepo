-- Same cooldown/reward/idempotency for the accessible timed-confirmation path.
create or replace function public.complete_affection_v1(
  p_sender_id uuid,
  p_affection_type text,
  p_gesture_metrics jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_timezone text := 'UTC';
  v_local_date date;
  v_has_plus boolean := false;
  v_last_free timestamptz;
  v_event_id uuid;
  v_reward_result jsonb;
  v_reward integer := 0;
  v_low uuid;
  v_high uuid;
begin
  if p_affection_type is null or p_affection_type not in ('hug', 'spicy', 'cuddle', 'gratitude', 'kiss', 'miss_you')
     or nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;

  v_recipient:=public.lock_burrow_pair(p_sender_id);
  if v_recipient is null then
    return jsonb_build_object('error', 'not_paired');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('affection:' || p_sender_id::text, 0));

  select id into v_event_id from public.affection_events
  where sender_id = p_sender_id and idempotency_key = trim(p_idempotency_key);
  if found then
    if not exists(select 1 from affection_events where id=v_event_id
      and affection_type=p_affection_type and recipient_id=v_recipient) then
      return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error', null, 'eventId', v_event_id, 'applied', false);
  end if;

  -- Metrics do not prove physical input, but reject incomplete/malformed
  -- gestures. Cooldown and rewards remain server authoritative regardless.
  if jsonb_typeof(p_gesture_metrics) is distinct from 'object' then
    return jsonb_build_object('error','invalid_request'); end if;
  if exists(select 1 from jsonb_each(p_gesture_metrics) where jsonb_typeof(value)<>'number') then
    return jsonb_build_object('error','invalid_request'); end if;
  if not (coalesce(case p_affection_type
    when 'hug' then jsonb_typeof(p_gesture_metrics->'durationMs')='number' and (p_gesture_metrics->>'durationMs')::numeric>=3000
    when 'spicy' then jsonb_typeof(p_gesture_metrics->'taps')='number' and (p_gesture_metrics->>'taps')::numeric>=10
    when 'cuddle' then jsonb_typeof(p_gesture_metrics->'turns')='number' and (p_gesture_metrics->>'turns')::numeric>=4
    when 'gratitude' then jsonb_typeof(p_gesture_metrics->'holdMs')='number' and (p_gesture_metrics->>'holdMs')::numeric>=1000
    when 'kiss' then jsonb_typeof(p_gesture_metrics->'scale')='number' and (p_gesture_metrics->>'scale')::numeric>=1.5
    when 'miss_you' then jsonb_typeof(p_gesture_metrics->'pathPoints')='number' and (p_gesture_metrics->>'pathPoints')::numeric>=9
  end,false) or coalesce((p_gesture_metrics->>'assistedHoldMs')::numeric between 3000 and 600000,false))
    then return jsonb_build_object('error','invalid_request'); end if;

  select exists (
    select 1 from public.profiles p
    where p.id in (p_sender_id, v_recipient)
      and coalesce(p.subscription_tier::text, 'free') <> 'free'
  ) into v_has_plus;

  if not v_has_plus then
    select max(completed_at) into v_last_free
    from public.affection_events where sender_id = p_sender_id;
    if v_last_free is not null and v_last_free > now() - interval '6 hours' then
      return jsonb_build_object(
        'error', 'cooldown_active',
        'availableAt', (v_last_free + interval '6 hours')
      );
    end if;
  end if;

  select coalesce(nullif(timezone_name, ''), 'UTC') into v_timezone
  from public.profiles where id = p_sender_id;
  v_local_date := (now() at time zone v_timezone)::date;

  v_reward_result := public.change_carrot_balance_v1(
    p_sender_id, 10, 'first_daily_affection', 'affection', null,
    'affection-first:' || v_local_date::text
  );
  v_reward := coalesce((v_reward_result->>'delta')::integer, 0);

  insert into public.affection_events(
    sender_id, recipient_id, affection_type, gesture_metrics,
    idempotency_key, reward_granted
  ) values (
    p_sender_id, v_recipient, p_affection_type,
    coalesce(p_gesture_metrics, '{}'::jsonb), trim(p_idempotency_key), v_reward
  ) returning id into v_event_id;

  v_low := least(p_sender_id, v_recipient);
  v_high := greatest(p_sender_id, v_recipient);
  insert into public.moment_events(
    pair_low, pair_high, actor_id, target_id, event_type,
    reference_type, reference_id, payload, idempotency_key
  ) values (
    v_low, v_high, p_sender_id, v_recipient, 'affection_sent',
    'affection_event', v_event_id::text,
    jsonb_build_object('affectionType', p_affection_type),
    'affection:' || trim(p_idempotency_key)
  ) on conflict (actor_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'error', null, 'eventId', v_event_id, 'applied', true,
    'reward', v_reward, 'hasPlus', v_has_plus
  );
end;
$$;

revoke all on function public.complete_affection_v1(uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.complete_affection_v1(uuid,text,jsonb,text)
  to service_role;

notify pgrst,'reload schema';
