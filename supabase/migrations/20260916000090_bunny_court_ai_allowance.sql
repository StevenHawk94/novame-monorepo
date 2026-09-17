-- Bunny Court has its own paid AI allowance. Structured answers always use the
-- deterministic rules; only meaningful optional text may consume one of the
-- initiator's two local-day credits.

create table if not exists public.court_ai_credits (
  session_id uuid primary key references public.court_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists court_ai_credits_user_date
  on public.court_ai_credits(user_id, local_date);

alter table public.court_ai_credits enable row level security;
revoke all on public.court_ai_credits from public, anon, authenticated;
grant all on public.court_ai_credits to service_role;

create or replace function public.claim_court_ai_credit(
  p_user_id uuid,
  p_session_id uuid,
  p_local_date date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_paid boolean := false;
  v_has_consent boolean := false;
  v_used integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_local_date::text, 0));

  if exists (
    select 1 from public.court_ai_credits
    where session_id = p_session_id and user_id = p_user_id
  ) then
    return jsonb_build_object('eligible', true, 'used', (
      select count(*) from public.court_ai_credits
      where user_id = p_user_id and local_date = p_local_date
    ));
  end if;

  if not exists (
    select 1 from public.court_sessions
    where id = p_session_id and initiator_id = p_user_id
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'not_initiator');
  end if;

  select coalesce(subscription_tier::text <> 'free', false), ai_consent_at is not null
    into v_is_paid, v_has_consent
  from public.profiles
  where id = p_user_id;

  if not v_is_paid or not v_has_consent then
    return jsonb_build_object('eligible', false, 'reason', 'not_eligible');
  end if;

  select count(*)::integer into v_used
  from public.court_ai_credits
  where user_id = p_user_id and local_date = p_local_date;

  if v_used >= 2 then
    return jsonb_build_object('eligible', false, 'reason', 'daily_limit', 'used', v_used);
  end if;

  insert into public.court_ai_credits(session_id, user_id, local_date)
  values (p_session_id, p_user_id, p_local_date)
  on conflict (session_id) do nothing;

  return jsonb_build_object('eligible', true, 'used', v_used + 1, 'remaining', greatest(0, 1 - v_used));
end;
$$;

revoke all on function public.claim_court_ai_credit(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.claim_court_ai_credit(uuid, uuid, date)
  to service_role;

-- Repeatability remains in the historical schema for snapshot compatibility,
-- but no case is gated by it after this release.
update public.court_case_definitions set repeatability = 'Anytime';
