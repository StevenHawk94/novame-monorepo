-- Connection Insight v8: staged matching, new dynamic sections, seven-day
-- pair facts, unmatched-template review, and append-only card history.

alter table public.reflect_drafts
  add column if not exists connection_event_candidates jsonb not null default '[]'::jsonb;

create or replace function public.store_reflect_generation_v2(
  p_user_id uuid, p_draft_id uuid, p_memories jsonb, p_bubble text,
  p_connection_events jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.reflect_drafts%rowtype; next_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into d from public.reflect_drafts where id=p_draft_id and user_id=p_user_id for update;
  if d.saved_reflect_id is null then return jsonb_build_object('error','saved_reflect_required'); end if;
  if d.finalized_reflect_id is not null then return jsonb_build_object('success',true); end if;
  select coalesce(jsonb_agg(case when coalesce((e->>'edited')::boolean,false)
    or nullif(p_memories->>(e->>'itemId'),'') is null then e
    else e || jsonb_build_object('text',p_memories->>(e->>'itemId'),'source','ai') end),'[]')
    into next_items from jsonb_array_elements(d.settlement_memories) e;
  update public.reflect_drafts set settlement_memories=next_items,
    ai_memories=ai_memories || coalesce(p_memories,'{}'),
    bubble=coalesce(p_bubble,bubble),
    connection_event_candidates=case when jsonb_typeof(p_connection_events)='array'
      then p_connection_events else '[]'::jsonb end
    where id=d.id;
  perform public.edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    (select coalesce(jsonb_agg(e || '{"visible":false}'::jsonb),'[]')
      from jsonb_array_elements(next_items) e));
  return jsonb_build_object('success',true);
end $$;
revoke all on function public.store_reflect_generation_v2(uuid,uuid,jsonb,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.store_reflect_generation_v2(uuid,uuid,jsonb,text,jsonb)
  to service_role;

create table if not exists public.connection_unmatched_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  local_date date not null,
  section text not null check (section in ('missed','world','together','on_their_mind')),
  emotion text not null check (emotion in ('Positive','Negative')),
  summary text not null,
  failure_stage text not null check (failure_stage in ('group','sub_scenario')),
  candidate_group text,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','covered','ignored')),
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id,fingerprint,failure_stage)
);
create index if not exists connection_unmatched_events_status_seen
  on public.connection_unmatched_events(status,last_seen_at desc);
alter table public.connection_unmatched_events enable row level security;
drop policy if exists connection_unmatched_events_service on public.connection_unmatched_events;
create policy connection_unmatched_events_service on public.connection_unmatched_events
  for all using (auth.role()='service_role') with check (auth.role()='service_role');

create table if not exists public.connection_tag_facts (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  reflect_id uuid not null references public.reflects(id) on delete cascade,
  local_date date not null,
  category text not null check (category in ('WYMM','TWL')),
  scenario_group text not null,
  sub_scenario text not null,
  emotion text not null check (emotion in ('Positive','Negative')),
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  check (author_user_id in (user_a,user_b)),
  unique(reflect_id,category,sub_scenario,emotion)
);
create index if not exists connection_tag_facts_pair_date
  on public.connection_tag_facts(user_a,user_b,local_date desc);
alter table public.connection_tag_facts enable row level security;
drop policy if exists connection_tag_facts_service on public.connection_tag_facts;
create policy connection_tag_facts_service on public.connection_tag_facts
  for all using (auth.role()='service_role') with check (auth.role()='service_role');

alter table public.connection_card_history
  drop constraint if exists connection_card_history_module_key_check;
alter table public.connection_card_history add constraint connection_card_history_module_key_check
  check (module_key in (
    'worth_knowing','recent_vibe','what_theyre_into','how_to_show_up',
    'talk_about','try_together','shared_rhythm','together_moments','on_their_mind_us'
  ));

