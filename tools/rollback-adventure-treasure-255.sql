-- EMERGENCY ONLY: pause NEW coin chests while retaining all existing claims.
-- Run only after confirming migration 255 is installed. Keep the new API live;
-- it understands both V3 and V4. Never delete wallet/ledger/claim data or reroll
-- bound journeys. Existing V4 chests continue to pay their frozen rewards.
begin;
set local lock_timeout='5s';
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261021000255') then
  raise exception 'migration 255 is not installed';
 end if;
end $guard$;
create or replace function public.start_adventure_v4(p_user_id uuid,p_record_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 return start_adventure_v3(p_user_id,p_record_id,p_idempotency_key);
end $$;
revoke all on function public.start_adventure_v4(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_adventure_v4(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
-- Restore only the start_adventure_v4 definition from migration 255 after a
-- corrected release has passed verification. Do not rerun the whole migration.
