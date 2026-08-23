-- Reflect memories v2: separate matched items, actual memories and per-item
-- paired visibility. Drafts make the settlement screen non-destructive until
-- the user presses Done; finalize is idempotent and atomic.

alter table public.reflects
  add column if not exists shared_with_user_id uuid references public.profiles(id) on delete set null;

create table if not exists public.reflect_items (
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.items(id),
  position smallint not null default 0,
  match_label text not null default '',
  source_excerpt text,
  visible_to_paired boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (reflect_id, item_id)
);
create index if not exists reflect_items_user_created
  on public.reflect_items(user_id, created_at desc);
create index if not exists reflect_items_user_item
  on public.reflect_items(user_id, item_id, created_at desc);
alter table public.reflect_items enable row level security;
drop policy if exists reflect_items_own on public.reflect_items;
create policy reflect_items_own on public.reflect_items
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists reflect_items_service on public.reflect_items;
create policy reflect_items_service on public.reflect_items
  for all to service_role using (true) with check (true);

alter table public.item_memories
  add column if not exists description text,
  add column if not exists memory_source text not null default 'legacy'
    check (memory_source in ('manual', 'ai', 'use_my_words', 'legacy')),
  add column if not exists updated_at timestamptz not null default now();

update public.item_memories
set description = coalesce(nullif(btrim(refined_desc), ''), nullif(btrim(raw_excerpt), ''))
where description is null;

-- Existing rows are preserved without guessing whether a raw excerpt was an
-- old automatic label or a hand-written memory. New writes are exact.
insert into public.reflect_items
  (reflect_id, user_id, item_id, position, match_label, source_excerpt, visible_to_paired, created_at)
select distinct on (m.reflect_id, m.item_id)
  m.reflect_id,
  m.user_id,
  m.item_id,
  row_number() over (partition by m.reflect_id order by m.created_at, m.id)::smallint - 1,
  coalesce(m.raw_excerpt, ''),
  null,
  coalesce(r.shared_to_friends, true),
  m.created_at
from public.item_memories m
join public.reflects r on r.id = m.reflect_id
order by m.reflect_id, m.item_id, m.created_at desc, m.id desc
on conflict (reflect_id, item_id) do nothing;

update public.reflects r
set shared_with_user_id = case
  when s.user_a = r.user_id then s.user_b else s.user_a
end
from (
  select distinct on (reflect_id) reflect_id, user_a, user_b
  from public.shared_memory_items
  where reflect_id is not null
  order by reflect_id, created_at desc
) s
where r.id = s.reflect_id and r.shared_with_user_id is null;

create table if not exists public.reflect_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  prompt_id smallint not null check (prompt_id between 1 and 9),
  body text not null default '',
  local_date date not null,
  mode text not null check (mode in ('typing', 'prompt', 'items')),
  source_kit text,
  friend_user_id uuid references public.profiles(id) on delete cascade,
  matches jsonb not null default '[]'::jsonb,
  ai_memories jsonb not null default '{}'::jsonb,
  bubble text,
  finalized_reflect_id uuid references public.reflects(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique(user_id, idempotency_key)
);
create index if not exists reflect_drafts_expiry on public.reflect_drafts(expires_at);
alter table public.reflect_drafts enable row level security;
drop policy if exists reflect_drafts_service on public.reflect_drafts;
create policy reflect_drafts_service on public.reflect_drafts
  for all to service_role using (true) with check (true);

