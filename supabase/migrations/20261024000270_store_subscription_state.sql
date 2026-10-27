begin;
set local lock_timeout='5s';set local statement_timeout='60s';

-- Additive state; never revoke existing users merely by deploying a migration.
create table public.store_subscription_states(
 store text not null check(store in('apple','google')),environment text not null check(environment in('production','sandbox')),
 credential text not null,user_id uuid references auth.users(id) on delete set null,
 snapshot jsonb not null,observed_at timestamptz not null,event_at timestamptz not null,
 next_check_at timestamptz not null default now()+interval '1 hour',
 lease_id uuid,lease_until timestamptz,
 primary key(store,environment,credential)
);
alter table public.store_subscription_states enable row level security;
revoke all on public.store_subscription_states from public,anon,authenticated;
grant all on public.store_subscription_states to service_role;

-- Retain a non-PII receipt tombstone after deletion. A store credential must
-- never become claimable by another App account just because its owner left.
alter table public.store_credential_bindings drop constraint store_credential_bindings_user_id_fkey;
alter table public.store_credential_bindings alter column user_id drop not null;
alter table public.store_credential_bindings add constraint store_credential_bindings_user_id_fkey
 foreign key(user_id) references auth.users(id) on delete set null;

alter function public.apply_store_subscription(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,boolean)
 rename to apply_store_subscription_pre_security_v1;
revoke all on function public.apply_store_subscription_pre_security_v1(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,boolean)
 from public,anon,authenticated,service_role;

