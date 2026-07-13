-- IAP Step 2: Plus tier constraint + duo seat model.
--
-- 1. The plan CHECK constraint allowed free/basic/pro/ultra; v2 uses free/plus.
--    Existing sandbox rows on old tiers are normalized to free first, then the
--    constraint is rewritten so apple-iap can write plan='plus'.
-- 2. Add plan_type (solo/duo) to the owner's subscription row.
-- 3. duo_memberships: one row per duo subscription. The owner buys a duo plan
--    and gets a one-time invite code; the member claims it once (irreversible).
--    The member's Plus follows the owner's subscription -- when the owner
--    cancels, the member stays Plus until the owner's period_end, then both
--    lapse together (mirrors Apple's cancel-at-period-end semantics).

-- Normalize legacy/sandbox plans before tightening the constraint.
update public.subscriptions set plan = 'free' where plan not in ('free', 'plus');

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan = any (array['free'::text, 'plus'::text]));

alter table public.subscriptions
  add column if not exists plan_type text default 'solo'
  check (plan_type in ('solo', 'duo'));

create table if not exists public.duo_memberships (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles on delete cascade,
  member_id     uuid references public.profiles on delete set null,
  invite_code   text not null unique,
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  created_at    timestamptz default now(),
  claimed_at    timestamptz,
  unique (owner_id)
);

create index if not exists duo_by_member on public.duo_memberships (member_id) where member_id is not null;

alter table public.duo_memberships enable row level security;

create policy duo_own on public.duo_memberships
  for select to authenticated using (auth.uid() = owner_id or auth.uid() = member_id);
create policy duo_service on public.duo_memberships
  for all to service_role using (true) with check (true);
