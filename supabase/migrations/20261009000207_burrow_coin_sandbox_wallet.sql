-- StoreKit sandbox purchases must never credit the spendable production wallet.
-- Existing production grants/refunds retain their implementation and signature.
create table public.burrow_sandbox_coin_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.burrow_sandbox_coin_transactions (
  store text not null check (store in ('apple','google')),
  credential text not null,
  user_id uuid references public.profiles(id) on delete set null,
  product_id text not null check (product_id in ('burrow.coin.200','burrow.coin.400','burrow.coin.1000')),
  quantity integer not null check (quantity between 1 and 100),
  refunded_quantity integer not null default 0,
  credited integer not null default 0,
  version integer not null default 0,
  signed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (store,credential),
  check (refunded_quantity between 0 and quantity)
);
alter table public.burrow_sandbox_coin_wallets enable row level security;
alter table public.burrow_sandbox_coin_transactions enable row level security;
revoke all on public.burrow_sandbox_coin_wallets,public.burrow_sandbox_coin_transactions from public,anon,authenticated;
grant all on public.burrow_sandbox_coin_wallets,public.burrow_sandbox_coin_transactions to service_role;

alter function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  rename to apply_burrow_coin_purchase_production_v1;
revoke all on function public.apply_burrow_coin_purchase_production_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  from public,anon,authenticated,service_role;

create function public.apply_burrow_coin_purchase_v1(
  p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
  p_quantity integer,p_refunded integer,p_signed_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  prior public.burrow_sandbox_coin_transactions%rowtype;
  amount integer; target integer; change integer; test_balance bigint;
begin
  if p_environment='production' then
    return public.apply_burrow_coin_purchase_production_v1(
      p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at
    ) || jsonb_build_object('environment','production');
  end if;
  amount:=case p_product_id when 'burrow.coin.200' then 200 when 'burrow.coin.400' then 400 when 'burrow.coin.1000' then 1000 end;
  if p_environment is distinct from 'sandbox' or amount is null
    or p_store is null or p_store not in ('apple','google')
    or p_user_id is null or p_quantity is null or p_quantity not between 1 and 100
    or p_refunded is null or p_refunded not between 0 and p_quantity
    or nullif(p_credential,'') is null or length(p_credential)>2000 or p_signed_at is null then
    return jsonb_build_object('error','invalid_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sandbox-coin:'||p_store||':'||p_credential,0));
  select * into prior from public.burrow_sandbox_coin_transactions
    where store=p_store and credential=p_credential for update;
  if found then
    if prior.user_id is distinct from p_user_id or prior.product_id<>p_product_id or prior.quantity<>p_quantity then
      return jsonb_build_object('error','purchase_account_conflict');
    end if;
    if p_signed_at<prior.signed_at or (p_signed_at=prior.signed_at and p_refunded<prior.refunded_quantity)
      or (p_store='google' and p_refunded<prior.refunded_quantity) then
      return jsonb_build_object('error',null,'environment','sandbox','applied',false,'delta',0,
        'credited',prior.credited,'balance',coalesce((select balance from public.burrow_sandbox_coin_wallets where user_id=p_user_id),0));
    end if;
  else
    if not exists(select 1 from public.profiles where id=p_user_id) then
      return jsonb_build_object('error','profile_not_found');
    end if;
    insert into public.burrow_sandbox_coin_transactions(store,credential,user_id,product_id,quantity,signed_at)
      values(p_store,p_credential,p_user_id,p_product_id,p_quantity,p_signed_at) returning * into prior;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sandbox-wallet:'||p_user_id::text,0));
  insert into public.burrow_sandbox_coin_wallets(user_id) values(p_user_id) on conflict do nothing;
  select balance into test_balance from public.burrow_sandbox_coin_wallets where user_id=p_user_id for update;
  target:=amount*(p_quantity-p_refunded); change:=target-prior.credited;
  if change<>0 then
    update public.burrow_sandbox_coin_wallets set balance=balance+change,version=version+1,updated_at=now()
      where user_id=p_user_id returning balance into test_balance;
  end if;
  update public.burrow_sandbox_coin_transactions
    set refunded_quantity=p_refunded,credited=target,version=version+1,signed_at=p_signed_at,updated_at=now()
    where store=p_store and credential=p_credential;
  return jsonb_build_object('error',null,'environment','sandbox','applied',change<>0,
    'delta',change,'balance',test_balance,'credited',target);
end $$;
revoke all on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  from public,anon,authenticated;
grant execute on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) to service_role;
notify pgrst,'reload schema';
