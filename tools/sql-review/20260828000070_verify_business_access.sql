-- Read-only consolidated report. No private records or credentials are returned.
begin read only;
select jsonb_build_object(
 'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
 'tables_without_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
 'client_table_grants',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f') and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))),
 'client_sequence_grants',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' and (has_sequence_privilege('anon',c.oid,'SELECT,UPDATE,USAGE') or has_sequence_privilege('authenticated',c.oid,'SELECT,UPDATE,USAGE'))),
 'client_business_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'functions_without_search_path',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') and not exists(select 1 from unnest(p.proconfig) s where s like 'search_path=%')),
 'views',(select jsonb_object_agg(c.relname,c.reloptions) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('user_stats','leaderboard')),
 'auth_hooks',(select bool_and(has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('handle_new_user','handle_new_user_subscription','check_disposable_email')),
 'realtime_receive',has_table_privilege('authenticated','realtime.messages','SELECT'),
 'realtime_policies',(select jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd,'condition',qual) order by policyname) from pg_policies where schemaname='realtime'),
 'migration',(select version from supabase_migrations.schema_migrations where version='20260828000070'),
 'public_insert_listens_policy',(select count(*) from pg_policies where schemaname='public' and tablename='listens' and policyname='Anyone can insert listens')
) as verification;
rollback;
