-- Let an authenticated admin explicitly publish reviewed one-word AUTO rules
-- and reversible NEVER_AUTO overrides. Automatic learning still only creates
-- suggestions; it cannot publish either mode without an admin decision.
begin;

alter table public.item_keyword_rule_events
  drop constraint if exists item_keyword_rule_events_action_check,
  drop constraint if exists item_keyword_rule_events_trigger_mode_check,
  drop constraint if exists item_keyword_rule_events_keyword_type_check;

alter table public.item_keyword_rule_events
  add constraint item_keyword_rule_events_action_check
    check (action in ('enable','disable','never','reset')),
  add constraint item_keyword_rule_events_trigger_mode_check
    check (trigger_mode in ('AUTO','NEVER_AUTO')),
  add constraint item_keyword_rule_events_keyword_type_check
    check (keyword_type in ('Word','Phrase'));

create or replace function public.publish_item_rule(p_catalog text, p_keyword text, p_item_id text,
  p_action text, p_expected_revision bigint, p_admin uuid, p_candidate uuid default null, p_removal uuid default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_latest bigint; v_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtext('item_keyword_rules'));
  select coalesce(max(revision),0) into v_latest from item_keyword_rule_events where catalog_version=p_catalog;
  if v_latest <> p_expected_revision then raise exception 'rule_version_conflict'; end if;
  insert into item_keyword_rule_events(
    catalog_version, keyword, item_id, action, trigger_mode, keyword_type, reviewed_by
  ) values (
    p_catalog, p_keyword, p_item_id, p_action,
    case when p_action = 'never' then 'NEVER_AUTO' else 'AUTO' end,
    case when position(' ' in btrim(p_keyword)) > 0 then 'Phrase' else 'Word' end,
    p_admin
  ) returning revision into v_revision;
  if p_candidate is not null then
    update item_learning_candidates set status='published',safety_mode='AUTO',suggested_item_id=p_item_id,reviewed_at=now(),published_version=v_revision::text where id=p_candidate;
  end if;
  if p_removal is not null then update item_match_removals set status='approved' where id=p_removal; end if;
  return v_revision;
end $$;

revoke all on function public.publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)
  to service_role;

commit;
