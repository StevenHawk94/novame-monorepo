begin;

-- Prepared branches are display snapshots, not reward authorizations. Keep
-- both modes valid: a later partner answer must not rewrite an open dialogue.
create table public.friend_visit_preparations_v3 (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.friend_visit_instances_v2(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check(mode in ('independent','followup')),
  other_answerer uuid references public.profiles(id),
  snapshot jsonb not null,
  unique(visit_id,user_id,mode)
);
alter table public.friend_visit_preparations_v3 enable row level security;
revoke all on public.friend_visit_preparations_v3 from public,anon,authenticated;
grant all on public.friend_visit_preparations_v3 to service_role;

create function public.prepare_friend_visit_v3(p_user_id uuid,p_visit_id uuid,p_pair_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; v friend_visit_instances_v2%rowtype; other friend_visit_answers_v2%rowtype;
  prepared friend_visit_preparations_v3%rowtype; role text; partner_name text; options jsonb;
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
  select * into other from friend_visit_answers_v2 where visit_id=v.id and user_id=partner;
  role:=case when other.user_id is null then 'independent' else 'followup' end;
  select * into prepared from friend_visit_preparations_v3 where visit_id=v.id and user_id=p_user_id and mode=role;
  if not found then
    select coalesce(nullif(display_name,''),'your partner') into partner_name from profiles where id=partner;
    select jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label',
      'feedback',(select jsonb_agg(replace(line,'{partner}',partner_name) order by n)
        from jsonb_array_elements_text(case when v.kind in('Preference','Guess') and other.user_id is not null
          then v.content_snapshot->'coupleReplies'->(other.choice_id||':'||(c->>'id')) else c->'reply' end)
          with ordinality lines(line,n)),
      'reward',case when v.kind='Trivia' and c->>'id' is distinct from v.content_snapshot->>'correctOption'
        then (v.content_snapshot->>'coinsIfWrong')::integer else (v.content_snapshot->>'coinsIfCorrect')::integer end) order by ord)
      into options from jsonb_array_elements(v.content_snapshot->'choices') with ordinality choices(c,ord);
    if options is null or exists(select 1 from jsonb_array_elements(options) c
      where c->'feedback' is null or c->'feedback'='null'::jsonb or jsonb_array_length(c->'feedback')=0)
      then return jsonb_build_object('error','content_unavailable'); end if;
    insert into friend_visit_preparations_v3(visit_id,user_id,mode,other_answerer,snapshot)
      values(v.id,p_user_id,role,other.user_id,jsonb_build_object('visitId',v.id,'pairVersion',v.pair_version,
        'friendId',v.friend_id,'mode',role,'type',v.kind,'scene',v.content_snapshot->>'scene',
        'lines',v.content_snapshot->'lines','question',case when v.kind='Guess' and other.user_id is not null
          then v.content_snapshot->>'selfQuestion' else v.content_snapshot->>'question' end,'choices',options))
      returning * into prepared;
  end if;
  return prepared.snapshot||jsonb_build_object('error',null,'sessionId',prepared.id,'expiresAt',v.expires_at,'serverNow',now());
end $$;

create function public.respond_friend_visit_v3(p_user_id uuid,p_visit_id uuid,p_session_id uuid,p_pair_version text,p_choice text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; v friend_visit_instances_v2%rowtype; prepared friend_visit_preparations_v3%rowtype; result jsonb; feedback jsonb;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null or p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
    then return jsonb_build_object('error','pair_changed'); end if;
  select * into v from friend_visit_instances_v2 where id=p_visit_id and pair_low=least(p_user_id,partner)
    and pair_high=greatest(p_user_id,partner) and pair_version=p_pair_version for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into prepared from friend_visit_preparations_v3 where id=p_session_id and visit_id=v.id and user_id=p_user_id;
  if not found then return jsonb_build_object('error','visit_session_changed'); end if;
  -- Reuse the existing atomic wallet transaction, expiry, unlock and replay
  -- checks. Never trust client-supplied rewards or feedback. The visit lock
  -- serializes this bridge with legacy clients and other devices.
  insert into friend_visit_sessions_v2(visit_id,user_id,id,other_answerer)
    values(v.id,p_user_id,prepared.id,prepared.other_answerer)
    on conflict(visit_id,user_id) do update set id=excluded.id,other_answerer=excluded.other_answerer;
  result:=respond_friend_visit_v2(p_user_id,p_visit_id,prepared.id,p_pair_version,p_choice);
  if result->>'error' is null and result->>'applied'='true' then
    -- Names may change during reading. Keep the rendered text frozen too;
    -- eligibility and actual credited amount still come from the transaction.
    select c->'feedback' into feedback from jsonb_array_elements(prepared.snapshot->'choices') c where c->>'id'=p_choice;
    result:=result||jsonb_build_object('feedback',feedback);
    update friend_visit_answers_v2 set response=result where visit_id=v.id and user_id=p_user_id;
  end if;
  return result;
end $$;

-- Only a boolean invalidation hint leaves the summary; no partner choice.
create or replace function public.friend_visit_view_v2(p_user_id uuid,p_visit_id uuid) returns jsonb
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
    'waitingCopy',case when answered then replace(v.waiting_line,'{partner}',partner_name) end,
    'partnerCompleted',exists(select 1 from friend_visit_answers_v2 where visit_id=v.id and user_id=partner));
end $$;

-- first_seen_at is immutable. interaction_completed_at is overwritten by a
-- repeat Adventure encounter and must never drive the first-meeting cooldown.
do $$ declare original text; revised text; begin
  original:=pg_get_functiondef('public.schedule_friend_visit_v2(uuid,date)'::regprocedure);
  revised:=replace(original,'and d.interaction_completed_at is not null and (d.source_adventure_id',
    'and d.interaction_completed_at is not null
      and (d.first_seen_at at time zone coalesce((select timezone from friend_visit_schedule_v2
        where pair_low=lo and pair_high=hi and pair_version=version),''UTC''))::date < p_day
      and (d.source_adventure_id');
  if revised=original then raise exception 'Unrecognized friend visit scheduler'; end if;
  execute revised;
end $$;

-- Do not erase history or interrupt conversations already started on old
-- clients. Retire only premature, untouched instances created before upgrade.
update friend_visit_instances_v2 v set ended_at=now()
where v.ended_at is null and v.first_completed_at is null
  and not exists(select 1 from friend_visit_sessions_v2 s where s.visit_id=v.id)
  and not exists(select 1 from user_friend_discoveries d where d.friend_id=v.friend_id and d.user_id in(v.pair_low,v.pair_high)
    and d.interaction_completed_at is not null and (d.first_seen_at at time zone coalesce(
      (select timezone from friend_visit_schedule_v2 where pair_low=v.pair_low and pair_high=v.pair_high and pair_version=v.pair_version),'UTC'))::date < v.visit_date);

revoke all on function public.prepare_friend_visit_v3(uuid,uuid,text),public.respond_friend_visit_v3(uuid,uuid,uuid,text,text),
  public.friend_visit_view_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_friend_visit_v3(uuid,uuid,text),public.respond_friend_visit_v3(uuid,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
