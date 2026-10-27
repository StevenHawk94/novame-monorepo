begin;
-- One transaction for replacement: readers see the previous or new policy,
-- never an intentionally deactivated gap. Insert failure rolls everything back.
create or replace function public.save_minimum_app_version_v1(
 p_min_version text,p_message text,p_platform text,p_enabled boolean default true
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.force_updates%rowtype;
begin
 if p_enabled is null then raise exception 'invalid_policy';end if;
 if p_enabled and (p_min_version is null or btrim(p_min_version)!~'^[0-9]+\.[0-9]+\.[0-9]+$'
  or p_message is null or length(btrim(p_message)) not between 1 and 2000 or p_platform is null or p_platform not in('all','ios','android'))
 then raise exception 'invalid_policy';end if;
 perform pg_advisory_xact_lock(hashtextextended('burrow:minimum-supported-version',0));
 if p_enabled then
  select * into v_row from public.force_updates where is_active order by created_at desc limit 1 for update;
  if found and v_row.min_version=btrim(p_min_version) and v_row.message=btrim(p_message) and v_row.platform=p_platform
   and (select count(*) from public.force_updates where is_active)=1
  then return to_jsonb(v_row);end if;
 end if;
 update public.force_updates set is_active=false where is_active;
 if not p_enabled then return null;end if;
 insert into public.force_updates(version,min_version,message,platform,is_active)
 values(btrim(p_min_version),btrim(p_min_version),btrim(p_message),p_platform,true) returning * into v_row;
 return to_jsonb(v_row);
end;$$;
revoke all on function public.save_minimum_app_version_v1(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_minimum_app_version_v1(text,text,text,boolean) to service_role;
commit;
