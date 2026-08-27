-- Save Reflection is the durable, quota-consuming boundary; Done edits/publishes it.
-- Additive and compatible with older clients using the same HTTP endpoints.
alter table public.reflect_drafts
  add column if not exists saved_reflect_id uuid references public.reflects(id) on delete set null,
  add column if not exists save_receipt jsonb,
  add column if not exists settlement_memories jsonb not null default '[]'::jsonb,
  add column if not exists settlement_revision bigint not null default 0,
  add column if not exists ai_claimed_at timestamptz;
create index if not exists reflect_drafts_pending_saved
  on public.reflect_drafts(user_id, created_at)
  where saved_reflect_id is not null and finalized_reflect_id is null;

create or replace function public.begin_saved_reflect(p_user_id uuid, p_payload jsonb, p_memories jsonb, p_xp integer, p_week text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.reflect_drafts%rowtype;
  receipt jsonb;
  staged jsonb;
begin
  -- Same lock/order as submit_reflect: different client keys cannot bypass quota.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts
    where user_id = p_user_id and idempotency_key = p_payload->>'idempotency_key' for update;
  if found and (d.saved_reflect_id is not null or d.finalized_reflect_id is not null) then
    return jsonb_build_object('draft', to_jsonb(d));
  end if;
  -- Local dates may differ from UTC by one day, never arbitrary past/future days.
  if (p_payload->>'local_date')::date not between (now() at time zone 'UTC')::date - 1
      and (now() at time zone 'UTC')::date + 1 then
    return jsonb_build_object('error', 'invalid_local_date');
  end if;
  if d.id is null then
    insert into public.reflect_drafts(user_id, idempotency_key, prompt_id, body, local_date, mode, source_kit, friend_user_id, matches)
    values(p_user_id, p_payload->>'idempotency_key', (p_payload->>'prompt_id')::smallint,
      p_payload->>'body', (p_payload->>'local_date')::date, p_payload->>'mode',
      p_payload->>'source_kit', (p_payload->>'friend_user_id')::uuid, p_payload->'matches')
    returning * into d;
  end if;
  if d.friend_user_id is not null and not exists(
    select 1 from public.pairings where user_id=p_user_id and partner_user_id=d.friend_user_id
  ) then return jsonb_build_object('error','pairing_required'); end if;
  -- Reuse the existing atomic reward/count implementation, but publish nothing
  -- while the user is reviewing privacy. These changes commit in ONE transaction.
  update public.reflect_drafts set friend_user_id=null where id=d.id;
  receipt := public.finalize_reflect_draft(p_user_id, d.id, '[]', '[]', p_xp, p_week);
  update public.reflect_drafts set friend_user_id=d.friend_user_id where id=d.id;
  if receipt->>'error' is not null then return receipt; end if;
  update public.reflects set shared_to_friends=false, shared_with_user_id=null
    where id=(receipt->>'reflect_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', m->>'itemId', 'text', coalesce(p_memories->>(m->>'itemId'), ''),
    'source', 'ai', 'visible', true, 'edited', false
  )), '[]') into staged from jsonb_array_elements(d.matches) m;
  update public.reflect_drafts set
    saved_reflect_id=(receipt->>'reflect_id')::uuid, finalized_reflect_id=null,
    save_receipt=receipt, settlement_memories=staged
    where id=d.id returning * into d;
  perform public.edit_reflect_item_memories(p_user_id, d.saved_reflect_id,
    (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]') from jsonb_array_elements(staged) e));
  return jsonb_build_object('draft', to_jsonb(d));
end $$;

-- Revisioned checkpoints persist edits without exposing the not-yet-confirmed
-- selection to a partner. Manual clearing is an edit too (never re-fill it by AI).
create or replace function public.checkpoint_reflect_settlement(p_user_id uuid, p_draft_id uuid, p_memories jsonb, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.reflect_drafts%rowtype; next_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts where id=p_draft_id and user_id=p_user_id for update;
  if d.saved_reflect_id is null then return jsonb_build_object('error','saved_reflect_required'); end if;
  if d.finalized_reflect_id is not null or p_revision <= d.settlement_revision then
    return jsonb_build_object('success',true,'revision',d.settlement_revision);
  end if;
  -- Merge by canonical item ids. Untouched/stale client AI must not overwrite a
  -- completed server generation; explicitly edited text/visibility always wins.
  select coalesce(jsonb_agg(
    case when incoming.value is null then old.value
    else old.value || incoming.value ||
      case when coalesce((incoming.value->>'edited')::boolean,false)
        then '{}'::jsonb
        else jsonb_build_object('text',old.value->>'text','source',old.value->>'source') end
    end
  ), '[]') into next_items
  from jsonb_array_elements(d.settlement_memories) old(value)
  left join lateral (
    select value from jsonb_array_elements(coalesce(p_memories,'[]')) where value->>'itemId'=old.value->>'itemId' limit 1
  ) incoming on true;
  update public.reflect_drafts set settlement_memories=next_items, settlement_revision=p_revision where id=d.id;
  perform public.edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]') from jsonb_array_elements(next_items) e
      where not exists(select 1 from jsonb_array_elements(d.settlement_memories) old
        where old->>'itemId'=e->>'itemId' and old->>'text'=e->>'text' and old->>'source'=e->>'source')));
  return jsonb_build_object('success',true,'revision',p_revision);
