-- Reflect v3 (2026-07-23 需求: 1对1 陪伴定位) — pairing + per-reflect
-- visibility + entry modes.
--
-- 1. pairings — the ONE person you share daily life with. Stored as mirrored
--    rows (one per member, PK user_id), so "a user has at most one pairing"
--    is enforced by the primary key alone, while the underlying shape stays
--    "N independent 1:1 channels" for the future (the v1 cap is a UX rule,
--    not a schema rule; lifting it later = allowing more rows per user via a
--    new PK, no rebuild of the model). Built ON TOP of friendships (ruling
--    2026-07-23: adjust the existing friends system, don't replace it) — you
--    can only pair with an accepted friend.
-- 2. reflects.mode — which entry produced it: 'typing' (流程1, live match),
--    'prompt' (流程2, my-days guided taps), 'items' (流程3, manual picks).
-- 3. submit_reflect gains p_shared_to_friends / p_mode. shared_to_friends
--    already existed on reflects (default true) but was never written; the
--    per-reflect top-right toggle now drives it. The 3/day gate is unchanged
--    and counts every mode (ruling: all entries share the 3 paying slots).

-- ---- 1. pairings ------------------------------------------------------------
create table if not exists public.pairings (
  user_id         uuid primary key references public.profiles on delete cascade,
  partner_user_id uuid not null references public.profiles on delete cascade,
  created_at      timestamptz default now(),
  check (user_id <> partner_user_id)
);

alter table public.pairings enable row level security;
create policy pairings_own on public.pairings
  for select to authenticated using (auth.uid() = user_id);
create policy pairings_service on public.pairings
  for all to service_role using (true) with check (true);

-- Pair with an accepted friend. Both members must be unpaired; both mirrored
-- rows are written in this one transaction so the pairing can never be lopsided.
create or replace function public.set_pairing(
  p_user_id    uuid,
  p_partner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid; v_b uuid;
begin
  if p_user_id = p_partner_id then
    return jsonb_build_object('error', 'cannot_pair_self');
  end if;
  -- One lock ordering for any pair, so two concurrent set_pairing calls
  -- involving the same people serialize instead of double-writing.
  v_a := least(p_user_id, p_partner_id);
  v_b := greatest(p_user_id, p_partner_id);
  perform pg_advisory_xact_lock(hashtextextended(v_a::text || v_b::text, 0));

  perform 1 from public.friendships
   where user_a = v_a and user_b = v_b and status = 'accepted';
  if not found then
    return jsonb_build_object('error', 'not_friends');
  end if;

  if exists (select 1 from public.pairings where user_id = p_user_id) then
    return jsonb_build_object('error', 'already_paired');
  end if;
  if exists (select 1 from public.pairings where user_id = p_partner_id) then
    return jsonb_build_object('error', 'partner_already_paired');
  end if;

  insert into public.pairings (user_id, partner_user_id) values
    (p_user_id, p_partner_id),
    (p_partner_id, p_user_id);
  return jsonb_build_object('error', null, 'paired_with', p_partner_id);
end;
$$;

-- Unpair removes both mirrored rows; either member can end it.
create or replace function public.unset_pairing(
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select partner_user_id into v_partner
    from public.pairings where user_id = p_user_id;
  if v_partner is null then
    return jsonb_build_object('error', 'not_paired');
  end if;
  delete from public.pairings
   where user_id in (p_user_id, v_partner);
  return jsonb_build_object('error', null, 'unpaired_from', v_partner);
end;
$$;

revoke all on function public.set_pairing(uuid, uuid) from public;
revoke all on function public.set_pairing(uuid, uuid) from anon;
revoke all on function public.set_pairing(uuid, uuid) from authenticated;
grant execute on function public.set_pairing(uuid, uuid) to service_role;
revoke all on function public.unset_pairing(uuid) from public;
revoke all on function public.unset_pairing(uuid) from anon;
revoke all on function public.unset_pairing(uuid) from authenticated;
grant execute on function public.unset_pairing(uuid) to service_role;

-- ---- 2. reflects.mode -------------------------------------------------------
alter table public.reflects
  add column if not exists mode text not null default 'typing'
    check (mode in ('typing', 'prompt', 'items'));

-- ---- 3. submit_reflect v3 ---------------------------------------------------
-- Signature changes, so the old 8-arg version is dropped first (same pattern
-- as the C5 update). The deployed API keeps working through the window via
-- parameter defaults.
drop function if exists public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t);

create or replace function public.submit_reflect(
  p_user_id           uuid,
  p_prompt_id         smallint,
  p_body              text,
  p_local_date        date,
  p_iso_week          text,
  p_xp_amount         int,
  p_dimension_hits    jsonb,
  p_source_kit        kit_t default null,
  p_shared_to_friends boolean default true,
  p_mode              text default 'typing'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_count int;
  v_reflect_id  uuid;
  v_hit         jsonb;
  v_new_xp      bigint;
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

  insert into public.reflects
    (user_id, prompt_id, body, dimension_hits, local_date, source_kit, shared_to_friends, mode)
  values
    (p_user_id, p_prompt_id, p_body, p_dimension_hits, p_local_date, p_source_kit,
     coalesce(p_shared_to_friends, true), coalesce(p_mode, 'typing'))
  returning id into v_reflect_id;

  if p_xp_amount > 0 then
    insert into public.xp_events (user_id, source, amount, ref_id, local_date, iso_week)
    values (p_user_id, 'reflect', p_xp_amount, v_reflect_id, p_local_date, p_iso_week);
  end if;

  for v_hit in select * from jsonb_array_elements(p_dimension_hits)
  loop
    insert into public.gem_events (user_id, dimension, amount, source, ref_id, local_date)
    values (
      p_user_id,
      (v_hit->>'dimension')::dimension_t,
      (v_hit->>'gems')::int,
      'reflect',
      v_reflect_id,
      p_local_date
    );
    insert into public.user_gems (user_id, dimension, total)
    values (p_user_id, (v_hit->>'dimension')::dimension_t, (v_hit->>'gems')::int)
    on conflict (user_id, dimension)
      do update set total = public.user_gems.total + excluded.total;
  end loop;

  select coalesce(sum(amount), 0) into v_new_xp
  from public.xp_events where user_id = p_user_id;
  update public.companions set xp = v_new_xp, last_opened_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'error', null,
    'reflect_id', v_reflect_id,
    'xp_awarded', coalesce(p_xp_amount, 0),
    'dimension_hits', p_dimension_hits,
    'companion_xp', v_new_xp,
    'reflects_today', v_today_count + 1,
    'reflects_remaining', 3 - (v_today_count + 1)
  );
end;
$$;

revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t, boolean, text) from public;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t, boolean, text) from anon;
revoke all on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t, boolean, text) from authenticated;
grant execute on function public.submit_reflect(uuid, smallint, text, date, text, int, jsonb, kit_t, boolean, text) to service_role;
