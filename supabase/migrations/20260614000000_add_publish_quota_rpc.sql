-- Atomic publish-quota gate (publish-quota TOCTOU race fix).
--
-- Re-counts a user's cards in the current billing window under a per-user
-- advisory lock and INSERTs the card only if still under the limit, so
-- concurrent publishes can no longer each pass a stale pre-check and all
-- create a card. Called only by the API (service_role); revoked from
-- anon/authenticated so PostgREST does not expose it as a client-callable
-- insert path. Uses jsonb_populate_record to map the payload onto
-- wisdom_cards using the table's own column types (no manual casts).

create or replace function public.insert_wisdom_card_if_under_quota(
  p_user_id uuid,
  p_period_start timestamptz,
  p_limit integer,
  p_card jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_rec public.wisdom_cards;
  v_row public.wisdom_cards;
begin
  -- Serialize concurrent publishes for THIS user (txn-scoped, auto-released).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Same window + filters as the JS quota gate: exclude starter/default
  -- cards (wisdom_id IS NULL), count from the caller's billing-period start.
  select count(*) into v_used
  from public.wisdom_cards
  where user_id = p_user_id
    and wisdom_id is not null
    and created_at >= p_period_start;

  if v_used >= p_limit then
    return jsonb_build_object('quota_exceeded', true, 'used', v_used, 'limit', p_limit);
  end if;

  -- Map payload onto a row using the table's own column types. Only the
  -- columns the API sets are inserted; id/created_at use DB defaults.
  -- user_id is forced to p_user_id (a tampered p_card.user_id is ignored).
  v_rec := jsonb_populate_record(null::public.wisdom_cards, p_card);

  insert into public.wisdom_cards (
    wisdom_id, user_id, keyword_id, quote_short, insight_full, peer_comment,
    card_a, reframe, reflective_question, wisdom_emotion, task_1, task_2,
    creator_name, creator_avatar, aspire_impacts
  ) values (
    v_rec.wisdom_id, p_user_id, v_rec.keyword_id, v_rec.quote_short, v_rec.insight_full, v_rec.peer_comment,
    v_rec.card_a, v_rec.reframe, v_rec.reflective_question, v_rec.wisdom_emotion, v_rec.task_1, v_rec.task_2,
    v_rec.creator_name, v_rec.creator_avatar, v_rec.aspire_impacts
  )
  returning * into v_row;

  return jsonb_build_object('quota_exceeded', false, 'card', to_jsonb(v_row));
end;
$$;

revoke all on function public.insert_wisdom_card_if_under_quota(uuid, timestamptz, integer, jsonb) from public;
revoke all on function public.insert_wisdom_card_if_under_quota(uuid, timestamptz, integer, jsonb) from anon;
revoke all on function public.insert_wisdom_card_if_under_quota(uuid, timestamptz, integer, jsonb) from authenticated;
grant execute on function public.insert_wisdom_card_if_under_quota(uuid, timestamptz, integer, jsonb) to service_role;
