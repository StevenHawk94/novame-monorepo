-- Pairing changes are rare and user-specific. Send a private invalidation
-- event instead of polling or exposing pair data in the realtime payload.
-- The client re-fetches the authenticated API/cache after receiving it.

create or replace function public.broadcast_pairing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  perform realtime.send(
    jsonb_build_object('changed_at', now()),
    'pairing_changed',
    'pairing:' || v_user_id::text,
    true
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Lock realtime.messages before pairings. Supabase Realtime workers can read
-- these relations in that order; matching it prevents a DDL deadlock where
-- this migration held pairings while waiting to create the policy.
drop policy if exists pairing_broadcast_receive_own on realtime.messages;
create policy pairing_broadcast_receive_own
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'pairing:' || auth.uid()::text);

drop trigger if exists pairings_change_broadcast on public.pairings;
create trigger pairings_change_broadcast
after insert or update or delete on public.pairings
for each row execute function public.broadcast_pairing_change();
