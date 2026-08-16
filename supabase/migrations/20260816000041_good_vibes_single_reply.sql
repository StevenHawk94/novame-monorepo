-- Good Vibes is a one-reply exchange. The existing sender/date unique
-- constraint intentionally counts replies toward the sender's daily limit.

alter table public.good_vibes
  add column if not exists message_type text not null default 'initial',
  add column if not exists reply_to_id uuid references public.good_vibes(id) on delete set null;

alter table public.good_vibes
  drop constraint if exists good_vibes_message_type_check;
alter table public.good_vibes
  add constraint good_vibes_message_type_check
  check (message_type in ('initial', 'reply'));

alter table public.good_vibes
  drop constraint if exists good_vibes_reply_shape_check;
alter table public.good_vibes
  add constraint good_vibes_reply_shape_check
  check (
    (message_type = 'initial' and reply_to_id is null)
    or (message_type = 'reply' and reply_to_id is not null)
  );

create unique index if not exists good_vibes_one_reply_per_message
  on public.good_vibes(reply_to_id)
  where reply_to_id is not null;

