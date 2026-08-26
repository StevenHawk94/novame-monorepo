-- Let the privacy-safe Connection analyzer clear a duplicated live module
-- without deleting its append-only History. Existing replace/append behavior
-- remains unchanged for ordinary card updates.
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
  v_clear_existing boolean;
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
    v_cards := coalesce(p_updates->v_key->'cards', '[]'::jsonb);
    v_clear_existing := coalesce((p_updates->v_key->>'clearExisting')::boolean, false);

    if coalesce((p_updates->v_key->>'hasUpdate')::boolean, false)
       and jsonb_array_length(v_cards) > 0 then
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
    elsif coalesce((p_updates->v_key->>'hasUpdate')::boolean, false)
          and v_clear_existing then
      -- The current board may be cleaned, but History is intentionally never
      -- updated or deleted by this branch.
      if coalesce(v_modules->v_key, '[]'::jsonb) is distinct from '[]'::jsonb then
        v_modules := jsonb_set(v_modules, array[v_key], '[]'::jsonb, true);
        v_changed := true;
      elsif not (v_modules ? v_key) then
        v_modules := jsonb_set(v_modules, array[v_key], '[]'::jsonb, true);
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
