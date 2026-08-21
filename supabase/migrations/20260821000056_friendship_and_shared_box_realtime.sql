-- Rare, user-specific invalidations for pending invitations and newly-created
-- shared memories. Payloads contain no memory copy or relationship details;
-- the authenticated client re-reads the existing protected API resource.

create or replace function public.broadcast_friendship_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  -- A pending row belongs to two users; only the non-requesting recipient
  -- needs the incoming-invitation invalidation.
  v_recipient := case
    when new.requested_by = new.user_a then new.user_b
    when new.requested_by = new.user_b then new.user_a
    else null
  end;

  if v_recipient is not null then
    perform realtime.send(
      jsonb_build_object('changed_at', now()),
      'friendship_invited',
      'pairing:' || v_recipient::text,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists friendships_invitation_broadcast on public.friendships;
create trigger friendships_invitation_broadcast
after insert or update of status, requested_by, created_at on public.friendships
for each row execute function public.broadcast_friendship_invitation();

create or replace function public.broadcast_shared_box_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change record;
begin
  -- /api/reflect inserts all matched items in one statement. A transition
  -- table lets that batch produce one event per recipient, not one per item.
  for v_change in
    select distinct
      case
        when author_user_id = user_a then user_b
        when author_user_id = user_b then user_a
        else null
      end as recipient_user_id,
      author_user_id as partner_user_id
    from new_shared_memory_rows
  loop
    if v_change.recipient_user_id is not null then
      perform realtime.send(
        jsonb_build_object(
          'partner_user_id', v_change.partner_user_id,
          'changed_at', now()
        ),
        'shared_box_changed',
        'pairing:' || v_change.recipient_user_id::text,
        true
      );
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists shared_memory_items_insert_broadcast on public.shared_memory_items;
create trigger shared_memory_items_insert_broadcast
after insert on public.shared_memory_items
referencing new table as new_shared_memory_rows
for each statement execute function public.broadcast_shared_box_insert();
