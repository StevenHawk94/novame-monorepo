-- Defence in depth at delivery time, not a new game/reward rule. The existing
-- submit writer still owns enqueueing after all twelve choices commit.
do $migration$
declare original text; revised text;
begin
 original:=pg_get_functiondef('public.system_notification_context_v1(uuid,text,jsonb)'::regprocedure);
 if position('game_notification_readiness_264' in original)>0 then return;end if;
 revised:=replace(original,
  'and session.pair_version is not distinct from burrow_pair_version_v1(p_user,partner);',
  'and session.pair_version is not distinct from burrow_pair_version_v1(p_user,partner)
   -- game_notification_readiness_264: never advertise a draft or stale invite.
   and exists(select 1 from burrow_game_progress me
    join burrow_game_progress them on them.session_id=me.session_id and them.user_id=partner
    where me.session_id=session.id and me.user_id=p_user
     and jsonb_array_length(them.own_answers)=6 and jsonb_array_length(them.guesses)=6
     and case when p_type=''game_invite'' then session.completed_at is null
       and (jsonb_array_length(me.own_answers)<6 or jsonb_array_length(me.guesses)<6)
      else session.completed_at is not null
       and jsonb_array_length(me.own_answers)=6 and jsonb_array_length(me.guesses)=6
       and me.result_viewed_at is null end);');
 if revised=original then raise exception 'Unexpected Game notification context definition';end if;
 execute revised;
end $migration$;
notify pgrst,'reload schema';
