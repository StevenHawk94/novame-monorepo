-- Emergency stop for new manual reminders only. Preserve all game data,
-- automatic invites/results, outbox dedup keys and the additive RPC signatures.
begin;
create or replace function public.burrow_game_nudge_v1(p_user_id uuid,p_session_id uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('error','feature_disabled');
$$;
create or replace function public.burrow_game_nudge_eligible_v1(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$select false;$$;
revoke all on function public.burrow_game_nudge_v1(uuid,uuid),public.burrow_game_nudge_eligible_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_game_nudge_v1(uuid,uuid),public.burrow_game_nudge_eligible_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
