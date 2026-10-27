-- Manual game reminder. No change to game scoring, unlocks or in-app badges.
create function public.burrow_game_nudge_eligible_v1(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
  select 1 from burrow_game_sessions s
  join pairings p on p.user_id=p_user
  join pairings back on back.user_id=p.partner_user_id and back.partner_user_id=p_user
  join burrow_game_progress me on me.session_id=s.id and me.user_id=p_user
  join burrow_game_progress them on them.session_id=s.id and them.user_id=p.partner_user_id
  where s.id=p_session and s.completed_at is null
   and s.pair_low=least(p_user,p.partner_user_id) and s.pair_high=greatest(p_user,p.partner_user_id)
   and s.pair_version is not distinct from burrow_pair_version_v1(p_user,p.partner_user_id)
   and (jsonb_array_length(me.own_answers)<6 or jsonb_array_length(me.guesses)<6)
   and jsonb_array_length(them.own_answers)=6 and jsonb_array_length(them.guesses)=6
 );
$$;

create function public.burrow_game_nudge_v1(p_user_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; game burrow_game_sessions%rowtype; day date; inserted integer;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired');end if;
 select * into game from burrow_game_sessions where id=p_session_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if game.pair_low<>least(p_user_id,partner) or game.pair_high<>greatest(p_user_id,partner)
  or game.pair_version is distinct from burrow_pair_version_v1(p_user_id,partner) then
  return jsonb_build_object('error','pair_changed');end if;
 if game.completed_at is not null then return jsonb_build_object('finished',true);end if;
 if not exists(select 1 from burrow_game_progress where session_id=p_session_id and user_id=p_user_id
  and jsonb_array_length(own_answers)=6 and jsonb_array_length(guesses)=6) then
  return jsonb_build_object('error','not_ready');end if;
 if not burrow_game_nudge_eligible_v1(partner,p_session_id) then return jsonb_build_object('finished',true);end if;
 day:=(now() at time zone notification_timezone_v1(partner))::date;
 insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
 values(partner,'game-nudge:'||p_session_id::text||':'||day::text,'game_invite',
  jsonb_build_object('sessionId',p_session_id,'nudge',true),now()+interval '24 hours')
 on conflict(recipient_user_id,event_key) do nothing;
 get diagnostics inserted=row_count;
 return jsonb_build_object('alreadySent',inserted=0);
end $$;
revoke all on function public.burrow_game_nudge_v1(uuid,uuid),public.burrow_game_nudge_eligible_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_game_nudge_v1(uuid,uuid),public.burrow_game_nudge_eligible_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
