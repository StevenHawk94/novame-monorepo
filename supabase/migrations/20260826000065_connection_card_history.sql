-- Append-only Connection card history. The live Connection Board remains a
-- latest-per-module snapshot; this table preserves each accepted generation.

create table if not exists public.connection_card_history (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  for_user uuid not null references public.profiles(id) on delete cascade,
  source_reflect_id uuid references public.reflects(id) on delete cascade,
  source_key text not null,
  module_key text not null check (module_key in (
    'worth_knowing', 'recent_vibe', 'what_theyre_into',
    'how_to_show_up', 'talk_about', 'try_together', 'shared_rhythm'
  )),
  card_index smallint not null default 0,
  card jsonb not null check (jsonb_typeof(card) = 'object'),
  for_date date not null,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  check (for_user in (user_a, user_b)),
  unique (user_a, user_b, for_user, source_key, module_key, card_index)
);

create index if not exists connection_card_history_reader_date
  on public.connection_card_history(for_user, for_date desc, created_at desc);
create index if not exists connection_card_history_pair
  on public.connection_card_history(user_a, user_b, for_user);

alter table public.connection_card_history enable row level security;

drop policy if exists connection_card_history_service on public.connection_card_history;
create policy connection_card_history_service on public.connection_card_history
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists connection_card_history_reader on public.connection_card_history;
create policy connection_card_history_reader on public.connection_card_history
  for select using (for_user = auth.uid());

-- Preserve the historical cards that can still be recovered from existing
-- daily Board snapshots. Repeated snapshot cards are de-duplicated.
with expanded as (
  select
    ci.user_a,
    ci.user_b,
    ci.for_user,
    ci.for_date,
    ci.created_at,
    modules.key as module_key,
    cards.value as card,
    (cards.ordinality - 1)::smallint as card_index,
    source_reflect.id as source_reflect_id,
    row_number() over (
      partition by ci.user_a, ci.user_b, ci.for_user, modules.key, md5(cards.value::text)
      order by ci.for_date, ci.created_at
    ) as occurrence
  from public.connection_insights ci
  cross join lateral jsonb_each(coalesce(ci.payload->'modules', '{}'::jsonb)) modules
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(modules.value) = 'array' then modules.value else '[]'::jsonb end
  ) with ordinality cards(value, ordinality)
  left join lateral (
    select reflects.id
    from public.reflects
    where reflects.id::text = cards.value->'evidenceIds'->>0
    limit 1
  ) source_reflect on true
  where modules.key in (
    'worth_knowing', 'recent_vibe', 'what_theyre_into',
    'how_to_show_up', 'talk_about', 'try_together', 'shared_rhythm'
  )
)
insert into public.connection_card_history (
  user_a, user_b, for_user, source_reflect_id, source_key, module_key, card_index,
  card, for_date, created_at
)
select
  user_a, user_b, for_user,
  source_reflect_id,
  coalesce(source_reflect_id::text, 'legacy:' || md5(module_key || ':' || card::text)),
  module_key, card_index, card, for_date, created_at
from expanded
where occurrence = 1
on conflict do nothing;

create or replace function public.apply_connection_insight_updates_v2(
  p_user_a uuid,
  p_user_b uuid,
  p_for_user uuid,
  p_for_date date,
  p_reflect_id uuid,
  p_updates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior jsonb;
  v_modules jsonb;
  v_payload jsonb;
  v_key text;
  v_cards jsonb;
  v_changed boolean := false;
begin
  if p_user_a >= p_user_b or p_for_user not in (p_user_a, p_user_b) then
    raise exception 'invalid connection pair';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_user_a::text || ':' || p_user_b::text || ':' || p_for_user::text, 0
  ));

  select payload into v_prior
  from public.connection_insights
  where user_a = p_user_a and user_b = p_user_b and for_user = p_for_user
  order by for_date desc
  limit 1;

  if coalesce((v_prior->>'schemaVersion')::integer, 0) = 2 then
    v_modules := coalesce(v_prior->'modules', '{}'::jsonb);
  else
    v_modules := '{}'::jsonb;
  end if;

  for v_key in
    select unnest(array[
      'worth_knowing', 'recent_vibe', 'what_theyre_into',
      'how_to_show_up', 'talk_about', 'try_together', 'shared_rhythm'
    ])
  loop
    if coalesce((p_updates->v_key->>'hasUpdate')::boolean, false)
       and jsonb_array_length(coalesce(p_updates->v_key->'cards', '[]'::jsonb)) > 0 then
      v_cards := p_updates->v_key->'cards';
      if coalesce(v_modules->v_key, '[]'::jsonb) is distinct from v_cards then
        v_modules := jsonb_set(v_modules, array[v_key], v_cards, true);
        v_changed := true;

        insert into public.connection_card_history (
          user_a, user_b, for_user, source_reflect_id, source_key,
          module_key, card_index, card, for_date, created_at
        )
        select
          p_user_a, p_user_b, p_for_user, p_reflect_id, p_reflect_id::text,
          v_key, (entry.ordinality - 1)::smallint, entry.value, p_for_date, now()
        from jsonb_array_elements(v_cards) with ordinality entry(value, ordinality)
        on conflict do nothing;
      end if;
    elsif not (v_modules ? v_key) then
      v_modules := jsonb_set(v_modules, array[v_key], '[]'::jsonb, true);
    end if;
  end loop;

  v_payload := jsonb_build_object(
    'schemaVersion', 2,
    'modules', v_modules,
    'updatedAt', now(),
    'lastProcessedReflectId', p_reflect_id
  );

  if not v_changed then
    return jsonb_build_object('changed', false, 'payload', coalesce(v_prior, v_payload));
  end if;

  insert into public.connection_insights
    (user_a, user_b, for_date, for_user, payload, created_at)
  values
    (p_user_a, p_user_b, p_for_date, p_for_user, v_payload, now())
  on conflict (user_a, user_b, for_date, for_user)
  do update set payload = excluded.payload, created_at = excluded.created_at;

  return jsonb_build_object('changed', true, 'payload', v_payload);
end;
$$;

revoke all on function public.apply_connection_insight_updates_v2(uuid, uuid, uuid, date, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_connection_insight_updates_v2(uuid, uuid, uuid, date, uuid, jsonb)
  to service_role;
