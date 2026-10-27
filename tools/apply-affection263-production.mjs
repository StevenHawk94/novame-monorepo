// Explicitly invoked only after approval. No real-user sends or impersonation.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),version='20261023000263';
const migration=fs.readFileSync(path.join(root,'supabase/migrations/'+version+'_affection_daily_limits.sql'),'utf8');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burrow-affection263-production-'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const guard=`
create temp table affection263_guard(name text primary key,n bigint,fingerprint text);
do $guard$ declare rel text;begin
 foreach rel in array array['profiles','affection_events','wallets','currency_ledger','moment_events','pairings'] loop
  execute format('insert into affection263_guard select %L,count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',rel,rel);
 end loop;
end $guard$;
create temp table affection263_functions as select oid,proname,md5(pg_get_functiondef(oid)) hash,proacl::text grants
 from pg_proc where pronamespace='public'::regnamespace and prokind='f';
`;
const checks=`
do $verify$ declare rel text; current_hash text;current_count bigint;begin
 foreach rel in array array['profiles','affection_events','wallets','currency_ledger','moment_events','pairings'] loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',rel) into current_count,current_hash;
  if not exists(select 1 from affection263_guard where name=rel and n=current_count and fingerprint=current_hash) then raise exception 'Protected user rows changed: %',rel;end if;
 end loop;
 if exists(select 1 from affection263_functions f left join pg_proc p on p.oid=f.oid where f.proname not in('complete_affection_v1','burrow_bootstrap_v1')
  and(p.oid is null or f.hash<>md5(pg_get_functiondef(p.oid)) or f.grants is distinct from p.proacl::text)) then raise exception 'Unrelated function changed';end if;
 if position('affection_daily_quota_263' in pg_get_functiondef('complete_affection_v1(uuid,text,jsonb,text)'::regprocedure))=0 then raise exception 'Quota missing';end if;
 if exists(select 1 from (values('anon'),('authenticated')) roles(r) cross join
  (values('complete_affection_v1(uuid,text,jsonb,text)'),('burrow_affection_state_v1(uuid,uuid)'),('burrow_bootstrap_v1(uuid)')) funcs(fn)
  where has_function_privilege(r,fn,'execute') or not has_function_privilege('service_role',fn,'execute')) then raise exception 'Unsafe RPC grants';end if;
end $verify$;
`;
const sql=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
do $already$ begin if exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)}
 and md5(array_to_string(statements,''))<>md5(${quote(migration)})) then raise exception 'Migration history conflict';end if;end $already$;
${guard}\n${migration}\n${checks}
insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},'affection_daily_limits',array[${quote(migration)}]) on conflict(version) do nothing;
commit;
select jsonb_build_object('version',${quote(version)},'protectedUserRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,
 'serviceRoleOnly',true,'migrationHash',(select md5(array_to_string(statements,'')) from supabase_migrations.schema_migrations where version=${quote(version)})) result;`;
const target=path.join(directory,'apply.sql');fs.writeFileSync(target,sql);
if(!process.argv.includes('--apply')){console.log(JSON.stringify({prepared:target,requires:'--apply'}));process.exit(0);}
const raw=execFileSync('supabase',['db','query','--linked','--output','json','--file',target],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:2e6});
fs.writeFileSync(path.join(directory,'result.json'),raw);const result=JSON.parse(raw),rows=Array.isArray(result)?result:result.rows;
assert.equal(rows?.[0]?.result?.version,version);console.log(JSON.stringify({directory,...rows[0].result}));
