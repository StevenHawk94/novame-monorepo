-- Plus Journal policy:
--   * two shared AI-enhanced entries per local day across Write Freely and
--     text-bearing Tap Your Day;
--   * unlimited paid Write Freely records after that (body/icons/manual
--     memories only);
--   * one Tap Your Day slot per day, whether or not its optional note uses AI;
--   * one independent Remember Together slot whose Memory creation never uses
--     the shared two-credit allowance and never creates Connection insights.

alter table public.reflect_drafts
  add column if not exists ai_enhancement_eligible boolean not null default false;

create table if not exists public.plus_journal_ai_credits (
  reflect_id uuid primary key references public.reflects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  journal_kind text not null check (journal_kind in ('write_freely', 'tap_your_day')),
  created_at timestamptz not null default now()
);
create index if not exists plus_journal_ai_credits_user_date
  on public.plus_journal_ai_credits(user_id, local_date);
alter table public.plus_journal_ai_credits enable row level security;
drop policy if exists plus_journal_ai_credits_service on public.plus_journal_ai_credits;
create policy plus_journal_ai_credits_service on public.plus_journal_ai_credits
  for all to service_role using (true) with check (true);

create or replace function public.claim_reflect_ai_enhancement(
  p_user_id uuid,
  p_reflect_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reflects%rowtype;
  v_is_paid boolean := false;
  v_has_consent boolean := false;
  v_used integer := 0;
  v_eligible boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into r
  from public.reflects
  where id = p_reflect_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  select coalesce(subscription_tier::text <> 'free', false), ai_consent_at is not null
  into v_is_paid, v_has_consent
  from public.profiles
  where id = p_user_id;

  select count(*)::integer into v_used
  from public.plus_journal_ai_credits
  where user_id = p_user_id and local_date = r.local_date;

  if v_is_paid and v_has_consent and btrim(coalesce(r.body, '')) <> '' then
    if r.journal_kind = 'remember_together' then
      -- Independent Memory-only entitlement; no shared credit row is created.
      v_eligible := true;
    elsif r.journal_kind in ('write_freely', 'tap_your_day') then
      if exists (
        select 1 from public.plus_journal_ai_credits where reflect_id = p_reflect_id
      ) then
        v_eligible := true;
      elsif v_used < 2 then
        insert into public.plus_journal_ai_credits(reflect_id, user_id, local_date, journal_kind)
        values(p_reflect_id, p_user_id, r.local_date, r.journal_kind)
        on conflict (reflect_id) do nothing;
        v_eligible := true;
        v_used := v_used + 1;
      end if;
    end if;
  end if;

  update public.reflect_drafts
  set ai_enhancement_eligible = v_eligible
  where user_id = p_user_id
    and (saved_reflect_id = p_reflect_id or finalized_reflect_id = p_reflect_id);

  return jsonb_build_object(
    'error', null,
    'eligible', v_eligible,
    'plus_ai_used', v_used,
    'plus_ai_remaining', case when v_is_paid then greatest(0, 2 - v_used) else 0 end
  );
end;
$$;
revoke all on function public.claim_reflect_ai_enhancement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_reflect_ai_enhancement(uuid, uuid)
  to service_role;

-- The old total-of-three limit remains for Free accounts. Plus accounts can
-- continue saving body-only Write Freely entries after their AI credits end.
create or replace function public.submit_reflect(
  p_user_id uuid,
  p_prompt_id smallint,
  p_body text,
  p_local_date date,
  p_iso_week text,
  p_xp_amount integer,
  p_dimension_hits jsonb,
  p_source_kit public.kit_t default null,
  p_shared_to_friends boolean default true,
  p_mode text default 'typing'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_count integer;
  v_reflect_id uuid;
  v_new_xp bigint;
  v_is_paid boolean := false;
  v_xp_awarded integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  select coalesce(subscription_tier::text <> 'free', false) into v_is_paid
  from public.profiles where id = p_user_id;

  select count(*) into v_today_count
  from public.reflects
  where user_id = p_user_id and local_date = p_local_date;
  if not v_is_paid and v_today_count >= 3 then
    return jsonb_build_object('error', 'daily_limit_reached', 'used', v_today_count);
  end if;

  insert into public.reflects (
    user_id, prompt_id, body, local_date, source_kit, shared_to_friends, mode
  ) values (
    p_user_id, p_prompt_id, p_body, p_local_date, p_source_kit,
    coalesce(p_shared_to_friends, true), coalesce(p_mode, 'typing')
  ) returning id into v_reflect_id;

  -- Unlimited paid Write Freely must not create an unlimited Clover faucet.
  -- Preserve the previous economy ceiling of three rewarded Journals per day.
  if p_xp_amount > 0 and v_today_count < 3 then
    v_xp_awarded := p_xp_amount;
    insert into public.xp_events(user_id, source, amount, ref_id, local_date, iso_week)
    values(p_user_id, 'reflect', v_xp_awarded, v_reflect_id, p_local_date, p_iso_week);
  end if;

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'reflect_id', v_reflect_id,
    'xp_awarded', v_xp_awarded,
    'dimension_hits', '[]'::jsonb,
    'companion_xp', v_new_xp,
    'reflects_today', v_today_count + 1,
    'reflects_remaining', greatest(0, 3 - (v_today_count + 1))
  );
end;
$$;
revoke all on function public.submit_reflect(uuid,smallint,text,date,text,integer,jsonb,public.kit_t,boolean,text)
  from public, anon, authenticated;
grant execute on function public.submit_reflect(uuid,smallint,text,date,text,integer,jsonb,public.kit_t,boolean,text)
  to service_role;

create or replace function public.begin_saved_reflect(
  p_user_id uuid, p_payload jsonb, p_memories jsonb, p_xp integer, p_week text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.reflect_drafts%rowtype;
  receipt jsonb;
  staged jsonb;
  v_kind text;
  v_is_paid boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts
    where user_id = p_user_id and idempotency_key = p_payload->>'idempotency_key' for update;
  if found and (d.saved_reflect_id is not null or d.finalized_reflect_id is not null) then
    return jsonb_build_object('draft', to_jsonb(d));
  end if;
  if (p_payload->>'local_date')::date not between (now() at time zone 'UTC')::date - 1
      and (now() at time zone 'UTC')::date + 1 then
    return jsonb_build_object('error', 'invalid_local_date');
  end if;
  v_kind := case
    when p_payload->>'journal_kind' in ('write_freely','tap_your_day','remember_together')
      then p_payload->>'journal_kind'
    when nullif(p_payload->>'friend_user_id','') is not null then 'remember_together'
    when p_payload->>'mode' = 'prompt' then 'tap_your_day'
    else 'write_freely'
  end;
  select coalesce(subscription_tier::text <> 'free', false) into v_is_paid
  from public.profiles where id = p_user_id;

  if not (v_is_paid and v_kind = 'write_freely') and exists(
    select 1 from public.daily_journal_slots
    where user_id = p_user_id and local_date = (p_payload->>'local_date')::date
      and journal_kind = v_kind
  ) then
    return jsonb_build_object('error', 'journal_kind_used', 'journal_kind', v_kind);
  end if;

  if d.id is null then
    insert into public.reflect_drafts(
      user_id,idempotency_key,prompt_id,body,local_date,mode,source_kit,friend_user_id,matches,journal_kind
    ) values (
      p_user_id,p_payload->>'idempotency_key',(p_payload->>'prompt_id')::smallint,
      p_payload->>'body',(p_payload->>'local_date')::date,p_payload->>'mode',
      p_payload->>'source_kit',(p_payload->>'friend_user_id')::uuid,p_payload->'matches',v_kind
    ) returning * into d;
  else
    update public.reflect_drafts set journal_kind = v_kind where id = d.id returning * into d;
  end if;
  if d.friend_user_id is not null and not exists(
    select 1 from public.pairings where user_id = p_user_id and partner_user_id = d.friend_user_id
  ) then return jsonb_build_object('error', 'pairing_required'); end if;

  update public.reflect_drafts set friend_user_id = null where id = d.id;
  receipt := public.finalize_reflect_draft(p_user_id,d.id,'[]','[]',p_xp,p_week);
  update public.reflect_drafts set friend_user_id = d.friend_user_id where id = d.id;
  if receipt->>'error' is not null then return receipt; end if;
  update public.reflects set
    journal_kind = v_kind, shared_to_friends = false, shared_with_user_id = null
  where id = (receipt->>'reflect_id')::uuid;

  if not (v_is_paid and v_kind = 'write_freely') then
    insert into public.daily_journal_slots(user_id,local_date,journal_kind,status,draft_id,reflect_id)
    values(
      p_user_id,(p_payload->>'local_date')::date,v_kind,'in_progress',d.id,
      (receipt->>'reflect_id')::uuid
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId',m->>'itemId','text',coalesce(p_memories->>(m->>'itemId'),''),
    'source','ai','visible',true,'edited',false
  )),'[]') into staged from jsonb_array_elements(d.matches) m;
  update public.reflect_drafts set
    saved_reflect_id=(receipt->>'reflect_id')::uuid,finalized_reflect_id=null,
    save_receipt=receipt,settlement_memories=staged
  where id=d.id returning * into d;
  perform public.edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]')
      from jsonb_array_elements(staged) e));
  return jsonb_build_object('draft',to_jsonb(d));
