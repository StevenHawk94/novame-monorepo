-- Retire automatic keyword matching without deleting any records, item IDs,
-- display metadata, icon mapping, manual selection or transaction functions.
begin;
set local lock_timeout = '5s';

revoke all on function public.item_rule_snapshot(text,bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_item_rules_batch(text,jsonb,bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_item_learning_jobs()
  from public, anon, authenticated, service_role;
revoke all on function public.record_item_learning_evidence(uuid,text,text,text,text,numeric,boolean)
  from public, anon, authenticated, service_role;

-- Keep old evidence and queue rows readable for audit, but stop stale workers
-- and older deployed API instances from producing or processing more work.
revoke all on table public.item_learning_candidates, public.item_learning_jobs,
  public.item_learning_occurrences, public.item_learning_decisions,
  public.item_match_removals, public.item_keyword_rule_events
  from public, anon, authenticated, service_role;
grant select on table public.item_learning_candidates, public.item_learning_jobs,
  public.item_learning_occurrences, public.item_learning_decisions,
  public.item_match_removals, public.item_keyword_rule_events to service_role;
revoke all on sequence public.item_keyword_rule_events_revision_seq
  from public, anon, authenticated, service_role;
commit;
