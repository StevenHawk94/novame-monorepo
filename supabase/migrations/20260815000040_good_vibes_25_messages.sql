-- Expand the Good Vibes catalogue from 24 to 25 messages.
alter table public.good_vibes
  drop constraint if exists good_vibes_message_index_check;

alter table public.good_vibes
  add constraint good_vibes_message_index_check
  check (message_index between 0 and 24);
