// Explicit authorization: four garden actions + scoped API only; no App release.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),version='20261028000284',name='independent_room_care';
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
const quote=s=>"'"+s.replaceAll("'","''")+"'",hash=(s,alg='sha256')=>createHash(alg).update(s).digest('hex');
const functions=`select oid,proname,proargtypes::text args,proacl,prosecdef,proconfig,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
export function care284Transaction(expected=[]){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin for t in select name from care284_tables loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select to_jsonb(t) v from %s t) a',t.name,t.name);
end loop;end $audit$;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow:care284-release',0));
do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261028000283')
 or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected migration baseline';end if;
 ${expected.map(f=>`if not exists(select 1 from pg_proc where oid=${quote(f.signature)}::regprocedure and md5(prosrc)=${quote(f.body)}) then raise exception 'Reviewed function changed';end if;`).join('\n')}
end $$;
create temporary table care284_tables on commit drop as select format('%I.%I',schemaname,tablename) name from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users');
create temporary table care284_functions on commit drop as ${functions};
create temporary table care284_security on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
${audit('care284_before')}
${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
${audit('care284_after')}
do $guard$begin
 if exists(select * from care284_before except select * from care284_after) or exists(select * from care284_after except select * from care284_before) then raise exception 'Protected rows changed';end if;
 if exists(select * from care284_functions where proname<>'burrow_moment_quest_progress' except ${functions}) then raise exception 'Unrelated function changed';end if;
 if (select count(*) from care284_functions)+3<>(select count(*) from pg_proc where pronamespace='public'::regnamespace and prokind='f') then raise exception 'Unexpected function set';end if;
 if exists(select 1 from care284_functions b join pg_proc a using(oid) where a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig) then raise exception 'Existing function security changed';end if;
 if exists(select v from care284_security except
  (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace
   union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Existing table security changed';end if;
 if position('recordingVersion' in pg_get_functiondef('burrow_moment_quest_progress()'::regprocedure))=0 then raise exception 'Toy quest guard missing';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);
select jsonb_build_object('migration',284,'sha256','${hash(source)}','protectedSets',(select count(*) from care284_before),'protectedRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,'existingPermissionsUnchanged',true) verified;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-care284.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(file,v)=>fs.writeFileSync(`${dir}/${file}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 if(mode==='inspect'){
  const rows=query("begin read only;select oid::regprocedure::text signature,md5(prosrc) body,pg_get_functiondef(oid) definition,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname='burrow_moment_quest_progress';commit;");
  assert.equal(rows.length,1);assert.ok(rows[0].definition.includes('recordingVersion'));assert.ok(rows[0].definition.includes('quest:=case new.event_type'));
  save('database-before',{digest:hash(source),functions:rows});console.log(JSON.stringify({readOnly:true,reviewedFunctions:rows.map(r=>({signature:r.signature,body:r.body}))}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/database-before.json'));assert.equal(before.digest,hash(source));
  const result=query(care284Transaction(before.functions)).find(r=>r.verified)?.verified;assert.ok(result?.protectedRowsUnchanged);save('database-applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
  const state=query(`begin read only;select jsonb_build_object(
 'digest',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'rpc',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute'))) from pg_proc p where pronamespace='public'::regnamespace and proname in('room_care_state_v2','complete_room_care_v2')),
 'table',(select jsonb_build_object('rls',relrowsecurity,'anon',has_table_privilege('anon',oid,'select,insert,update,delete'),'authenticated',has_table_privilege('authenticated',oid,'select,insert,update,delete'),'service_write',has_table_privilege('service_role',oid,'insert,update,delete')) from pg_class where oid='public.room_care_actions_v2'::regclass)) verified;commit;`)[0].verified;
  assert.equal(state.digest,hash(source,'md5'));const rpc=state.rpc;assert.equal(rpc.length,2);
  for(const f of rpc){assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,true);}
  const table=state.table;assert.ok(table.rls);assert.equal(table.anon,false);assert.equal(table.authenticated,false);assert.equal(table.service_write,false);
  const result={migration:284,migrationRecorded:true,serviceOnlyRpc:true,privateTable:true,verifiedAt:new Date().toISOString()};save('database-verified',result);console.log(JSON.stringify(result));
 }else throw Error('Use inspect / apply / verify');
}
