-- Pairing invitations are valid for 48 hours and each requester may have only
-- one outgoing pending invitation. The API performs just-in-time cleanup; the
-- database constraint below is the final concurrency-safe guard.

-- Expire any legacy rows before adding the one-pending-invite constraint.
-- Re-invites reuse historical accepted rows, so restore those instead of
-- deleting relationship history.
update public.friendships
   set status = 'accepted'
 where status = 'pending'
   and accepted_at is not null
   and coalesce(created_at, '-infinity'::timestamptz) <= now() - interval '48 hours';

delete from public.friendships
 where status = 'pending'
   and accepted_at is null
   and coalesce(created_at, '-infinity'::timestamptz) <= now() - interval '48 hours';

-- Normalize any pre-existing duplicate outgoing invitations, keeping the most
-- recent one for each requester.
with ranked as (
  select id,
         row_number() over (
           partition by requested_by
           order by created_at desc nulls last, id desc
         ) as position
    from public.friendships
   where status = 'pending'
)
update public.friendships as friendship
   set status = 'accepted'
  from ranked
 where friendship.id = ranked.id
   and ranked.position > 1
   and friendship.accepted_at is not null;

with ranked as (
  select id,
         row_number() over (
           partition by requested_by
           order by created_at desc nulls last, id desc
         ) as position
    from public.friendships
   where status = 'pending'
)
delete from public.friendships as friendship
 using ranked
 where friendship.id = ranked.id
   and ranked.position > 1
   and friendship.accepted_at is null;

create unique index if not exists friendships_one_pending_outgoing
  on public.friendships (requested_by)
  where status = 'pending';

-- Keep acceptance atomic and reject an invitation whose 48-hour lease has
-- elapsed, even if an older app submits a stale Accept action.
create or replace function public.accept_pairing_invitation(
  p_user_id uuid,
  p_friendship_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_friendship public.friendships%rowtype;
  v_other uuid;
  v_first uuid;
  v_second uuid;
  v_ignored integer := 0;
  v_changed integer := 0;
begin
  select * into v_friendship
    from public.friendships
   where id = p_friendship_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if p_user_id <> v_friendship.user_a and p_user_id <> v_friendship.user_b then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  v_other := case when v_friendship.user_a = p_user_id then v_friendship.user_b else v_friendship.user_a end;
  v_first := least(p_user_id, v_other);
  v_second := greatest(p_user_id, v_other);

  -- A-B and A-C accepts serialize by user, not merely by friendship row.
  perform pg_advisory_xact_lock(hashtextextended(v_first::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_second::text, 0));

  select * into v_friendship
    from public.friendships
   where id = p_friendship_id
   for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_friendship.status <> 'pending'
     or v_friendship.requested_by = p_user_id
     or (p_user_id <> v_friendship.user_a and p_user_id <> v_friendship.user_b) then
    return jsonb_build_object('error', 'not_allowed');
  end if;

  if coalesce(v_friendship.created_at, '-infinity'::timestamptz) <= now() - interval '48 hours' then
    if v_friendship.accepted_at is not null then
      update public.friendships set status = 'accepted' where id = p_friendship_id;
    else
      delete from public.friendships where id = p_friendship_id;
    end if;
    return jsonb_build_object('error', 'invitation_expired');
  end if;

  if exists (select 1 from public.pairings where user_id = p_user_id) then
    return jsonb_build_object('error', 'already_paired');
  end if;
  if exists (select 1 from public.pairings where user_id = v_other) then
    return jsonb_build_object('error', 'requester_already_paired');
  end if;

  update public.friendships
     set status = 'accepted', accepted_at = now()
   where id = p_friendship_id;

  insert into public.pairings (user_id, partner_user_id, relationship, relationship_since) values
    (p_user_id, v_other, v_friendship.relationship, v_friendship.relationship_since),
    (v_other, p_user_id, v_friendship.relationship, v_friendship.relationship_since);

  update public.friendships
     set status = 'accepted'
   where id <> p_friendship_id
     and status = 'pending'
     and accepted_at is not null
     and (user_a in (p_user_id, v_other) or user_b in (p_user_id, v_other));
  get diagnostics v_changed = row_count;
  v_ignored := v_ignored + v_changed;

  delete from public.friendships
   where id <> p_friendship_id
     and status = 'pending'
     and accepted_at is null
     and (user_a in (p_user_id, v_other) or user_b in (p_user_id, v_other));
  get diagnostics v_changed = row_count;
  v_ignored := v_ignored + v_changed;

  return jsonb_build_object(
    'error', null,
    'paired_with', v_other,
    'ignored_count', v_ignored
  );
end;
$$;

revoke all on function public.accept_pairing_invitation(uuid, uuid) from public;
revoke all on function public.accept_pairing_invitation(uuid, uuid) from anon;
revoke all on function public.accept_pairing_invitation(uuid, uuid) from authenticated;
grant execute on function public.accept_pairing_invitation(uuid, uuid) to service_role;
