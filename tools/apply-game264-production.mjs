// Run with --apply only after explicit rollout approval. No user impersonation
// or writes to game progress, wallet, inbox or other business records.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),version='20261023000264';
const migration=fs.readFileSync(path.join(root,'supabase/migrations/'+version+'_game_notification_readiness.sql'),'utf8');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burrow-game264-production-'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const protectedTables=['profiles','pairings','burrow_game_sessions','burrow_game_progress','burrow_game_unlocks','wallets','currency_ledger','moment_events','notification_outbox'];
const tableArray='array['+protectedTables.map(quote).join(',')+']';
const sql=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
do $history$ begin if exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)}
 and md5(array_to_string(statements,''))<>md5(${quote(migration)})) then raise exception 'Migration history conflict';end if;end $history$;
create temp table game264_guard(name text primary key,n bigint,fingerprint text);
do $guard$ declare rel text;begin foreach rel in array ${tableArray} loop
 execute format('insert into game264_guard select %L,count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',rel,rel);
end loop;end $guard$;
create temp table game264_functions as select oid,proname,md5(pg_get_functiondef(oid)) hash,proacl::text grants
 from pg_proc where pronamespace='public'::regnamespace and prokind='f';
${migration}
do $verify$ declare rel text;current_hash text;current_count bigint;begin
 foreach rel in array ${tableArray} loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',rel) into current_count,current_hash;
  if not exists(select 1 from game264_guard where name=rel and n=current_count and fingerprint=current_hash) then raise exception 'Protected rows changed: %',rel;end if;
 end loop;
 if exists(select 1 from game264_functions f left join pg_proc p on p.oid=f.oid where
  p.oid is null or f.grants is distinct from p.proacl::text or (f.proname<>'system_notification_context_v1' and f.hash<>md5(pg_get_functiondef(p.oid)))) then raise exception 'Unrelated function or grants changed';end if;
 if position('game_notification_readiness_264' in pg_get_functiondef('system_notification_context_v1(uuid,text,jsonb)'::regprocedure))=0 then raise exception 'Readiness guard missing';end if;
 if has_function_privilege('authenticated','system_notification_context_v1(uuid,text,jsonb)','execute')
  or has_function_privilege('anon','system_notification_context_v1(uuid,text,jsonb)','execute')
  or not has_function_privilege('service_role','system_notification_context_v1(uuid,text,jsonb)','execute') then raise exception 'Unsafe context grants';end if;
end $verify$;
insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},'game_notification_readiness',array[${quote(migration)}]) on conflict(version) do nothing;
commit;
select jsonb_build_object('version',${quote(version)},'protectedUserRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,'grantsUnchanged',true,
 'migrationHash',(select md5(array_to_string(statements,'')) from supabase_migrations.schema_migrations where version=${quote(version)})) result;`;
const target=path.join(directory,'apply.sql');fs.writeFileSync(target,sql);
if(!process.argv.includes('--apply')){console.log(JSON.stringify({prepared:target,requires:'--apply'}));process.exit(0);}
const raw=execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',target],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:2e6});
fs.writeFileSync(path.join(directory,'result.json'),raw);const result=JSON.parse(raw),rows=Array.isArray(result)?result:result.rows;
assert.equal(rows?.[0]?.result?.version,version);console.log(JSON.stringify({directory,...rows[0].result}));
