-- Restore the row-counting behavior introduced by migration 71.
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
    select m.item_id, m.created_at
    from public.item_memories m
    join public.reflect_items ri
      on ri.reflect_id = m.reflect_id and ri.user_id = m.user_id and ri.item_id = m.item_id
    join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
    where m.user_id = p_owner_user_id
      and ri.visible_to_paired = true
      and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
      and (not coalesce(p_require_reflect_share, true) or coalesce(r.shared_to_friends, true) = true)
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

revoke all on function public.get_visible_partner_memory_items(uuid, boolean, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_visible_partner_memory_items(uuid, boolean, integer, timestamptz, text)
  to service_role;

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
  select m.id, m.item_id, m.reflect_id, m.raw_excerpt, m.refined_desc,
    m.description, m.memory_source, m.created_at
  from public.item_memories m
  join public.reflect_items ri
    on ri.reflect_id = m.reflect_id and ri.user_id = m.user_id and ri.item_id = m.item_id
  join public.reflects r on r.id = m.reflect_id and r.user_id = m.user_id
  where m.user_id = p_owner_user_id and m.item_id = p_item_id
    and ri.visible_to_paired = true
    and coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.refined_desc), ''), nullif(btrim(m.raw_excerpt), '')) is not null
    and (not coalesce(p_require_reflect_share, true) or coalesce(r.shared_to_friends, true) = true)
    and (
      p_before_created_at is null
      or m.created_at < p_before_created_at
      or (p_before_memory_id is not null and m.created_at = p_before_created_at and m.id < p_before_memory_id)
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 51), 1), 101);
$$;

revoke all on function public.get_visible_partner_item_memories(uuid, text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_visible_partner_item_memories(uuid, text, boolean, integer, timestamptz, uuid)
  to service_role;
