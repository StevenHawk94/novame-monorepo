-- Monitor the share of user-visible Connection cards that required original
-- AI fallback copy. Windows are non-overlapping groups of 100 accepted cards.

begin;

-- Supabase SQL Editor can leave two Run requests active for a short period.
-- Serialize duplicate/retried executions before any catalog-changing DDL so
-- they cannot deadlock while creating policies, functions, and dependencies.
select pg_advisory_xact_lock(
  hashtextextended('migration_20260915000091_connection_originality_monitor', 0)
);

create table if not exists public.connection_output_events (
  id bigint generated always as identity primary key,
  reflect_id text not null,
  signal_id text not null,
  outcome text not null check (outcome in ('matched', 'custom')),
  section text,
  created_at timestamptz not null default now(),
  unique (reflect_id, signal_id)
);

create table if not exists public.connection_output_monitor_state (
  id smallint primary key default 1 check (id = 1),
  window_number bigint not null default 1,
  outputs_in_window integer not null default 0 check (outputs_in_window between 0 and 99),
  originals_in_window integer not null default 0 check (originals_in_window between 0 and outputs_in_window),
  updated_at timestamptz not null default now()
);

insert into public.connection_output_monitor_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.connection_output_alerts (
  id bigint generated always as identity primary key,
  window_number bigint not null unique,
  total_outputs integer not null default 100,
  original_outputs integer not null,
  original_ratio numeric(6, 5) not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists connection_output_alerts_delivery
  on public.connection_output_alerts(status, created_at);

create or replace function public.record_connection_output_outcomes(
  p_reflect_id text,
  p_outcomes jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_event_id bigint;
  v_window bigint;
  v_outputs integer;
  v_originals integer;
begin
  if p_reflect_id is null or jsonb_typeof(p_outcomes) <> 'array' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('connection_output_monitor_v1', 0));
  insert into public.connection_output_monitor_state (id)
  values (1)
  on conflict (id) do nothing;

  select window_number, outputs_in_window, originals_in_window
    into v_window, v_outputs, v_originals
  from public.connection_output_monitor_state
  where id = 1
  for update;

  for v_row in
    select signal_id, outcome, section
    from jsonb_to_recordset(p_outcomes)
      as x(signal_id text, outcome text, section text)
    where signal_id is not null and outcome in ('matched', 'custom')
  loop
    v_event_id := null;
    insert into public.connection_output_events(reflect_id, signal_id, outcome, section)
    values (p_reflect_id, v_row.signal_id, v_row.outcome, v_row.section)
    on conflict (reflect_id, signal_id) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      continue;
    end if;

    v_outputs := v_outputs + 1;
    if v_row.outcome = 'custom' then
      v_originals := v_originals + 1;
    end if;

    if v_outputs = 100 then
      if v_originals > 30 then
        insert into public.connection_output_alerts(
          window_number, total_outputs, original_outputs, original_ratio
        ) values (
          v_window, 100, v_originals, v_originals::numeric / 100
        ) on conflict (window_number) do nothing;
      end if;
      v_window := v_window + 1;
      v_outputs := 0;
      v_originals := 0;
    end if;
  end loop;

  update public.connection_output_monitor_state set
    window_number = v_window,
    outputs_in_window = v_outputs,
    originals_in_window = v_originals,
    updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.claim_connection_output_alert()
returns setof public.connection_output_alerts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.connection_output_alerts
  set status = 'sending', attempts = attempts + 1, claimed_at = now()
  where id = (
    select id from public.connection_output_alerts
    where attempts < 5 and (
      status in ('pending', 'failed')
      or (status = 'sending' and claimed_at < now() - interval '15 minutes')
    )
    order by created_at asc
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

create or replace function public.complete_connection_output_alert(
  p_alert_id bigint,
  p_success boolean,
  p_error text default null
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.connection_output_alerts set
    status = case when p_success then 'sent' else 'failed' end,
    sent_at = case when p_success then now() else sent_at end,
    claimed_at = null,
    last_error = case when p_success then null else left(coalesce(p_error, 'unknown'), 500) end
  where id = p_alert_id;
$$;

alter table public.connection_output_events enable row level security;
alter table public.connection_output_monitor_state enable row level security;
alter table public.connection_output_alerts enable row level security;

drop policy if exists connection_output_events_service on public.connection_output_events;
create policy connection_output_events_service on public.connection_output_events
  for all to service_role using (true) with check (true);
drop policy if exists connection_output_monitor_state_service on public.connection_output_monitor_state;
create policy connection_output_monitor_state_service on public.connection_output_monitor_state
  for all to service_role using (true) with check (true);
drop policy if exists connection_output_alerts_service on public.connection_output_alerts;
create policy connection_output_alerts_service on public.connection_output_alerts
  for all to service_role using (true) with check (true);

revoke all on function public.record_connection_output_outcomes(text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_connection_output_alert() from public, anon, authenticated;
revoke all on function public.complete_connection_output_alert(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.record_connection_output_outcomes(text, jsonb) to service_role;
grant execute on function public.claim_connection_output_alert() to service_role;
grant execute on function public.complete_connection_output_alert(bigint, boolean, text) to service_role;

commit;