create or replace function public.finalize_reflect_draft(
  p_user_id uuid,
  p_draft_id uuid,
  p_memories jsonb,
  p_visibility jsonb,
  p_xp_amount integer,
  p_iso_week text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.reflect_drafts%rowtype;
  v_result jsonb;
  v_reflect_id uuid;
  v_match jsonb;
  v_memory jsonb;
  v_item_id text;
  v_text text;
  v_source text;
  v_visible boolean;
  v_position smallint := 0;
  v_shared jsonb := '[]'::jsonb;
  v_existing_count integer;
begin
  select * into v_draft
  from public.reflect_drafts
  where id = p_draft_id and user_id = p_user_id
  for update;

  if not found then return jsonb_build_object('error', 'draft_not_found'); end if;

  if v_draft.finalized_reflect_id is not null then
    select count(*) into v_existing_count from public.reflects
      where user_id = p_user_id and local_date = v_draft.local_date;
    if v_draft.friend_user_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'author_user_id', author_user_id,
        'item_id', item_id,
        'description', description,
        'source', source,
        'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      into v_shared
      from public.shared_memory_items
      where reflect_id = v_draft.finalized_reflect_id and author_user_id = p_user_id;
    end if;
    return jsonb_build_object(
      'error', null,
      'reflect_id', v_draft.finalized_reflect_id,
      'xp_awarded', 0,
      'reflects_today', v_existing_count,
      'reflects_remaining', greatest(0, 3 - v_existing_count),
      'already_finalized', true,
      'matchedItems', v_draft.matches,
      'sharedItems', v_shared,
      'bubble', v_draft.bubble
    );
  end if;

  if v_draft.expires_at <= now() then return jsonb_build_object('error', 'draft_expired'); end if;

  if v_draft.friend_user_id is not null and not exists (
    select 1 from public.pairings
    where user_id = p_user_id and partner_user_id = v_draft.friend_user_id
  ) then
    return jsonb_build_object('error', 'pairing_required');
  end if;

  select public.submit_reflect(
    p_user_id,
    v_draft.prompt_id,
    v_draft.body,
    v_draft.local_date,
    p_iso_week,
    p_xp_amount,
    '[]'::jsonb,
    case when v_draft.source_kit = 'new_lens' then 'new_lens'::kit_t else null end,
    true,
    v_draft.mode
  ) into v_result;

  if v_result->>'error' is not null then return v_result; end if;
  v_reflect_id := (v_result->>'reflect_id')::uuid;

  update public.reflects
  set shared_with_user_id = v_draft.friend_user_id
  where id = v_reflect_id;

  for v_match in select * from jsonb_array_elements(v_draft.matches)
  loop
    v_item_id := v_match->>'itemId';
    if not exists (select 1 from public.items where id = v_item_id) then continue; end if;

    select coalesce((entry->>'visible')::boolean, true) into v_visible
    from jsonb_array_elements(coalesce(p_visibility, '[]'::jsonb)) entry
    where entry->>'itemId' = v_item_id
    limit 1;
    v_visible := case when v_draft.friend_user_id is not null then true else coalesce(v_visible, true) end;

    insert into public.reflect_items
      (reflect_id, user_id, item_id, position, match_label, source_excerpt, visible_to_paired)
    values (
      v_reflect_id, p_user_id, v_item_id, v_position,
      coalesce(v_match->>'label', ''), nullif(v_match->>'sourceExcerpt', ''), v_visible
    );
    v_position := v_position + 1;

    select entry into v_memory
    from jsonb_array_elements(coalesce(p_memories, '[]'::jsonb)) entry
    where entry->>'itemId' = v_item_id
    limit 1;
    v_text := left(btrim(coalesce(v_memory->>'text', '')), 500);
    v_source := coalesce(nullif(v_memory->>'source', ''), 'manual');
    if v_source not in ('manual', 'ai', 'use_my_words') then v_source := 'manual'; end if;

    if v_text <> '' then
      insert into public.item_memories
        (user_id, item_id, reflect_id, raw_excerpt, refined_desc, description, memory_source)
      values (
        p_user_id, v_item_id, v_reflect_id, v_text,
        case when v_source = 'ai' then v_text else null end,
        v_text, v_source
      );

      insert into public.user_items(user_id, item_id, count, first_seen_at)
      select p_user_id, v_item_id, count(*)::integer, min(created_at)
      from public.item_memories
      where user_id = p_user_id and item_id = v_item_id
      on conflict (user_id, item_id) do update
        set count = excluded.count,
            first_seen_at = least(public.user_items.first_seen_at, excluded.first_seen_at);

    end if;
  end loop;

  -- One statement means the existing Ours transition-table trigger emits one
  -- small shared_box_changed invalidation for the whole reflection.
  if v_draft.friend_user_id is not null then
    insert into public.shared_memory_items
      (user_a, user_b, author_user_id, item_id, description, source, reflect_id)
    select
      least(p_user_id, v_draft.friend_user_id),
      greatest(p_user_id, v_draft.friend_user_id),
      p_user_id,
      m.item_id,
      coalesce(m.description, m.refined_desc, m.raw_excerpt),
      'reflect',
      v_reflect_id
    from public.item_memories m
    where m.user_id = p_user_id and m.reflect_id = v_reflect_id;
  end if;

  update public.reflect_drafts
  set finalized_reflect_id = v_reflect_id
  where id = p_draft_id;

  if v_draft.friend_user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'author_user_id', author_user_id,
      'item_id', item_id,
      'description', description,
      'source', source,
      'created_at', created_at
    ) order by created_at), '[]'::jsonb)
    into v_shared
    from public.shared_memory_items
    where reflect_id = v_reflect_id and author_user_id = p_user_id;
  end if;

  return v_result || jsonb_build_object(
    'matchedItems', v_draft.matches,
    'sharedItems', v_shared,
    'bubble', v_draft.bubble
  );
end;
$$;