end;
$$;
revoke all on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text)
  from public,anon,authenticated;
grant execute on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text)
  to service_role;

create or replace function public.submit_reflect_with_kind(
  p_user_id uuid,p_prompt_id smallint,p_body text,p_local_date date,p_iso_week text,
  p_xp_amount int,p_dimension_hits jsonb,p_source_kit public.kit_t default null,
  p_shared_to_friends boolean default true,p_mode text default 'typing',p_journal_kind text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt jsonb;
  v_kind text;
  v_is_paid boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  v_kind := case
    when p_journal_kind in ('write_freely','tap_your_day','remember_together') then p_journal_kind
    when p_mode='prompt' then 'tap_your_day' else 'write_freely'
  end;
  select coalesce(subscription_tier::text <> 'free', false) into v_is_paid
  from public.profiles where id = p_user_id;
  if not (v_is_paid and v_kind = 'write_freely') and exists(
    select 1 from public.daily_journal_slots
    where user_id=p_user_id and local_date=p_local_date and journal_kind=v_kind
  ) then
    return jsonb_build_object('error','journal_kind_used','journal_kind',v_kind);
  end if;
  receipt := public.submit_reflect(
    p_user_id,p_prompt_id,p_body,p_local_date,p_iso_week,p_xp_amount,
    p_dimension_hits,p_source_kit,p_shared_to_friends,p_mode
  );
  if receipt->>'error' is not null then return receipt; end if;
  update public.reflects set journal_kind=v_kind where id=(receipt->>'reflect_id')::uuid;
  if not (v_is_paid and v_kind = 'write_freely') then
    insert into public.daily_journal_slots(
      user_id,local_date,journal_kind,status,reflect_id,completed_at
    ) values(
      p_user_id,p_local_date,v_kind,'completed',(receipt->>'reflect_id')::uuid,now()
    );
  end if;
  return receipt;
end;
$$;
revoke all on function public.submit_reflect_with_kind(
  uuid,smallint,text,date,text,int,jsonb,public.kit_t,boolean,text,text
) from public,anon,authenticated;
grant execute on function public.submit_reflect_with_kind(
  uuid,smallint,text,date,text,int,jsonb,public.kit_t,boolean,text,text
) to service_role;

notify pgrst, 'reload schema';
