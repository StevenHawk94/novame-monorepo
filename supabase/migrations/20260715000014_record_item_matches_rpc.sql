-- record_item_matches: write the items matched in one reflect (C8).
--
-- Called by /api/reflect AFTER submit_reflect succeeds, with the matches the
-- engine found. Kept separate from submit_reflect (not another param on that
-- already-twice-touched function) because items are additive: a match failure
-- must never block or undo the reflect itself. The reflect is the core write;
-- items are a bonus layered on top.
--
-- For each match: bump user_items.count (upsert) and append an item_memories
-- row tying the item to this reflect with its excerpt. refined_desc is null for
-- now (paid AI refinement is a later step). The API calls this exactly once per
-- successful reflect, so memories are not duplicated.
create or replace function public.record_item_matches(
  p_user_id    uuid,
  p_reflect_id uuid,
  p_matches    jsonb,
  p_local_date date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match     jsonb;
  v_item_id   text;
  v_label     text;
  v_new_count int := 0;
begin
  for v_match in select * from jsonb_array_elements(p_matches)
  loop
    v_item_id := v_match->>'item_id';
    v_label   := v_match->>'label';

    perform 1 from public.items where id = v_item_id;
    if not found then
      continue;
    end if;

    insert into public.user_items (user_id, item_id, count, first_seen_at)
    values (p_user_id, v_item_id, 1, now())
    on conflict (user_id, item_id)
      do update set count = public.user_items.count + 1;

    insert into public.item_memories (user_id, item_id, reflect_id, raw_excerpt)
    values (p_user_id, v_item_id, p_reflect_id, v_label);

    v_new_count := v_new_count + 1;
  end loop;

  return jsonb_build_object('error', null, 'items_recorded', v_new_count);
end;
$$;

revoke all on function public.record_item_matches(uuid, uuid, jsonb, date) from public;
revoke all on function public.record_item_matches(uuid, uuid, jsonb, date) from anon;
revoke all on function public.record_item_matches(uuid, uuid, jsonb, date) from authenticated;
grant execute on function public.record_item_matches(uuid, uuid, jsonb, date) to service_role;
