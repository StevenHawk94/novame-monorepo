-- Fixed-window rate limiting (2026-08-07 security audit). Serverless API
-- instances are stateless, so the limiter lives in Postgres. One row per
-- (key, window) is upserted and its counter atomically incremented; the RPC
-- returns whether the caller is over the limit. Old rows are disposable
-- (cleaned opportunistically / by the window boundary), so no TTL job needed.
create table if not exists public.rate_limits (
  bucket       text        not null,   -- e.g. 'upload-avatar:<userId>'
  window_start bigint      not null,   -- unix seconds, floored to the window
  count        int         not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limits enable row level security;
-- No policy => deny-all for anon/authenticated. Only the service-role API
-- (which bypasses RLS) touches this table, via the RPC below.

/**
 * Atomically bump a fixed-window counter and report whether the caller is
 * within `p_limit` for the current `p_window_seconds` window. Returns
 * { allowed, count, reset_in }. SECURITY DEFINER + service_role-only.
 */
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    bigint := extract(epoch from now())::bigint;
  v_window bigint := (v_now / p_window_seconds) * p_window_seconds;
  v_count  int;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup of this bucket's stale windows.
  delete from public.rate_limits
  where bucket = p_bucket and window_start < v_window;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'reset_in', (v_window + p_window_seconds) - v_now
  );
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public;
revoke all on function public.check_rate_limit(text, int, int) from anon;
revoke all on function public.check_rate_limit(text, int, int) from authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
