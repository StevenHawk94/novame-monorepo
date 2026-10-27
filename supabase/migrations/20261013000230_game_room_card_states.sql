-- A round is archived for each participant only after they view its result.
-- Catalogue progress retains the last completed round even during a replay.
begin;
alter table public.burrow_game_progress add column result_viewed_at timestamptz;
create index burrow_game_sessions_latest_game on public.burrow_game_sessions
 (pair_low,pair_high,pair_version,game_id,created_at desc,id desc) where completed_at is not null;

create function public.burrow_game_view_result_v1(p_user_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; round public.burrow_game_sessions%rowtype; viewed timestamptz;
begin
 partner:=public.lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into round from public.burrow_game_sessions where id=p_session_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if round.pair_low<>least(p_user_id,partner) or round.pair_high<>greatest(p_user_id,partner)
  or round.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,partner) then
  return jsonb_build_object('error','pair_changed'); end if;
 if round.completed_at is null then return jsonb_build_object('error','not_ready'); end if;
 update public.burrow_game_progress set result_viewed_at=coalesce(result_viewed_at,now())
  where session_id=p_session_id and user_id=p_user_id returning result_viewed_at into viewed;
 if not found then return jsonb_build_object('error','not_found'); end if;
 return jsonb_build_object('error',null,'viewedAt',viewed);
end $$;

create or replace function public.burrow_game_overview_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; version text;
begin
 partner:=public.lock_burrow_pair(p_user_id);
 if partner is not null then version:=public.burrow_pair_version_v1(p_user_id,partner); end if;
 return jsonb_build_object('error',null,'paired',partner is not null,
  'ownedIds',coalesce((select jsonb_agg(game_id order by game_id) from public.burrow_game_unlocks where owner_id=p_user_id),'[]'::jsonb),
  'availableIds',coalesce((select jsonb_agg(distinct game_id) from public.burrow_game_unlocks where owner_id=p_user_id or owner_id=partner),'[]'::jsonb),
  'sessions',coalesce((
   with latest as (
    select distinct on(s.game_id) s.id from public.burrow_game_sessions s
    where s.pair_low=least(p_user_id,partner) and s.pair_high=greatest(p_user_id,partner)
      and s.pair_version=version and s.completed_at is not null
    order by s.game_id,s.created_at desc,s.id desc
   )
   select jsonb_agg(jsonb_build_object('id',s.id,'gameId',s.game_id,'createdAt',s.created_at,'completedAt',s.completed_at,
    'resultViewedAt',me.result_viewed_at,'ownCount',jsonb_array_length(me.own_answers),'guessCount',jsonb_array_length(me.guesses),
    'partnerOwnCount',jsonb_array_length(them.own_answers),'partnerGuessCount',jsonb_array_length(them.guesses)) order by s.created_at desc,s.id desc)
   from public.burrow_game_sessions s
   join public.burrow_game_progress me on me.session_id=s.id and me.user_id=p_user_id
   join public.burrow_game_progress them on them.session_id=s.id and them.user_id=partner
   where s.pair_low=least(p_user_id,partner) and s.pair_high=greatest(p_user_id,partner) and s.pair_version=version
    and (s.started_by=p_user_id or s.completed_at is not null
      or (jsonb_array_length(them.own_answers)=6 and jsonb_array_length(them.guesses)=6))
    and (s.completed_at is null or me.result_viewed_at is null or s.id in(select id from latest))
  ),'[]'::jsonb));
end $$;
-- Preserve the existing result privacy and pairing-generation checks verbatim.
do $$ declare original text; revised text; begin
 original:=pg_get_functiondef('public.burrow_game_state_v1(uuid,uuid)'::regprocedure);
 revised:=replace(original,'''notifyReady'',v_me.notify_ready,',
  '''notifyReady'',v_me.notify_ready,''resultViewedAt'',v_me.result_viewed_at,');
 if revised=original then raise exception 'Unexpected game state definition'; end if;
 execute revised;
end $$;
revoke all on function public.burrow_game_view_result_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_game_view_result_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
