-- record_skill: persist one generated skill after dedup (C9).
--
-- Dedup happens in /api/reflect using the engine's keyword-overlap function
-- against the user's existing skill texts, so by the time this is called the
-- skill is known-novel. This just inserts it, as a security-definer writer for
-- parity with the others.
create or replace function public.record_skill(
  p_user_id    uuid,
  p_reflect_id uuid,
  p_dimension  dimension_t,
  p_title      text,
  p_body       text,
  p_rarity     skill_rarity
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skill_id uuid;
begin
  perform 1 from public.companions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'companion_not_initialized');
  end if;

  insert into public.skills (user_id, reflect_id, dimension, title, body, rarity, source)
  values (p_user_id, p_reflect_id, p_dimension, p_title, p_body, p_rarity, 'self')
  returning id into v_skill_id;

  return jsonb_build_object('error', null, 'skill_id', v_skill_id);
end;
$$;

revoke all on function public.record_skill(uuid, uuid, dimension_t, text, text, skill_rarity) from public;
revoke all on function public.record_skill(uuid, uuid, dimension_t, text, text, skill_rarity) from anon;
revoke all on function public.record_skill(uuid, uuid, dimension_t, text, text, skill_rarity) from authenticated;
grant execute on function public.record_skill(uuid, uuid, dimension_t, text, text, skill_rarity) to service_role;
