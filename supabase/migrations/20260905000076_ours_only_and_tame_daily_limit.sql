-- Remember Together belongs only to the pair's Ours collection. The durable
-- settlement pipeline intentionally keeps item_memories as its editable source
-- of truth, so collection reads exclude reflects addressed to a partner rather
-- than duplicating those rows into Mine/Theirs.

create or replace function public.get_personal_memory_items(
  p_owner_user_id uuid,
  p_limit integer default 101,
  p_before_first_seen_at timestamptz default null,
  p_before_item_id text default null
) returns table (item_id text, count integer, first_seen_at timestamptz)
language sql stable security definer set search_path = public
as $$
  with personal_memories as (
    select m.reflect_id, m.item_id, min(m.created_at) as created_at
    from public.item_memories m
    join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
    where m.user_id = p_owner_user_id
      and r.shared_with_user_id is null
      and not exists (
        select 1 from public.reflect_drafts d
        where d.saved_reflect_id = r.id and d.friend_user_id is not null
      )
      and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
    group by m.reflect_id, m.item_id
  ), grouped as (
    select pm.item_id, count(*)::integer as count, min(pm.created_at) as first_seen_at
    from personal_memories pm group by pm.item_id
  )
  select g.item_id, g.count, g.first_seen_at
  from grouped g
  where p_before_first_seen_at is null
     or g.first_seen_at < p_before_first_seen_at
     or (p_before_item_id is not null and g.first_seen_at = p_before_first_seen_at and g.item_id < p_before_item_id)
  order by g.first_seen_at desc, g.item_id desc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

