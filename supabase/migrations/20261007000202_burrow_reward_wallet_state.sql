-- A single MVCC snapshot ties the wallet version to the credits it contains.
-- Clients must never add an optimistic credit again after a concurrent read
-- has already included it. This is a read-only companion to existing writers.
create or replace function public.burrow_reward_wallet_state_v1(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wallet', jsonb_build_object('balance', w.carrot_balance, 'version', w.version),
    'localDate', (now() at time zone coalesce(nullif(p.timezone_name, ''), 'UTC'))::date,
    'timezone', coalesce(nullif(p.timezone_name, ''), 'UTC'),
    'serverNow', now(),
    'credits', coalesce((select jsonb_agg(jsonb_build_object(
      'key', l.idempotency_key, 'amount', l.delta, 'reason', l.reason))
      from public.currency_ledger l where l.user_id = p_user_id
      and l.requested_delta > 0 and l.created_at >= now() - interval '8 days'), '[]'::jsonb)
  ) from public.wallets w join public.profiles p on p.id = w.user_id
  where w.user_id = p_user_id;
$$;
revoke all on function public.burrow_reward_wallet_state_v1(uuid) from public, anon, authenticated;
grant execute on function public.burrow_reward_wallet_state_v1(uuid) to service_role;
notify pgrst, 'reload schema';
