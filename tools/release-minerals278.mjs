// Authorized presentation-only production update. No claims, rerolls or grants.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [mode,dir]=process.argv.slice(2);
assert.ok(dir?.startsWith('/private/tmp/burrow-r2-refresh.'));
assert.equal(fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261027000278',name='minerals_gift_art_refresh';
const source=fs.readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
const updates=JSON.parse(source.match(/\$gift_art278\$([\s\S]+?)\$gift_art278\$/)[1]);
const q=s=>"'"+s.replaceAll("'","''")+"'";
const ids=updates.map(x=>q(x.id)).join(',');assert.equal(updates.length,32);
function query(sql){
 const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const rows=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(rows)?rows:rows.rows;
}
const digest='md5(coalesce(string_agg(v::text,E\'\\n\' order by v::text),\'\'))';
const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in('catalog_items','adventure_encounter_plans','adventure_results') loop
 execute format('insert into ${table} select %L,count(*),${digest.replaceAll("'","''")} from (select to_jsonb(t) v from public.%I t) a',t.tablename,t.tablename);
 end loop;end $audit$;
insert into ${table} select 'catalog_items',count(*),${digest} from(select case when stable_id in(${ids}) then to_jsonb(c)-'asset'-'updated_at' else to_jsonb(c) end v from catalog_items c)a;
insert into ${table} select 'adventure_encounter_plans',count(*),${digest} from(select case when gift_id in(${ids}) then jsonb_set(to_jsonb(p),'{snapshot}',snapshot#-'{giftSnapshot,asset}') else to_jsonb(p) end v from adventure_encounter_plans p)a;
insert into ${table} select 'adventure_results',count(*),${digest} from(select case when metadata->'giftSnapshot'->>'stable_id' in(${ids}) or metadata->'itemSnapshot'->>'stable_id' in(${ids}) then jsonb_set(to_jsonb(r),'{metadata}',metadata#-'{giftSnapshot,asset}'#-'{itemSnapshot,asset}') else to_jsonb(r) end v from adventure_results r)a;
insert into ${table} select 'schema-security',count(*),${digest} from(
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select jsonb_build_array('function',oid,proacl,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'
 union all select to_jsonb(p) from pg_policies p where schemaname='public')a;`;
const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
const transaction=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
${audit('minerals278_before')}${body}${audit('minerals278_after')}
do $guard$ begin if exists(select * from minerals278_before except select * from minerals278_after) or exists(select * from minerals278_after except select * from minerals278_before) then raise exception 'Protected data/permissions changed';end if;end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${q(source)}]);
select count(*) protected_tables from minerals278_before;
commit;`;
if(mode==='sql-test'){console.log(transaction);
}else if(mode==='inspect'){
 const rows=query(`select stable_id,asset from catalog_items where stable_id in(${ids}) order by stable_id`);
 assert.equal(rows.length,32);for(const x of updates)assert.equal(rows.find(y=>y.stable_id===x.id).asset.key,x.old_key);
 assert.equal(query(`select version from supabase_migrations.schema_migrations where version='20261026000277'`).length,1);
 fs.writeFileSync(dir+'/minerals-before.json',JSON.stringify(rows,null,2),{mode:0o600});
 const rollback=updates.map(x=>{const old=rows.find(y=>y.stable_id===x.id).asset,asset=q(JSON.stringify(old))+'::jsonb',id=q(x.id),key=q(x.asset.key);return `update catalog_items set asset=${asset} where stable_id=${id} and asset->>'key'=${key};
update adventure_encounter_plans set snapshot=jsonb_set(snapshot,'{giftSnapshot,asset}',${asset}) where gift_id=${id} and snapshot->'giftSnapshot'->>'stable_id'=${id} and snapshot->'giftSnapshot'->'asset'->>'key'=${key};
update adventure_results set metadata=jsonb_set(metadata,'{giftSnapshot,asset}',${asset}) where metadata->'giftSnapshot'->>'stable_id'=${id} and metadata->'giftSnapshot'->'asset'->>'key'=${key};
update adventure_results set metadata=jsonb_set(metadata,'{itemSnapshot,asset}',${asset}) where metadata->'itemSnapshot'->>'stable_id'=${id} and metadata->'itemSnapshot'->'asset'->>'key'=${key};`;}).join('\n');
 fs.writeFileSync(dir+'/rollback-minerals-presentation.sql','begin;\n'+rollback+'\ncommit;',{mode:0o600});
 console.log(JSON.stringify({preflight:true,gifts:rows.length,rollbackPrepared:true}));
}else if(mode==='apply'){
 assert.ok(fs.existsSync(dir+'/minerals-before.json'));
 // Public CDN must serve exactly the uploaded bytes before any pointer moves.
 const gifts=JSON.parse(fs.readFileSync('apps/api/src/data/adventure-friends/MM.json')).gifts;
 for(let i=0;i<gifts.length;i+=4)await Promise.all(gifts.slice(i,i+4).map(async g=>{
  const response=await fetch('https://media.novameapp.com/'+g.key,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,g.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),g.sha256);
 }));
 const result=query(transaction);
 const rows=query(`select stable_id,asset from catalog_items where stable_id in(${ids}) order by stable_id`);
 for(const x of updates)assert.deepEqual(rows.find(y=>y.stable_id===x.id).asset,x.asset);
 const report={migration:278,gifts:rows.length,cdnHashesVerified:32,protectedDataAndPermissionsUnchanged:true,result};
 fs.writeFileSync(dir+'/minerals-applied.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}else throw Error('Use inspect or apply');
