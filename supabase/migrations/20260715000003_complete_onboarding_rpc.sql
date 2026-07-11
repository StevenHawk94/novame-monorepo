-- complete_onboarding: the atomic write that ends onboarding (C4).
--
-- Called once, from signing-in after a fresh sign-up, with the pet the user
-- picked before they had an account (stored locally, synced now). Two writes in
-- one transaction: stamp the profile as onboarded and create the companion row
-- that Reflect requires. Idempotent on both -- a retried sync (network flake,
-- app relaunch mid-sign-in) must not create a second companion or churn the
-- timestamp, so companions uses on-conflict-do-nothing and the profile update
-- only sets onboarding_completed_at when it is still null.
--
-- companion_id is stored on companions only; the profiles.companion_id column
-- added in C1 is redundant and left alone (its cleanup is C12). The pet is a
-- one-time, unchangeable choice, so a second call with a different pet is
-- ignored, not honoured -- the first companion row wins.
--
-- service_role only, like the other economy writes. Runs in one pass in the
-- SQL editor (single create-function plus grants, no DDL/do-block mix).
create or replace function public.complete_onboarding(
  p_user_id      uuid,
  p_companion_id companion_t
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created bigint := 0;
begin
  insert into public.companions (user_id, companion_id)
  values (p_user_id, p_companion_id)
  on conflict (user_id) do nothing;
  get diagnostics v_created = row_count;

  update public.profiles
  set onboarding_completed_at = now()
  where id = p_user_id and onboarding_completed_at is null;

  return jsonb_build_object(
    'error', null,
    'companion_created', v_created > 0
  );
end;
$$;

revoke all on function public.complete_onboarding(uuid, companion_t) from public;
revoke all on function public.complete_onboarding(uuid, companion_t) from anon;
revoke all on function public.complete_onboarding(uuid, companion_t) from authenticated;
grant execute on function public.complete_onboarding(uuid, companion_t) to service_role;
