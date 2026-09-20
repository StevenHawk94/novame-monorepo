-- Quests v2: server-authoritative product-action rewards.
-- Daily claims are date-scoped; milestone claims are lifetime and cumulative.

create table if not exists public.quest_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_key text not null,
  quest_key text not null,
  quest_kind text not null check (quest_kind in ('daily','special')),
  milestone integer,
  reward integer not null check (reward in (20,30)),
  local_date date not null,
  created_at timestamptz not null default now(),
  unique(user_id, claim_key)
);

create index if not exists quest_reward_claims_user_created
  on public.quest_reward_claims(user_id, created_at desc);

alter table public.quest_reward_claims enable row level security;
drop policy if exists quest_reward_claims_read_own on public.quest_reward_claims;
create policy quest_reward_claims_read_own on public.quest_reward_claims
  for select to authenticated using (auth.uid()=user_id);
drop policy if exists quest_reward_claims_service on public.quest_reward_claims;
create policy quest_reward_claims_service on public.quest_reward_claims
  for all to service_role using (true) with check (true);

create or replace function public.get_quest_activity_counts_v2(
  p_user_id uuid, p_local_date date
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_timezone text := 'UTC';
  v_memories integer := 0; v_cases integer := 0; v_good_vibes integer := 0;
  v_small_wins integer := 0; v_tames integer := 0;
  v_scenes integer := 0; v_outfits integer := 0;
begin
  select coalesce(nullif(timezone_name,''),'UTC') into v_timezone
  from public.profiles where id=p_user_id;

  select count(*)::integer into v_memories
  from public.item_memories where user_id=p_user_id;
  select count(*)::integer into v_cases
  from public.court_sessions where status='completed' and p_user_id in (pair_low,pair_high);
  select count(*)::integer into v_small_wins
  from public.kit_completions where user_id=p_user_id and kit='quiet_wins';
  select count(*)::integer into v_tames
  from public.kit_completions where user_id=p_user_id and kit='tame_enemy';
  select count(*)::integer into v_good_vibes
  from public.good_vibes where sender_user_id=p_user_id;
  select count(*)::integer into v_scenes
  from public.cosmetic_unlocks where user_id=p_user_id and cosmetic_type='scene';
  select count(*)::integer into v_outfits
  from public.cosmetic_unlocks where user_id=p_user_id and cosmetic_type='outfit';

  return jsonb_build_object(
    'daily',jsonb_build_object(
      'reflection',exists(select 1 from public.reflects where user_id=p_user_id and local_date=p_local_date),
      'case_sync',exists(select 1 from public.court_sessions where status='completed'
        and p_user_id in (pair_low,pair_high)
        and (completed_at at time zone v_timezone)::date=p_local_date),
      'good_vibe',exists(select 1 from public.good_vibes where sender_user_id=p_user_id and sender_local_date=p_local_date),
      'tame_enemy',exists(select 1 from public.kit_completions where user_id=p_user_id and kit='tame_enemy' and local_date=p_local_date),
      'small_win',exists(select 1 from public.kit_completions where user_id=p_user_id and kit='quiet_wins' and local_date=p_local_date),
      'new_perspective',exists(select 1 from public.kit_completions where user_id=p_user_id and kit='new_lens' and local_date=p_local_date)
    ),
    'totals',jsonb_build_object(
      'memory_items',v_memories,'cases_finished',v_cases,'small_wins',v_small_wins,
      'tame_enemy',v_tames,'good_vibes',v_good_vibes,
      'scenes_unlocked',v_scenes,'outfits_unlocked',v_outfits
    )
  );
end $$;

revoke all on function public.get_quest_activity_counts_v2(uuid,date)
  from public,anon,authenticated;
grant execute on function public.get_quest_activity_counts_v2(uuid,date) to service_role;

create or replace function public.claim_quest_rewards_v2(
  p_user_id uuid, p_claims jsonb, p_local_date date, p_iso_week text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_claim jsonb; v_claim_id uuid; v_claimed jsonb := '[]'::jsonb;
  v_kind text; v_key text; v_quest text; v_milestone integer; v_reward integer;
  v_total integer := 0; v_new_xp bigint; v_spent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  perform 1 from public.companions where user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','companion_not_initialized'); end if;

  for v_claim in select value from jsonb_array_elements(coalesce(p_claims,'[]'::jsonb))
  loop
    v_kind:=v_claim->>'kind'; v_key:=nullif(v_claim->>'claimKey','');
    v_quest:=nullif(v_claim->>'questKey','');
    v_milestone:=case when v_claim->>'milestone' ~ '^[0-9]+$'
      then (v_claim->>'milestone')::integer else null end;
    if v_kind not in ('daily','special') or v_key is null or v_quest is null then continue; end if;
    if v_kind='daily' and v_key not like p_local_date::text||':%' then continue; end if;
    if v_kind='special' and coalesce(v_milestone,0)<1 then continue; end if;
    v_reward:=case when v_kind='daily' then 20 else 30 end;
    v_claim_id:=null;
    insert into public.quest_reward_claims(
      user_id,claim_key,quest_key,quest_kind,milestone,reward,local_date)
    values(p_user_id,v_key,v_quest,v_kind,v_milestone,v_reward,p_local_date)
    on conflict(user_id,claim_key) do nothing returning id into v_claim_id;
    if v_claim_id is not null then
      insert into public.xp_events(id,user_id,source,amount,ref_id,local_date,iso_week)
      values(v_claim_id,p_user_id,'quest',v_reward,v_claim_id,p_local_date,p_iso_week);
      v_total:=v_total+v_reward;
      v_claimed:=v_claimed||jsonb_build_array(v_key);
    end if;
  end loop;

  select coalesce(sum(amount),0) into v_new_xp from public.xp_events where user_id=p_user_id;
  update public.companions set xp=v_new_xp,last_opened_at=now()
  where user_id=p_user_id returning clovers_spent into v_spent;
  return jsonb_build_object(
    'error',null,'claimed',v_claimed,'clovers_earned',v_total,
    'clover_balance',greatest(0,least(v_new_xp,99999)-coalesce(v_spent,0))
  );
end $$;

revoke all on function public.claim_quest_rewards_v2(uuid,jsonb,date,text)
  from public,anon,authenticated;
grant execute on function public.claim_quest_rewards_v2(uuid,jsonb,date,text) to service_role;

notify pgrst,'reload schema';
