-- Approved: daily economic windows are account-scoped and immutable. Profile
-- and device timezone changes must not reopen rewards or quotas. Journal pages
-- retain their separate, already-frozen common calendar (migration 268).
begin;

create table public.account_economic_calendars (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  timezone_name text not null,
  fixed_at timestamptz not null default now()
);
alter table public.account_economic_calendars enable row level security;
revoke all on public.account_economic_calendars from public,anon,authenticated,service_role;
grant select on public.account_economic_calendars to service_role;

-- Existing accounts are pinned before any newly deployed request can change
-- their profile timezone. No wallet, ledger, profile or historical row changes.
insert into public.account_economic_calendars(user_id,timezone_name)
select p.id,coalesce(z.name,'UTC') from public.profiles p
left join pg_timezone_names z on z.name=nullif(p.timezone_name,'');

create function public.economic_timezone_v1(p_user uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare zone text;
begin
  select timezone_name into zone from account_economic_calendars where user_id=p_user;
  if found then return zone; end if;
  -- New accounts: first economic use fixes the then-current valid profile zone.
  -- Concurrent first requests converge on one immutable row, never last-write.
  insert into account_economic_calendars(user_id,timezone_name)
    select p.id,coalesce(z.name,'UTC') from profiles p
    left join pg_timezone_names z on z.name=nullif(p.timezone_name,'') where p.id=p_user
    on conflict(user_id) do nothing;
  select timezone_name into zone from account_economic_calendars where user_id=p_user;
  if not found then raise exception 'profile_not_found'; end if;
  return zone;
end $$;

create function public.economic_calendar_v1(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare zone text:=public.economic_timezone_v1(p_user);
begin
  return jsonb_build_object('timezone',zone,'localDate',(now() at time zone zone)::date);
end $$;
revoke all on function public.economic_timezone_v1(uuid),public.economic_calendar_v1(uuid) from public,anon,authenticated;
grant execute on function public.economic_timezone_v1(uuid),public.economic_calendar_v1(uuid) to service_role;

-- Replace only audited actor-calendar expressions in existing writers/readers.
-- Preserve every other limit, price, entitlement, idempotency and history rule.
-- An unexpected deployed definition aborts this entire migration, not a partial
-- patch. Do NOT generalize this to journal/notification/display-only calendars.
do $migration$
declare spec record; fn record; definition text; patched text; matches integer;
  pattern text:=E'coalesce\\s*\\(\\s*nullif\\s*\\(\\s*(p\\.)?timezone_name\\s*,\\s*\'\'\\s*\\)\\s*,\\s*\'UTC\'\\s*\\)';
begin
 for spec in select * from (values
  ('advance_daily_quest_v1','p_user_id'),('assign_daily_quests_v1','p_user_id'),
  ('burrow_affection_state_v1','p_user_id'),('burrow_bootstrap_core_v1','p_user_id'),
  ('burrow_photo_quota_v1','p_actor'),('burrow_photo_usage_v1','p_user'),
  ('burrow_record_date_v1','p_user_id'),('burrow_reward_wallet_state_v1','p_user_id'),
  ('complete_affection_v1','p_sender_id'),('complete_personal_toy_photo_v1','p_user_id'),
  ('complete_room_photo_before_expiry_v1','p_user_id'),('complete_toy_photo_v1','p_user_id'),
  ('daily_plus_bonus_state_v1','p_user_id'),('enforce_love_note_send_limits_v1','new.author_id'),
  ('get_quest_activity_counts_v2','p_user_id'),('interact_burrow_toy_v1','p_user_id'),
  ('interact_room_need_v1','p_actor_id'),('prepare_personal_toy_photo_v1','p_user_id'),
  ('prepare_room_photo_before_expiry_v1','p_user_id'),('prepare_toy_photo_v1','p_user_id'),
  ('record_burrow_toy_window_v1','p_user_id'),('release_room_status_v1','p_user_id'),
  ('solo_burrow_complete_photo_v1','p_user_id'),('solo_burrow_initialize_v1','p_user_id'),
  ('solo_burrow_prepare_photo_v1','p_user_id'),('solo_burrow_start_adventure_v1','p_user_id'),
  ('start_adventure_v1','p_user_id'),('submit_release_room_v1','p_user_id')
 ) s(name,actor) loop
  matches:=0;
  for fn in select oid from pg_proc where pronamespace='public'::regnamespace and proname=spec.name loop
   definition:=pg_get_functiondef(fn.oid);
   if definition !~ pattern then raise exception 'Economic calendar definition changed: %',spec.name; end if;
   patched:=regexp_replace(definition,pattern,'public.economic_timezone_v1('||spec.actor||')','g');
   -- The first-use helper may insert a calendar row. Explicitly reflect that
   -- volatility rather than hiding writes behind a STABLE SQL declaration.
   patched:=replace(patched,'STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER');
   if spec.name='burrow_bootstrap_core_v1' then
    if patched not like '%''localDate'',today,%' then raise exception 'Economic bootstrap shape changed'; end if;
    patched:=replace(patched,'''localDate'',today,','''localDate'',today,''economicTimezone'',tz,');
   end if;
   if spec.name='enforce_love_note_send_limits_v1' then
    patched:=replace(patched,'The next window uses the current zone.','The next window uses the fixed economic zone.');
   end if;
   execute patched; matches:=matches+1;
  end loop;
  if matches<>1 then raise exception 'Missing/ambiguous economic calendar function: %',spec.name; end if;
 end loop;
end $migration$;

commit;
