// Explicitly authorized migrations 281 + 282 only. No economy or App release.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const names=['20261027000281_personal_plushie_photo_visibility','20261027000282_received_touch_history_and_personal_photo_moments'];
export const plushieReleaseSources=names.map(n=>({version:n.slice(0,14),name:n.slice(15),source:fs.readFileSync(`${root}/supabase/migrations/${n}.sql`,'utf8')}));
export const plushieReleaseDigest=createHash('sha256').update(plushieReleaseSources.map(m=>m.source).join('\n')).digest('hex');
const allowed=['read_room_photo_v1','burrow_bootstrap_v2','plushie_touch_state_v2','read_plushie_touch_v2','record_burrow_toy_window_v1','interact_burrow_toy_batch_v1','interact_burrow_toy_v1'];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const functions=`select oid,proname,proargtypes::text args,proacl,prosecdef,proconfig,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
export function plushieReleaseTransaction(expected=[]){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin for t in select name from plushie_release_tables loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select to_jsonb(t) v from %s t) a',t.name,t.name);
end loop;end $audit$;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow:plushie281282-release',0));
do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261027000280')
 or exists(select 1 from supabase_migrations.schema_migrations where version in('20261027000281','20261027000282')) then raise exception 'Unexpected migration baseline';end if;
 ${expected.map(f=>`if not exists(select 1 from pg_proc where oid=${quote(f.signature)}::regprocedure and md5(prosrc)=${quote(f.body)}) then raise exception 'Reviewed function changed: %',${quote(f.signature)};end if;`).join('\n')}
end $$;
create temporary table plushie_release_tables on commit drop as select format('%I.%I',schemaname,tablename) name from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users');
create temporary table plushie_release_functions on commit drop as ${functions};
create temporary table plushie_release_security on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
${audit('plushie_release_before')}
${plushieReleaseSources.map(m=>m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')).join('\n')}
${audit('plushie_release_after')}
do $guard$begin
 if exists(select * from plushie_release_before except select * from plushie_release_after) or exists(select * from plushie_release_after except select * from plushie_release_before) then raise exception 'Protected rows changed';end if;
 if exists(select * from plushie_release_functions where proname not in(${allowed.map(quote).join(',')}) except ${functions}) then raise exception 'Unrelated function changed';end if;
 if (select count(*) from plushie_release_functions)<>(select count(*) from pg_proc where pronamespace='public'::regnamespace and prokind='f') then raise exception 'Unexpected function set';end if;
 if exists(select 1 from plushie_release_functions b join pg_proc a using(oid) where a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig) then raise exception 'Function security changed';end if;
 if exists(select v from plushie_release_security except
  (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace
   union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Table security changed';end if;
end $guard$;
${plushieReleaseSources.map(m=>`insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(m.version)},${quote(m.name)},array[${quote(m.source)}]);`).join('\n')}
select jsonb_build_object('migrations',jsonb_build_array(281,282),'sha256','${plushieReleaseDigest}','protectedSets',(select count(*) from plushie_release_before),'protectedRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,'existingPermissionsUnchanged',true) verified;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-plushie281282.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(file,v)=>fs.writeFileSync(`${dir}/${file}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 if(mode==='inspect'){
  const rows=query(`begin read only;select oid::regprocedure::text signature,md5(prosrc) body,pg_get_functiondef(oid) definition,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in(${allowed.map(quote).join(',')}) order by oid;commit;`);
  assert.equal(rows.length,7);save('before',{digest:plushieReleaseDigest,functions:rows});console.log(JSON.stringify({readOnly:true,reviewedFunctions:rows.map(r=>({signature:r.signature,body:r.body}))}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/before.json'));assert.equal(before.digest,plushieReleaseDigest);
  const result=query(plushieReleaseTransaction(before.functions)).find(r=>r.verified)?.verified;assert.ok(result?.protectedRowsUnchanged);save('applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
  const rows=query(`begin read only;select version,md5(statements[1]) digest from supabase_migrations.schema_migrations where version in('20261027000281','20261027000282') order by version;commit;`);
  assert.equal(rows.length,2);for(let i=0;i<2;i++)assert.equal(rows[i].digest,createHash('md5').update(plushieReleaseSources[i].source).digest('hex'));
  save('verified',{migrationRecorded:true,digest:plushieReleaseDigest});console.log(JSON.stringify({migrations:[281,282],migrationRecorded:true}));
 }else throw Error('Use inspect / apply / verify');
}
