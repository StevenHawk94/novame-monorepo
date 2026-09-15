-- Publish a prevalidated Admin AUTO-keyword batch as one atomic revision change.
-- The API validates catalog ownership and NEVER_AUTO policy first; this RPC
-- provides the final concurrency boundary so a batch is all-or-nothing.
begin;

create or replace function public.publish_item_rules_batch(
  p_catalog text,
  p_rules jsonb,
  p_expected_revision bigint,
  p_admin uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_latest bigint;
  v_count integer;
  v_inserted integer;
  v_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtext('item_keyword_rules'));
  select coalesce(max(revision), 0) into v_latest
    from public.item_keyword_rule_events where catalog_version = p_catalog;
  if v_latest <> p_expected_revision then raise exception 'rule_version_conflict'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'invalid_rule_batch'; end if;
  v_count := jsonb_array_length(p_rules);
  if v_count < 1 or v_count > 25000 then raise exception 'invalid_rule_batch_size'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rules) as rule(keyword text, item_id text)
    where keyword is null or item_id is null
      or length(keyword) not between 1 and 100
      or keyword <> lower(keyword) or keyword <> btrim(keyword)
      or keyword !~ '^[a-z0-9]+([ '' ][a-z0-9'']+)*$'
      or length(item_id) not between 1 and 160
  ) then raise exception 'invalid_rule_batch_row'; end if;

  if exists (
    select keyword from jsonb_to_recordset(p_rules) as rule(keyword text, item_id text)
    group by keyword having count(*) > 1
  ) then raise exception 'duplicate_rule_batch_keyword'; end if;

  with source as (
    select rule.keyword, rule.item_id, ordinal
      from jsonb_array_elements(p_rules) with ordinality entry(value, ordinal)
      cross join lateral jsonb_to_record(entry.value) as rule(keyword text, item_id text)
  ), inserted as (
    insert into public.item_keyword_rule_events(
      catalog_version, keyword, item_id, action, trigger_mode, keyword_type, reviewed_by
    )
    select p_catalog, keyword, item_id, 'enable', 'AUTO',
      case when position(' ' in keyword) > 0 then 'Phrase' else 'Word' end,
      p_admin
    from source order by ordinal
    returning revision
  )
  select count(*)::integer, max(revision) into v_inserted, v_revision from inserted;

  return jsonb_build_object('count', v_inserted, 'revision', v_revision);
end
$$;

revoke all on function public.publish_item_rules_batch(text,jsonb,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.publish_item_rules_batch(text,jsonb,bigint,uuid)
  to service_role;

commit;
