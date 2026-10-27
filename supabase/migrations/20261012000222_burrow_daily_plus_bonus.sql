-- A daily login is now an explicit Home claim, not a bootstrap side effect.
-- Reuse the historical key/reason so today's old automatic grants stay consumed.
begin;
do $$
declare signature text; original text; replacement text;
begin
  foreach signature in array array['public.burrow_bootstrap_core_v1(uuid)','public.solo_burrow_initialize_v1(uuid)'] loop
    original := pg_get_functiondef(signature::regprocedure);
    replacement := regexp_replace(original,
      'if paid then perform change_carrot_balance_v1\(p_user_id,50,''plus_daily_login'',null,null,[[:space:]]*''plus-login:''\|\|(today|local_day)::text\); end if;',
      '-- Daily Plus coins are awarded only by claim_daily_plus_bonus_v1.');
    if replacement = original then raise exception 'Automatic Plus grant not found in %; abort release', signature; end if;
    execute replacement;
  end loop;
end $$;

create or replace function public.daily_plus_bonus_state_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; zone text; local_day date; eligible boolean;
begin
  if not exists(select 1 from profiles where id=p_user_id) then return jsonb_build_object('error','profile_not_found'); end if;
  partner := lock_burrow_pair(p_user_id);
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  local_day := (now() at time zone zone)::date;
  -- Preserve the app's existing reciprocal-pair Plus entitlement.
  select exists(select 1 from profiles where id in(p_user_id,partner)
    and coalesce(subscription_tier::text,'free')<>'free') into eligible;
  return jsonb_build_object('error',null,'eligible',eligible,'amount',50,'localDate',local_day,
    'key','plus-login:'||local_day::text,'claimed',exists(select 1 from currency_ledger
      where user_id=p_user_id and idempotency_key='plus-login:'||local_day::text));
end $$;

create or replace function public.claim_daily_plus_bonus_v1(p_user_id uuid,p_local_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare bonus jsonb; receipt jsonb;
begin
  bonus := daily_plus_bonus_state_v1(p_user_id);
  if bonus->>'error' is not null then return bonus; end if;
  if (bonus->>'eligible')::boolean is not true then return jsonb_build_object('error','plus_required'); end if;
  if p_local_date is null or p_local_date is distinct from (bonus->>'localDate')::date then
    return jsonb_build_object('error','day_changed'); end if;
  -- The wallet lock and unique ledger key serialize double taps/two devices.
  receipt := change_carrot_balance_v1(p_user_id,50,'plus_daily_login',null,null,bonus->>'key');
  if receipt->>'error' is not null then return receipt; end if;
  return receipt || jsonb_build_object('reward',coalesce((receipt->>'delta')::integer,0),
    'coinReward',jsonb_build_object('key',bonus->>'key','amount',coalesce((receipt->>'delta')::integer,0)),
    'coinState',burrow_reward_wallet_state_v1(p_user_id),
    'dailyPlusBonus',bonus||jsonb_build_object('claimed',true));
end $$;
revoke all on function public.daily_plus_bonus_state_v1(uuid),public.claim_daily_plus_bonus_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.daily_plus_bonus_state_v1(uuid),public.claim_daily_plus_bonus_v1(uuid,date) to service_role;
notify pgrst,'reload schema';
commit;
