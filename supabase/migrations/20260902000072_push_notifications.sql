-- Durable device registration plus an idempotent delivery outbox for partner
-- Reflect notifications. Clients never read these tables directly.
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists device_push_tokens_user_enabled_idx
  on public.device_push_tokens (user_id, enabled);
alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from public, anon, authenticated;
grant all on public.device_push_tokens to service_role;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'retry', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (recipient_user_id, event_key)
);
alter table public.notification_outbox
  add column if not exists locked_at timestamptz;
create index if not exists notification_outbox_ready_idx
  on public.notification_outbox (status, next_attempt_at, created_at);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;
