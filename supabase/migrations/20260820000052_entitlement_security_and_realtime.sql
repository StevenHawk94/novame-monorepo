-- Pre-launch entitlement hardening.
--
-- 1. A store transaction belongs to exactly one NovaMe account.
-- 2. Subscription + profile entitlement writes are atomic.
-- 3. Pair-shared Plus is synchronized transactionally and preserves a
--    partner's independently purchased subscription on revoke/unpair.
-- 4. Effective entitlement changes emit a tiny private Realtime invalidation
--    message. Existing mobile page-cache TTL/read/write policies are untouched.

-- Historical sandbox builds allowed one expired StoreKit/Play credential to be
-- restored into several test accounts. There is no safe "winner" for an
-- already-expired duplicate, so detach every copy and let a future signed
-- restore establish a fresh immutable binding. This cleanup is deliberately
-- limited to groups where every row has an authoritative period end in the
-- past. A duplicate group containing any current/unknown period still blocks
-- deployment for manual review.
update public.subscriptions s
   set apple_transaction_id = null,
       apple_original_transaction_id = null,
       updated_at = now()
 where s.apple_original_transaction_id in (
   select apple_original_transaction_id
     from public.subscriptions
    where apple_original_transaction_id is not null
    group by apple_original_transaction_id
   having count(*) > 1
      and bool_and(current_period_end is not null and current_period_end <= now())
 );

update public.subscriptions s
   set google_purchase_token = null,
       updated_at = now()
 where s.google_purchase_token in (
   select google_purchase_token
     from public.subscriptions
    where google_purchase_token is not null
    group by google_purchase_token
   having count(*) > 1
      and bool_and(current_period_end is not null and current_period_end <= now())
 );

-- Stop deployment if any duplicate credential remains. Choosing a current
-- owner automatically would risk assigning paid access to the wrong account.
do $$
begin
  if exists (
    select 1 from public.subscriptions
     where apple_original_transaction_id is not null
     group by apple_original_transaction_id having count(*) > 1
  ) then
    raise exception 'duplicate apple_original_transaction_id values require review';
  end if;
  if exists (
    select 1 from public.subscriptions
     where google_purchase_token is not null
     group by google_purchase_token having count(*) > 1
  ) then
    raise exception 'duplicate google_purchase_token values require review';
  end if;
end
$$;

drop index if exists public.idx_subscriptions_apple_original_txn;
drop index if exists public.idx_subscriptions_google_purchase_token;
drop index if exists public.idx_subscriptions_google_token;

create unique index if not exists subscriptions_apple_original_txn_unique
  on public.subscriptions (apple_original_transaction_id)
  where apple_original_transaction_id is not null;
create unique index if not exists subscriptions_google_purchase_token_unique
  on public.subscriptions (google_purchase_token)
  where google_purchase_token is not null;

-- Keep immutable ownership history even when Google rotates the active token
-- during a plan replacement. Otherwise the old linked token could be replayed
-- after subscriptions.google_purchase_token moves to the new value.
create table if not exists public.store_credential_bindings (
  store text not null check (store in ('apple', 'google')),
  credential text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store, credential)
);
alter table public.store_credential_bindings enable row level security;
drop policy if exists store_credential_bindings_service on public.store_credential_bindings;
create policy store_credential_bindings_service on public.store_credential_bindings
  for all to service_role using (true) with check (true);

insert into public.store_credential_bindings(store, credential, user_id)
select 'apple', apple_original_transaction_id, user_id
  from public.subscriptions where apple_original_transaction_id is not null
on conflict (store, credential) do nothing;
insert into public.store_credential_bindings(store, credential, user_id)
select 'google', google_purchase_token, user_id
  from public.subscriptions where google_purchase_token is not null
on conflict (store, credential) do nothing;

-- Webhook states already used by the API must be accepted by the database.
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (
  status in (
    'active', 'cancelled', 'past_due', 'trialing', 'grace_period',
    'on_hold', 'paused', 'expired', 'revoked'
  )
);

