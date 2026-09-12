-- Phase 1 of the retired-v1 cleanup: stop every remaining write before data
-- removal. This migration is intentionally non-destructive and can be safely
-- deployed ahead of the final DROP migration.

set lock_timeout = '5s';
set statement_timeout = '120s';

-- Stop legacy jobs that write only to retired systems. Dynamic SQL keeps local
-- environments without pg_cron compatible.
do $$
declare
  v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in execute $query$
      select jobid
      from cron.job
      where command ~* '(wisdoms|wisdom_cards|weekly_reports|daily_tasks|seek_questions|gem_events|user_gems|character_data)'
    $query$
    loop
      execute 'select cron.unschedule($1)' using v_job.jobid;
    end loop;
  end if;
end
$$;

-- Auth-user provisioning now writes current profile fields only. The
-- Companion row remains an onboarding concern because it backs Clovers.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (
    id, email, display_name, is_default_avatar, subscription_tier
  ) values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    true,
    'free'
  )
  on conflict (id) do update set
    email = coalesce(nullif(new.email, ''), profiles.email),
    display_name = coalesce(nullif(profiles.display_name, ''), excluded.display_name);
  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- Preserve installed-client RPC signatures while retiring Growth Gems.
-- p_dimension_hits / p_gem_hits are accepted and intentionally ignored.
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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  select count(*) into v_today_count
  from public.reflects
  where user_id = p_user_id and local_date = p_local_date;
  if v_today_count >= 3 then
    return jsonb_build_object('error', 'daily_limit_reached', 'used', v_today_count);
  end if;

  insert into public.reflects (
    user_id, prompt_id, body, local_date, source_kit, shared_to_friends, mode
  ) values (
    p_user_id, p_prompt_id, p_body, p_local_date, p_source_kit,
    coalesce(p_shared_to_friends, true), coalesce(p_mode, 'typing')
  )
  returning id into v_reflect_id;

  if p_xp_amount > 0 then
    insert into public.xp_events (
      user_id, source, amount, ref_id, local_date, iso_week
    ) values (
      p_user_id, 'reflect', p_xp_amount, v_reflect_id, p_local_date, p_iso_week
    );
  end if;

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events
  where user_id = p_user_id;

  update public.companions
  set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'reflect_id', v_reflect_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'dimension_hits', '[]'::jsonb,
    'companion_xp', v_new_xp,
    'reflects_today', v_today_count + 1,
    'reflects_remaining', 3 - (v_today_count + 1)
  );
end;
$$;

revoke all on function public.submit_reflect(uuid,smallint,text,date,text,integer,jsonb,public.kit_t,boolean,text)
  from public, anon, authenticated;
grant execute on function public.submit_reflect(uuid,smallint,text,date,text,integer,jsonb,public.kit_t,boolean,text)
  to service_role;

create or replace function public.submit_kit(
  p_user_id uuid,
  p_kit public.kit_t,
  p_source public.xp_source,
  p_period_key text,
  p_local_date date,
  p_iso_week text,
  p_xp_amount integer,
  p_gem_hits jsonb,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_id uuid;
  v_new_xp bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  insert into public.kit_completions (
    user_id, kit, period_key, payload, local_date
  ) values (
    p_user_id, p_kit, p_period_key, p_payload, p_local_date
  )
  on conflict (user_id, kit, period_key) do nothing
  returning id into v_completion_id;

  if v_completion_id is null then
    return jsonb_build_object('error', 'already_done_this_period');
  end if;

  if p_xp_amount > 0 then
    insert into public.xp_events (
      user_id, source, amount, ref_id, local_date, iso_week
    ) values (
      p_user_id, p_source, p_xp_amount, v_completion_id, p_local_date, p_iso_week
    );
  end if;

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events
  where user_id = p_user_id;

  update public.companions
  set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'completion_id', v_completion_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'gem_hits', '[]'::jsonb,
    'companion_xp', least(v_new_xp, 99999)
  );
end;
$$;

revoke all on function public.submit_kit(uuid,public.kit_t,public.xp_source,text,date,text,integer,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_kit(uuid,public.kit_t,public.xp_source,text,date,text,integer,jsonb,jsonb)
  to service_role;

create or replace function public.submit_true_north(
  p_user_id uuid,
  p_period_key text,
  p_local_date date,
  p_iso_week text,
  p_xp_amount integer,
  p_gem_hits jsonb,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_completed_at timestamptz;
  v_next_available_at timestamptz;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select created_at into v_last_completed_at
  from public.kit_completions
  where user_id = p_user_id and kit = 'true_north'
  order by created_at desc
  limit 1;

  if v_last_completed_at is not null then
    v_next_available_at := v_last_completed_at + interval '7 days';
    if v_next_available_at > now() then
      return jsonb_build_object(
        'error', 'already_done_this_period',
        'next_available_at', v_next_available_at
      );
    end if;
  end if;

  v_result := public.submit_kit(
    p_user_id,
    'true_north'::public.kit_t,
    'true_north'::public.xp_source,
    p_period_key,
    p_local_date,
    p_iso_week,
    p_xp_amount,
    '[]'::jsonb,
    p_payload
  );

  if coalesce(v_result->>'error', '') = '' then
    v_result := v_result || jsonb_build_object(
      'next_available_at', now() + interval '7 days'
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.submit_true_north(uuid,text,date,text,integer,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_true_north(uuid,text,date,text,integer,jsonb,jsonb)
  to service_role;
