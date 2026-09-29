-- Game Room: permanent per-account unlocks and pair-bound, server-scored rounds.
create table public.burrow_game_unlocks (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null check (game_id ~ '^[a-z_]+_[0-9]{2}$'),
  price_paid integer not null default 20 check (price_paid = 20),
  unlocked_at timestamptz not null default now(),
  primary key (owner_id, game_id)
);

create table public.burrow_game_sessions (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  pair_version text not null,
  game_id text not null,
  questions jsonb not null,
  started_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (pair_low < pair_high),
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 6)
);
create unique index burrow_game_one_active_per_pair_game
  on public.burrow_game_sessions(pair_low, pair_high, pair_version, game_id)
  where completed_at is null;
create index burrow_game_sessions_pair_recent
  on public.burrow_game_sessions(pair_low, pair_high, created_at desc);

create table public.burrow_game_progress (
  session_id uuid not null references public.burrow_game_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  own_answers jsonb not null default '[]'::jsonb,
  guesses jsonb not null default '[]'::jsonb,
  notify_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id),
  check (jsonb_typeof(own_answers) = 'array' and jsonb_array_length(own_answers) <= 6),
  check (jsonb_typeof(guesses) = 'array' and jsonb_array_length(guesses) <= 6)
);

alter table public.burrow_game_unlocks enable row level security;
alter table public.burrow_game_sessions enable row level security;
alter table public.burrow_game_progress enable row level security;
revoke all on public.burrow_game_unlocks, public.burrow_game_sessions, public.burrow_game_progress from public, anon, authenticated;
grant all on public.burrow_game_unlocks, public.burrow_game_sessions, public.burrow_game_progress to service_role;

create function public.burrow_game_overview_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_version text;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is not null then v_version := public.burrow_pair_version_v1(p_user_id,v_partner); end if;
  return jsonb_build_object(
    'error',null,
    'paired',v_partner is not null,
    'ownedIds',coalesce((select jsonb_agg(game_id order by game_id) from public.burrow_game_unlocks where owner_id=p_user_id),'[]'::jsonb),
    'availableIds',coalesce((select jsonb_agg(distinct game_id) from public.burrow_game_unlocks where owner_id=p_user_id or owner_id=v_partner),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(row_data order by row_data->>'createdAt' desc) from (
      select jsonb_build_object('id',s.id,'gameId',s.game_id,'createdAt',s.created_at,'completedAt',s.completed_at,
        'ownCount',jsonb_array_length(me.own_answers),'guessCount',jsonb_array_length(me.guesses),
        'partnerOwnCount',jsonb_array_length(them.own_answers),'partnerGuessCount',jsonb_array_length(them.guesses)) as row_data
      from public.burrow_game_sessions s
      join public.burrow_game_progress me on me.session_id=s.id and me.user_id=p_user_id
      join public.burrow_game_progress them on them.session_id=s.id and them.user_id=v_partner
      where s.pair_low=least(p_user_id,v_partner) and s.pair_high=greatest(p_user_id,v_partner)
        and s.pair_version=v_version
      order by s.created_at desc limit 40
    ) recent),'[]'::jsonb)
  );
end $$;

