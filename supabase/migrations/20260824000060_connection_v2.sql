-- Connection v2: seven independently-updated modules, exact 48-hour resume
-- state, and one tiny private invalidation only when the stored board changes.

alter table public.profiles
  add column if not exists connection_resume_required boolean not null default false;

-- v2 never batches same-day candidates. Some environments never received the
-- legacy queue table, so clean it only where it actually exists.
do $$
begin
  if to_regclass('public.connection_update_candidates') is not null then
    execute $sql$
      update public.connection_update_candidates
      set status = 'discarded'
      where status = 'pending'
    $sql$;
  end if;
end;
$$;

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
      if coalesce(v_modules->v_key, '[]'::jsonb) is distinct from (p_updates->v_key->'cards') then
        v_modules := jsonb_set(v_modules, array[v_key], p_updates->v_key->'cards', true);
        v_changed := true;
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

create or replace function public.broadcast_connection_insight_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('changed_at', now()),
    'connection_changed',
    'pairing:' || new.for_user::text,
    true
  );
  return new;
end;
$$;

drop trigger if exists connection_insights_change_broadcast on public.connection_insights;
create trigger connection_insights_change_broadcast
after insert or update of payload on public.connection_insights
for each row execute function public.broadcast_connection_insight_change();
