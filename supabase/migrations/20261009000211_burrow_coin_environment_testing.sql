-- Explicit server-controlled test mode: new sandbox receipts can exercise Home
-- on any fresh App account. Historical isolated purchases are NEVER backfilled.
create table public.burrow_coin_test_policy (
  singleton boolean primary key default true check(singleton),
  activated_at timestamptz not null default now()
);
insert into public.burrow_coin_test_policy(singleton) values(true);
alter table public.burrow_coin_test_policy enable row level security;
revoke all on public.burrow_coin_test_policy from public,anon,authenticated;
grant select on public.burrow_coin_test_policy to service_role;

-- Refunds/replays retain their original wallet even after changing configuration.
-- Recognize test Home accounts so they cannot silently receive live payments.
create function public.burrow_coin_wallet_mode_v1(p_user_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select case
    when exists(select 1 from burrow_coin_transactions where user_id=p_user_id and environment='sandbox')
      then case when exists(select 1 from burrow_coin_transactions where user_id=p_user_id and environment='production')
        then 'mixed' else 'sandbox' end
    when exists(select 1 from burrow_coin_transactions where user_id=p_user_id and environment='production') then 'production'
    else 'none' end;
$$;

alter function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  rename to apply_burrow_coin_purchase_legacy_v1;
revoke all on function public.apply_burrow_coin_purchase_legacy_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  from public,anon,authenticated,service_role;

create function public.apply_burrow_coin_purchase_v2(
  p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
  p_quantity integer,p_refunded integer,p_signed_at timestamptz,p_allow_sandbox_room boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; prior_room boolean; prior_isolated boolean; scope text;
begin
  if p_user_id is null or p_environment is null or p_environment not in('sandbox','production')
    or p_allow_sandbox_room is null or (p_allow_sandbox_room and p_environment<>'sandbox')
    or p_store is null or p_store not in('apple','google')
    or p_product_id is null or p_product_id not in('burrow.coin.200','burrow.coin.400','burrow.coin.1000')
    or p_quantity is null or p_quantity not between 1 and 100
    or p_refunded is null or p_refunded not between 0 and p_quantity
    or nullif(p_credential,'') is null or length(p_credential)>2000 or p_signed_at is null then
    return jsonb_build_object('error','invalid_request'); end if;
  -- Serialize environment admission per account before receipt and wallet locks.
  perform pg_advisory_xact_lock(hashtextextended('coin-wallet-scope:'||p_user_id::text,0));
  -- One receipt lock shared by automatic Home and legacy isolated routing.
  -- Without it, two owners/modes could race into different transaction tables.
  if p_environment='sandbox' then
    perform pg_advisory_xact_lock(hashtextextended('sandbox-coin:'||p_store||':'||p_credential,0));
  end if;
  scope:=burrow_coin_wallet_mode_v1(p_user_id);
  prior_room:=exists(select 1 from burrow_coin_transactions
    where store=p_store and environment=p_environment and credential=p_credential);
  prior_isolated:=p_environment='sandbox' and exists(select 1 from burrow_sandbox_coin_transactions
    where store=p_store and credential=p_credential);

  if not prior_room and p_environment='production' and scope in('sandbox','mixed') then
    return jsonb_build_object('error','sandbox_account_conflict'); end if;
  if not prior_room and not prior_isolated and p_environment='sandbox' and scope in('production','mixed')
    and (p_allow_sandbox_room or exists(select 1 from burrow_coin_sandbox_testers where user_id=p_user_id and enabled)) then
    return jsonb_build_object('error','production_account_conflict'); end if;

  if p_environment='sandbox' and p_allow_sandbox_room and not prior_room and not prior_isolated
    and p_signed_at >= (select activated_at from burrow_coin_test_policy where singleton) then
    -- Only this service-role RPC can choose the spendable test Home wallet.
    -- Receipt environment remains sandbox and its original App owner is retained.
    result:=apply_burrow_coin_purchase_production_v1(
      p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at)
      || jsonb_build_object('environment','sandbox','wallet','room');
    if result->>'error' is null then
      result:=result||jsonb_build_object('roomWallet',(
        select jsonb_build_object('balance',carrot_balance,'version',version) from wallets where user_id=p_user_id));
    end if;
    return result;
  end if;
  return apply_burrow_coin_purchase_legacy_v1(
    p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at);
end $$;

-- Old deployments and pending receipt/refund recovery use the same protections.
create function public.apply_burrow_coin_purchase_v1(
  p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
  p_quantity integer,p_refunded integer,p_signed_at timestamptz
) returns jsonb language sql security definer set search_path=public as $$
  select apply_burrow_coin_purchase_v2(p_user_id,p_store,p_environment,p_credential,p_product_id,
    p_quantity,p_refunded,p_signed_at,false);
$$;
revoke all on function public.burrow_coin_wallet_mode_v1(uuid),
  public.apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean),
  public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.burrow_coin_wallet_mode_v1(uuid),
  public.apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean),
  public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) to service_role;
notify pgrst,'reload schema';
