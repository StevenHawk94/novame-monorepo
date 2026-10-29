// Explicitly approved migration 286 only. Evidence remains local/private.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),version='20261028000286',name='photo_replacement_retention';
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
const changed=['complete_toy_photo_v1','complete_personal_toy_photo_v1','burrow_photo_quota_v1','burrow_photo_usage_v1','collect_room_photo_garbage_v1'];
const quote=s=>"'"+s.replaceAll("'","''")+"'",sha=s=>createHash('sha256').update(s).digest('hex');
export function photo286Transaction(expected=[]){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin
 for t in select schemaname,tablename from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users') loop
  if t.schemaname='public' and t.tablename in('room_photos','room_photo_garbage') then continue;end if;
  execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select %s v from %I.%I t) a',t.schemaname||'.'||t.tablename,
   case when t.schemaname='public' and t.tablename in(select conrelid::regclass::text from pg_constraint where confrelid='room_photos'::regclass and contype='f' and confdeltype='n') then 'to_jsonb(t)-''photo_id''' else 'to_jsonb(t)' end,t.schemaname,t.tablename);
 end loop;end $audit$;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow:photo286-release',0));
do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261028000285') or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected migration baseline';end if;
 ${expected.map(f=>`if not exists(select 1 from pg_proc where oid=${quote(f.signature)}::regprocedure and md5(pg_get_functiondef(oid))=${quote(f.digest)}) then raise exception 'Reviewed photo function changed';end if;`).join('\n')}
end $$;
lock table room_photos in share row exclusive mode;
create temporary table photo286_photos on commit drop as select * from room_photos;
create temporary table photo286_functions on commit drop as select oid,proname,proacl,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f';
create temporary table photo286_security on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace and relkind in('r','S','v')
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
${audit('photo286_before')}
${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
${audit('photo286_after')}
do $guard$begin
 if exists(select * from photo286_before except select * from photo286_after) or exists(select * from photo286_after except select * from photo286_before) then raise exception 'Protected photo data changed';end if;
 if exists(select * from room_photos except select p.* from photo286_photos p where kind<>'doll' or not exists(select 1 from photo286_photos n where n.kind='doll' and n.owner_id=p.owner_id and n.toy_id=p.toy_id and (n.updated_at,n.id)>(p.updated_at,p.id)))
 or exists(select p.* from photo286_photos p where kind<>'doll' or not exists(select 1 from photo286_photos n where n.kind='doll' and n.owner_id=p.owner_id and n.toy_id=p.toy_id and (n.updated_at,n.id)>(p.updated_at,p.id)) except select * from room_photos) then raise exception 'Unexpected current photo changes';end if;
 if exists(select 1 from photo286_photos p where not exists(select 1 from room_photos n where n.id=p.id) and not exists(select 1 from room_photo_garbage g where g.private_path=p.private_path)) then raise exception 'Old photo not queued';end if;
 if exists(select oid,definition from photo286_functions where proname not in(${changed.map(quote).join(',')}) except select oid,pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f') then raise exception 'Unrelated function changed';end if;
 if exists(select 1 from photo286_functions b join pg_proc a using(oid) where a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig) then raise exception 'Existing function security changed';end if;
 if exists(select v from photo286_security except (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace and relkind in('r','S','v') union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Existing table security changed';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);
select jsonb_build_object('migration',286,'sha256','${sha(source)}','protectedSets',(select count(*) from photo286_before),'protectedDataUnchanged',true,'existingPermissionsUnchanged',true,'unrelatedFunctionsUnchanged',true,'removedDuplicateRows',(select count(*) from photo286_photos)-(select count(*) from room_photos),'currentPlushiePhotos',(select count(*) from room_photos where kind='doll'),'queuedFiles',(select count(*) from room_photo_garbage)) verified;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-photo286.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const f=dir+'/query.sql';fs.writeFileSync(f,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',f],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 if(mode==='inspect'){
  const data=query(`begin read only;
 select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(pg_get_functiondef(oid)),'definition',pg_get_functiondef(oid),'acl',proacl)) from pg_proc where pronamespace='public'::regnamespace and proname in(${changed.map(quote).join(',')})),
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='20261027000280'),
 'photos',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from room_photos p),
 'foreignKeys',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'definition',pg_get_constraintdef(oid))) from pg_constraint where confrelid='room_photos'::regclass and contype='f'),
 'queueCount',(select count(*) from room_photo_garbage)) inspection;commit;`)[0].inspection;
  assert.equal(data.functions.length,5);assert.ok(data.migrations.includes('20261028000285'));assert.ok(!data.migrations.includes(version));
  save('database-before',{sha256:sha(source),...data});console.log(JSON.stringify({readOnly:true,functions:data.functions.map(f=>({signature:f.signature,digest:f.digest})),migrations:data.migrations,photoRows:data.photos.length,foreignKeys:data.foreignKeys,queueCount:data.queueCount}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/database-before.json'));assert.equal(before.sha256,sha(source));
  const result=query(photo286Transaction(before.functions)).find(r=>r.verified)?.verified;assert.ok(result?.protectedDataUnchanged);save('database-applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
  const result=query(`begin read only;select jsonb_build_object('recorded',(select md5(statements[1])=${quote(createHash('md5').update(source).digest('hex'))} from supabase_migrations.schema_migrations where version='${version}'),'duplicates',(select count(*) from(select owner_id,toy_id from room_photos where kind='doll' group by owner_id,toy_id having count(*)>1)d),'unlimited',(select (burrow_photo_usage_v1(user_id)->'doll'->>'unlimited')::boolean from account_economic_calendars limit 1),'permissions',(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in('burrow_photo_usage_v1','collect_room_photo_garbage_v1'))) verified;commit;`)[0].verified;
  assert.ok(result.recorded);assert.equal(result.duplicates,0);assert.ok(result.unlimited);for(const p of result.permissions){assert.equal(p.anon,false);assert.equal(p.authenticated,false);assert.equal(p.service,true);}save('database-verified',result);console.log(JSON.stringify(result));
 }else throw Error('Use inspect / apply / verify');
}
