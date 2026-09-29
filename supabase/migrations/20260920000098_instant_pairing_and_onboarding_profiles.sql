-- Pairing by a correct Burrow code is now immediate. One member's action is
-- enough: create the durable friendship and both mirrored pairing rows in one
-- transaction, while preserving the one-active-partner invariant.

alter table public.profiles
  add column if not exists onboarding_partner_name text,
  add column if not exists onboarding_partner_nickname text,
  add column if not exists onboarding_relationship_since date;

create or replace function public.pair_immediately(
  p_user_id uuid,
  p_partner_id uuid,
  p_relationship text default 'Partner',
  p_since date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_friendship_id uuid;
begin
  if p_user_id = p_partner_id then
    return jsonb_build_object('error', 'cannot_pair_self');
  end if;

  v_a := least(p_user_id, p_partner_id);
  v_b := greatest(p_user_id, p_partner_id);

  -- Serialize by both identities. This also protects simultaneous A->B and
  -- B->A submissions and attempts that share just one member.
  perform pg_advisory_xact_lock(hashtextextended(v_a::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_b::text, 0));

  if not exists (select 1 from public.profiles where id = p_user_id)
     or not exists (select 1 from public.profiles where id = p_partner_id) then
    return jsonb_build_object('error', 'profile_not_found');
  end if;
  if exists (select 1 from public.pairings where user_id = p_user_id) then
    return jsonb_build_object('error', 'already_paired');
  end if;
  if exists (select 1 from public.pairings where user_id = p_partner_id) then
    return jsonb_build_object('error', 'target_already_paired');
  end if;

  -- Retain historical accepted relationships. Any old pending row for this
  -- exact pair becomes accepted immediately instead of waiting for approval.
  insert into public.friendships (
    user_a, user_b, status, requested_by, relationship,
    relationship_since, accepted_at, created_at
  ) values (
    v_a, v_b, 'accepted', p_user_id, nullif(p_relationship, ''),
    p_since, now(), now()
  )
  on conflict (user_a, user_b) do update set
    status = 'accepted',
    requested_by = excluded.requested_by,
    relationship = coalesce(excluded.relationship, public.friendships.relationship),
    relationship_since = coalesce(excluded.relationship_since, public.friendships.relationship_since),
    accepted_at = now(),
    created_at = now()
  returning id into v_friendship_id;

  -- Retire stale approval-era requests involving either newly paired member.
  update public.friendships
     set status = 'accepted'
   where id <> v_friendship_id
     and status = 'pending'
     and accepted_at is not null
     and (user_a in (p_user_id, p_partner_id) or user_b in (p_user_id, p_partner_id));

  delete from public.friendships
   where id <> v_friendship_id
     and status = 'pending'
     and accepted_at is null
     and (user_a in (p_user_id, p_partner_id) or user_b in (p_user_id, p_partner_id));

  insert into public.pairings (
    user_id, partner_user_id, relationship, relationship_since
  ) values
    (p_user_id, p_partner_id, coalesce(nullif(p_relationship, ''), 'Partner'), p_since),
    (p_partner_id, p_user_id, coalesce(nullif(p_relationship, ''), 'Partner'), p_since);

  return jsonb_build_object('error', null, 'paired_with', p_partner_id);
end;
$$;

revoke all on function public.pair_immediately(uuid, uuid, text, date) from public;
revoke all on function public.pair_immediately(uuid, uuid, text, date) from anon;
revoke all on function public.pair_immediately(uuid, uuid, text, date) from authenticated;
grant execute on function public.pair_immediately(uuid, uuid, text, date) to service_role;
