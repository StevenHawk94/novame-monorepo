-- Explicitly approved developer accounts can test spendable Home coins.
-- Everyone else still uses 207's isolated wallet. No client may self-enroll.
create table public.burrow_coin_sandbox_testers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.burrow_coin_sandbox_testers enable row level security;
revoke all on public.burrow_coin_sandbox_testers from public,anon,authenticated;
grant all on public.burrow_coin_sandbox_testers to service_role;

alter function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  rename to apply_burrow_coin_purchase_isolated_v1;
revoke all on function public.apply_burrow_coin_purchase_isolated_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  from public,anon,authenticated,service_role;

create function public.apply_burrow_coin_purchase_v1(
  p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
  p_quantity integer,p_refunded integer,p_signed_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; prior public.burrow_sandbox_coin_transactions%rowtype;
begin
  if p_environment='sandbox' then
    perform pg_advisory_xact_lock(hashtextextended('sandbox-test-mode:'||p_user_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('sandbox-coin:'||p_store||':'||p_credential,0));
    select * into prior from public.burrow_sandbox_coin_transactions where store=p_store and credential=p_credential;
    if found and (prior.user_id is distinct from p_user_id or prior.product_id is distinct from p_product_id
      or prior.quantity is distinct from p_quantity) then
      return jsonb_build_object('error','purchase_account_conflict');
    end if;
    if prior.credential is not null and (p_signed_at<prior.signed_at
      or (p_signed_at=prior.signed_at and p_refunded<prior.refunded_quantity)
      or (p_store='google' and p_refunded<prior.refunded_quantity)) then
      p_signed_at:=prior.signed_at; p_refunded:=prior.refunded_quantity;
    end if;
    -- Existing spendable sandbox receipts keep their original settlement path,
    -- including refunds, even if the tester is subsequently disabled/deleted.
    if exists(select 1 from public.burrow_coin_sandbox_testers where user_id=p_user_id and enabled)
      or exists(select 1 from public.burrow_coin_transactions where store=p_store and environment='sandbox' and credential=p_credential) then
      result:=public.apply_burrow_coin_purchase_production_v1(
        p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at);
      return result || jsonb_build_object('environment','sandbox','wallet','room');
    end if;
  end if;
  result:=public.apply_burrow_coin_purchase_isolated_v1(
    p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at);
  return result || jsonb_build_object('wallet',case when p_environment='production' then 'room' else 'sandbox' end);
end $$;
revoke all on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)
  from public,anon,authenticated;
grant execute on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz) to service_role;

-- Enrollment also settles already verified, finished test receipts exactly once
-- into Home. It does not fabricate receipts, amounts, or change environment.
create function public.set_burrow_coin_sandbox_tester_v1(p_user_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receipt public.burrow_sandbox_coin_transactions%rowtype; result jsonb; credited bigint:=0;
begin
  if p_user_id is null or p_enabled is null or not exists(select 1 from public.profiles where id=p_user_id) then
    return jsonb_build_object('error','profile_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sandbox-test-mode:'||p_user_id::text,0));
  insert into public.burrow_coin_sandbox_testers(user_id,enabled) values(p_user_id,p_enabled)
    on conflict(user_id) do update set enabled=excluded.enabled,updated_at=now();
  if p_enabled then
    for receipt in select * from public.burrow_sandbox_coin_transactions where user_id=p_user_id order by store,credential loop
      result:=public.apply_burrow_coin_purchase_v1(p_user_id,receipt.store,'sandbox',receipt.credential,
        receipt.product_id,receipt.quantity,receipt.refunded_quantity,receipt.signed_at);
      if result->>'error' is not null then raise exception 'Sandbox receipt settlement failed: %',result->>'error'; end if;
      credited:=credited+coalesce((result->>'delta')::bigint,0);
    end loop;
  end if;
  return jsonb_build_object('error',null,'enabled',p_enabled,'delta',credited,
    'balance',coalesce((select carrot_balance from public.wallets where user_id=p_user_id),0));
end $$;
revoke all on function public.set_burrow_coin_sandbox_tester_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_burrow_coin_sandbox_tester_v1(uuid,boolean) to service_role;
notify pgrst,'reload schema';
