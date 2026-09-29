-- Server-authoritative commands for the first Burrow vertical slice.
-- The API authenticates the caller and invokes these functions with the
-- service role. Direct authenticated execution is intentionally revoked.

create or replace function public.change_carrot_balance_v1(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_next integer;
  v_applied integer;
  v_existing public.currency_ledger%rowtype;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta::bigint)>99999 or nullif(trim(p_reason), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('error', 'profile_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user_id::text, 0));

  select * into v_existing
  from public.currency_ledger
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.requested_delta<>p_delta or v_existing.reason<>trim(p_reason)
      or v_existing.reference_type is distinct from nullif(trim(p_reference_type),'')
      or v_existing.reference_id is distinct from nullif(trim(p_reference_id),'') then
      return jsonb_build_object('error','idempotency_conflict');
    end if;
    return jsonb_build_object(
      'error', null,
      'applied', false,
      'delta', 0,
      'balance', (select carrot_balance from public.wallets where user_id=p_user_id)
    );
  end if;

  insert into public.wallets(user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select carrot_balance into v_current
  from public.wallets where user_id = p_user_id for update;

  if v_current + p_delta < 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', v_current);
  end if;

  v_next := greatest(0, least(99999, v_current + p_delta));
  v_applied := v_next - v_current;

  update public.wallets
  set carrot_balance = v_next, version = version + 1, updated_at = now()
  where user_id = p_user_id;

  insert into public.currency_ledger(
    user_id, requested_delta, delta, balance_after, reason,
    reference_type, reference_id, idempotency_key
  ) values (
    p_user_id, p_delta, v_applied, v_next, trim(p_reason),
    nullif(trim(p_reference_type), ''), nullif(trim(p_reference_id), ''),
    trim(p_idempotency_key)
  );

  return jsonb_build_object(
    'error', null, 'applied', true, 'delta', v_applied, 'balance', v_next
  );
end;
$$;

revoke all on function public.change_carrot_balance_v1(uuid,integer,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.change_carrot_balance_v1(uuid,integer,text,text,text,text)
  to service_role;

create or replace function public.interact_room_need_v1(
  p_actor_id uuid,
  p_owner_id uuid,
  p_need text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_timezone text := 'UTC';
  v_local_date date;
  v_stored smallint;
  v_updated timestamptz;
  v_current integer;
  v_reward integer := 0;
  v_reward_result jsonb;
  v_low uuid;
  v_high uuid;
  v_receipt public.burrow_command_receipts%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  if p_need is null or p_need not in ('food', 'water') or nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;

  v_partner:=public.lock_burrow_pair(p_actor_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_actor_id <> p_owner_id then
    if v_partner is distinct from p_owner_id then
      return jsonb_build_object('error', 'not_paired');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('room-need:' || p_owner_id::text, 0));
  v_request:=jsonb_build_object('owner',p_owner_id,'need',p_need);
  select * into v_receipt from public.burrow_command_receipts
    where actor_id=p_actor_id and command_key='refill:'||trim(p_idempotency_key);
  if found then
    if v_receipt.request<>v_request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return v_receipt.response || '{"applied":false,"reward":0}'::jsonb;
  end if;
  insert into public.room_needs(owner_id) values (p_owner_id)
  on conflict (owner_id) do nothing;

  if p_need = 'food' then
    select food_value, food_updated_at into v_stored, v_updated
    from public.room_needs where owner_id = p_owner_id for update;
  else
    select water_value, water_updated_at into v_stored, v_updated
    from public.room_needs where owner_id = p_owner_id for update;
  end if;

  v_current := greatest(0, v_stored - floor(extract(epoch from (now() - v_updated)) / 300)::integer);
  if v_current >= 100 then
    return jsonb_build_object('error', 'already_full', 'value', 100, 'reward', 0);
  end if;

  if p_need = 'food' then
    update public.room_needs set food_value = 100, food_updated_at = now()
    where owner_id = p_owner_id;
  else
    update public.room_needs set water_value = 100, water_updated_at = now()
    where owner_id = p_owner_id;
  end if;

  if p_actor_id <> p_owner_id then
    select coalesce(nullif(timezone_name, ''), 'UTC') into v_timezone
    from public.profiles where id = p_actor_id;
    v_local_date := (now() at time zone v_timezone)::date;
    v_reward_result := public.change_carrot_balance_v1(
      p_actor_id,
      5,
      case when p_need = 'food' then 'partner_feed' else 'partner_water' end,
      'room_need',
      p_owner_id::text,
      'room-need-reward:' || p_need || ':' || v_local_date::text
    );
    v_reward := coalesce((v_reward_result->>'delta')::integer, 0);
    v_low := least(p_actor_id, p_owner_id);
    v_high := greatest(p_actor_id, p_owner_id);
    insert into public.moment_events(
      pair_low, pair_high, actor_id, target_id, event_type,
      reference_type, reference_id, payload, idempotency_key
    ) values (
      v_low, v_high, p_actor_id, p_owner_id, 'room_need_refilled',
      'room_need', p_owner_id::text,
      jsonb_build_object('need', p_need),
      'room-need:' || trim(p_idempotency_key)
    ) on conflict (actor_id, idempotency_key) do nothing;
  end if;

  if p_actor_id=p_owner_id then
    insert into public.moment_events(pair_low,pair_high,actor_id,target_id,event_type,payload,idempotency_key)
    values(least(p_actor_id,v_partner),greatest(p_actor_id,v_partner),p_actor_id,p_owner_id,
      'room_need_refilled',jsonb_build_object('need',p_need),'room-need:'||trim(p_idempotency_key));
  end if;
  v_response:=jsonb_build_object('error',null,'applied',true,'previousValue',v_current,'value',100,'reward',v_reward);
  insert into public.burrow_command_receipts(actor_id,command_key,request,response)
    values(p_actor_id,'refill:'||trim(p_idempotency_key),v_request,v_response);
  return v_response;
end;
$$;

revoke all on function public.interact_room_need_v1(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.interact_room_need_v1(uuid,uuid,text,text)
  to service_role;

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
  if not coalesce(case p_affection_type
    when 'hug' then jsonb_typeof(p_gesture_metrics->'durationMs')='number' and (p_gesture_metrics->>'durationMs')::numeric>=3000
    when 'spicy' then jsonb_typeof(p_gesture_metrics->'taps')='number' and (p_gesture_metrics->>'taps')::numeric>=10
    when 'cuddle' then jsonb_typeof(p_gesture_metrics->'turns')='number' and (p_gesture_metrics->>'turns')::numeric>=4
    when 'gratitude' then jsonb_typeof(p_gesture_metrics->'holdMs')='number' and (p_gesture_metrics->>'holdMs')::numeric>=1000
    when 'kiss' then jsonb_typeof(p_gesture_metrics->'scale')='number' and (p_gesture_metrics->>'scale')::numeric>=1.5
    when 'miss_you' then jsonb_typeof(p_gesture_metrics->'pathPoints')='number' and (p_gesture_metrics->>'pathPoints')::numeric>=9
  end,false) then return jsonb_build_object('error','invalid_request'); end if;

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

create or replace function public.start_adventure_v1(
  p_user_id uuid,
  p_record_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_timezone text := 'UTC';
  v_local_date date;
  v_has_plus boolean := false;
  v_duration integer;
  v_adventure public.adventures%rowtype;
  v_revision text;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;

  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then
    return jsonb_build_object('error', 'not_paired');
  end if;
  select coalesce(nullif(timezone_name, ''), 'UTC') into v_timezone
  from public.profiles where id = p_user_id;
  v_local_date := (now() at time zone v_timezone)::date;

  perform pg_advisory_xact_lock(hashtextextended('adventure:' || p_user_id::text, 0));

  select * into v_adventure from public.adventures
  where user_id = p_user_id and idempotency_key = trim(p_idempotency_key);
  if found then
    if v_adventure.record_id is distinct from p_record_id then return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object(
      'error', null, 'applied', false, 'adventureId', v_adventure.id,
      'status', v_adventure.status, 'endsAt', v_adventure.ends_at
    );
  end if;
  if exists (select 1 from public.adventures where user_id = p_user_id and local_date = v_local_date) then
    return jsonb_build_object('error', 'daily_adventure_used');
  end if;
  if exists(select 1 from public.adventures where user_id=p_user_id and status in ('in_progress','result_ready','interaction_required')) then
    return jsonb_build_object('error','adventure_pending');
  end if;
  if p_record_id is null or not exists (
    select 1 from public.reflects r join public.reflect_drafts d on d.finalized_reflect_id=r.id
    where r.id=p_record_id and r.user_id=p_user_id and d.user_id=p_user_id
      and r.local_date=v_local_date
      and r.journal_kind in ('write_freely','tap_your_day')
  ) then return jsonb_build_object('error','record_required'); end if;
  if exists(select 1 from public.adventures where record_id=p_record_id) then
    return jsonb_build_object('error','record_already_used');
  end if;
  select value into v_revision from app_config where key='app_major_update_content_revision';
  if not exists(select 1 from content_revisions where id=v_revision and status='published') then
    return jsonb_build_object('error','feature_disabled'); end if;

  select exists (
    select 1 from public.profiles p
    where p.id in (p_user_id, v_partner)
      and coalesce(p.subscription_tier::text, 'free') <> 'free'
  ) into v_has_plus;
  v_duration := case when v_has_plus then 7200 else 28800 end;

  insert into public.adventures(
    user_id, partner_id, local_date, record_id, status, started_at, ends_at,
    duration_seconds, plus_snapshot, content_revision, idempotency_key
  ) values (
    p_user_id, v_partner, v_local_date, p_record_id, 'in_progress', now(),
    now() + make_interval(secs => v_duration), v_duration, v_has_plus,
    v_revision, trim(p_idempotency_key)
  ) returning * into v_adventure;

  return jsonb_build_object(
    'error', null, 'applied', true, 'adventureId', v_adventure.id,
    'status', v_adventure.status, 'endsAt', v_adventure.ends_at,
    'durationSeconds', v_duration, 'hasPlus', v_has_plus
  );
end;
$$;

revoke all on function public.start_adventure_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.start_adventure_v1(uuid,uuid,text)
  to service_role;

create or replace function public.accelerate_adventure_for_plus_v1(
  p_user_id uuid,
  p_adventure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_has_plus boolean := false;
  v_adventure public.adventures%rowtype;
  v_new_end timestamptz;
begin
  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  select exists (
    select 1 from public.profiles p
    where p.id in (p_user_id, v_partner)
      and coalesce(p.subscription_tier::text, 'free') <> 'free'
  ) into v_has_plus;
  if not v_has_plus then return jsonb_build_object('error', 'plus_required'); end if;

  select * into v_adventure from public.adventures
  where id = p_adventure_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_adventure.status <> 'in_progress' then
    return jsonb_build_object('error', 'not_in_progress');
  end if;

  v_new_end := least(v_adventure.ends_at, now() + interval '2 hours');
  update public.adventures
  set ends_at = v_new_end,
      duration_seconds = greatest(1, extract(epoch from (v_new_end - v_adventure.started_at))::integer),
      plus_snapshot = true,
      updated_at = now()
  where id = p_adventure_id;

  return jsonb_build_object('error', null, 'adventureId', p_adventure_id, 'endsAt', v_new_end);
end;
$$;

revoke all on function public.accelerate_adventure_for_plus_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.accelerate_adventure_for_plus_v1(uuid,uuid)
  to service_role;

create or replace function public.assign_daily_quests_v1(
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text := 'UTC';
  v_local_date date;
  v_result jsonb;
begin
  select coalesce(nullif(timezone_name, ''), 'UTC') into v_timezone
  from public.profiles where id = p_user_id;
  if not found then return jsonb_build_object('error', 'profile_not_found'); end if;
  v_local_date := (now() at time zone v_timezone)::date;

  perform pg_advisory_xact_lock(hashtextextended('daily-quests:' || p_user_id::text || ':' || v_local_date::text, 0));

  insert into public.daily_quest_assignments(user_id, local_date, quest_id, target)
  select p_user_id, v_local_date, quest_id, 1
  from unnest(array[
    'write_adventure_record', 'send_affection', 'water_partner_flower',
    'feed_partner_bunny', 'visit_partner_room', 'finish_adventure'
  ]) as q(quest_id)
  order by md5(p_user_id::text || ':' || v_local_date::text || ':' || quest_id)
  limit 3
  on conflict (user_id, local_date, quest_id) do nothing;

  insert into public.quest_progress_vnext(assignment_id)
  select id from public.daily_quest_assignments
  where user_id = p_user_id and local_date = v_local_date
  on conflict (assignment_id) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', q.id,
    'questId', q.quest_id,
    'target', q.target,
    'progress', p.progress,
    'completedAt', p.completed_at,
    'claimedAt', p.claimed_at
  ) order by q.quest_id), '[]'::jsonb) into v_result
  from public.daily_quest_assignments q
  join public.quest_progress_vnext p on p.assignment_id = q.id
  where q.user_id = p_user_id and q.local_date = v_local_date;

  return jsonb_build_object('error', null, 'localDate', v_local_date, 'quests', v_result);
end;
$$;

revoke all on function public.assign_daily_quests_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.assign_daily_quests_v1(uuid) to service_role;

create or replace function public.advance_daily_quest_v1(
  p_user_id uuid,
  p_quest_id text,
  p_amount integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text := 'UTC';
  v_local_date date;
  v_assignment public.daily_quest_assignments%rowtype;
  v_progress public.quest_progress_vnext%rowtype;
begin
  if p_amount < 1 then return jsonb_build_object('error', 'invalid_amount'); end if;
  select coalesce(nullif(timezone_name, ''), 'UTC') into v_timezone
  from public.profiles where id = p_user_id;
  if not found then return jsonb_build_object('error', 'profile_not_found'); end if;
  v_local_date := (now() at time zone v_timezone)::date;

  select * into v_assignment from public.daily_quest_assignments
  where user_id = p_user_id and local_date = v_local_date and quest_id = p_quest_id;
  if not found then return jsonb_build_object('error', 'quest_not_assigned'); end if;

  insert into public.quest_progress_vnext(assignment_id) values (v_assignment.id)
  on conflict (assignment_id) do nothing;
  update public.quest_progress_vnext
  set progress = least(v_assignment.target, progress + p_amount),
      completed_at = case
        when progress + p_amount >= v_assignment.target then coalesce(completed_at, now())
        else completed_at
      end,
      updated_at = now()
  where assignment_id = v_assignment.id
  returning * into v_progress;

  return jsonb_build_object(
    'error', null, 'assignmentId', v_assignment.id,
    'progress', v_progress.progress, 'target', v_assignment.target,
    'completedAt', v_progress.completed_at, 'claimedAt', v_progress.claimed_at
  );
end;
$$;

revoke all on function public.advance_daily_quest_v1(uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.advance_daily_quest_v1(uuid,text,integer) to service_role;

create or replace function public.claim_daily_quest_v1(
  p_user_id uuid,
  p_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.daily_quest_assignments%rowtype;
  v_progress public.quest_progress_vnext%rowtype;
  v_reward jsonb;
begin
  if public.lock_burrow_pair(p_user_id) is null then return jsonb_build_object('error','not_paired'); end if;
  select * into v_assignment from public.daily_quest_assignments
  where id = p_assignment_id and user_id = p_user_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  select * into v_progress from public.quest_progress_vnext
  where assignment_id = p_assignment_id for update;
  if v_progress.completed_at is null then return jsonb_build_object('error', 'not_completed'); end if;
  if v_progress.claimed_at is not null then
    return jsonb_build_object('error', null, 'applied', false, 'reward', 0);
  end if;

  v_reward := public.change_carrot_balance_v1(
    p_user_id, 10, 'daily_quest', 'daily_quest_assignment', p_assignment_id::text,
    'daily-quest:' || p_assignment_id::text
  );
  if v_reward->>'error' is not null then return v_reward; end if;

  update public.quest_progress_vnext set claimed_at = now(), updated_at = now()
  where assignment_id = p_assignment_id;
  insert into public.reward_claims_vnext(
    user_id, reward_type, period_key, reference_id, amount, idempotency_key
  ) values (
    p_user_id, 'daily_quest', v_assignment.local_date::text,
    p_assignment_id::text, 10, 'daily-quest:' || p_assignment_id::text
  ) on conflict (user_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'error', null, 'applied', true,
    'reward', coalesce((v_reward->>'delta')::integer, 0),
    'balance', (v_reward->>'balance')::integer
  );
end;
$$;

revoke all on function public.claim_daily_quest_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_daily_quest_v1(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