revoke all on function public.get_personal_memory_items(uuid, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_personal_memory_items(uuid, integer, timestamptz, text)
  to service_role;

create or replace function public.get_personal_item_memories(
  p_owner_user_id uuid,
  p_item_id text,
  p_limit integer default 51,
  p_before_created_at timestamptz default null,
  p_before_memory_id uuid default null
) returns table (
  id uuid, item_id text, reflect_id uuid, raw_excerpt text, refined_desc text,
  description text, memory_source text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select d.id, d.item_id, d.reflect_id, d.raw_excerpt, d.refined_desc,
    d.description, d.memory_source, d.created_at
  from (
    select distinct on (m.reflect_id, m.item_id)
      m.id, m.item_id, m.reflect_id, m.raw_excerpt, m.refined_desc,
      m.description, m.memory_source, m.created_at
    from public.item_memories m
    join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
    where m.user_id = p_owner_user_id and m.item_id = p_item_id
      and r.shared_with_user_id is null
      and not exists (
        select 1 from public.reflect_drafts draft
        where draft.saved_reflect_id = r.id and draft.friend_user_id is not null
      )
      and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
    order by m.reflect_id, m.item_id, m.created_at desc, m.id desc
  ) d
  where p_before_created_at is null
     or d.created_at < p_before_created_at
     or (p_before_memory_id is not null and d.created_at = p_before_created_at and d.id < p_before_memory_id)
  order by d.created_at desc, d.id desc
  limit least(greatest(coalesce(p_limit, 51), 1), 101);
$$;

revoke all on function public.get_personal_item_memories(uuid, text, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_personal_item_memories(uuid, text, integer, timestamptz, uuid)
  to service_role;

create or replace function public.get_visible_partner_memory_items(
  p_owner_user_id uuid,
  p_require_reflect_share boolean default true,
  p_limit integer default 101,
  p_before_first_seen_at timestamptz default null,
  p_before_item_id text default null
) returns table (item_id text, count integer, first_seen_at timestamptz)
language sql stable security definer set search_path = public
as $$
  with visible_memories as (
    select m.reflect_id, m.item_id, min(m.created_at) as created_at
    from public.item_memories m
    join public.reflect_items ri
      on ri.reflect_id = m.reflect_id and ri.user_id = m.user_id and ri.item_id = m.item_id
    join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
    where m.user_id = p_owner_user_id
      and r.shared_with_user_id is null
      and not exists (
        select 1 from public.reflect_drafts d
        where d.saved_reflect_id = r.id and d.friend_user_id is not null
      )
      and ri.visible_to_paired = true
      and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
      and (not coalesce(p_require_reflect_share, true) or coalesce(r.shared_to_friends, true) = true)
    group by m.reflect_id, m.item_id
  ), grouped as (
    select vm.item_id, count(*)::integer as count, min(vm.created_at) as first_seen_at
    from visible_memories vm group by vm.item_id
  )
  select g.item_id, g.count, g.first_seen_at
  from grouped g
  where p_before_first_seen_at is null
     or g.first_seen_at < p_before_first_seen_at
     or (p_before_item_id is not null and g.first_seen_at = p_before_first_seen_at and g.item_id < p_before_item_id)
  order by g.first_seen_at desc, g.item_id desc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

create or replace function public.get_visible_partner_item_memories(
  p_owner_user_id uuid,
  p_item_id text,
  p_require_reflect_share boolean default true,
  p_limit integer default 51,
  p_before_created_at timestamptz default null,
  p_before_memory_id uuid default null
) returns table (
  id uuid, item_id text, reflect_id uuid, raw_excerpt text, refined_desc text,
  description text, memory_source text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select d.id, d.item_id, d.reflect_id, d.raw_excerpt, d.refined_desc,
    d.description, d.memory_source, d.created_at
  from (
    select distinct on (m.reflect_id, m.item_id)
      m.id, m.item_id, m.reflect_id, m.raw_excerpt, m.refined_desc,
      m.description, m.memory_source, m.created_at
    from public.item_memories m
    join public.reflect_items ri
      on ri.reflect_id = m.reflect_id and ri.user_id = m.user_id and ri.item_id = m.item_id
    join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
    where m.user_id = p_owner_user_id and m.item_id = p_item_id
      and r.shared_with_user_id is null
      and not exists (
        select 1 from public.reflect_drafts draft
        where draft.saved_reflect_id = r.id and draft.friend_user_id is not null
      )
      and ri.visible_to_paired = true
      and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
      and (not coalesce(p_require_reflect_share, true) or coalesce(r.shared_to_friends, true) = true)
    order by m.reflect_id, m.item_id, m.created_at desc, m.id desc
  ) d
  where p_before_created_at is null
     or d.created_at < p_before_created_at
     or (p_before_memory_id is not null and d.created_at = p_before_created_at and d.id < p_before_memory_id)
  order by d.created_at desc, d.id desc
  limit least(greatest(coalesce(p_limit, 51), 1), 101);
$$;

-- Every account may tame at most two distinct monsters per local day. Keep the
-- checks in the same user-scoped transaction as rewards so concurrent taps or
-- retries cannot exceed the cap or double-tame one monster.
create or replace function public.submit_tame_enemy(
  p_user_id uuid, p_period_key text, p_local_date date, p_iso_week text,
  p_xp_amount int, p_payload jsonb, p_battle_points int, p_base int, p_reward int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_submit jsonb;
  v_milestone jsonb;
  v_monster_id text := nullif(p_payload->>'monster_id', '');
  v_tames_today integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if v_monster_id is null then return jsonb_build_object('error', 'invalid_monster'); end if;

  select count(*)::integer into v_tames_today
  from public.kit_completions
  where user_id = p_user_id and kit = 'tame_enemy' and local_date = p_local_date;
  if v_tames_today >= 2 then
    return jsonb_build_object('error', 'daily_limit_reached', 'tames_today', v_tames_today, 'daily_limit', 2);
  end if;
  if exists (
    select 1 from public.kit_completions
    where user_id = p_user_id and kit = 'tame_enemy' and local_date = p_local_date
      and payload->>'monster_id' = v_monster_id
  ) then
    return jsonb_build_object('error', 'already_done', 'tames_today', v_tames_today, 'daily_limit', 2);
  end if;

  v_submit := public.submit_kit(
    p_user_id, 'tame_enemy'::public.kit_t, 'tame_enemy'::public.xp_source,
    p_local_date::text || ':' || v_monster_id, p_local_date, p_iso_week,
    p_xp_amount, '[]'::jsonb, p_payload
  );
  if v_submit->>'error' is not null then return v_submit; end if;
  v_milestone := public.record_monster_tame_points(
    p_user_id, v_monster_id, p_battle_points, p_local_date, p_iso_week, p_base, p_reward
  );
  if v_milestone->>'error' is not null then
    raise exception 'tame_enemy_reward_failed: %', v_milestone->>'error';
  end if;

  return v_submit || jsonb_build_object(
    'progress_scope', 'monster', 'battle_points', greatest(0, p_battle_points),
    'battle_total_points', v_milestone->'points', 'milestone_bonus', v_milestone->'bonus_awarded',
    'milestones_crossed', v_milestone->'milestones_crossed',
    'tames_today', v_tames_today + 1, 'daily_limit', 2
  );
end;
$$;

revoke all on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int)
  from public, anon, authenticated;
grant execute on function public.submit_tame_enemy(uuid, text, date, text, int, jsonb, int, int, int)
  to service_role;

notify pgrst, 'reload schema';