end $$;

create or replace function public.store_reflect_generation(p_user_id uuid, p_draft_id uuid, p_memories jsonb, p_bubble text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.reflect_drafts%rowtype; next_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts where id=p_draft_id and user_id=p_user_id for update;
  if d.saved_reflect_id is null then return jsonb_build_object('error','saved_reflect_required'); end if;
  -- A late model response never changes a confirmed/refined reflection.
  if d.finalized_reflect_id is not null then return jsonb_build_object('success',true); end if;
  select coalesce(jsonb_agg(case when coalesce((e->>'edited')::boolean,false)
    or nullif(p_memories->>(e->>'itemId'),'') is null then e
    else e || jsonb_build_object('text',p_memories->>(e->>'itemId'),'source','ai') end),'[]')
    into next_items from jsonb_array_elements(d.settlement_memories) e;
  update public.reflect_drafts set settlement_memories=next_items,
    ai_memories=ai_memories || coalesce(p_memories,'{}'), bubble=coalesce(p_bubble,bubble) where id=d.id;
  perform public.edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]') from jsonb_array_elements(next_items) e));
  return jsonb_build_object('success',true);
end $$;

create or replace function public.complete_saved_reflect(p_user_id uuid, p_draft_id uuid, p_memories jsonb, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.reflect_drafts%rowtype; shared_rows jsonb; receipt jsonb; can_share boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts where id=p_draft_id and user_id=p_user_id for update;
  if d.saved_reflect_id is null then return jsonb_build_object('error','saved_reflect_required'); end if;
  if d.finalized_reflect_id is not null then
    return coalesce(d.save_receipt,'{}') || jsonb_build_object('already_finalized',true,'xp_awarded',0);
  end if;
  -- null means recover the latest server checkpoint, NEVER an empty overwrite.
  if p_memories is not null then
    perform public.checkpoint_reflect_settlement(p_user_id,p_draft_id,p_memories,p_revision);
    select * into d from public.reflect_drafts where id=p_draft_id;
  end if;
  -- A lost pairing/expired entitlement must not destroy an already-paid-for
  -- reflection or strand Done. Retain it privately instead of sharing elsewhere.
  can_share := d.friend_user_id is null or exists(
      select 1 from public.pairings p join public.profiles u on u.id=p.user_id
      where p.user_id=p_user_id and p.partner_user_id=d.friend_user_id and u.subscription_tier::text <> 'free'
    );
  update public.reflects set
    shared_to_friends=can_share,
    shared_with_user_id=case when can_share then d.friend_user_id else null end
    where id=d.saved_reflect_id;
  perform public.edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    case when can_share then d.settlement_memories else
      (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]') from jsonb_array_elements(d.settlement_memories) e) end);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'author_user_id',author_user_id,'item_id',item_id,'description',description,'source',source,'created_at',created_at
  ) order by created_at),'[]') into shared_rows from public.shared_memory_items where reflect_id=d.saved_reflect_id;
  receipt := d.save_receipt || jsonb_build_object('matchedItems',d.matches,'sharedItems',shared_rows,'bubble',d.bubble,
    'memories',d.settlement_memories,'shared_to_friends',can_share);
  update public.reflect_drafts set finalized_reflect_id=d.saved_reflect_id,save_receipt=receipt where id=d.id;
  return receipt;
