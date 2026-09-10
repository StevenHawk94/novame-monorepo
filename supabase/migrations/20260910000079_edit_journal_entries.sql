-- A journal entry edit is one durable operation: update the private body,
-- reconcile its matched icons/memories, rebuild an Ours reflection, and
-- remove AI evidence that was derived from the superseded wording.

create or replace function public.edit_journal_entry(
  p_user_id uuid,
  p_reflect_id uuid,
  p_body text,
  p_matches jsonb,
  p_auto_memories jsonb,
  p_create_auto_memories boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reflect public.reflects%rowtype;
  v_draft public.reflect_drafts%rowtype;
  v_completion jsonb;
  v_match jsonb;
  v_item_id text;
  v_position smallint := 0;
  v_visible boolean;
  v_existing_source text;
  v_generated text;
  v_count integer;
  v_shared_count integer := 0;
  v_old_item_ids text[] := '{}'::text[];
  v_new_item_ids text[] := '{}'::text[];
  v_settlement jsonb := '[]'::jsonb;
  v_insight record;
  v_modules jsonb;
  v_next_payload jsonb;
begin
  if p_body is null or char_length(p_body) > 5000 then
    return jsonb_build_object('error', 'invalid_body');
  end if;
  if jsonb_typeof(coalesce(p_matches, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_auto_memories, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('error', 'invalid_payload');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- My Logs can expose a saved reflection whose settlement was interrupted.
  -- Publish that durable checkpoint first, just like the existing memory
  -- editor, so a later recovery cannot restore the pre-edit body/items.
  select * into v_draft
  from public.reflect_drafts
  where user_id = p_user_id and saved_reflect_id = p_reflect_id
  for update;
  if v_draft.id is not null and v_draft.finalized_reflect_id is null then
    v_completion := public.complete_saved_reflect(
      p_user_id, v_draft.id, null, v_draft.settlement_revision + 1
    );
    if v_completion->>'error' is not null then return v_completion; end if;
  end if;

  select * into v_reflect
  from public.reflects
  where id = p_reflect_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_reflect.mode = 'typing' and btrim(p_body) = '' then
    return jsonb_build_object('error', 'empty');
  end if;

  select coalesce(array_agg(item_id), '{}'::text[]) into v_old_item_ids
  from public.reflect_items
  where reflect_id = p_reflect_id and user_id = p_user_id;

  -- Reject duplicate/unknown ids even though the authenticated API supplies
  -- server-resolved matches. The RPC remains safe if called incorrectly.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) entry
    where nullif(entry->>'itemId', '') is null
       or not exists (select 1 from public.items where id = entry->>'itemId')
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) entry
    group by entry->>'itemId'
    having count(*) > 1
  ) then
    return jsonb_build_object('error', 'invalid_items');
  end if;

  select coalesce(array_agg(entry->>'itemId'), '{}'::text[]) into v_new_item_ids
  from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) entry;

  update public.reflects set body = p_body where id = p_reflect_id;

  -- Removed keywords remove both the feed icon and its derived Memory. A
  -- manually edited Memory cannot remain attached to an item that no longer
  -- matches this reflection.
  delete from public.item_memories
  where user_id = p_user_id and reflect_id = p_reflect_id
    and not (item_id = any(v_new_item_ids));
  delete from public.reflect_items
  where user_id = p_user_id and reflect_id = p_reflect_id
    and not (item_id = any(v_new_item_ids));

  for v_match in
    select entry.value
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) with ordinality entry(value, ordinality)
    order by entry.ordinality
  loop
    v_item_id := v_match->>'itemId';
    select visible_to_paired into v_visible
    from public.reflect_items
    where reflect_id = p_reflect_id and user_id = p_user_id and item_id = v_item_id;
    if not found then
      v_visible := case
        when v_reflect.shared_with_user_id is not null then true
        else coalesce(v_reflect.shared_to_friends, true)
      end;
    end if;

    insert into public.reflect_items(
      reflect_id, user_id, item_id, position, match_label, source_excerpt,
      visible_to_paired, created_at
    ) values (
      p_reflect_id, p_user_id, v_item_id, v_position,
      left(coalesce(v_match->>'label', ''), 200),
      nullif(left(coalesce(v_match->>'sourceExcerpt', ''), 500), ''),
      v_visible, coalesce(v_reflect.created_at, now())
    )
    on conflict (reflect_id, item_id) do update set
      position = excluded.position,
      match_label = excluded.match_label,
      source_excerpt = excluded.source_excerpt;
    v_position := v_position + 1;

    select memory_source into v_existing_source
    from public.item_memories
    where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id
    order by created_at asc, id asc limit 1;
    v_generated := left(btrim(coalesce(p_auto_memories->>v_item_id, '')), 500);

    -- User-written memory copy wins. AI/legacy copy follows the edited journal.
    -- New Memory rows are only created when the account is currently eligible;
    -- an expired subscriber's existing rows still receive a safe fallback.
    if coalesce(v_existing_source, '') not in ('manual', 'use_my_words')
       and v_generated <> ''
       and (v_existing_source is not null or coalesce(p_create_auto_memories, false)) then
      update public.item_memories set
        raw_excerpt = v_generated,
        refined_desc = case when p_create_auto_memories then v_generated else null end,
        description = v_generated,
        memory_source = case when p_create_auto_memories then 'ai' else 'legacy' end,
        updated_at = now()
      where id = (
        select id from public.item_memories
        where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id
        order by created_at asc, id asc limit 1
      );
      if not found then
        insert into public.item_memories(
          user_id, item_id, reflect_id, raw_excerpt, refined_desc, description,
          memory_source, created_at, updated_at
        ) values (
          p_user_id, v_item_id, p_reflect_id, v_generated,
          case when p_create_auto_memories then v_generated else null end,
          v_generated, case when p_create_auto_memories then 'ai' else 'legacy' end,
          coalesce(v_reflect.created_at, now()), now()
        );
      end if;
      delete from public.item_memories
      where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id
        and id not in (
          select id from public.item_memories
          where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id
          order by created_at asc, id asc limit 1
        );
    end if;
  end loop;

  -- user_items is a materialized count of actual Memory rows, not matched
  -- feed icons. Recompute every item touched by the old or new match set.
  for v_item_id in
    select distinct touched.item_id
    from unnest(v_old_item_ids || v_new_item_ids) as touched(item_id)
  loop
    select count(*)::integer into v_count
    from public.item_memories where user_id = p_user_id and item_id = v_item_id;
    if v_count = 0 then
      delete from public.user_items where user_id = p_user_id and item_id = v_item_id;
    else
      insert into public.user_items(user_id, item_id, count, first_seen_at)
      select p_user_id, v_item_id, count(*)::integer, min(created_at)
      from public.item_memories where user_id = p_user_id and item_id = v_item_id
      on conflict (user_id, item_id) do update set
        count = excluded.count,
        first_seen_at = excluded.first_seen_at;
    end if;
  end loop;

  -- Remember Together rows are a projection of the editable Memory source.
  if v_reflect.shared_with_user_id is not null then
    delete from public.shared_memory_items
    where reflect_id = p_reflect_id and author_user_id = p_user_id;
    insert into public.shared_memory_items(
      user_a, user_b, author_user_id, item_id, description, source, reflect_id, created_at
    )
    select
      least(p_user_id, v_reflect.shared_with_user_id),
      greatest(p_user_id, v_reflect.shared_with_user_id),
      p_user_id, m.item_id,
      coalesce(m.description, m.refined_desc, m.raw_excerpt),
      'reflect', p_reflect_id, coalesce(v_reflect.created_at, now())
    from public.item_memories m
    join public.reflect_items ri
      on ri.reflect_id = m.reflect_id and ri.user_id = m.user_id and ri.item_id = m.item_id
    where m.user_id = p_user_id and m.reflect_id = p_reflect_id;
    get diagnostics v_shared_count = row_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', ri.item_id,
    'text', coalesce(m.description, m.refined_desc, m.raw_excerpt, ''),
    'source', coalesce(m.memory_source, 'manual'),
    'visible', ri.visible_to_paired,
    'edited', coalesce(m.memory_source in ('manual', 'use_my_words'), false)
  ) order by ri.position), '[]'::jsonb) into v_settlement
  from public.reflect_items ri
  left join lateral (
    select im.description, im.refined_desc, im.raw_excerpt, im.memory_source
    from public.item_memories im
    where im.user_id = ri.user_id and im.reflect_id = ri.reflect_id and im.item_id = ri.item_id
    order by im.created_at asc, im.id asc limit 1
  ) m on true
  where ri.user_id = p_user_id and ri.reflect_id = p_reflect_id;

  update public.reflect_drafts set
    body = p_body,
    matches = coalesce(p_matches, '[]'::jsonb),
    ai_memories = coalesce(p_auto_memories, '{}'::jsonb),
    settlement_memories = v_settlement,
    bubble = null,
    save_receipt = coalesce(save_receipt, '{}'::jsonb) || jsonb_build_object(
      'matchedItems', coalesce(p_matches, '[]'::jsonb),
      'memories', v_settlement,
      'bubble', null
    )
  where user_id = p_user_id
    and (saved_reflect_id = p_reflect_id or finalized_reflect_id = p_reflect_id);

  -- Superseded text must not remain as retained Connection evidence, learning
  -- evidence, live cards, or History. The API schedules a fresh analysis after
  -- commit when the account is eligible.
  delete from public.reflect_ai_analyses
  where reflect_id = p_reflect_id and user_id = p_user_id;
  delete from public.connection_update_candidates where reflect_id = p_reflect_id;
  delete from public.item_learning_jobs where reflect_id = p_reflect_id;
  with removed as (
    delete from public.item_learning_occurrences
    where reflect_id = p_reflect_id returning candidate_id
  ), counts as (
    select candidate_id, count(*)::integer as total from removed group by candidate_id
  )
  update public.item_learning_candidates candidate
  set occurrence_count = greatest(0, candidate.occurrence_count - counts.total)
  from counts where candidate.id = counts.candidate_id;
  delete from public.connection_card_history where source_reflect_id = p_reflect_id;

  for v_insight in
    select user_a, user_b, for_user, for_date, payload
    from public.connection_insights
    where p_user_id in (user_a, user_b)
      and coalesce(payload->'modules', '{}'::jsonb)::text like '%' || p_reflect_id::text || '%'
    for update
  loop
    select coalesce(jsonb_object_agg(module.key, (
      select coalesce(jsonb_agg(card.value order by card.ordinality), '[]'::jsonb)
      from jsonb_array_elements(
        case when jsonb_typeof(module.value) = 'array' then module.value else '[]'::jsonb end
      ) with ordinality card(value, ordinality)
      where not (coalesce(card.value->'evidenceIds', '[]'::jsonb)
        @> jsonb_build_array(p_reflect_id::text))
    )), '{}'::jsonb) into v_modules
    from jsonb_each(coalesce(v_insight.payload->'modules', '{}'::jsonb)) module;

    v_next_payload := jsonb_set(
      jsonb_set(v_insight.payload, '{modules}', v_modules, true),
      '{updatedAt}', to_jsonb(now()), true
    );
    if v_next_payload is distinct from v_insight.payload then
      update public.connection_insights set payload = v_next_payload, created_at = now()
      where user_a = v_insight.user_a and user_b = v_insight.user_b
        and for_user = v_insight.for_user and for_date = v_insight.for_date;
    end if;
  end loop;

  return jsonb_build_object(
    'error', null,
    'reflect_id', p_reflect_id,
    'body', p_body,
    'local_date', v_reflect.local_date,
    'shared_to_friends', v_reflect.shared_to_friends,
    'shared', v_reflect.shared_with_user_id is not null,
    'shared_rows', v_shared_count,
    'matchedItems', coalesce(p_matches, '[]'::jsonb),
    'memories', v_settlement
  );
end;
$$;

revoke all on function public.edit_journal_entry(uuid, uuid, text, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.edit_journal_entry(uuid, uuid, text, jsonb, jsonb, boolean)
  to service_role;

-- Targeted Ours invalidation. Generic callers keep using the existing one-arg
-- helper; journal edits include the reflect id so both devices can evict rows
-- that were deleted or replaced rather than merging them back from cache.
create or replace function public.broadcast_shared_box_reflect_change(
  p_user_id uuid,
  p_reflect_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select shared_with_user_id into v_partner
  from public.reflects
  where id = p_reflect_id and user_id = p_user_id;
  if v_partner is null then return; end if;
  perform realtime.send(
    jsonb_build_object(
      'partner_user_id', p_user_id,
      'reflect_id', p_reflect_id,
      'changed_at', now()
    ),
    'shared_box_changed',
    'pairing:' || v_partner::text,
    true
  );
end;
$$;

revoke all on function public.broadcast_shared_box_reflect_change(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.broadcast_shared_box_reflect_change(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
