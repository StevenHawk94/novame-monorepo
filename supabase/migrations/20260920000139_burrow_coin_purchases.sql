-- Verified store transactions, not client-supplied currency amounts.
alter table wallets drop constraint wallets_carrot_balance_check;
alter table currency_ledger drop constraint currency_ledger_balance_after_check;
-- Signed balances represent refunded carrots already spent. Ordinary spending
-- cannot increase this debt; future earnings/purchases offset it first.
create table public.burrow_coin_transactions(
 store text not null check(store in('apple','google')),credential text not null,
 environment text not null check(environment in('sandbox','production')),
 user_id uuid references profiles(id) on delete set null,
 product_id text not null check(product_id in('burrow.coin.200','burrow.coin.400','burrow.coin.1000')),
 quantity integer not null check(quantity between 1 and 100),
 refunded_quantity integer not null default 0,
 credited integer not null default 0,
 version integer not null default 0,
 signed_at timestamptz not null,
 updated_at timestamptz not null default now(),
 primary key(store,environment,credential),check(refunded_quantity between 0 and quantity)
);
alter table public.burrow_coin_transactions enable row level security;
revoke all on public.burrow_coin_transactions from public,anon,authenticated;
grant all on public.burrow_coin_transactions to service_role;

create function public.apply_burrow_coin_purchase_v1(p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,p_quantity integer,p_refunded integer,p_signed_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior burrow_coin_transactions%rowtype; amount integer; target integer; change integer; balance integer; ver integer;
begin
 amount:=case p_product_id when 'burrow.coin.200' then 200 when 'burrow.coin.400' then 400 when 'burrow.coin.1000' then 1000 end;
 if amount is null or p_store not in('apple','google') or p_store is null or p_environment not in('sandbox','production') or p_environment is null
   or p_quantity is null or p_quantity not between 1 and 100 or p_refunded is null or p_refunded not between 0 and p_quantity
   or nullif(p_credential,'') is null or length(p_credential)>2000 or p_signed_at is null then return jsonb_build_object('error','invalid_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('coin:'||p_store||':'||p_environment||':'||p_credential,0));
 select * into prior from burrow_coin_transactions where store=p_store and environment=p_environment and credential=p_credential for update;
 if found then
   if prior.user_id is distinct from p_user_id or prior.product_id<>p_product_id or prior.quantity<>p_quantity then return jsonb_build_object('error','purchase_account_conflict'); end if;
   -- Refunds win ties. Older receipts must never restore refunded currency.
   if p_signed_at<prior.signed_at or (p_signed_at=prior.signed_at and p_refunded<prior.refunded_quantity)
     or (p_store='google' and p_refunded<prior.refunded_quantity) then
     return jsonb_build_object('error',null,'applied',false,'credited',prior.credited);
   end if;
 else
   if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found'); end if;
   insert into burrow_coin_transactions(store,environment,credential,user_id,product_id,quantity,signed_at)
   values(p_store,p_environment,p_credential,p_user_id,p_product_id,p_quantity,p_signed_at) returning * into prior;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_user_id::text,0));
 insert into wallets(user_id) values(p_user_id) on conflict do nothing;
 select carrot_balance into balance from wallets where user_id=p_user_id for update;
 target:=amount*(p_quantity-p_refunded);change:=target-prior.credited;ver:=prior.version+1;
 if change<>0 then
   update wallets set carrot_balance=carrot_balance+change,version=version+1,updated_at=now() where user_id=p_user_id returning carrot_balance into balance;
   insert into currency_ledger(user_id,requested_delta,delta,balance_after,reason,reference_type,reference_id,idempotency_key)
     values(p_user_id,change,change,balance,case when change>0 then 'coin_purchase' else 'coin_refund' end,'store_transaction',
       p_store||':'||p_environment||':'||p_credential,'coin:'||p_store||':'||p_environment||':'||p_credential||':'||ver);
 end if;
 update burrow_coin_transactions set refunded_quantity=p_refunded,credited=target,version=ver,signed_at=p_signed_at,updated_at=now()
   where store=p_store and environment=p_environment and credential=p_credential;
 return jsonb_build_object('error',null,'applied',change<>0,'delta',change,'balance',balance,'credited',target);
end $$;
revoke all on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) to service_role;
create or replace function public.change_carrot_balance_v1(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_next integer;
  v_applied integer;
  v_existing public.currency_ledger%rowtype;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta::bigint)>99999 or nullif(trim(p_reason), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('error', 'profile_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user_id::text, 0));

  select * into v_existing
  from public.currency_ledger
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.requested_delta<>p_delta or v_existing.reason<>trim(p_reason)
      or v_existing.reference_type is distinct from nullif(trim(p_reference_type),'')
      or v_existing.reference_id is distinct from nullif(trim(p_reference_id),'') then
      return jsonb_build_object('error','idempotency_conflict');
    end if;
    return jsonb_build_object(
      'error', null,
      'applied', false,
      'delta', 0,
      'balance', (select carrot_balance from public.wallets where user_id=p_user_id)
    );
  end if;

  insert into public.wallets(user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select carrot_balance into v_current
  from public.wallets where user_id = p_user_id for update;

  if p_delta < 0 and v_current::bigint + p_delta < 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', v_current);
  end if;

  v_next := case when p_delta>0 then greatest(v_current,least(99999,v_current::bigint+p_delta)) else v_current::bigint+p_delta end;
  v_applied := v_next - v_current;

  update public.wallets
  set carrot_balance = v_next, version = version + 1, updated_at = now()
  where user_id = p_user_id;

  insert into public.currency_ledger(
    user_id, requested_delta, delta, balance_after, reason,
    reference_type, reference_id, idempotency_key
  ) values (
    p_user_id, p_delta, v_applied, v_next, trim(p_reason),
    nullif(trim(p_reference_type), ''), nullif(trim(p_reference_id), ''),
    trim(p_idempotency_key)
  );

  return jsonb_build_object(
    'error', null, 'applied', true, 'delta', v_applied, 'balance', v_next
  );
end;
$$;
notify pgrst,'reload schema';
