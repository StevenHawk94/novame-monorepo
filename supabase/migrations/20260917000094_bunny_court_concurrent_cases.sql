-- A questionnaire is only filed after its initiator submits every answer.
-- Once sealed, either person may return to the lobby and start a different
-- case while the other side is still answering. Keep only duplicate instances
-- of the same case blocked for the same pair.
begin;

drop index if exists public.court_one_open_case_per_pair;

create unique index if not exists court_one_open_instance_per_pair_case
  on public.court_sessions(pair_low, pair_high,case_id)
  where status in ('awaiting_initiator','awaiting_partner','processing','ready');

commit;
