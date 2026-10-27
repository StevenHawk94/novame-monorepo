begin;
set local lock_timeout='5s';set local statement_timeout='60s';

-- A domain is selected by a VERIFIED purchase, never by a client flag or UI.
-- Existing wallets/inventory/receipts are not moved, deleted or backfilled.
create table public.account_economic_domains(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 domain text not null check(domain in('production','sandbox')),
 fixed_at timestamptz not null default now()
);
alter table public.account_economic_domains enable row level security;
revoke all on public.account_economic_domains from public,anon,authenticated;
grant select,insert on public.account_economic_domains to service_role;

create function public.economic_domain_v1(p_user uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select domain from account_economic_domains where user_id=p_user),
  case when exists(select 1 from burrow_coin_transactions where user_id=p_user and environment='sandbox')
    or exists(select 1 from subscriptions where user_id=p_user and store_environment='sandbox')
   then 'sandbox' else 'production' end);
$$;
create function public.same_economic_domain_v1(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select p_a is not null and p_b is not null and economic_domain_v1(p_a)=economic_domain_v1(p_b);
$$;
create function public.lock_economic_account_v1(p_user uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;locked_partner uuid;begin
 select a.partner_user_id into partner from pairings a join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id where a.user_id=p_user;
 perform pg_advisory_xact_lock(hashtextextended(least(p_user,coalesce(partner,p_user))::text,0));
 perform pg_advisory_xact_lock(hashtextextended(greatest(p_user,coalesce(partner,p_user))::text,0));
 locked_partner:=lock_burrow_pair(p_user);
 if locked_partner is distinct from partner then raise serialization_failure;end if;
 return partner;
end $$;

create function public.admit_store_economic_domain_v1(p_user uuid,p_environment text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare fixed text;live_proof boolean;test_proof boolean;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_environment is null or p_environment not in('production','sandbox') then return jsonb_build_object('error','invalid_store_environment');end if;
 -- Same ordering as pair entitlement sync. Never lock a receipt then a pair.
 perform lock_economic_account_v1(p_user);
 perform pg_advisory_xact_lock(hashtextextended('economic-domain:'||p_user::text,0));
 if not exists(select 1 from profiles where id=p_user) then return jsonb_build_object('error','profile_not_found');end if;
 select domain into fixed from account_economic_domains where user_id=p_user;
 if found then
  if fixed<>p_environment then return jsonb_build_object('error',case when fixed='sandbox' then 'sandbox_account_conflict' else 'production_account_conflict' end);end if;
  return jsonb_build_object('error',null,'domain',fixed);
 end if;
 select exists(select 1 from burrow_coin_transactions where user_id=p_user and environment='production')
  or exists(select 1 from subscriptions where user_id=p_user and store_environment is distinct from 'sandbox'
   and (apple_original_transaction_id is not null or google_purchase_token is not null))
  or exists(select 1 from store_subscription_states where user_id=p_user and environment='production') into live_proof;
 select exists(select 1 from burrow_coin_transactions where user_id=p_user and environment='sandbox')
  or exists(select 1 from subscriptions where user_id=p_user and store_environment='sandbox')
  or exists(select 1 from store_subscription_states where user_id=p_user and environment='sandbox') into test_proof;
 if p_environment='sandbox' and live_proof then return jsonb_build_object('error','production_account_conflict');end if;
 if p_environment='production' and test_proof then return jsonb_build_object('error','sandbox_account_conflict');end if;
 insert into account_economic_domains(user_id,domain) values(p_user,p_environment);
 return jsonb_build_object('error',null,'domain',p_environment);
end $$;

-- Profiles are a display projection, not proof of a paid entitlement. Preserve
-- legitimate server-issued non-store trials, but store subscriptions need an
-- explicit, future expiry and a matching immutable economic domain.
create or replace function public.has_own_active_plus(p_user_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from store_subscription_states v where v.user_id=p_user_id and v.environment=economic_domain_v1(p_user_id)
  and v.snapshot->>'state' in('active','cancelled','grace_period') and (v.snapshot->>'periodEnd')::timestamptz>now())
 or exists(select 1 from subscriptions s where s.user_id=p_user_id and s.plan='plus'
  and s.status in('active','cancelled','trialing','grace_period')
  and (s.current_period_end>now() or (s.current_period_end is null and s.apple_original_transaction_id is null and s.google_purchase_token is null))
  and case when s.store_environment='sandbox' then 'sandbox' else 'production' end=economic_domain_v1(p_user_id)
  and not exists(select 1 from store_subscription_states v where v.user_id=p_user_id and v.snapshot ? 'state'));
$$;
create or replace function public.burrow_has_plus_v1(p_user uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select has_own_active_plus(p_user) or exists(select 1 from pairings a join pairings b
  on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
  where a.user_id=p_user and same_economic_domain_v1(p_user,a.partner_user_id) and has_own_active_plus(a.partner_user_id));
$$;

-- Reuse the established pair-seat state machine, with a single extra gate.
do $$declare original text;revised text;begin
 original:=pg_get_functiondef('public.sync_pair_plus_entitlements(uuid,uuid)'::regprocedure);
 revised:=replace(original,'if v_a_owns and not v_b_owns then',
  'if not public.same_economic_domain_v1(p_user_a,p_user_b) then v_owner:=null;v_member:=null; elsif v_a_owns and not v_b_owns then');
 if revised=original then raise exception 'Unexpected pair entitlement definition';end if;
 execute revised;
end $$;
create function public.refresh_economic_entitlements_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;begin
 partner:=lock_economic_account_v1(p_user);
 if partner is not null then perform sync_pair_plus_entitlements(p_user,partner);
 else update profiles set subscription_tier=case when has_own_active_plus(p_user) then 'plus' else 'free' end,updated_at=now()
  where id=p_user and subscription_tier::text is distinct from case when has_own_active_plus(p_user) then 'plus' else 'free' end;
 end if;
 return jsonb_build_object('hasPlus',burrow_has_plus_v1(p_user),'economicDomain',economic_domain_v1(p_user));
end $$;

-- Apply verified coin admission in the SAME transaction as credit. Existing
-- isolated sandbox receipts keep their original wallet; no historical refill.
alter function public.apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean)
 rename to apply_burrow_coin_purchase_pre_domain_v2;
revoke all on function public.apply_burrow_coin_purchase_pre_domain_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean) from public,anon,authenticated,service_role;
create function public.apply_burrow_coin_purchase_v2(p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
 p_quantity integer,p_refunded integer,p_signed_at timestamptz,p_allow_sandbox_room boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare admission jsonb;result jsonb;begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 -- Invalid or unowned receipts cannot select a domain.
 if p_user_id is null or p_environment is null or p_environment not in('production','sandbox') or p_allow_sandbox_room is null
  or p_store is null or p_store not in('apple','google') or nullif(p_credential,'') is null or length(p_credential)>2000
  or p_product_id is null or p_product_id not in('burrow.coin.200','burrow.coin.400','burrow.coin.1000')
  or p_quantity is null or p_quantity not between 1 and 100 or p_refunded is null or p_refunded not between 0 and p_quantity
  or p_signed_at is null or not isfinite(p_signed_at) or p_signed_at>now()+interval '5 minutes'
  then return jsonb_build_object('error','invalid_request');end if;
 perform lock_economic_account_v1(p_user_id);
 if not exists(select 1 from burrow_coin_transactions where store=p_store and environment=p_environment and credential=p_credential)
  and not exists(select 1 from burrow_sandbox_coin_transactions where store=p_store and credential=p_credential and p_environment='sandbox') then
  admission:=admit_store_economic_domain_v1(p_user_id,p_environment);
  if admission->>'error' is not null then return admission;end if;
 end if;
 result:=apply_burrow_coin_purchase_pre_domain_v2(p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at,p_environment='sandbox');
 if result->>'error' is null then perform refresh_economic_entitlements_v1(p_user_id);end if;
 return result;
end $$;

-- Database backstop for every gift path (Shop, Adventure, old protocols). An
-- exception rolls the WHOLE transaction back, including any earlier charge.
create function public.enforce_economic_transfer_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sender uuid;begin
 sender:=case when tg_table_name in('gifts','burrow_surprises') then (to_jsonb(new)->>'sender_id')::uuid else (to_jsonb(new)->>'buyer_id')::uuid end;
 if sender is distinct from new.recipient_id and not same_economic_domain_v1(sender,new.recipient_id) then
  raise exception 'economic_domain_mismatch' using errcode='23514';
 end if;
 return new;
end $$;
create trigger security_gift_domain before insert or update on public.gifts for each row execute function public.enforce_economic_transfer_v1();
create trigger security_purchase_domain before insert or update on public.catalog_purchases for each row execute function public.enforce_economic_transfer_v1();
create trigger security_surprise_domain before insert or update of sender_id,recipient_id,paid_at on public.burrow_surprises
 for each row execute function public.enforce_economic_transfer_v1();

-- New paid collaborative games cannot borrow an unlock across economic
-- domains. Completed rounds/history remain readable; free games stay social.
do $$declare original text;revised text;begin
 if to_regprocedure('public.burrow_service_offer_v1(uuid,text,text)') is null then raise exception 'Missing service offer definition';end if;
  original:=pg_get_functiondef('public.burrow_service_offer_v1(uuid,text,text)'::regprocedure);
  revised:=replace(original,'return jsonb_build_object(''price'',item.price',
   'if p_kind=''game'' and (item.price>0 or item.plus_only) and exists(select 1 from pairings a join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id where a.user_id=p_user and not same_economic_domain_v1(p_user,a.partner_user_id)) then return jsonb_build_object(''error'',''economic_domain_mismatch'');end if; return jsonb_build_object(''price'',item.price');
  if revised=original then raise exception 'Unreviewed service offer definition';end if;
  execute revised;
end $$;

-- These exact replacement shapes are from audited deployed definitions.
-- Any unknown paid-profile read aborts the migration rather than silently
-- shipping only part of the isolation. No write/notification logic is replaced.
do $$declare r record;original text;revised text;actor text;begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosrc ilike '%subscription_tier%'
  and p.proname not in('handle_new_user','broadcast_entitlement_change','apply_store_subscription_pre_security_v1',
   'sync_pair_plus_entitlements','release_pair_plus_entitlements','expire_store_subscription','refresh_economic_entitlements_v1') loop
  original:=pg_get_functiondef(r.oid);revised:=original;
  actor:=case when r.proname='purchase_catalog_item_v1' then 'p_buyer_id'
   when r.proname='complete_affection_v1' then 'p_sender_id' else 'p_user_id' end;
  revised:=regexp_replace(revised,
   'select exists\s*\(\s*select 1 from (public\.)?profiles( p)?\s+where (p\.)?id in\s*\([^)]*\)\s+and coalesce\((p\.)?subscription_tier::text,\s*''free''\)\s*<>\s*''free''\s*\)',
   'select public.burrow_has_plus_v1('||actor||')','g');
  revised:=regexp_replace(revised,
   'select exists\s*\(\s*select 1 from profiles where id in\s*\([^)]*\)\s+and subscription_tier::text\s*<>\s*''free''\s*\)',
   'select public.burrow_has_plus_v1('||actor||')','g');
  revised:=replace(revised,'select case when exists(select 1 from profiles where id in(p_user_id,p_partner_id)'||chr(10)||
   '    and coalesce(subscription_tier::text,''free'')<>''free'') then 6 else 1 end',
   'select case when public.burrow_has_plus_v1(p_user_id) then 6 else 1 end');
  revised:=regexp_replace(revised,'coalesce\(subscription_tier::text\s*<>\s*''free'',\s*false\)',
   'public.burrow_has_plus_v1('||actor||')','g');
  revised:=replace(revised,'coalesce(subscription_tier::text,''free'')<>''free''','public.burrow_has_plus_v1('||actor||')');
  revised:=replace(revised,'u.subscription_tier::text <> ''free''','public.burrow_has_plus_v1(p_user_id)');
  if revised=original then raise exception 'Unreviewed entitlement reader: %',r.proname;end if;
  if revised ~ 'subscription_tier::text\s*<>' then raise exception 'Remaining paid-profile check: %',r.proname;end if;
  execute revised;
 end loop;
end $$;

-- Manual Duo codes are legacy; accepting one still requires the CURRENT
-- reciprocal partner and the same domain, and uses the atomic seat routine.
create function public.join_current_partner_plus_v1(p_user uuid,p_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;owner uuid;begin
 partner:=lock_burrow_pair(p_user);
 select owner_id into owner from duo_memberships where invite_code=upper(trim(p_code));
 if partner is null or owner is distinct from partner then return jsonb_build_object('error','current_partner_required');end if;
 if not same_economic_domain_v1(p_user,partner) then return jsonb_build_object('error','economic_domain_mismatch');end if;
 if not has_own_active_plus(partner) then return jsonb_build_object('error','owner_inactive');end if;
 return sync_pair_plus_entitlements(p_user,partner);
end $$;

revoke all on function public.economic_domain_v1(uuid),public.same_economic_domain_v1(uuid,uuid),
 public.lock_economic_account_v1(uuid),
 public.admit_store_economic_domain_v1(uuid,text),public.refresh_economic_entitlements_v1(uuid),
 public.enforce_economic_transfer_v1(),public.join_current_partner_plus_v1(uuid,text),
 public.has_own_active_plus(uuid),public.burrow_has_plus_v1(uuid),
 public.apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.economic_domain_v1(uuid),public.same_economic_domain_v1(uuid,uuid),
 public.admit_store_economic_domain_v1(uuid,text),public.refresh_economic_entitlements_v1(uuid),
 public.join_current_partner_plus_v1(uuid,text),public.has_own_active_plus(uuid),public.burrow_has_plus_v1(uuid),
 public.apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;
