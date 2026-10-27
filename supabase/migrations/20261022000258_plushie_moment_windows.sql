-- First eligible play starts a non-sliding hour. Old daily history stays intact.
-- Photos remain private; only proof IDs/timestamps are recorded, never paths.
begin;
alter table public.moment_events add column toy_window_started_at timestamptz;
create index moment_toy_windows on public.moment_events(actor_id,pair_low,pair_high,toy_window_started_at)
  where event_type='toy_interacted' and toy_window_started_at is not null;

-- These commands explicitly advance the interaction's day, even when an hour
-- spans midnight or a photo upload finishes later. Other event rules unchanged.
do $$ declare original text; revised text; begin
  original:=pg_get_functiondef('public.burrow_moment_quest_progress()'::regprocedure);
  revised:=replace(original,'quest:=case new.event_type',
    'if new.event_type=''toy_interacted'' and new.payload->>''recordingVersion''=''2'' then return new; end if;
 quest:=case new.event_type');
  if revised=original then raise exception 'Unexpected Moments quest trigger'; end if;
  execute revised;
end $$;

create function public.record_burrow_toy_window_v1(p_user_id uuid,p_partner_id uuid,p_pair_version text,
  p_toy_id text,p_photo_id text,p_window_started_at timestamptz,p_occurred_at timestamptz,
  p_last_occurred_at timestamptz,p_local_date date,p_count integer,p_key text,
  p_receipt_prefix text default 'toy-window:')
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; version text; lo uuid; hi uuid; zone text; today date;
  request jsonb; result jsonb; receipt public.burrow_command_receipts%rowtype;
  event public.moment_events%rowtype; proof public.room_photo_uploads%rowtype;
  started timestamptz; touches integer;
begin
  if p_count is null or p_count<1 or p_count>50 or nullif(trim(p_key),'') is null or length(p_key)>200
    or p_receipt_prefix not in('toy-window:','toy-batch:','toy-touch:')
    then return jsonb_build_object('error','invalid_request'); end if;
  partner:=lock_burrow_pair(p_user_id);
  version:=case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end;
  if partner is distinct from p_partner_id or version is distinct from p_pair_version
    then return jsonb_build_object('error','pair_changed'); end if;
  lo:=least(p_user_id,coalesce(partner,p_user_id));hi:=greatest(p_user_id,coalesce(partner,p_user_id));
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  today:=(now() at time zone zone)::date;
  request:=case p_receipt_prefix
    when 'toy-touch:' then jsonb_build_object('day',p_local_date,'partner',partner)
    when 'toy-batch:' then jsonb_build_object('day',p_local_date,'partner',partner,'pairVersion',version,'count',p_count)
    else jsonb_build_object('partner',partner,'pairVersion',version,'toyId',p_toy_id,'photoId',p_photo_id,
      'window',p_window_started_at,'first',p_occurred_at,'last',p_last_occurred_at,'day',p_local_date,'count',p_count) end;
  -- Serialize by actor, not day: an hour is allowed to cross midnight.
  perform pg_advisory_xact_lock(hashtextextended('toy-window:'||p_user_id::text,0));
  select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key=p_receipt_prefix||p_key;
  if found then
    if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return receipt.response||jsonb_build_object('applied',false);
  end if;
  if p_window_started_at is null or not isfinite(p_window_started_at) or p_occurred_at is null or not isfinite(p_occurred_at)
    or p_last_occurred_at is null or not isfinite(p_last_occurred_at) or p_local_date is null
    or p_window_started_at>p_occurred_at or p_occurred_at>p_last_occurred_at
    or p_last_occurred_at>=p_window_started_at+interval '1 hour' or p_last_occurred_at>now()+interval '5 minutes'
    or (p_occurred_at at time zone zone)::date<>p_local_date
    or (p_last_occurred_at at time zone zone)::date<>p_local_date
    then return jsonb_build_object('error','invalid_request'); end if;
  if partner is not null and p_occurred_at<burrow_relation_started_at_v1(lo,hi)-interval '5 minutes'
    then return jsonb_build_object('error','pair_changed'); end if;

  -- Modern clients name the displayed toy, not whichever toy is equipped when
  -- a delayed batch arrives. Legacy clients can only prove the current toy.
  if p_photo_id like 'local-plushie-%' then
    select * into proof from room_photo_uploads where actor_id=p_user_id and owner_id=p_user_id
      and partner_id=coalesce(partner,p_user_id) and kind='doll' and toy_id=p_toy_id
      and command_key::text=substring(p_photo_id from 15);
    if not found then return jsonb_build_object('error','photo_sync_pending'); end if;
    if proof.committed_at is null and proof.expired_at is null then return jsonb_build_object('error','photo_sync_pending'); end if;
    if proof.committed_at is null then result:=jsonb_build_object('error',null,'applied',false,'skipped','photo_required'); end if;
  elsif not exists(select 1 from room_photos where id::text=p_photo_id and owner_id=p_user_id
    and pair_low=lo and pair_high=hi and kind='doll' and toy_id=p_toy_id) then
    result:=jsonb_build_object('error',null,'applied',false,'skipped','photo_required');
  end if;
  if result is not null then
    insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,p_receipt_prefix||p_key,request,result);
    return result;
  end if;

  select * into event from moment_events where actor_id=p_user_id and event_type='toy_interacted'
    and pair_low=lo and pair_high=hi and burrow_relation_row_matches_v1(pair_low,pair_high,pair_version)
    and toy_window_started_at<=p_window_started_at and toy_window_started_at>p_window_started_at-interval '1 hour'
    and p_last_occurred_at<toy_window_started_at+interval '1 hour'
    order by toy_window_started_at desc limit 1 for update;
  if found then
    update moment_events set payload=jsonb_set(payload,'{count}',to_jsonb(coalesce((payload->>'count')::integer,0)+p_count)),
      created_at=greatest(created_at,p_last_occurred_at) where id=event.id
      returning (payload->>'count')::integer into touches;
    started:=event.toy_window_started_at;
  else
    started:=p_window_started_at;touches:=p_count;
    insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,
      idempotency_key,toy_window_started_at,created_at)
    values(lo,hi,p_user_id,p_user_id,'toy_interacted','toy',started::text,
      jsonb_build_object('action','touch','count',touches,'recordingVersion',2),
      'toy-window:'||p_key,started,p_last_occurred_at);
  end if;
  if p_local_date=today then perform assign_daily_quests_v1(p_user_id); end if;
  -- Past-day delayed input cannot complete today's quest or claim a reward.
  insert into quest_progress_vnext(assignment_id)
    select id from daily_quest_assignments where user_id=p_user_id and local_date=p_local_date and quest_id='interact_with_toy'
    on conflict(assignment_id) do nothing;
  update quest_progress_vnext p set progress=q.target,completed_at=coalesce(p.completed_at,p_occurred_at),updated_at=now()
    from daily_quest_assignments q where p.assignment_id=q.id and q.user_id=p_user_id
    and q.local_date=p_local_date and q.quest_id='interact_with_toy' and p.progress<q.target;
  result:=jsonb_build_object('error',null,'applied',true,'count',touches,'windowStartedAt',started);
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,p_receipt_prefix||p_key,request,result);
  return result;
