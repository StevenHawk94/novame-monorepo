-- One service RPC validates canonical content, commits the existing idempotent
-- delivery and returns its sealed/unsealed state in the same transaction.
create or replace function public.burrow_game_submit_ready_v1(
  p_user_id uuid,p_session_id uuid,p_game_id text,p_questions jsonb,
  p_own_answers jsonb,p_guesses jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_session public.burrow_game_sessions%rowtype;
  v_receipt jsonb; v_state jsonb;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into v_session from public.burrow_game_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_session.pair_low<>least(p_user_id,v_partner) or v_session.pair_high<>greatest(p_user_id,v_partner)
    or v_session.pair_version is distinct from public.burrow_pair_version_v1(p_user_id,v_partner) then
    return jsonb_build_object('error','pair_changed'); end if;
  -- Both arguments are selected by the authenticated API's server catalogue,
  -- never accepted as canonical content from a client request.
  if v_session.game_id is distinct from p_game_id or v_session.questions is distinct from p_questions then
    return jsonb_build_object('error','game_content_update_required'); end if;
  v_receipt:=public.burrow_game_submit_v1(p_user_id,p_session_id,p_own_answers,p_guesses);
  if v_receipt->>'error' is not null then return v_receipt; end if;
  v_state:=public.burrow_game_state_v1(p_user_id,p_session_id);
  if v_state->>'error' is not null then return v_state; end if;
  return v_receipt||jsonb_build_object('session',v_state);
end $$;
revoke all on function public.burrow_game_submit_ready_v1(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.burrow_game_submit_ready_v1(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
