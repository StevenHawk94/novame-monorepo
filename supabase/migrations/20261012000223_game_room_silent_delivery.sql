-- Deliver a complete local game atomically; never send partner invites per tap.
create or replace function public.burrow_game_submit_v1(p_user_id uuid,p_session_id uuid,p_own_answers jsonb,p_guesses jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_session public.burrow_game_sessions%rowtype;
  v_me public.burrow_game_progress%rowtype; v_them public.burrow_game_progress%rowtype;
  v_choice jsonb; v_index integer;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if jsonb_typeof(p_own_answers) is distinct from 'array' or jsonb_typeof(p_guesses) is distinct from 'array' then
    return jsonb_build_object('error','invalid_request'); end if;
  if jsonb_array_length(p_own_answers)<>6 or jsonb_array_length(p_guesses)<>6 then
    return jsonb_build_object('error','invalid_request'); end if;
  for v_choice in select value from jsonb_array_elements(p_own_answers||p_guesses) loop
    if v_choice not in ('0'::jsonb,'1'::jsonb,'2'::jsonb,'3'::jsonb) then return jsonb_build_object('error','invalid_request'); end if;
  end loop;
  select * into v_session from public.burrow_game_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_session.pair_low<>least(p_user_id,v_partner) or v_session.pair_high<>greatest(p_user_id,v_partner)
    or v_session.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,v_partner) then
    return jsonb_build_object('error','pair_changed'); end if;
  select * into v_me from public.burrow_game_progress where session_id=p_session_id and user_id=p_user_id for update;
  select * into v_them from public.burrow_game_progress where session_id=p_session_id and user_id=v_partner for update;
  -- Replays (including a lost successful response) are successful, never a new game or notification.
  if v_me.own_answers=p_own_answers and v_me.guesses=p_guesses then
    return jsonb_build_object('error',null,'replayed',true); end if;
  if v_session.completed_at is not null then return jsonb_build_object('error','already_done'); end if;
  -- Preserve answers committed by older versions; only append a matching prefix.
  for v_index in 0..5 loop
    if (v_index<jsonb_array_length(v_me.own_answers) and v_me.own_answers->v_index is distinct from p_own_answers->v_index)
      or (v_index<jsonb_array_length(v_me.guesses) and v_me.guesses->v_index is distinct from p_guesses->v_index) then
      return jsonb_build_object('error','answer_conflict'); end if;
  end loop;
  update public.burrow_game_progress set own_answers=p_own_answers,guesses=p_guesses,updated_at=now()
    where session_id=p_session_id and user_id=p_user_id;
  if jsonb_array_length(v_them.own_answers)=6 and jsonb_array_length(v_them.guesses)=6 then
    update public.burrow_game_sessions set completed_at=now() where id=p_session_id;
    insert into public.notification_outbox(recipient_user_id,event_key,event_type,payload)
      values(v_partner,'game-ready:'||p_session_id::text,'game_ready',jsonb_build_object('sessionId',p_session_id))
      on conflict(recipient_user_id,event_key) do nothing;
  else
    insert into public.notification_outbox(recipient_user_id,event_key,event_type,payload)
      values(v_partner,'game-invite:'||p_session_id::text,'game_invite',jsonb_build_object('sessionId',p_session_id))
      on conflict(recipient_user_id,event_key) do nothing;
  end if;
  -- One private invalidation per participant after the whole batch. No answers
  -- or per-question progress are broadcast; replay returns before this block.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send('{}'::jsonb,'burrow_changed','burrow:'||p_user_id::text,true);
    perform realtime.send('{}'::jsonb,'burrow_changed','burrow:'||v_partner::text,true);
  end if;
  return jsonb_build_object('error',null);
end $$;
revoke all on function public.burrow_game_submit_v1(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.burrow_game_submit_v1(uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.burrow_game_overview_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_version text;
begin
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is not null then v_version := public.burrow_pair_version_v1(p_user_id,v_partner); end if;
  return jsonb_build_object('error',null,'paired',v_partner is not null,
    'ownedIds',coalesce((select jsonb_agg(game_id order by game_id) from public.burrow_game_unlocks where owner_id=p_user_id),'[]'::jsonb),
    'availableIds',coalesce((select jsonb_agg(distinct game_id) from public.burrow_game_unlocks where owner_id=p_user_id or owner_id=v_partner),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(row_data order by row_data->>'createdAt' desc) from (
      select jsonb_build_object('id',s.id,'gameId',s.game_id,'createdAt',s.created_at,'completedAt',s.completed_at,
        'ownCount',jsonb_array_length(me.own_answers),'guessCount',jsonb_array_length(me.guesses),
        'partnerOwnCount',jsonb_array_length(them.own_answers),'partnerGuessCount',jsonb_array_length(them.guesses)) as row_data
      from public.burrow_game_sessions s
      join public.burrow_game_progress me on me.session_id=s.id and me.user_id=p_user_id
      join public.burrow_game_progress them on them.session_id=s.id and them.user_id=v_partner
      where s.pair_low=least(p_user_id,v_partner) and s.pair_high=greatest(p_user_id,v_partner) and s.pair_version=v_version
        and (s.started_by=p_user_id or s.completed_at is not null
          or (jsonb_array_length(them.own_answers)=6 and jsonb_array_length(them.guesses)=6))
      order by s.created_at desc limit 40
    ) recent),'[]'::jsonb));
end $$;

create or replace function public.burrow_game_unlock_v1(p_user_id uuid,p_game_id text,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_payment jsonb;
begin
  if p_game_id is null or p_game_id !~ '^[a-z_]+_[0-9]{2}$' or p_key is null then return jsonb_build_object('error','invalid_request'); end if;
  v_partner := public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  if exists(select 1 from public.burrow_game_unlocks where game_id=p_game_id and owner_id in(p_user_id,v_partner)) then
    return jsonb_build_object('error',null,'unlocked',true,'charged',false); end if;
  v_payment := public.change_carrot_balance_v1(p_user_id,-150,'game_unlock','game',p_game_id,'game-unlock:'||p_key::text);
  if v_payment->>'error' is not null then return v_payment; end if;
  insert into public.burrow_game_unlocks(owner_id,game_id) values(p_user_id,p_game_id) on conflict do nothing;
  return jsonb_build_object('error',null,'unlocked',true,'charged',coalesce((v_payment->>'applied')::boolean,false),'balance',v_payment->'balance');
end $$;
notify pgrst,'reload schema';
