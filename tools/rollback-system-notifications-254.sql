-- EMERGENCY ONLY. Do not run as part of normal deployment.
-- Before promoting the pre-254 API, quarantine system pushes: its generic
-- dispatcher does not recognize the new event types and could mislabel them.
-- This pauses only OS push delivery, not App badges, games, rewards or pairing.
-- In-flight requests already accepted by Expo cannot be recalled.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261020000254') then
  raise exception 'migration 254 is not installed';
 end if;
end $guard$;
create function public.quarantine_system_push_254() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in('pending','retry','sending') then
  new.status:='failed';new.last_error:='emergency_dispatch_paused_254';new.locked_at:=null;
 end if;
 return new;
end $$;
revoke all on function public.quarantine_system_push_254() from public,anon,authenticated;
create trigger quarantine_system_push_254 before insert or update on public.notification_outbox
for each row execute function public.quarantine_system_push_254();
update public.notification_outbox set status='failed',last_error='emergency_dispatch_paused_254',locked_at=null
where status in('pending','retry','sending');
commit;
-- Then promote the previously verified deployment. Keep migration 254's
-- additive schema in place; never drop columns or restore business tables.
-- After a corrected 254-compatible API is live and verified, resume with:
-- begin;
-- drop trigger quarantine_system_push_254 on public.notification_outbox;
-- drop function public.quarantine_system_push_254();
-- commit;
-- Do not replay quarantined rows automatically: that risks stale/duplicate push.
