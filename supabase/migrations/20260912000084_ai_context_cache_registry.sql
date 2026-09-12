-- Durable registry for globally shared Gemini explicit context caches.
-- Cache contents are public application instructions only; no user data is stored here.

comment on column public.reflect_ai_analyses.connection_signals is
  'Compact privacy-safe Connection evidence used within a 10-day analysis window.';

create table if not exists public.ai_context_caches (
  cache_key text primary key,
  provider text not null default 'gemini',
  model text not null,
  prompt_hash text not null,
  remote_name text,
  expires_at timestamptz,
  last_used_at timestamptz,
  refresh_lease_until timestamptz,
  status text not null default 'missing'
    check (status in ('missing', 'ready', 'refreshing', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_context_caches enable row level security;
revoke all on table public.ai_context_caches from public, anon, authenticated;
grant all on table public.ai_context_caches to service_role;

create or replace function public.claim_ai_context_cache(
  p_cache_key text,
  p_model text,
  p_prompt_hash text,
  p_renew_before timestamptz
)
returns table(action text, remote_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_context_caches%rowtype;
  v_now timestamptz := now();
begin
  insert into public.ai_context_caches(cache_key, model, prompt_hash)
  values (p_cache_key, p_model, p_prompt_hash)
  on conflict (cache_key) do nothing;

  select * into v_row
  from public.ai_context_caches
  where cache_key = p_cache_key
  for update;

  if v_row.model <> p_model
    or v_row.prompt_hash <> p_prompt_hash
    or v_row.remote_name is null
    or v_row.expires_at is null
    or v_row.expires_at <= v_now then
    if v_row.refresh_lease_until is not null and v_row.refresh_lease_until > v_now then
      return query select 'wait'::text, null::text, null::timestamptz;
      return;
    end if;
    update public.ai_context_caches set
      model = p_model,
      prompt_hash = p_prompt_hash,
      remote_name = null,
      expires_at = null,
      status = 'refreshing',
      last_error = null,
      refresh_lease_until = v_now + interval '60 seconds',
      updated_at = v_now
    where cache_key = p_cache_key;
    return query select 'create'::text, null::text, null::timestamptz;
    return;
  end if;

  update public.ai_context_caches set last_used_at = v_now, updated_at = v_now
  where cache_key = p_cache_key;

  if v_row.expires_at <= p_renew_before
    and (v_row.refresh_lease_until is null or v_row.refresh_lease_until <= v_now) then
    update public.ai_context_caches set
      status = 'refreshing',
      refresh_lease_until = v_now + interval '60 seconds',
      updated_at = v_now
    where cache_key = p_cache_key;
    return query select 'renew'::text, v_row.remote_name, v_row.expires_at;
    return;
  end if;

  return query select 'reuse'::text, v_row.remote_name, v_row.expires_at;
end;
$$;

revoke all on function public.claim_ai_context_cache(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_ai_context_cache(text, text, text, timestamptz)
  to service_role;
