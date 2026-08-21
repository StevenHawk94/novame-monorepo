-- Good Vibes delivery is a rare, recipient-specific invalidation. Reuse the
-- existing authenticated private pairing topic instead of keeping a separate
-- postgres_changes channel alive. The payload contains no message content;
-- the recipient fetches the protected inbox API after receiving it.

create or replace function public.broadcast_good_vibe_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('changed_at', now()),
    'good_vibe_received',
    'pairing:' || new.recipient_user_id::text,
    true
  );

  return new;
end;
$$;

drop trigger if exists good_vibes_insert_broadcast on public.good_vibes;
create trigger good_vibes_insert_broadcast
after insert on public.good_vibes
for each row execute function public.broadcast_good_vibe_insert();