end $$;

-- Old API signatures remain callable. They now require the equipped toy's
-- actual photo and use receipt-compatible server-time windows (no client wait).
create or replace function public.interact_burrow_toy_batch_v1(p_user_id uuid,p_owner_id uuid,p_partner_id uuid,
  p_pair_version text,p_local_date date,p_count integer,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item text; photo text;
begin
  if p_owner_id is distinct from p_user_id then return jsonb_build_object('error','own_toy_only'); end if;
  item:=current_burrow_toy_v1(p_user_id,p_partner_id);
  select id::text into photo from room_photos where owner_id=p_user_id and kind='doll' and toy_id=item
    and pair_low=least(p_user_id,coalesce(p_partner_id,p_user_id)) and pair_high=greatest(p_user_id,coalesce(p_partner_id,p_user_id));
  return record_burrow_toy_window_v1(p_user_id,p_partner_id,p_pair_version,item,coalesce(photo,''),now(),now(),now(),p_local_date,p_count,p_key,'toy-batch:');
end $$;
create or replace function public.interact_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; version text; item text; photo text; local_day date;
begin
  partner:=lock_burrow_pair(p_user_id);
  version:=case when partner is not null then burrow_pair_version_v1(p_user_id,partner) end;
  select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into local_day from profiles where id=p_user_id;
  item:=current_burrow_toy_v1(p_user_id,partner);
  select id::text into photo from room_photos where owner_id=p_user_id and kind='doll' and toy_id=item
    and pair_low=least(p_user_id,coalesce(partner,p_user_id)) and pair_high=greatest(p_user_id,coalesce(partner,p_user_id));
  return record_burrow_toy_window_v1(p_user_id,partner,version,item,coalesce(photo,''),now(),now(),now(),local_day,1,p_key,'toy-touch:');
end $$;
create or replace function public.solo_burrow_toy_v1(p_user_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  return interact_burrow_toy_v1(p_user_id,p_key);
end $$;
revoke all on function public.record_burrow_toy_window_v1(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,date,integer,text,text) from public,anon,authenticated;
grant execute on function public.record_burrow_toy_window_v1(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,date,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