revoke all on function public.finalize_reflect_draft(uuid, uuid, jsonb, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.finalize_reflect_draft(uuid, uuid, jsonb, jsonb, integer, text) to service_role;

create or replace function public.edit_reflect_item_memories(
  p_user_id uuid,
  p_reflect_id uuid,
  p_edits jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reflect public.reflects%rowtype;
  v_edit jsonb;
  v_item_id text;
  v_text text;
  v_source text;
  v_visible boolean;
  v_count integer;
  v_shared_count integer := 0;
begin
  select * into v_reflect from public.reflects
  where id = p_reflect_id and user_id = p_user_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  for v_edit in select * from jsonb_array_elements(coalesce(p_edits, '[]'::jsonb))
  loop
    v_item_id := v_edit->>'itemId';
    if not exists (
      select 1 from public.reflect_items
      where reflect_id = p_reflect_id and user_id = p_user_id and item_id = v_item_id
    ) then continue; end if;

    v_text := left(btrim(coalesce(v_edit->>'text', '')), 500);
    v_source := coalesce(nullif(v_edit->>'source', ''), 'manual');
    if v_source not in ('manual', 'ai', 'use_my_words') then v_source := 'manual'; end if;
    v_visible := coalesce((v_edit->>'visible')::boolean, true);
    if v_reflect.shared_with_user_id is not null then v_visible := true; end if;

    update public.reflect_items
    set visible_to_paired = v_visible
    where reflect_id = p_reflect_id and user_id = p_user_id and item_id = v_item_id;

    if v_text = '' then
      delete from public.item_memories
      where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id;
    else
      update public.item_memories
      set raw_excerpt = v_text,
          refined_desc = case when v_source = 'ai' then v_text else null end,
          description = v_text,
          memory_source = v_source,
          updated_at = now()
      where id = (
        select id from public.item_memories
        where user_id = p_user_id and reflect_id = p_reflect_id and item_id = v_item_id
        order by created_at asc, id asc limit 1
      );
      if not found then
        insert into public.item_memories
          (user_id, item_id, reflect_id, raw_excerpt, refined_desc, description, memory_source)
        values (
          p_user_id, v_item_id, p_reflect_id, v_text,
          case when v_source = 'ai' then v_text else null end,
          v_text, v_source
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

    select count(*)::integer into v_count
    from public.item_memories where user_id = p_user_id and item_id = v_item_id;
    if v_count = 0 then
      delete from public.user_items where user_id = p_user_id and item_id = v_item_id;
    else
      insert into public.user_items(user_id, item_id, count, first_seen_at)
      select p_user_id, v_item_id, count(*)::integer, min(created_at)
      from public.item_memories where user_id = p_user_id and item_id = v_item_id
      on conflict (user_id, item_id) do update
        set count = excluded.count,
            first_seen_at = excluded.first_seen_at;
    end if;

  end loop;

  if v_reflect.shared_with_user_id is not null then
    delete from public.shared_memory_items
    where reflect_id = p_reflect_id and author_user_id = p_user_id;

    -- Rebuild the Shared/Ours rows in one statement. The existing transition-
    -- table trigger therefore sends at most one lightweight invalidation,
    -- regardless of how many memories were edited.
    insert into public.shared_memory_items
      (user_a, user_b, author_user_id, item_id, description, source, reflect_id)
    select
      least(p_user_id, v_reflect.shared_with_user_id),
      greatest(p_user_id, v_reflect.shared_with_user_id),
      p_user_id,
      m.item_id,
      coalesce(m.description, m.refined_desc, m.raw_excerpt),
      'reflect',
      p_reflect_id
    from public.item_memories m
    where m.user_id = p_user_id and m.reflect_id = p_reflect_id;
    get diagnostics v_shared_count = row_count;
  end if;

  return jsonb_build_object(
    'error', null,
    'updated', jsonb_array_length(coalesce(p_edits, '[]'::jsonb)),
    'shared', v_reflect.shared_with_user_id is not null,
    'shared_rows', v_shared_count
  );
end;
$$;

revoke all on function public.edit_reflect_item_memories(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.edit_reflect_item_memories(uuid, uuid, jsonb) to service_role;

create or replace function public.broadcast_reflect_feed_change(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  if v_partner is null then return; end if;
  perform realtime.send(
    jsonb_build_object('author_user_id', p_user_id),
    'reflect_feed_changed',
    'pairing:' || v_partner::text,
    true
  );
end;
$$;

revoke all on function public.broadcast_reflect_feed_change(uuid) from public, anon, authenticated;
grant execute on function public.broadcast_reflect_feed_change(uuid) to service_role;

-- A Shared reflection can be edited until every description is blank. In that
-- deletion-only case the insert transition trigger has no rows to announce,
-- so the API calls this one explicit invalidation after the transaction.
create or replace function public.broadcast_shared_box_change(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  if v_partner is null then return; end if;
  perform realtime.send(
    jsonb_build_object('partner_user_id', p_user_id, 'changed_at', now()),
    'shared_box_changed',
    'pairing:' || v_partner::text,
    true
  );
end;
$$;

revoke all on function public.broadcast_shared_box_change(uuid) from public, anon, authenticated;
grant execute on function public.broadcast_shared_box_change(uuid) to service_role;
