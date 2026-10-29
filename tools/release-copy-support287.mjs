// Deploy the already approved 12 placeholder-copy removals and matching support.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),version='20261028000287',name='placeholder_copy_client_support';
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
const release=JSON.parse(fs.readFileSync(root+'/catalog/generated/shop-catalog-release.json'));
const ids=release.products.filter(p=>p.id.startsWith('placeholder_')&&p.description==='').map(p=>p.id).sort();assert.equal(ids.length,12);
const quote=s=>"'"+s.replaceAll("'","''")+"'",sha=s=>createHash('sha256').update(s).digest('hex');
export function copy287Transaction(){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users') loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select %s v from %I.%I t %s) a',t.schemaname||'.'||t.tablename,
  case when t.tablename='catalog_items' then 'case when stable_id in(select jsonb_array_elements_text('''||${quote(JSON.stringify(ids))}||'''::jsonb)) then to_jsonb(t)-''description'' else to_jsonb(t) end' else 'to_jsonb(t)' end,t.schemaname,t.tablename,
  case when t.tablename='burrow_shop_release_support' then 'where release<>''${release.release}''' else '' end);
 end loop;end $audit$;
insert into ${table} select 'schema-security',count(*),md5(coalesce(string_agg(v::text,E'\\n' order by v::text),'')) from(
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select jsonb_build_array('function',oid,proacl,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'
 union all select to_jsonb(p) from pg_policies p where schemaname='public')s;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
do $$begin if not exists(select 1 from supabase_migrations.schema_migrations where version='20261028000286') or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected copy migration baseline';end if;end $$;
${audit('copy287_before')}${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}${audit('copy287_after')}
do $$begin if exists(select * from copy287_before except select * from copy287_after) or exists(select * from copy287_after except select * from copy287_before) then raise exception 'Unrelated copy/support data changed';end if;end $$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);
select jsonb_build_object('migration',287,'sha256','${sha(source)}','clearedDescriptions',12,'registeredProducts',(select count(*) from burrow_shop_release_support where release='${release.release}'),'release','${release.release}','protectedSets',(select count(*) from copy287_before),'protectedDataUnchanged',true,'permissionsUnchanged',true) verified;commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-photo286.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const f=dir+'/copy-query.sql';fs.writeFileSync(f,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',f],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 if(mode==='inspect'){
  const rows=query(`begin read only;select stable_id,description from catalog_items where stable_id in(select jsonb_array_elements_text(${quote(JSON.stringify(ids))}::jsonb)) order by stable_id;commit;`);assert.equal(rows.length,12);save('copy-before',{sha256:sha(source),rows});console.log(JSON.stringify({readOnly:true,rows}));
 }else if(mode==='apply'){
  assert.equal(JSON.parse(fs.readFileSync(dir+'/copy-before.json')).sha256,sha(source));const result=query(copy287Transaction()).find(r=>r.verified)?.verified;assert.ok(result?.protectedDataUnchanged);assert.equal(result.registeredProducts,496);save('copy-applied',result);console.log(JSON.stringify(result));
 }else throw Error('Use inspect / apply');
}
