-- Finite, couple-scoped visits. Content/answers are service-only; bootstrap
-- exposes a redacted per-viewer state, never correct answers or partner picks.
begin;
create table public.friend_visit_characters_v2 (
  friend_id text primary key references friend_definitions(stable_id),
  waiting_lines jsonb not null check(jsonb_array_length(waiting_lines)=2)
);
create table public.friend_visit_questions_v2 (
  id text primary key, friend_id text not null references friend_definitions(stable_id),
  kind text not null check(kind in('Trivia','Preference','Guess')),
  content jsonb not null, status text not null default 'active' check(status in('active','retired'))
);
create index friend_visit_question_pool on public.friend_visit_questions_v2(friend_id,kind) where status='active';
create table public.friend_visit_schedule_v2 (
  pair_low uuid not null references profiles(id) on delete cascade,
  pair_high uuid not null references profiles(id) on delete cascade,
  pair_version text not null, timezone text not null,
  primary key(pair_low,pair_high,pair_version), check(pair_low<pair_high)
);
create table public.friend_visit_instances_v2 (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references profiles(id) on delete cascade,
  pair_high uuid not null references profiles(id) on delete cascade,
  pair_version text not null, visit_date date not null,
  friend_id text not null references friend_definitions(stable_id),
  question_id text not null references friend_visit_questions_v2(id),
  kind text not null check(kind in('Trivia','Preference','Guess')),
  content_snapshot jsonb not null, waiting_line text not null,
  created_at timestamptz not null default now(),
  first_completed_at timestamptz, expires_at timestamptz, ended_at timestamptz,
  unique(pair_low,pair_high,pair_version,visit_date),
  unique(pair_low,pair_high,pair_version,question_id), check(pair_low<pair_high)
);
create unique index friend_visit_one_active_v2 on public.friend_visit_instances_v2(pair_low,pair_high,pair_version) where ended_at is null;
create index friend_visit_recent_v2 on public.friend_visit_instances_v2(pair_low,pair_high,pair_version,friend_id,visit_date desc);
create table public.friend_visit_sessions_v2 (
  visit_id uuid not null references friend_visit_instances_v2(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid(), other_answerer uuid,
  primary key(visit_id,user_id), unique(id)
);
create table public.friend_visit_answers_v2 (
  visit_id uuid not null references friend_visit_instances_v2(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  choice_id text not null, response jsonb not null, completed_at timestamptz not null default now(),
  primary key(visit_id,user_id)
);
alter table public.user_friend_discoveries add column source_visit_id uuid references friend_visit_instances_v2(id) on delete set null;
do $$ declare t text; begin
  foreach t in array array['friend_visit_characters_v2','friend_visit_questions_v2','friend_visit_schedule_v2',
    'friend_visit_instances_v2','friend_visit_sessions_v2','friend_visit_answers_v2'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create trigger burrow_change after insert or update or delete on public.friend_visit_instances_v2
  for each row execute function public.broadcast_burrow_change();

create function public.friend_visit_view_v2(p_user_id uuid,p_visit_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; v friend_visit_instances_v2%rowtype; answered boolean; partner_name text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return null; end if;
  select * into v from friend_visit_instances_v2 where id=p_visit_id
    and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)
    and pair_version=burrow_pair_version_v1(p_user_id,partner) and ended_at is null
    and (expires_at is null or expires_at>now());
  if not found then return null; end if;
  answered:=exists(select 1 from friend_visit_answers_v2 where visit_id=v.id and user_id=p_user_id);
  select coalesce(nullif(display_name,''),'your partner') into partner_name from profiles where id=partner;
  return jsonb_build_object('version',2,'id',v.id,'friend_id',v.friend_id,'visit_date',v.visit_date,
    'pairVersion',v.pair_version,'myCompleted',answered,'expiresAt',v.expires_at,
    'waitingCopy',case when answered then replace(v.waiting_line,'{partner}',partner_name) end);
end $$;

-- A reusable day-based scheduler makes the calendar rules testable without
-- changing production clocks. It is internal (not granted to service_role).
create function public.schedule_friend_visit_v2(p_user_id uuid,p_day date) returns uuid
language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; version text; v friend_visit_instances_v2%rowtype;
  f text; question friend_visit_questions_v2%rowtype; previous_kind text; category text; waiting jsonb;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return null; end if;
  lo:=least(p_user_id,partner); hi:=greatest(p_user_id,partner); version:=burrow_pair_version_v1(lo,hi);
  perform pg_advisory_xact_lock(hashtextextended('friend-visits:'||lo::text||':'||hi::text,0));
  update friend_visit_instances_v2 set ended_at=expires_at where pair_low=lo and pair_high=hi
    and pair_version=version and ended_at is null and expires_at<=now();
  select * into v from friend_visit_instances_v2 where pair_low=lo and pair_high=hi and pair_version=version
    and ended_at is null order by created_at desc limit 1;
  if found then return v.id; end if;
  if exists(select 1 from friend_visit_instances_v2 where pair_low=lo and pair_high=hi
    and pair_version=version and visit_date>=p_day) then return null; end if;
  -- Weighted random: fewer appearances this week / longer absence is favored.
  -- Four eligible, unexhausted friends provide >=8 weekly slots for 7 days.
  select x.stable_id into f from friend_definitions x
    cross join lateral(select count(*) n,max(visit_date) last_day from friend_visit_instances_v2
      where pair_low=lo and pair_high=hi and pair_version=version and friend_id=x.stable_id
      and visit_date>=date_trunc('week',p_day::timestamp)::date) w
    where x.status='active' and x.metadata->>'adventureV2'='true'
      and x.revision_id=(select value from app_config where key='app_major_update_content_revision')
      and exists(select 1 from content_revisions r where r.id=x.revision_id and r.status='published')
      and exists(select 1 from user_friend_discoveries d where d.friend_id=x.stable_id and d.user_id in(lo,hi)
        and d.interaction_completed_at is not null and (d.source_adventure_id is not null or exists(
          select 1 from adventure_dialogue_completions c join adventure_dialogues_v2 ad on ad.id=c.dialogue_id
          where c.user_id=d.user_id and ad.friend_id=d.friend_id)))
      and exists(select 1 from friend_visit_questions_v2 q where q.friend_id=x.stable_id and q.status='active'
        and not exists(select 1 from friend_visit_instances_v2 old where old.pair_low=lo and old.pair_high=hi
          and old.pair_version=version and old.question_id=q.id))
      and w.n<2 and not exists(select 1 from friend_visit_instances_v2 recent where recent.pair_low=lo
        and recent.pair_high=hi and recent.pair_version=version and recent.friend_id=x.stable_id and recent.visit_date>=p_day-1)
    order by -ln(greatest(random(),0.000001))/((2-w.n)*(1+least(14,p_day-coalesce(w.last_day,p_day-14))/7.0)) limit 1;
  if f is null then return null; end if;
  select kind into previous_kind from friend_visit_instances_v2 where pair_low=lo and pair_high=hi
    and pair_version=version and friend_id=f order by visit_date desc limit 1;
  -- Random within category, rotate categories, skip exhausted categories.
  foreach category in array case previous_kind when 'Trivia' then array['Preference','Guess','Trivia']
    when 'Preference' then array['Guess','Trivia','Preference'] else array['Trivia','Preference','Guess'] end loop
    select * into question from friend_visit_questions_v2 q where friend_id=f and kind=category and status='active'
      and not exists(select 1 from friend_visit_instances_v2 old where old.pair_low=lo and old.pair_high=hi
        and old.pair_version=version and old.question_id=q.id) order by random() limit 1;
    if found then exit; end if;
  end loop;
  select waiting_lines into waiting from friend_visit_characters_v2 where friend_id=f;
  insert into friend_visit_instances_v2(pair_low,pair_high,pair_version,visit_date,friend_id,question_id,kind,content_snapshot,waiting_line)
    values(lo,hi,version,p_day,f,question.id,question.kind,question.content,waiting->>floor(random()*2)::integer)
    returning id into v.id;
  return v.id;
end $$;

-- Existing bootstrap composition calls this entry point. Replace old gift /
-- Rage visits; old records remain intact but can no longer mint visit rewards.
create or replace function public.ensure_friend_visit_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; version text; tz text; today date; id uuid;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  lo:=least(p_user_id,partner); hi:=greatest(p_user_id,partner); version:=burrow_pair_version_v1(lo,hi);
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where profiles.id=lo;
  insert into friend_visit_schedule_v2 values(lo,hi,version,tz) on conflict do nothing;
  select timezone into tz from friend_visit_schedule_v2 where pair_low=lo and pair_high=hi and pair_version=version;
  today:=(now() at time zone tz)::date; id:=schedule_friend_visit_v2(p_user_id,today);
  return jsonb_build_object('error',null,'visit',friend_visit_view_v2(p_user_id,id),'visitDate',today,'timezone',tz);
end $$;
create or replace function public.respond_friend_visit_v1(p_user_id uuid,p_visit_id uuid,p_response jsonb) returns jsonb
language sql security definer set search_path=public as $$ select jsonb_build_object('error','client_upgrade_required') $$;

alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_pre_friend_visits_v2;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language sql security definer set search_path=public as $$
  -- Old deployed APIs/clients expect a legacy content_snapshot. Keep that
  -- slot null across rollout; the opted-in API bridges the new projection.
  select snapshot||jsonb_build_object('friendVisitsVersion',2,
    'coupleFriendVisit',snapshot->'friendVisit','friendVisit',null)
    from (select burrow_bootstrap_pre_friend_visits_v2(p_user_id) snapshot) s;
$$;
revoke all on function public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.burrow_bootstrap_v1(uuid) to service_role;

create function public.begin_friend_visit_v2(p_user_id uuid,p_visit_id uuid,p_pair_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; v friend_visit_instances_v2%rowtype; session friend_visit_sessions_v2%rowtype; other_id uuid; question text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null or p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
    then return jsonb_build_object('error','pair_changed'); end if;
  select * into v from friend_visit_instances_v2 where id=p_visit_id and pair_low=least(p_user_id,partner)
    and pair_high=greatest(p_user_id,partner) and pair_version=p_pair_version for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if exists(select 1 from friend_visit_answers_v2 where visit_id=v.id and user_id=p_user_id)
    then return jsonb_build_object('error','already_completed'); end if;
  if v.ended_at is not null or v.expires_at<=now() then return jsonb_build_object('error','visit_expired'); end if;
  select user_id into other_id from friend_visit_answers_v2 where visit_id=v.id and user_id=partner;
  insert into friend_visit_sessions_v2(visit_id,user_id,other_answerer) values(v.id,p_user_id,other_id)
    on conflict(visit_id,user_id) do update set id=gen_random_uuid(),other_answerer=excluded.other_answerer returning * into session;
  question:=case when v.kind='Guess' and other_id is not null then v.content_snapshot->>'selfQuestion'
    else v.content_snapshot->>'question' end;
  return jsonb_build_object('error',null,'sessionId',session.id,'visitId',v.id,'pairVersion',v.pair_version,
    'type',v.kind,'scene',v.content_snapshot->>'scene','lines',v.content_snapshot->'lines','question',question,
    'choices',(select jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label'))
      from jsonb_array_elements(v.content_snapshot->'choices') c));
end $$;

create function public.skip_visit_stranger_plans_v1(p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare p adventure_encounter_plans%rowtype; next_dialogue adventure_dialogues_v2%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  for p in select ep.* from adventure_encounter_plans ep join adventure_dialogues_v2 d on d.id=ep.dialogue_id
    where ep.user_id=p_user_id and d.phase='Intro' and d.seq=1 and ep.status in('reserved','bound')
      and exists(select 1 from user_friend_discoveries u where u.user_id=p_user_id and u.friend_id=ep.friend_id and u.source_visit_id is not null)
      and (ep.status='reserved' or exists(select 1 from adventures a where a.id=ep.adventure_id and a.status='in_progress')) for update of ep loop
    select d.* into next_dialogue from adventure_dialogues_v2 d where d.friend_id=p.friend_id and d.status='active'
      and not(d.phase='Intro' and d.seq=1)
      and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id=d.id)
      and not exists(select 1 from adventure_encounter_plans ep where ep.user_id=p_user_id and ep.dialogue_id=d.id and ep.status<>'cancelled' and ep.id<>p.id)
      order by case when d.phase='Intro' then 0 else 1 end,d.seq limit 1;
    if next_dialogue.id is not null then
      update adventure_encounter_plans set dialogue_id=next_dialogue.id,snapshot=jsonb_set(snapshot,'{dialogue}',next_dialogue.content) where id=p.id;
    else
      update adventure_encounter_plans set friend_id=null,dialogue_id=null,snapshot=snapshot||'{"dialogue":null,"friendSnapshot":null}'::jsonb where id=p.id;
    end if;
  end loop;
end $$;

create function public.respond_friend_visit_v2(p_user_id uuid,p_visit_id uuid,p_session_id uuid,p_pair_version text,p_choice text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; v friend_visit_instances_v2%rowtype; s friend_visit_sessions_v2%rowtype;
  prior friend_visit_answers_v2%rowtype; other friend_visit_answers_v2%rowtype;
  choice jsonb; lines jsonb; reward integer; credit jsonb; result jsonb; partner_name text; key text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null or p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
    then return jsonb_build_object('error','pair_changed'); end if;
  select * into v from friend_visit_instances_v2 where id=p_visit_id and pair_low=least(p_user_id,partner)
    and pair_high=greatest(p_user_id,partner) and pair_version=p_pair_version for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into prior from friend_visit_answers_v2 where visit_id=v.id and user_id=p_user_id;
  if found then
    if prior.choice_id is distinct from p_choice then return jsonb_build_object('error','idempotency_conflict'); end if;
    return prior.response||jsonb_build_object('applied',false,'reward',0,'coinReward',jsonb_build_object('key','friend-visit:'||v.id::text,'amount',0));
  end if;
  if v.ended_at is not null or v.expires_at<=now() then return jsonb_build_object('error','visit_expired'); end if;
  select * into s from friend_visit_sessions_v2 where visit_id=v.id and user_id=p_user_id and id=p_session_id;
  if not found then return jsonb_build_object('error','visit_session_changed'); end if;
  select c into choice from jsonb_array_elements(v.content_snapshot->'choices') c where c->>'id'=p_choice;
  if choice is null then return jsonb_build_object('error','invalid_response'); end if;
  lines:=choice->'reply';
  select * into other from friend_visit_answers_v2 where visit_id=v.id and user_id=partner;
  -- Both opened before any answer: retain each initiator's frozen question /
  -- personal feedback. Only a session begun AFTER a partner's committed answer
  -- uses the ordered pair matrix. Trivia always has its own uniform feedback.
  if v.kind in('Preference','Guess') and s.other_answerer is not null and other.user_id is not null then
    lines:=v.content_snapshot->'coupleReplies'->(other.choice_id||':'||p_choice);
  end if;
  if lines is null or jsonb_array_length(lines)=0 then return jsonb_build_object('error','content_unavailable'); end if;
  select coalesce(nullif(display_name,''),'your partner') into partner_name from profiles where id=partner;
  select jsonb_agg(replace(value,'{partner}',partner_name) order by ord) into lines
    from jsonb_array_elements_text(lines) with ordinality r(value,ord);
  reward:=case when v.kind='Trivia' and p_choice is distinct from v.content_snapshot->>'correctOption'
    then (v.content_snapshot->>'coinsIfWrong')::integer else (v.content_snapshot->>'coinsIfCorrect')::integer end;
  key:='friend-visit:'||v.id::text;
  credit:=change_carrot_balance_v1(p_user_id,reward,'friend_visit','friend_visit',v.id::text,key);
  if credit->>'error' is not null then raise exception 'Visit wallet settlement failed: %',credit->>'error'; end if;
  result:=jsonb_build_object('error',null,'applied',true,'feedback',lines,'reward',(credit->>'delta')::integer,
    'coinReward',jsonb_build_object('key',key,'amount',(credit->>'delta')::integer));
  insert into friend_visit_answers_v2(visit_id,user_id,choice_id,response) values(v.id,p_user_id,p_choice,result);
  update friend_visit_instances_v2 set first_completed_at=coalesce(first_completed_at,now()),
    expires_at=coalesce(expires_at,now()+interval '24 hours'),ended_at=case when other.user_id is not null then now() end where id=v.id;
  -- Personal unlock is granted ONLY by a committed answer, never room entry.
  insert into user_friend_discoveries(user_id,friend_id,interaction_completed_at,source_visit_id)
    values(p_user_id,v.friend_id,now(),v.id) on conflict(user_id,friend_id) do update
      set source_visit_id=coalesce(user_friend_discoveries.source_visit_id,
        case when user_friend_discoveries.interaction_completed_at is null then excluded.source_visit_id end),
        interaction_completed_at=coalesce(user_friend_discoveries.interaction_completed_at,excluded.interaction_completed_at);
  perform skip_visit_stranger_plans_v1(p_user_id);
  return result;
end $$;

-- Keep all existing Adventure reward/treasure reservations; only exclude the
-- initial Stranger dialogue for personal visit unlocks (no fake completion).
do $$ declare original text; revised text; alias text; selector regprocedure; begin
  -- Migration 218 wraps the selector to reserve separate chest furniture.
  -- Patch the underlying friend selector, never replace that chest wrapper.
  selector:=coalesce(to_regprocedure('public.prepare_adventure_friend_gifts_v2(uuid)'),
    to_regprocedure('public.prepare_adventure_encounters_v2(uuid)'));
  original:=pg_get_functiondef(selector); revised:=original;
  foreach alias in array array['y','z'] loop
    revised:=replace(revised,'and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id='||alias||'.id)',
      'and not ('||alias||'.phase=''Intro'' and '||alias||'.seq=1 and exists(select 1 from user_friend_discoveries vd where vd.user_id=p_user_id and vd.friend_id='||alias||'.friend_id and vd.source_visit_id is not null))
        and not exists(select 1 from adventure_dialogue_completions c where c.user_id=p_user_id and c.dialogue_id='||alias||'.id)');
  end loop;
  if revised=original then raise exception 'Unrecognized Adventure selector'; end if;
  execute revised;
end $$;
revoke all on function public.friend_visit_view_v2(uuid,uuid),public.schedule_friend_visit_v2(uuid,date),
  public.skip_visit_stranger_plans_v1(uuid),public.begin_friend_visit_v2(uuid,uuid,text),
  public.respond_friend_visit_v2(uuid,uuid,uuid,text,text),public.ensure_friend_visit_v1(uuid),
  public.respond_friend_visit_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_friend_visit_v2(uuid,uuid,text),public.respond_friend_visit_v2(uuid,uuid,uuid,text,text),
  public.ensure_friend_visit_v1(uuid),public.respond_friend_visit_v1(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
