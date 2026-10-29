// Explicit user authorization on 2026-10-29: migrations 288/289 only, after
// care-rendering verification. No purchases, account RPC calls or catalog edit.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),sha=s=>createHash('sha256').update(s).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const migrations=[
 ['20261029000288','adventure_upgrade_and_owned_games','9c7c0dacdea52a690e84b4d0940133068516ffbf70b9f3426a370a5ac8c13e4b'],
 ['20261029000289','adventure_nudge_availability','b1cc65828f3251b6edd7e62ce36aeb0fc2bf7b68eacd10d105ef828e40e4ff04'],
].map(([version,name,hash])=>{const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');assert.equal(sha(source),hash);return{version,name,source,sha256:hash};});
const changed=['accelerate_adventure_for_plus_v1','refresh_economic_entitlements_v1','adventure_team_snapshot_v1','burrow_service_offer_v1','adventure_nudge_eligible_v1'];
export function adventure288289Transaction(expected=[]){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
 do $audit$declare t record;begin
 for t in select schemaname,tablename from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users') loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from(select %s v from %I.%I x)a',t.schemaname||'.'||t.tablename,
 case when t.schemaname='public' and t.tablename='adventures' then 'to_jsonb(x)-''plus_accelerated_at''' else 'to_jsonb(x)' end,t.schemaname,t.tablename);
 end loop;end $audit$;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('burrow:adventure288289-release',0));
 do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261028000287')
 or exists(select 1 from supabase_migrations.schema_migrations where version>='20261029000288') then raise exception 'Unexpected Adventure migration baseline';end if;
 ${expected.map(f=>`if not exists(select 1 from pg_proc where oid=${quote(f.signature)}::regprocedure and md5(pg_get_functiondef(oid))=${quote(f.digest)}) then raise exception 'Reviewed Adventure function changed';end if;`).join('\n')}
 end $$;
 create temporary table adventure_release_functions on commit drop as select oid,proname,proacl,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f';
 create temporary table adventure_release_security on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace and relkind in('r','S','v')
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
 ${audit('adventure_release_before')}
 ${migrations.map(m=>m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')).join('\n')}
 ${audit('adventure_release_after')}
 do $guard$begin
 if exists(select * from adventure_release_before except select * from adventure_release_after)
 or exists(select * from adventure_release_after except select * from adventure_release_before) then raise exception 'Protected Adventure data changed';end if;
 if exists(select 1 from adventures where plus_accelerated_at is not null) then raise exception 'Deployment must not accelerate existing trips';end if;
 if exists(select oid,definition from adventure_release_functions where proname not in(${changed.map(quote).join(',')}) except select oid,pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f') then raise exception 'Unrelated Adventure function changed';end if;
 if exists(select 1 from adventure_release_functions b join pg_proc a using(oid) where b.proname not in(${changed.map(quote).join(',')}) and (a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig)) then raise exception 'Existing Adventure function security changed';end if;
 if exists(select v from adventure_release_security except (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace and relkind in('r','S','v') union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Existing Adventure table security changed';end if;
 end $guard$;
 ${migrations.map(m=>`insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(m.version)},${quote(m.name)},array[${quote(m.source)}]);`).join('\n')}
 select jsonb_build_object('migrations',jsonb_build_array('20261029000288','20261029000289'),'protectedSets',(select count(*) from adventure_release_before),'protectedDataUnchanged',true,'unrelatedFunctionsUnchanged',true,'existingTablePermissionsUnchanged',true,'catalogUnchanged',true,'deploymentAcceleratedTrips',0) verified;
 commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const[mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-adventure288289.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const f=dir+'/query.sql';fs.writeFileSync(f,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',f],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 if(mode==='inspect'){
 const result=query(`begin read only;select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(pg_get_functiondef(oid)),'definition',pg_get_functiondef(oid),'acl',proacl)) from pg_proc where pronamespace='public'::regnamespace and proname in(${changed.map(quote).join(',')})),
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='20261028000285')) inspection;commit;`)[0].inspection;
 assert.equal(result.functions.length,5);assert.ok(result.migrations.includes('20261028000287'));assert.ok(!result.migrations.some(v=>v>='20261029000288'));
 save('before',{...result,candidates:migrations.map(({version,sha256})=>({version,sha256}))});console.log(JSON.stringify({readOnly:true,migrations:result.migrations,functions:result.functions.map(({signature,digest})=>({signature,digest}))}));
 }else if(mode==='apply'){
 const before=JSON.parse(fs.readFileSync(dir+'/before.json'));assert.deepEqual(before.candidates,migrations.map(({version,sha256})=>({version,sha256})));
 const result=query(adventure288289Transaction(before.functions)).find(r=>r.verified)?.verified;assert.ok(result?.protectedDataUnchanged);save('applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
 const names=['accelerate_adventure_for_plus_v1','refresh_economic_entitlements_v1','adventure_team_snapshot_v1','adventure_team_snapshot_before288_v1','adventure_team_snapshot_before289_v1','refresh_economic_entitlements_before288_v1','apply_active_adventure_plus_v1','adventure_nudge_status_v1','adventure_nudge_eligible_v1'];
 const result=query(`begin read only;select jsonb_build_object('recorded',(select jsonb_agg(jsonb_build_object('version',version,'sha256',encode(sha256(convert_to(statements[1],'UTF8')),'hex'))) from supabase_migrations.schema_migrations where version in('20261029000288','20261029000289')),
 'permissions',(select jsonb_agg(jsonb_build_object('name',proname,'signature',oid::regprocedure::text,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in(${names.map(quote).join(',')}))) verified;commit;`)[0].verified;
 assert.equal(result.recorded.length,2);for(const m of migrations)assert.equal(result.recorded.find(r=>r.version===m.version)?.sha256,m.sha256);
 assert.equal(result.permissions.length,names.length);for(const p of result.permissions){assert.equal(p.anon,false);assert.equal(p.authenticated,false);assert.equal(p.service,['accelerate_adventure_for_plus_v1','refresh_economic_entitlements_v1','adventure_team_snapshot_v1'].includes(p.name));}
 save('verified',result);console.log(JSON.stringify(result));
 }else throw Error('Use inspect / apply / verify');
}
