-- Google Play Billing support (/api/google-iap): store the Play purchase
-- token + product id alongside the existing apple_* columns so renewals,
-- restores and future Play RTDN webhooks can key on them.
alter table public.subscriptions
  add column if not exists google_purchase_token text,
  add column if not exists google_product_id text;

create index if not exists subscriptions_google_token
  on public.subscriptions (google_purchase_token)
  where google_purchase_token is not null;