create function public.burrow_game_unlock_v1(p_user_id uuid,p_game_id text,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_payment jsonb;
begin
  if p_game_id is null or p_game_id !~ '^[a-z_]+_[0-9]{2}$' or p_key is null then return jsonb_build_object('error','invalid_request'); end if;
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if exists(select 1 from public.burrow_game_unlocks where game_id=p_game_id and owner_id in(p_user_id,v_partner)) then
    return jsonb_build_object('error',null,'unlocked',true,'charged',false);
  end if;
  v_payment := public.change_carrot_balance_v1(p_user_id,-20,'game_unlock','game',p_game_id,'game-unlock:'||p_key::text);
  if v_payment->>'error' is not null then return v_payment; end if;
  insert into public.burrow_game_unlocks(owner_id,game_id) values(p_user_id,p_game_id) on conflict do nothing;
  return jsonb_build_object('error',null,'unlocked',true,'charged',coalesce((v_payment->>'applied')::boolean,false),'balance',v_payment->'balance');
end $$;

create function public.burrow_game_start_v1(p_user_id uuid,p_game_id text,p_questions jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_version text; v_session public.burrow_game_sessions%rowtype;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_game_id is null or p_game_id !~ '^[a-z_]+_[0-9]{2}$' or jsonb_typeof(p_questions) is distinct from 'array'
    or jsonb_array_length(p_questions)<>6 then return jsonb_build_object('error','invalid_request'); end if;
  if not exists(select 1 from public.burrow_game_unlocks where game_id=p_game_id and owner_id in(p_user_id,v_partner)) then
    return jsonb_build_object('error','game_locked');
  end if;
  v_version := public.burrow_pair_version_v1(p_user_id,v_partner);
  select * into v_session from public.burrow_game_sessions
    where pair_low=least(p_user_id,v_partner) and pair_high=greatest(p_user_id,v_partner)
      and pair_version=v_version and game_id=p_game_id and completed_at is null for update;
  if not found then
    insert into public.burrow_game_sessions(pair_low,pair_high,pair_version,game_id,questions,started_by)
      values(least(p_user_id,v_partner),greatest(p_user_id,v_partner),v_version,p_game_id,p_questions,p_user_id)
      returning * into v_session;
    insert into public.burrow_game_progress(session_id,user_id) values(v_session.id,p_user_id),(v_session.id,v_partner);
  end if;
  return jsonb_build_object('error',null,'sessionId',v_session.id);
end $$;

create function public.burrow_game_answer_v1(p_user_id uuid,p_session_id uuid,p_phase text,p_index integer,p_choice integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_session public.burrow_game_sessions%rowtype;
  v_me public.burrow_game_progress%rowtype; v_them public.burrow_game_progress%rowtype;
  v_answers jsonb; v_count integer;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_phase is null or p_phase not in('own','guess') or p_index is null or p_index not between 0 and 5
    or p_choice is null or p_choice not between 0 and 3 then
    return jsonb_build_object('error','invalid_request');
  end if;
  select * into v_session from public.burrow_game_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_session.pair_low<>least(p_user_id,v_partner) or v_session.pair_high<>greatest(p_user_id,v_partner)
     or v_session.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,v_partner) then
    return jsonb_build_object('error','pair_changed');
  end if;
  select * into v_me from public.burrow_game_progress where session_id=p_session_id and user_id=p_user_id for update;
  select * into v_them from public.burrow_game_progress where session_id=p_session_id and user_id=v_partner for update;
  if v_session.completed_at is not null then return jsonb_build_object('error','already_done'); end if;
  if p_phase='guess' and jsonb_array_length(v_me.own_answers)<>6 then return jsonb_build_object('error','not_ready'); end if;
  v_answers := case when p_phase='own' then v_me.own_answers else v_me.guesses end;
  v_count := jsonb_array_length(v_answers);
  if p_index<v_count then
    if (v_answers->>p_index)::integer=p_choice then return jsonb_build_object('error',null,'count',v_count,'replayed',true); end if;
    return jsonb_build_object('error','answer_conflict');
  end if;
  if p_index<>v_count then return jsonb_build_object('error','answer_out_of_order'); end if;
  if p_phase='own' then
    update public.burrow_game_progress set own_answers=own_answers||to_jsonb(p_choice),updated_at=now()
      where session_id=p_session_id and user_id=p_user_id;
  else
    update public.burrow_game_progress set guesses=guesses||to_jsonb(p_choice),updated_at=now()
      where session_id=p_session_id and user_id=p_user_id;
    if p_index=5 and jsonb_array_length(v_them.guesses)=6 then
      update public.burrow_game_sessions set completed_at=now() where id=p_session_id;
      if v_them.notify_ready then
        insert into public.notification_outbox(recipient_user_id,event_key,event_type,payload)
          values(v_partner,'game-ready:'||p_session_id::text,'game_ready',jsonb_build_object('sessionId',p_session_id))
          on conflict(recipient_user_id,event_key) do nothing;
      end if;
    end if;
  end if;
  return jsonb_build_object('error',null,'count',v_count+1);
end $$;

create function public.burrow_game_notify_v1(p_user_id uuid,p_session_id uuid,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_session public.burrow_game_sessions%rowtype;
begin
  if p_enabled is null then return jsonb_build_object('error','invalid_request'); end if;
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into v_session from public.burrow_game_sessions where id=p_session_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_session.pair_low<>least(p_user_id,v_partner) or v_session.pair_high<>greatest(p_user_id,v_partner)
    or v_session.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,v_partner) then
    return jsonb_build_object('error','pair_changed');
  end if;
  update public.burrow_game_progress set notify_ready=p_enabled,updated_at=now()
    where session_id=p_session_id and user_id=p_user_id;
  return jsonb_build_object('error',null,'enabled',p_enabled);
end $$;

create function public.burrow_game_state_v1(p_user_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_session public.burrow_game_sessions%rowtype;
  v_me public.burrow_game_progress%rowtype; v_them public.burrow_game_progress%rowtype;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into v_session from public.burrow_game_sessions where id=p_session_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_session.pair_low<>least(p_user_id,v_partner) or v_session.pair_high<>greatest(p_user_id,v_partner)
    or v_session.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,v_partner) then
    return jsonb_build_object('error','pair_changed');
  end if;
  select * into v_me from public.burrow_game_progress where session_id=p_session_id and user_id=p_user_id;
  select * into v_them from public.burrow_game_progress where session_id=p_session_id and user_id=v_partner;
  return jsonb_build_object('error',null,'id',v_session.id,'gameId',v_session.game_id,'questions',v_session.questions,
    'createdAt',v_session.created_at,'completedAt',v_session.completed_at,
    'ownAnswers',v_me.own_answers,'guesses',v_me.guesses,'notifyReady',v_me.notify_ready,
    'partnerOwnCount',jsonb_array_length(v_them.own_answers),'partnerGuessCount',jsonb_array_length(v_them.guesses),
    'partnerOwnAnswers',case when v_session.completed_at is not null then v_them.own_answers else null end,
    'partnerGuesses',case when v_session.completed_at is not null then v_them.guesses else null end);
end $$;

revoke all on function public.burrow_game_overview_v1(uuid), public.burrow_game_unlock_v1(uuid,text,uuid),
  public.burrow_game_start_v1(uuid,text,jsonb), public.burrow_game_answer_v1(uuid,uuid,text,integer,integer),
  public.burrow_game_notify_v1(uuid,uuid,boolean), public.burrow_game_state_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.burrow_game_overview_v1(uuid), public.burrow_game_unlock_v1(uuid,text,uuid),
  public.burrow_game_start_v1(uuid,text,jsonb), public.burrow_game_answer_v1(uuid,uuid,text,integer,integer),
  public.burrow_game_notify_v1(uuid,uuid,boolean), public.burrow_game_state_v1(uuid,uuid)
  to service_role;
notify pgrst,'reload schema';