create or replace function public.has_own_active_plus(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.subscriptions s
     where s.user_id = p_user_id
       and s.plan = 'plus'
       and s.status in ('active', 'cancelled', 'trialing', 'grace_period')
       and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

revoke all on function public.has_own_active_plus(uuid) from public, anon, authenticated;
grant execute on function public.has_own_active_plus(uuid) to service_role;

create or replace function public.apply_store_subscription(
  p_user_id uuid,
  p_store text,
  p_plan text,
  p_plan_type text,
  p_billing_cycle text,
  p_period_end timestamptz,
  p_apple_transaction_id text default null,
  p_apple_original_transaction_id text default null,
  p_apple_product_id text default null,
  p_google_purchase_token text default null,
  p_google_product_id text default null,
  p_google_base_plan_id text default null,
  p_google_auto_renewing boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_existing public.subscriptions%rowtype;
  v_period_start timestamptz;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_store not in ('apple', 'google')
     or p_plan <> 'plus'
     or p_plan_type not in ('solo', 'duo')
     or p_billing_cycle not in ('monthly', 'yearly')
     or p_period_end is null then
    return jsonb_build_object('success', false, 'error', 'invalid_arguments');
  end if;

  -- Serialize both claims of the same credential before checking ownership.
  perform pg_advisory_xact_lock(hashtextextended(
    p_store || ':' || coalesce(p_apple_original_transaction_id, p_google_purchase_token, ''), 0
  ));

  if p_store = 'apple' then
    if p_apple_original_transaction_id is null then
      return jsonb_build_object('success', false, 'error', 'missing_store_credential');
    end if;
    select user_id into v_owner
      from public.store_credential_bindings
     where store = 'apple' and credential = p_apple_original_transaction_id
     limit 1;
  else
    if p_google_purchase_token is null then
      return jsonb_build_object('success', false, 'error', 'missing_store_credential');
    end if;
    select user_id into v_owner
      from public.store_credential_bindings
     where store = 'google' and credential = p_google_purchase_token
     limit 1;
  end if;

  if v_owner is not null and v_owner <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'credential_owned_by_another_user');
  end if;

  insert into public.store_credential_bindings(store, credential, user_id)
  values (
    p_store,
    case when p_store = 'apple' then p_apple_original_transaction_id else p_google_purchase_token end,
    p_user_id
  ) on conflict (store, credential) do nothing;
  select user_id into v_owner
    from public.store_credential_bindings
   where store = p_store
     and credential = case when p_store = 'apple' then p_apple_original_transaction_id else p_google_purchase_token end;
  if v_owner <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'credential_owned_by_another_user');
  end if;

  select * into v_existing
    from public.subscriptions
   where user_id = p_user_id
   for update;

  v_period_start := case
    when v_existing.user_id is not null
     and v_existing.plan = p_plan
     and v_existing.status in ('active', 'cancelled', 'trialing', 'grace_period')
     and v_existing.current_period_start is not null
     and v_existing.current_period_end is not null
     and p_period_end <= v_existing.current_period_end
      then v_existing.current_period_start
    else v_now
  end;

  insert into public.subscriptions (
    user_id, plan, plan_type, status, billing_cycle,
    current_period_start, current_period_end,
    apple_transaction_id, apple_original_transaction_id, apple_product_id,
    google_purchase_token, google_product_id, google_base_plan_id,
    google_auto_renewing, pending_plan, pending_billing_cycle,
    pending_product_id, pending_base_plan_id, updated_at
  ) values (
    p_user_id, p_plan, p_plan_type, 'active', p_billing_cycle,
    v_period_start, p_period_end,
    case when p_store = 'apple' then p_apple_transaction_id else null end,
    case when p_store = 'apple' then p_apple_original_transaction_id else null end,
    case when p_store = 'apple' then p_apple_product_id else null end,
    case when p_store = 'google' then p_google_purchase_token else null end,
    case when p_store = 'google' then p_google_product_id else null end,
    case when p_store = 'google' then p_google_base_plan_id else null end,
    case when p_store = 'google' then p_google_auto_renewing else null end,
    null, null, null, null, v_now
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    plan_type = excluded.plan_type,
    status = 'active',
    billing_cycle = excluded.billing_cycle,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    apple_transaction_id = case when p_store = 'apple' then excluded.apple_transaction_id else public.subscriptions.apple_transaction_id end,
    apple_original_transaction_id = case when p_store = 'apple' then excluded.apple_original_transaction_id else public.subscriptions.apple_original_transaction_id end,
    apple_product_id = case when p_store = 'apple' then excluded.apple_product_id else public.subscriptions.apple_product_id end,
    google_purchase_token = case when p_store = 'google' then excluded.google_purchase_token else public.subscriptions.google_purchase_token end,
    google_product_id = case when p_store = 'google' then excluded.google_product_id else public.subscriptions.google_product_id end,
    google_base_plan_id = case when p_store = 'google' then excluded.google_base_plan_id else public.subscriptions.google_base_plan_id end,
    google_auto_renewing = case when p_store = 'google' then excluded.google_auto_renewing else public.subscriptions.google_auto_renewing end,
    pending_plan = null,
    pending_billing_cycle = null,
    pending_product_id = null,
    pending_base_plan_id = null,
    updated_at = v_now;

  update public.profiles
     set subscription_tier = p_plan, updated_at = v_now
   where id = p_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;

  return jsonb_build_object(
    'success', true,
    'period_start', v_period_start,
    'period_end', p_period_end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'credential_owned_by_another_user');
end;
$$;

revoke all on function public.apply_store_subscription(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_store_subscription(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean) to service_role;

create or replace function public.sync_pair_plus_entitlements(
  p_user_a uuid,
  p_user_b uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first uuid := least(p_user_a, p_user_b);
  v_second uuid := greatest(p_user_a, p_user_b);
  v_a_owns boolean;
  v_b_owns boolean;
  v_owner uuid;
  v_member uuid;
  v_duo public.duo_memberships%rowtype;
  v_code text;
begin
  -- This function is also invoked by a pairing trigger in the authenticated
  -- user's transaction. Direct execution remains revoked from authenticated,
  -- anon and public below; the trigger path must not depend on the caller JWT.
  perform pg_advisory_xact_lock(hashtextextended(v_first::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_second::text, 0));

  if not exists (
    select 1 from public.pairings
     where user_id = p_user_a and partner_user_id = p_user_b
  ) or not exists (
    select 1 from public.pairings
     where user_id = p_user_b and partner_user_id = p_user_a
  ) then
    return jsonb_build_object('success', false, 'error', 'not_paired');
  end if;

  v_a_owns := public.has_own_active_plus(p_user_a);
  v_b_owns := public.has_own_active_plus(p_user_b);

  if v_a_owns and not v_b_owns then
    v_owner := p_user_a; v_member := p_user_b;
  elsif v_b_owns and not v_a_owns then
    v_owner := p_user_b; v_member := p_user_a;
  else
    v_owner := null; v_member := null;
  end if;

  -- An independently paid pair needs no borrowed seat between them.
  if v_owner is null then
    update public.duo_memberships
       set member_id = null, status = 'pending', claimed_at = null
     where status = 'claimed'
       and ((owner_id = p_user_a and member_id = p_user_b)
         or (owner_id = p_user_b and member_id = p_user_a));

    update public.profiles
       set subscription_tier = case
         when id = p_user_a and v_a_owns then 'plus'
         when id = p_user_b and v_b_owns then 'plus'
         else 'free'
       end,
       updated_at = now()
     where id in (p_user_a, p_user_b);
    return jsonb_build_object('success', true, 'owner_id', null, 'member_id', null);
  end if;

  select * into v_duo
    from public.duo_memberships
   where owner_id = v_owner
   for update;

  if v_duo.id is not null and v_duo.member_id is not null and v_duo.member_id <> v_member then
    return jsonb_build_object('success', false, 'error', 'seat_already_claimed');
  end if;

  if v_duo.id is null then
    v_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
    insert into public.duo_memberships(owner_id, member_id, invite_code, status, claimed_at)
      values (v_owner, v_member, v_code, 'claimed', now());
  else
    update public.duo_memberships
       set member_id = v_member, status = 'claimed', claimed_at = now()
     where id = v_duo.id;
  end if;

  update public.profiles
     set subscription_tier = 'plus', updated_at = now()
   where id in (v_owner, v_member);

  return jsonb_build_object('success', true, 'owner_id', v_owner, 'member_id', v_member);
end;
$$;

revoke all on function public.sync_pair_plus_entitlements(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sync_pair_plus_entitlements(uuid, uuid) to service_role;

create or replace function public.release_pair_plus_entitlements(
  p_user_a uuid,
  p_user_b uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pairing DELETE triggers run with the end user's JWT role. Direct execution
  -- remains restricted by the function grants below.
  perform pg_advisory_xact_lock(hashtextextended(least(p_user_a, p_user_b)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_user_a, p_user_b)::text, 0));

  update public.duo_memberships
     set member_id = null, status = 'pending', claimed_at = null
   where (owner_id = p_user_a and member_id = p_user_b)
      or (owner_id = p_user_b and member_id = p_user_a);

  update public.profiles
     set subscription_tier = case when public.has_own_active_plus(id) then 'plus' else 'free' end,
         updated_at = now()
   where id in (p_user_a, p_user_b);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.release_pair_plus_entitlements(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_pair_plus_entitlements(uuid, uuid) to service_role;

-- Any server-side pairing creation receives the entitlement grant in the same
-- transaction, including accept_pairing_invitation and set_pairing.
create or replace function public.sync_entitlement_after_pairing_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- The reciprocal row is inserted in the same statement/RPC. A deferred
  -- constraint trigger observes it before commit and rolls back on failure.
  if exists (
    select 1 from public.pairings
     where user_id = new.partner_user_id and partner_user_id = new.user_id
  ) then
    v_result := public.sync_pair_plus_entitlements(new.user_id, new.partner_user_id);
    if coalesce((v_result->>'success')::boolean, false) is not true then
      raise exception 'pair entitlement sync failed: %', v_result;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pairings_entitlement_sync on public.pairings;
create constraint trigger pairings_entitlement_sync
after insert on public.pairings
deferrable initially deferred
for each row execute function public.sync_entitlement_after_pairing_insert();

create or replace function public.release_entitlement_after_pairing_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.release_pair_plus_entitlements(old.user_id, old.partner_user_id);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'pair entitlement release failed: %', v_result;
  end if;
  return old;
end;
$$;

drop trigger if exists pairings_entitlement_release on public.pairings;
create trigger pairings_entitlement_release
after delete on public.pairings
for each row execute function public.release_entitlement_after_pairing_delete();

create or replace function public.sync_entitlement_after_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner uuid;
  v_result jsonb;
begin
  select partner_user_id into v_partner
    from public.pairings where user_id = new.user_id;
  if v_partner is not null then
    v_result := public.sync_pair_plus_entitlements(new.user_id, v_partner);
    if coalesce((v_result->>'success')::boolean, false) is not true then
      raise exception 'subscription pair entitlement sync failed: %', v_result;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_entitlement_sync on public.subscriptions;
create constraint trigger subscriptions_entitlement_sync
after insert or update on public.subscriptions
deferrable initially deferred
for each row execute function public.sync_entitlement_after_subscription_change();

-- Recompute the owner's pair after expiry/refund. The helper preserves the
-- member's independently purchased Plus if one exists.
create or replace function public.expire_store_subscription(
  p_user_id uuid,
  p_status text,
  p_event_period_end timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_partner uuid;
  v_sync jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_status not in ('expired', 'revoked', 'on_hold', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select * into v_sub from public.subscriptions where user_id = p_user_id for update;
  if v_sub.user_id is null then
    return jsonb_build_object('success', false, 'error', 'subscription_not_found');
  end if;
  if p_event_period_end is not null
     and v_sub.current_period_end is not null
     and v_sub.current_period_end > p_event_period_end then
    return jsonb_build_object('success', true, 'stale', true);
  end if;

  update public.subscriptions
     set plan = 'free', status = p_status, updated_at = now()
   where user_id = p_user_id;
  update public.profiles
     set subscription_tier = 'free', updated_at = now()
   where id = p_user_id;

  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  if v_partner is not null then
    v_sync := public.sync_pair_plus_entitlements(p_user_id, v_partner);
    if coalesce((v_sync->>'success')::boolean, false) is not true then
      raise exception 'pair entitlement sync failed: %', v_sync;
    end if;
  end if;
  return jsonb_build_object('success', true, 'stale', false);
end;
$$;

revoke all on function public.expire_store_subscription(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.expire_store_subscription(uuid, text, timestamptz) to service_role;

-- Private, minimal invalidation event. It contains no profile or billing data.
create or replace function public.broadcast_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.subscription_tier is distinct from new.subscription_tier then
    perform realtime.send(
      jsonb_build_object('changed_at', new.updated_at),
      'entitlement_changed',
      'entitlement:' || new.id::text,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_entitlement_broadcast on public.profiles;
create trigger profiles_entitlement_broadcast
after update of subscription_tier on public.profiles
for each row execute function public.broadcast_entitlement_change();

drop policy if exists entitlement_broadcast_receive_own on realtime.messages;
create policy entitlement_broadcast_receive_own
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'entitlement:' || auth.uid()::text);

-- Reconcile historical store rows whose signed billing period has already
-- ended but whose legacy webhook left status/profile access active. The
-- subscription trigger above recomputes any paired partner in the same
-- transaction, preserving an independently active purchase on either side.
update public.subscriptions
   set plan = 'free', status = 'expired', updated_at = now()
 where current_period_end is not null
   and current_period_end <= now()
   and status in ('active', 'cancelled', 'trialing', 'grace_period')
   and (apple_product_id is not null or google_product_id is not null);

update public.profiles p
   set subscription_tier = 'free', updated_at = now()
 where p.subscription_tier <> 'free'
   and exists (
     select 1 from public.subscriptions s
      where s.user_id = p.id
        and s.status = 'expired'
        and s.current_period_end is not null
        and s.current_period_end <= now()
        and (s.apple_product_id is not null or s.google_product_id is not null)
   )
   and not public.has_own_active_plus(p.id);
