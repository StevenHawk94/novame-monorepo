-- Admin-only learning evidence and versioned, reversible rule overrides.
-- Does not alter Reflect quotas, page caches, pairing or Connection policy.
begin;
set local lock_timeout = '5s';
alter table public.item_learning_candidates
  add column if not exists source_phrase text,
  add column if not exists evidence_version integer not null default 1,
  add column if not exists bare_word_disabled boolean not null default false;
alter table public.item_learning_jobs
  add column if not exists evidence_version integer not null default 1,
  add column if not exists claimed_at timestamptz;

create table if not exists public.item_learning_occurrences (
  candidate_id uuid not null references public.item_learning_candidates(id) on delete cascade,
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  primary key(candidate_id, reflect_id)
);
create table if not exists public.item_learning_decisions (
  catalog_version text not null, signal_key text not null,
  decision jsonb not null, created_at timestamptz not null default now(),
  primary key(catalog_version,signal_key)
);
alter table public.item_learning_decisions enable row level security;
revoke all on public.item_learning_decisions from anon,authenticated;
grant all on public.item_learning_decisions to service_role;
create table if not exists public.item_match_removals (
  id uuid primary key default gen_random_uuid(),
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  item_id text not null, icon_name text not null,
  keyword text not null check(length(keyword) between 1 and 100),
  catalog_version text not null, rule_revision bigint not null default 0,
  status text not null default 'pending' check(status in ('pending','rejected','approved')),
  created_at timestamptz not null default now(),
  unique(reflect_id, item_id, keyword)
);
create table if not exists public.item_keyword_rule_events (
  revision bigint generated always as identity primary key,
  catalog_version text not null, keyword text not null,
  item_id text not null,
  action text not null check(action in ('enable','disable','reset')),
  trigger_mode text not null default 'AUTO' check(trigger_mode = 'AUTO'),
  keyword_type text not null default 'Phrase' check(keyword_type = 'Phrase'),
  reviewed_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists item_keyword_rule_lookup on public.item_keyword_rule_events(catalog_version, keyword, revision desc);
alter table public.item_learning_occurrences enable row level security;
alter table public.item_match_removals enable row level security;
alter table public.item_keyword_rule_events enable row level security;
revoke all on public.item_learning_occurrences, public.item_match_removals, public.item_keyword_rule_events from anon, authenticated;
grant all on public.item_learning_occurrences, public.item_match_removals, public.item_keyword_rule_events to service_role;
grant usage, select on sequence public.item_keyword_rule_events_revision_seq to service_role;

create or replace function public.item_rule_snapshot(p_catalog text, p_revision bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_revision bigint; v_rules jsonb;
begin
  select coalesce(max(revision),0) into v_revision from item_keyword_rule_events where catalog_version=p_catalog;
  if p_revision is not null then
    if p_revision < 0 or (p_revision <> 0 and not exists(select 1 from item_keyword_rule_events where catalog_version=p_catalog and revision=p_revision)) then
      raise exception 'unknown_rule_revision';
    end if;
    v_revision := p_revision;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rules from (
    select distinct on(keyword) keyword, item_id, action, revision
    from item_keyword_rule_events where catalog_version=p_catalog and revision<=v_revision
    order by keyword, revision desc
  ) r;
  return jsonb_build_object('catalog',p_catalog,'revision',v_revision,'rules',v_rules);
end $$;

create or replace function public.publish_item_rule(p_catalog text, p_keyword text, p_item_id text,
  p_action text, p_expected_revision bigint, p_admin uuid, p_candidate uuid default null, p_removal uuid default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_latest bigint; v_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtext('item_keyword_rules'));
  select coalesce(max(revision),0) into v_latest from item_keyword_rule_events where catalog_version=p_catalog;
  if v_latest <> p_expected_revision then raise exception 'rule_version_conflict'; end if;
  insert into item_keyword_rule_events(catalog_version,keyword,item_id,action,reviewed_by)
    values(p_catalog,p_keyword,p_item_id,p_action,p_admin) returning revision into v_revision;
  if p_candidate is not null then
    update item_learning_candidates set status='published',safety_mode='AUTO',suggested_item_id=p_item_id,reviewed_at=now(),published_version=v_revision::text where id=p_candidate;
  end if;
  if p_removal is not null then update item_match_removals set status='approved' where id=p_removal; end if;
  return v_revision;
end $$;

create or replace function public.claim_item_learning_jobs()
returns setof public.item_learning_jobs language sql security definer set search_path=public as $$
  update item_learning_jobs j set status='processing', attempts=j.attempts+1, claimed_at=now()
  where j.id in (
    select id from item_learning_jobs where evidence_version=2 and attempts<2
      and (status in ('pending','failed') or (status='processing' and claimed_at<now()-interval '15 minutes'))
    order by created_at for update skip locked limit 6
  ) returning j.*;
$$;

create or replace function public.record_item_learning_evidence(p_reflect uuid, p_kind text, p_phrase text,
  p_item text, p_name text, p_confidence numeric, p_bare boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_added integer;
begin
  insert into item_learning_candidates(kind,concept,normalized_concept,source_phrase,suggested_item_id,
    suggested_icon_name,confidence,evidence_version,bare_word_disabled,occurrence_count)
    values(p_kind,p_phrase,lower(p_phrase),p_phrase,p_item,p_name,p_confidence,2,p_bare,0) on conflict do nothing;
  select id into v_id from item_learning_candidates where kind=p_kind and normalized_concept=lower(p_phrase)
    and coalesce(suggested_item_id,'')=coalesce(p_item,'');
  insert into item_learning_occurrences(candidate_id,reflect_id) values(v_id,p_reflect) on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then update item_learning_candidates set occurrence_count=occurrence_count+1,
    source_phrase=p_phrase,evidence_version=2,bare_word_disabled=p_bare,last_seen_at=now() where id=v_id; end if;
end $$;

revoke all on function public.item_rule_snapshot(text,bigint) from public,anon,authenticated;
revoke all on function public.publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_item_learning_jobs() from public,anon,authenticated;
revoke all on function public.record_item_learning_evidence(uuid,text,text,text,text,numeric,boolean) from public,anon,authenticated;
grant execute on function public.item_rule_snapshot(text,bigint) to service_role;
grant execute on function public.publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid) to service_role;
grant execute on function public.claim_item_learning_jobs() to service_role;
grant execute on function public.record_item_learning_evidence(uuid,text,text,text,text,numeric,boolean) to service_role;
commit;
