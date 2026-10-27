-- New sandbox tests may credit Home only for enrolled developers. Existing
-- isolated receipts stay isolated forever: no enrollment/replay backfill.
create or replace function public.apply_burrow_coin_purchase_v1(
  p_user_id uuid,p_store text,p_environment text,p_credential text,p_product_id text,
  p_quantity integer,p_refunded integer,p_signed_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; prior public.burrow_sandbox_coin_transactions%rowtype; room_mode boolean:=false;
begin
  if p_environment='sandbox' then
    perform pg_advisory_xact_lock(hashtextextended('sandbox-test-mode:'||p_user_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('sandbox-coin:'||p_store||':'||p_credential,0));
    select * into prior from public.burrow_sandbox_coin_transactions where store=p_store and credential=p_credential;
    if found and (prior.user_id is distinct from p_user_id or prior.product_id is distinct from p_product_id
      or prior.quantity is distinct from p_quantity) then
      return jsonb_build_object('error','purchase_account_conflict');
    end if;
    room_mode:=exists(select 1 from public.burrow_coin_transactions
      where store=p_store and environment='sandbox' and credential=p_credential)
      or (prior.credential is null and exists(select 1 from public.burrow_coin_sandbox_testers
        where user_id=p_user_id and enabled and p_signed_at>=updated_at));
    if room_mode then
      result:=public.apply_burrow_coin_purchase_production_v1(
        p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at)
        || jsonb_build_object('environment','sandbox','wallet','room');
    end if;
  end if;
  if not room_mode then
    result:=public.apply_burrow_coin_purchase_isolated_v1(
      p_user_id,p_store,p_environment,p_credential,p_product_id,p_quantity,p_refunded,p_signed_at)
      || jsonb_build_object('wallet',case when p_environment='production' then 'room' else 'sandbox' end);
  end if;
  -- The wallet lock is still held inside this RPC: return the exact committed
  -- versioned balance, so Home can update without a full bootstrap round-trip.
  if result->>'error' is null and result->>'wallet'='room' then
    result:=result || jsonb_build_object('roomWallet',(
      select jsonb_build_object('balance',carrot_balance,'version',version) from public.wallets where user_id=p_user_id));
  end if;
  return result;
end $$;

create or replace function public.set_burrow_coin_sandbox_tester_v1(p_user_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_user_id is null or p_enabled is null or not exists(select 1 from public.profiles where id=p_user_id) then
    return jsonb_build_object('error','profile_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sandbox-test-mode:'||p_user_id::text,0));
  insert into public.burrow_coin_sandbox_testers(user_id,enabled) values(p_user_id,p_enabled)
    on conflict(user_id) do update set enabled=excluded.enabled,
      updated_at=case when burrow_coin_sandbox_testers.enabled is distinct from excluded.enabled
        then now() else burrow_coin_sandbox_testers.updated_at end;
  return jsonb_build_object('error',null,'enabled',p_enabled,'delta',0,
    'balance',coalesce((select carrot_balance from public.wallets where user_id=p_user_id),0));
end $$;
revoke all on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz),
  public.set_burrow_coin_sandbox_tester_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz),
  public.set_burrow_coin_sandbox_tester_v1(uuid,boolean) to service_role;
notify pgrst,'reload schema';