end $$;

revoke all on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text) from public,anon,authenticated;
revoke all on function public.checkpoint_reflect_settlement(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.store_reflect_generation(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.complete_saved_reflect(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text) to service_role;
grant execute on function public.checkpoint_reflect_settlement(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.store_reflect_generation(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.complete_saved_reflect(uuid,uuid,jsonb,bigint) to service_role;

-- My Logs can open a saved reflection before crash recovery finishes it.
-- Choose the pending/completed path UNDER the same lock, never in an HTTP
-- read-then-write gap that could discard a user's newer edit.
create or replace function public.edit_durable_reflect_memories(p_user_id uuid,p_reflect_id uuid,p_edits jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.reflect_drafts%rowtype; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into d from public.reflect_drafts
    where user_id=p_user_id and saved_reflect_id=p_reflect_id for update;
  if d.id is not null and d.finalized_reflect_id is null then
    receipt := public.complete_saved_reflect(p_user_id,d.id,
      (select coalesce(jsonb_agg(e || '{"edited":true}'::jsonb),'[]') from jsonb_array_elements(p_edits) e),
      d.settlement_revision+1);
    return receipt || jsonb_build_object('updated',jsonb_array_length(p_edits));
  end if;
  return public.edit_reflect_item_memories(p_user_id,p_reflect_id,p_edits);
end $$;
revoke all on function public.edit_durable_reflect_memories(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.edit_durable_reflect_memories(uuid,uuid,jsonb) to service_role;

-- Keep the old signature usable while serializing old/new clients consistently.
-- In particular, a legacy finalize request racing prepare must not create a
-- second reflection after prepare has reserved the first one.
do $$ begin
  if to_regprocedure('public.finalize_reflect_draft_legacy(uuid,uuid,jsonb,jsonb,integer,text)') is null then
    alter function public.finalize_reflect_draft(uuid,uuid,jsonb,jsonb,integer,text) rename to finalize_reflect_draft_legacy;
  end if;
end $$;
create or replace function public.finalize_reflect_draft(
  p_user_id uuid,p_draft_id uuid,p_memories jsonb,p_visibility jsonb,p_xp_amount integer,p_iso_week text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.reflect_drafts%rowtype; edits jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into d from public.reflect_drafts where id=p_draft_id and user_id=p_user_id for update;
  if d.saved_reflect_id is null then
    return public.finalize_reflect_draft_legacy(p_user_id,p_draft_id,p_memories,p_visibility,p_xp_amount,p_iso_week);
  end if;
  select coalesce(jsonb_agg(m || jsonb_build_object('edited',true,'visible',
    coalesce((select (v->>'visible')::boolean from jsonb_array_elements(coalesce(p_visibility,'[]')) v
      where v->>'itemId'=m->>'itemId' limit 1),true))),'[]')
    into edits from jsonb_array_elements(coalesce(p_memories,'[]')) m;
  return public.complete_saved_reflect(p_user_id,p_draft_id,edits,d.settlement_revision+1);
end $$;
revoke all on function public.finalize_reflect_draft(uuid,uuid,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_reflect_draft(uuid,uuid,jsonb,jsonb,integer,text) to service_role;