create or replace function public.apply_connection_insight_updates_v3(
  p_user_a uuid, p_user_b uuid, p_for_user uuid, p_for_date date,
  p_reflect_id uuid, p_updates jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prior jsonb; v_modules jsonb; v_payload jsonb; v_key text;
  v_incoming jsonb; v_merged jsonb; v_allowed_parent_ids text[];
  v_limit integer; v_changed boolean := false;
begin
  if p_user_a >= p_user_b or p_for_user not in (p_user_a,p_user_b) then
    raise exception 'invalid connection pair';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_user_a::text||':'||p_user_b::text||':'||p_for_user::text,0));
  select payload into v_prior from public.connection_insights
    where user_a=p_user_a and user_b=p_user_b and for_user=p_for_user
    order by for_date desc limit 1;
  if coalesce((v_prior->>'schemaVersion')::integer,0)=3 then
    v_modules := coalesce(v_prior->'modules','{}'::jsonb);
  else v_modules := '{}'::jsonb;
  end if;

  foreach v_key in array array[
    'worth_knowing','recent_vibe','together_moments','on_their_mind_us','shared_rhythm'
  ] loop
    v_incoming := case when coalesce((p_updates->v_key->>'hasUpdate')::boolean,false)
      then coalesce(p_updates->v_key->'cards','[]'::jsonb) else '[]'::jsonb end;
    v_limit := case v_key when 'worth_knowing' then 2 when 'recent_vibe' then 2 else 1 end;
    insert into public.connection_card_history(
      user_a,user_b,for_user,source_reflect_id,source_key,module_key,card_index,card,for_date,created_at)
    select p_user_a,p_user_b,p_for_user,p_reflect_id,p_reflect_id::text,v_key,
      (e.ordinality-1)::smallint,e.value,p_for_date,now()
    from jsonb_array_elements(v_incoming) with ordinality e(value,ordinality)
    on conflict do nothing;
    select coalesce(jsonb_agg(card order by priority, ordinality),'[]'::jsonb) into v_merged
    from (
      select value card,0 priority,ordinality from jsonb_array_elements(v_incoming) with ordinality
      union all
      select value,1,ordinality from jsonb_array_elements(coalesce(v_modules->v_key,'[]'::jsonb))
        with ordinality where not exists (
          select 1 from jsonb_array_elements(v_incoming) n
          where n->>'contentId'=value->>'contentId')
      order by priority,ordinality limit v_limit
    ) cards;
    if coalesce(v_modules->v_key,'[]'::jsonb) is distinct from v_merged then
      v_modules:=jsonb_set(v_modules,array[v_key],v_merged,true); v_changed:=true;
    elsif not (v_modules ? v_key) then v_modules:=jsonb_set(v_modules,array[v_key],'[]'::jsonb,true);
    end if;
  end loop;

  select coalesce(array_agg(value->>'contentId'),array[]::text[]) into v_allowed_parent_ids
  from (
    select value from jsonb_array_elements(coalesce(v_modules->'worth_knowing','[]'::jsonb))
    union all select value from jsonb_array_elements(coalesce(v_modules->'recent_vibe','[]'::jsonb))
    union all select value from jsonb_array_elements(coalesce(v_modules->'together_moments','[]'::jsonb))
    union all select value from jsonb_array_elements(coalesce(v_modules->'on_their_mind_us','[]'::jsonb))
  ) live;
  v_key := 'how_to_show_up';
  v_incoming := case when coalesce((p_updates->v_key->>'hasUpdate')::boolean,false)
    then coalesce(p_updates->v_key->'cards','[]'::jsonb) else '[]'::jsonb end;
  insert into public.connection_card_history(
    user_a,user_b,for_user,source_reflect_id,source_key,module_key,card_index,card,for_date,created_at)
  select p_user_a,p_user_b,p_for_user,p_reflect_id,p_reflect_id::text,v_key,
    (e.ordinality-1)::smallint,e.value,p_for_date,now()
  from jsonb_array_elements(v_incoming) with ordinality e(value,ordinality)
  on conflict do nothing;
  select coalesce(jsonb_agg(card order by priority,ordinality),'[]'::jsonb) into v_merged from (
    select value card,0 priority,ordinality from jsonb_array_elements(v_incoming) with ordinality
      where value->>'parentCardId'=any(v_allowed_parent_ids)
    union all
    select value,1,ordinality from jsonb_array_elements(coalesce(v_modules->v_key,'[]'::jsonb))
      with ordinality where value->>'parentCardId'=any(v_allowed_parent_ids)
      and not exists (select 1 from jsonb_array_elements(v_incoming) n
        where n->>'contentId'=value->>'contentId')
    order by priority,ordinality limit 4
  ) cards;
  if coalesce(v_modules->v_key,'[]'::jsonb) is distinct from v_merged then
    v_modules:=jsonb_set(v_modules,array[v_key],v_merged,true); v_changed:=true;
  end if;
  foreach v_key in array array['what_theyre_into','talk_about','try_together'] loop
    v_modules:=jsonb_set(v_modules,array[v_key],'[]'::jsonb,true);
  end loop;
  v_payload:=jsonb_build_object('schemaVersion',3,'modules',v_modules,'updatedAt',now(),
    'lastProcessedReflectId',p_reflect_id);
  if not v_changed then return jsonb_build_object('changed',false,'payload',coalesce(v_prior,v_payload)); end if;
  insert into public.connection_insights(user_a,user_b,for_date,for_user,payload,created_at)
    values(p_user_a,p_user_b,p_for_date,p_for_user,v_payload,now())
    on conflict(user_a,user_b,for_date,for_user)
    do update set payload=excluded.payload,created_at=excluded.created_at;
  return jsonb_build_object('changed',true,'payload',v_payload);
end $$;
revoke all on function public.apply_connection_insight_updates_v3(uuid,uuid,uuid,date,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_connection_insight_updates_v3(uuid,uuid,uuid,date,uuid,jsonb)
  to service_role;