create function public.reconcile_store_subscription_v3(p_user uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text:=p_snapshot->>'store';env text:=p_snapshot->>'environment';v_credential text:=p_snapshot->>'credential';
 state text:=p_snapshot->>'state';product text:=p_snapshot->>'productId';period_end timestamptz;
 observed timestamptz;event_time timestamptz;prior public.store_subscription_states%rowtype;
 result jsonb;owner uuid;existing public.subscriptions%rowtype;partner uuid;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_user is null or kind is null or kind not in('apple','google') or env is null or env not in('production','sandbox')
  or nullif(v_credential,'') is null or length(v_credential)>12000
  or state is null or state not in('active','cancelled','grace_period','expired','revoked','on_hold','paused')
  or product is null or product not in('novame.plus.monthly','novame.plus.yearly','novame.plusduo.monthly','novame.plusduo.yearly')
  then return jsonb_build_object('error','invalid_store_snapshot');end if;
 begin
  period_end:=(p_snapshot->>'periodEnd')::timestamptz;observed:=(p_snapshot->>'observedAt')::timestamptz;event_time:=(p_snapshot->>'eventAt')::timestamptz;
 exception when others then return jsonb_build_object('error','invalid_store_snapshot');end;
 if period_end is null or not isfinite(period_end) or observed is null or not isfinite(observed)
  or observed>now()+interval '10 seconds' or observed<now()-interval '10 minutes'
  or event_time is null or not isfinite(event_time) or event_time>now()+interval '5 minutes'
  or (state in('active','cancelled','grace_period') and period_end<=now())
  then return jsonb_build_object('error','invalid_store_snapshot');end if;
 select partner_user_id into partner from public.pairings where user_id=p_user;
 perform pg_advisory_xact_lock(hashtextextended(least(p_user,coalesce(partner,p_user))::text,0));
 perform pg_advisory_xact_lock(hashtextextended(greatest(p_user,coalesce(partner,p_user))::text,0));
 perform pg_advisory_xact_lock(hashtextextended('store-state:'||kind||':'||env||':'||v_credential,0));
 if not exists(select 1 from public.profiles where id=p_user) then return jsonb_build_object('error','profile_not_found');end if;
 select * into prior from public.store_subscription_states s where s.store=kind and s.environment=env and s.credential=v_credential for update;
 if found and prior.user_id is distinct from p_user then return jsonb_build_object('error','purchase_account_conflict');end if;
 if found and (observed<prior.observed_at or event_time<prior.event_at) then
  return jsonb_build_object('success',true,'stale',true,'tier',case when public.has_own_active_plus(p_user) then 'plus' else 'free' end);
 end if;
 select user_id into owner from public.store_credential_bindings b where b.store=kind and b.credential=v_credential;
 if found and owner is distinct from p_user then return jsonb_build_object('error','purchase_account_conflict');end if;
 -- Defined by migration 271; all three security migrations form one release.
 result:=public.admit_store_economic_domain_v1(p_user,env);
 if result->>'error' is not null then return result;end if;
 select * into existing from public.subscriptions where user_id=p_user for update;
 if state in('active','cancelled','grace_period') then
  result:=public.apply_store_subscription_pre_security_v1(p_user,kind,'plus',case when product like 'novame.plusduo.%' then 'duo' else 'solo' end,
   case when product like '%.yearly' then 'yearly' else 'monthly' end,period_end,
   case when kind='apple' then p_snapshot->>'transactionId' end,case when kind='apple' then v_credential end,
   case when kind='apple' then product end,case when kind='google' then v_credential end,
   case when kind='google' then product end,case when kind='google' then p_snapshot->>'basePlanId' end,
   case when kind='google' then coalesce((p_snapshot->>'autoRenewing')::boolean,false) end);
  if result->>'success' is distinct from 'true' then return jsonb_build_object('error','purchase_account_conflict');end if;
  update public.subscriptions set status=state,store_environment=env,updated_at=now() where user_id=p_user;
 else
  -- An old credential cannot expire a later subscription from a different chain.
  if (kind='apple' and existing.apple_original_transaction_id=v_credential)
   or (kind='google' and existing.google_purchase_token=v_credential) then
   result:=public.expire_store_subscription(p_user,state,period_end);
   if result->>'success' is distinct from 'true' then return result;end if;
  end if;
 end if;
 insert into public.store_subscription_states(store,environment,credential,user_id,snapshot,observed_at,event_at,next_check_at)
 values(kind,env,v_credential,p_user,p_snapshot,observed,event_time,
  case when p_snapshot->>'acknowledgementPending'='true' then now() else least(now()+interval '1 hour',greatest(now()+interval '5 minutes',period_end)) end)
 on conflict(store,environment,credential) do update set snapshot=excluded.snapshot,observed_at=excluded.observed_at,event_at=excluded.event_at,next_check_at=excluded.next_check_at;
 perform public.refresh_economic_entitlements_v1(p_user);
 return jsonb_build_object('success',true,'tier',case when public.burrow_has_plus_v1(p_user) then 'plus' else 'free' end,
  'periodEnd',period_end,'storeEnvironment',env,'billingCycle',case when product like '%.yearly' then 'yearly' else 'monthly' end);
end $$;
revoke all on function public.reconcile_store_subscription_v3(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_store_subscription_v3(uuid,jsonb) to service_role;

-- A missed webhook is repaired without a foreground store round trip. Known
-- legacy environments are seeded lazily; unknown historical environments are
-- not guessed or reassigned during deployment.
create function public.claim_subscription_checks_v1(p_limit integer default 1)
returns setof public.store_subscription_states language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into store_subscription_states(store,environment,credential,user_id,snapshot,observed_at,event_at,next_check_at)
 select 'apple',s.store_environment,s.apple_original_transaction_id,s.user_id,
  jsonb_build_object('recovery',true,'transactionId',s.apple_transaction_id),'-infinity','-infinity',now()
 from subscriptions s where s.apple_original_transaction_id is not null and s.store_environment in('production','sandbox')
 on conflict do nothing;
 insert into store_subscription_states(store,environment,credential,user_id,snapshot,observed_at,event_at,next_check_at)
 select 'google',s.store_environment,s.google_purchase_token,s.user_id,'{"recovery":true}', '-infinity','-infinity',now()
 from subscriptions s where s.google_purchase_token is not null and s.store_environment in('production','sandbox')
 on conflict do nothing;
 return query update store_subscription_states s set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where (s.store,s.environment,s.credential) in(select j.store,j.environment,j.credential from store_subscription_states j
  where j.user_id is not null and j.next_check_at<=now() and (j.lease_until is null or j.lease_until<now())
  order by j.next_check_at limit least(greatest(p_limit,1),5) for update skip locked) returning s.*;
end $$;
create function public.complete_subscription_check_v1(p_store text,p_env text,p_credential text,p_lease uuid,p_success boolean)
returns void language sql security definer set search_path=public,pg_temp as $$
 update store_subscription_states set lease_id=null,lease_until=null,
  next_check_at=now()+case when p_success then interval '1 hour' else interval '5 minutes' end
 where store=p_store and environment=p_env and credential=p_credential and lease_id=p_lease;
$$;
revoke all on function public.claim_subscription_checks_v1(integer),public.complete_subscription_check_v1(text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_subscription_checks_v1(integer),public.complete_subscription_check_v1(text,text,text,uuid,boolean) to service_role;

-- Old API deployments fail closed until their verified-state counterpart is up.
create function public.apply_store_subscription(p_user_id uuid,p_store text,p_plan text,p_plan_type text,p_billing_cycle text,p_period_end timestamptz,
 p_apple_transaction_id text default null,p_apple_original_transaction_id text default null,p_apple_product_id text default null,
 p_google_purchase_token text default null,p_google_product_id text default null,p_google_base_plan_id text default null,p_google_auto_renewing boolean default null)
returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('success',false,'error','verified_state_required')$$;
revoke all on function public.apply_store_subscription(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.apply_store_subscription(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
