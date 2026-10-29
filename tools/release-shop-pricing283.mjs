// Narrow authorized price/Plus update. No real-user purchase operations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const evidence=JSON.parse(fs.readFileSync(path.join(root,'catalog/approvals/pricing-2026-10-28.json')));
const meta=evidence.release;
const version='20261028000283',name='approved_shop_pricing';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const q=s=>"'"+s.replaceAll("'","''")+"'";
export function shop283Transaction({recordMigration=true}={}){
 const digest="md5(coalesce(string_agg(v::text,E'\\n' order by v::text),''))";
 const ids=q(JSON.stringify(evidence.records.map(r=>r.id)));
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in('catalog_items','burrow_shop_price_audit','burrow_shop_release_support') loop
 execute format('insert into ${table} select %L,count(*),${digest.replaceAll("'","''")} from (select to_jsonb(t) v from public.%I t) a',t.tablename,t.tablename);
 end loop;
 if to_regclass('auth.users') is not null then
 execute 'insert into ${table} select ''auth-users'',count(*),${digest.replaceAll("'","''")} from (select to_jsonb(t) v from auth.users t) a';
 end if;end $audit$;
insert into ${table} select 'protected-catalog-fields',count(*),${digest} from(select case when c.stable_id in(select jsonb_array_elements_text(${ids}::jsonb)) then to_jsonb(c)-array['price','plus_only','shop_price_version','updated_at'] else to_jsonb(c) end v from catalog_items c)a;
insert into ${table} select 'prior-price-audits',count(*),${digest} from(select to_jsonb(s) v from burrow_shop_price_audit s where batch_id<>${q(meta.batch)})a;
insert into ${table} select 'prior-capabilities',count(*),${digest} from(select to_jsonb(s) v from burrow_shop_release_support s where release<>${q(meta.release)})a;
insert into ${table} select 'schema-security',count(*),${digest} from(
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select jsonb_build_array('function',oid,proacl,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'
 union all select to_jsonb(p) from pg_policies p where schemaname='public')a;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
${audit('shop283_before')}${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}${audit('shop283_after')}
do $guard$ begin if exists(select * from shop283_before except select * from shop283_after) or exists(select * from shop283_after except select * from shop283_before) then raise exception 'Protected data/permissions changed';end if;end $guard$;
${recordMigration?`insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${q(source)}]) on conflict(version) do nothing;`:''}
select count(*) protected_sets from shop283_before;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-pricing283.'));
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
  const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:5*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(result)?result:result.rows;}
 const rows=()=>query(`begin read only;select c.stable_id,c.price,c.plus_only,c.shop_price_version,c.status,burrow_shop_item_supported_v1(c.stable_id,${q(meta.release)}) supported from catalog_items c where stable_id in(select jsonb_array_elements_text(${q(JSON.stringify(evidence.records.map(r=>r.id)))}::jsonb)) order by stable_id;commit;`);
 if(mode==='inspect'){
  const products=rows();assert.equal(products.length,496);assert.ok(products.every(p=>p.status==='active'));
  for(const p of products){const old=evidence.before.find(r=>r.stable_id===p.stable_id);assert.deepEqual([p.price,p.plus_only,p.shop_price_version],[old.price,old.plus_only,old.shop_price_version]);}
  fs.writeFileSync(dir+'/before.json',JSON.stringify({products,meta},null,2),{mode:0o600});
  console.log(JSON.stringify({readOnly:true,products:products.length,pendingChanges:meta.changed}));
 }else if(mode==='apply'){
  assert.deepEqual(JSON.parse(fs.readFileSync(dir+'/before.json')).meta,meta);
  const result=query(shop283Transaction());const products=rows();
  for(const p of products){const x=evidence.records.find(r=>r.id===p.stable_id);assert.equal(p.price,x.price);assert.equal(p.plus_only,x.plusOnly);assert.ok(p.supported);}
  const report={migration:283,appliedAt:new Date().toISOString(),...meta,verifiedProducts:products.length,protectedDataAndPermissionsUnchanged:true,result};
  fs.writeFileSync(dir+'/applied.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }else if(mode==='verify'){
  const products=rows();for(const p of products){const x=evidence.records.find(r=>r.id===p.stable_id);assert.equal(p.price,x.price);assert.equal(p.plus_only,x.plusOnly);assert.ok(p.supported);}
  assert.equal(products.length,496);console.log(JSON.stringify({readOnly:true,matched:products.length,release:meta.release}));
 }else throw Error('Use inspect, apply or verify');
}
