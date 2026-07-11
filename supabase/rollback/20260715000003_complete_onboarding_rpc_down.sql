-- Rollback for 20260715000003. Drops the function only; no data affected.
drop function if exists public.complete_onboarding(uuid, companion_t);
