-- Record the verified store environment for entitlement diagnostics.
--
-- Apple purchases derive this value exclusively from the signed StoreKit JWS;
-- clients cannot choose it. Existing rows remain `unknown` because their old
-- transaction payloads are not available during migration.

alter table public.subscriptions
  add column if not exists store_environment text not null default 'unknown';

alter table public.subscriptions
  drop constraint if exists subscriptions_store_environment_check;

alter table public.subscriptions
  add constraint subscriptions_store_environment_check
  check (store_environment in ('unknown', 'sandbox', 'production'));

create index if not exists idx_subscriptions_store_environment
  on public.subscriptions (store_environment);

comment on column public.subscriptions.store_environment is
  'Verified store transaction environment: sandbox, production, or unknown for legacy rows.';
