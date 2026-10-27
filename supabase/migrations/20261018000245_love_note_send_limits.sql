-- One transactional allowance per sender, shared by devices and relationships.
-- Receipts are checked by the existing save RPC BEFORE this trigger runs: a
-- successful retry never spends another allowance, even at the daily limit.
create table public.love_note_send_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  day_start timestamptz not null,
  day_end timestamptz not null,
  daily_count integer not null check (daily_count >= 0),
  minute_sends timestamptz[] not null default '{}',
  check (day_end > day_start),
  check (cardinality(minute_sends) <= 5)
);
alter table public.love_note_send_limits enable row level security;
revoke all on public.love_note_send_limits from public, anon, authenticated;

-- Used only to initialize an existing account's allowance once. Include soft
-- deleted letters; removing a letter must not refund its send allowance.
create index memory_room_entries_love_note_sender_time_idx
  on public.memory_room_entries(author_id, created_at)
  where pair_low <> pair_high and left(body, 2) = '💌 ';

create function public.enforce_love_note_send_limits_v1()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stamp timestamptz;
  zone_name text;
  local_day date;
  window_start timestamptz;
  window_end timestamptz;
  allowance public.love_note_send_limits%rowtype;
  recent timestamptz[];
  sent_today integer;
  retry_after integer;
begin
  -- Private solo notes and ordinary journal entries are not partner sends.
  if new.pair_low = new.pair_high or left(trim(new.body), 2) <> '💌 ' then return new; end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then return new; end if;
  -- Also covers diary -> letter edits, without changing historical IDs or RPCs.
  perform pg_advisory_xact_lock(hashtextextended('love-note-limit:' || new.author_id::text, 0));
  stamp := clock_timestamp();
  select coalesce(nullif(timezone_name, ''), 'UTC') into zone_name from profiles where id = new.author_id;
  begin
    local_day := (stamp at time zone coalesce(zone_name, 'UTC'))::date;
  exception when invalid_parameter_value then
    zone_name := 'UTC'; local_day := (stamp at time zone 'UTC')::date;
  end;
  window_start := local_day::timestamp at time zone coalesce(zone_name, 'UTC');
  window_end := (local_day + 1)::timestamp at time zone coalesce(zone_name, 'UTC');

  select * into allowance from love_note_send_limits where user_id = new.author_id for update;
  if not found then
    select count(*)::integer into sent_today from memory_room_entries
      where author_id = new.author_id and pair_low <> pair_high and left(body, 2) = '💌 '
        and created_at >= window_start and created_at < window_end;
    select coalesce(array_agg(created_at order by created_at), '{}'::timestamptz[]) into recent
      from (select created_at from memory_room_entries
        where author_id = new.author_id and pair_low <> pair_high and left(body, 2) = '💌 '
          and created_at > stamp - interval '60 seconds'
        order by created_at desc limit 5) seed;
    insert into love_note_send_limits(user_id, day_start, day_end, daily_count, minute_sends)
      values(new.author_id, window_start, window_end, sent_today, recent) returning * into allowance;
  elsif stamp >= allowance.day_end then
    -- Keep a fixed window until it expires: changing profile timezone cannot
    -- immediately refill the allowance. The next window uses the current zone.
    allowance.day_start := window_start; allowance.day_end := window_end; allowance.daily_count := 0;
  end if;
  select coalesce(array_agg(value order by value), '{}'::timestamptz[]) into recent
    from unnest(allowance.minute_sends) value where value > stamp - interval '60 seconds';
  if allowance.daily_count >= 100 then
    retry_after := greatest(1, ceil(extract(epoch from allowance.day_end - stamp))::integer);
    raise exception using errcode = 'P0001', message = 'love_note_daily_limit',
      detail = jsonb_build_object('retryAfterSeconds', retry_after)::text;
  end if;
  if cardinality(recent) >= 5 then
    retry_after := greatest(1, ceil(extract(epoch from recent[1] + interval '60 seconds' - stamp))::integer);
    raise exception using errcode = 'P0001', message = 'love_note_minute_limit',
      detail = jsonb_build_object('retryAfterSeconds', retry_after)::text;
  end if;
  update love_note_send_limits set day_start = allowance.day_start, day_end = allowance.day_end,
    daily_count = allowance.daily_count + 1, minute_sends = array_append(recent, stamp)
    where user_id = new.author_id;
  return new;
end $$;
revoke all on function public.enforce_love_note_send_limits_v1() from public, anon, authenticated;
create trigger enforce_love_note_send_limits
  before insert or update of body on public.memory_room_entries
  for each row execute function public.enforce_love_note_send_limits_v1();
notify pgrst, 'reload schema';
