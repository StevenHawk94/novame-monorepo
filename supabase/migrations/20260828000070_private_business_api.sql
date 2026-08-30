-- Public business objects are accessed through the authenticated Vercel API.
-- Preserve service_role, Supabase Auth hooks, Storage and private Realtime.
-- Never disable the Data API or remove public from its exposed schemas.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '45s';

do $preflight$
begin
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'Untrusted CREATE on public must be reviewed first';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ) then
    raise exception 'All public business tables must have RLS enabled before hardening';
  end if;
  -- No column grants exist in the audited database. Fail rather than overlook
  -- a column-specific grant if the schema has drifted before deployment.
  if exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attacl is not null
  ) then
    raise exception 'Column-specific grants require review before hardening';
  end if;
end
$preflight$;

-- The app has no direct table/RPC clients; server-side grants are unchanged.
-- This also closes legacy views, global catalog reads and direct own-row
-- mutations that bypass the API's quota, validation and entitlement checks.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- Keep Auth's explicit ability to use its existing signup trigger functions
-- after removing the inherited PUBLIC execute grant. No UUID/auth flow changes.
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_new_user_subscription() to supabase_auth_admin;

do $functions$
declare
  f record;
begin
  for f in
    select p.oid, p.proname, p.proconfig,
      format('%I.%I(%s)', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid)) as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', f.signature);
    -- Fixed path preserves the existing public.vector operator and legacy
    -- unqualified table references. public CREATE is restricted (see above);
    -- pg_catalog stays implicitly first and temporary objects explicitly last.
    if not exists (select 1 from unnest(f.proconfig) s where s like 'search_path=%') then
      execute format('alter function %s set search_path = public, pg_temp', f.signature);
    end if;
  end loop;
end
$functions$;

-- Defense in depth: owner-owned views must not silently bypass caller RLS if
-- a future migration deliberately grants them access again.
alter view public.user_stats set (security_invoker = true);
alter view public.leaderboard set (security_invoker = true);
drop policy if exists "Anyone can insert listens" on public.listens;

-- New application migrations run as postgres. Keep server defaults; remove
-- public/client defaults. Per-schema REVOKE alone cannot remove PostgreSQL's
-- built-in global PUBLIC EXECUTE default, so revoke that globally as well.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated;

-- Auth/Storage/Realtime schemas, private channel policies, trigger bodies,
-- data rows, service_role grants and page caching are intentionally untouched.
notify pgrst, 'reload schema';
commit;
