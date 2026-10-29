// Authorized capability registration only; no purchases on production accounts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const version='20261027000279',name='shop_client_capability';
const release=JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json')));
// This historical migration registers this exact reviewed bundle, not whichever
// bundle happens to be current when a later regression/recovery is run.
release.release='f7647586172bd52cc353933b38ac06b40fc3ad51e870eed9635e80e26d8a3c15';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const q=s=>"'"+s.replaceAll("'","''")+"'";
export function shop279Transaction(){
 const digest="md5(coalesce(string_agg(v::text,E'\\n' order by v::text),''))";
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename<>'burrow_shop_release_support' loop
 execute format('insert into ${table} select %L,count(*),${digest.replaceAll("'","''")} from (select to_jsonb(t) v from public.%I t) a',t.tablename,t.tablename);
 end loop;end $audit$;
insert into ${table} select 'prior-capabilities',count(*),${digest} from(select to_jsonb(s) v from burrow_shop_release_support s where release<>${q(release.release)})a;
insert into ${table} select 'schema-security',count(*),${digest} from(
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select jsonb_build_array('function',oid,proacl,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'
 union all select to_jsonb(p) from pg_policies p where schemaname='public')a;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
${audit('shop279_before')}${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}${audit('shop279_after')}
do $guard$ begin if exists(select * from shop279_before except select * from shop279_after) or exists(select * from shop279_after except select * from shop279_before) then raise exception 'Protected data/permissions changed';end if;end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${q(source)}]);
select count(*) protected_sets from shop279_before;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-shop279.'));
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
  const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(result)?result:result.rows;}
 const check=()=>query(`select c.stable_id,c.title,c.category,c.price,c.plus_only,c.status,burrow_shop_item_supported_v1(c.stable_id,${q(release.release)}) supported from catalog_items c where stable_id in(select jsonb_array_elements_text(${q(JSON.stringify(release.clients[release.release]))}::jsonb)) order by stable_id`);
 if(mode==='inspect'){
  const products=check();assert.equal(products.length,496);assert.ok(products.every(p=>p.status==='active'));
  const support=query('select release,product_id from burrow_shop_release_support order by release,product_id');
  fs.writeFileSync(dir+'/before.json',JSON.stringify({products,support},null,2),{mode:0o600});
  fs.writeFileSync(dir+'/rollback-capability.sql',`-- Only if explicitly authorized; never reverts any committed purchase.\nbegin;delete from burrow_shop_release_support where release=${q(release.release)};commit;`,{mode:0o600});
  console.log(JSON.stringify({readOnly:true,products:products.length,blocked:products.filter(p=>!p.supported).length,currentRegistered:support.filter(s=>s.release===release.release).length}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/before.json'));assert.equal(before.support.filter(s=>s.release===release.release).length,0);
  const result=query(shop279Transaction());const products=check();
  assert.equal(products.length,496);assert.ok(products.every(p=>p.supported));
  assert.deepEqual(products.map(({supported,...rest})=>rest),before.products.map(({supported,...rest})=>rest));
  const report={migration:279,release:release.release,registered:496,previouslyBlocked:before.products.filter(p=>!p.supported).length,nowBlocked:0,productFieldsUnchanged:true,protectedDataAndPermissionsUnchanged:true,result};
  fs.writeFileSync(dir+'/applied.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }else throw Error('Use inspect or apply');
}
