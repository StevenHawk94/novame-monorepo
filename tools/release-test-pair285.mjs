// Authorized fixed-pair temporary exception only. No App/Admin release.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),version='20261028000285',name='temporary_paired_testing';
export const test285Pair=['36b75655-a89b-45dd-b232-a35db4efe502','4d95e1b8-09e9-4904-aaaa-5e564dabb603'];
export const test285Functions=['burrow_has_plus_v1','sync_pair_plus_entitlements','join_current_partner_plus_v1','burrow_service_offer_v1',
 'adventure_nudge_eligible_v1','adventure_team_snapshot_v1','start_adventure_v5','bind_unpaired_adventures_v1',
 'prune_plushie_touch_v1','cleanup_plushie_touch_v1','send_plushie_touch_v1','plushie_touch_state_v2','enforce_economic_transfer_v1','complete_burrow_surprise_v1'];
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
export const test285Digest=createHash('sha256').update(source).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const functions=`select oid,proname,proargtypes::text args,proacl,prosecdef,proconfig,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
export function test285Transaction(expected=[],pairVersion){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin for t in select name from test285_tables loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select to_jsonb(t) v from %s t) a',t.name,t.name);
end loop;end $audit$;`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow:test285-release',0));
do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261028000284')
 or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected migration baseline';end if;
 ${pairVersion?`if burrow_pair_version_v1('${test285Pair[0]}','${test285Pair[1]}') is distinct from ${quote(pairVersion)} then raise exception 'Approved relationship changed';end if;`:''}
 ${expected.map(f=>`if not exists(select 1 from pg_proc where oid=${quote(f.signature)}::regprocedure and md5(prosrc)=${quote(f.body)}) then raise exception 'Reviewed function changed';end if;`).join('\n')}
end $$;
create temporary table test285_tables on commit drop as select format('%I.%I',schemaname,tablename) name from pg_tables where schemaname='public' or(schemaname='auth' and tablename='users');
create temporary table test285_functions on commit drop as ${functions};
create temporary table test285_security on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
${audit('test285_before')}
${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
${audit('test285_after')}
do $guard$begin
 if exists(select * from test285_before except select * from test285_after) or exists(select * from test285_after except select * from test285_before) then raise exception 'Protected rows changed';end if;
 if exists(select * from test285_functions where proname not in(${test285Functions.map(quote).join(',')}) except ${functions}) then raise exception 'Unrelated function changed';end if;
 if (select count(*) from test285_functions)+2<>(select count(*) from pg_proc where pronamespace='public'::regnamespace and prokind='f') then raise exception 'Unexpected function set';end if;
 if exists(select 1 from test285_functions b join pg_proc a using(oid) where a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig) then raise exception 'Existing function security changed';end if;
 if exists(select v from test285_security except
  (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace
   union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Existing table security changed';end if;
 if not burrow_test_pair_allowed_v1('${test285Pair[0]}','${test285Pair[1]}') then raise exception 'Temporary pair not enabled';end if;
 if exists(select 1 from burrow_temporary_test_pair where expires_at-enabled_at<>interval '168 hours') then raise exception 'Wrong temporary duration';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);
select jsonb_build_object('migration',285,'sha256','${test285Digest}','protectedSets',(select count(*) from test285_before),'protectedRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,'existingPermissionsUnchanged',true,
 'enabledAt',(select enabled_at from burrow_temporary_test_pair),'expiresAt',(select expires_at from burrow_temporary_test_pair)) verified;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-test285.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(file,v)=>fs.writeFileSync(`${dir}/${file}.json`,JSON.stringify(v,null,2),{mode:0o600});
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const out=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(out)?out:out.rows;}
 const pair=()=>query(`begin read only;select p.id,p.invite_code,economic_domain_v1(p.id) domain,has_own_active_plus(p.id) own_plus,burrow_has_plus_v1(p.id) effective_plus,
 a.partner_user_id,burrow_pair_version_v1(p.id,a.partner_user_id) pair_version,
 exists(select 1 from pairings b where b.user_id=a.partner_user_id and b.partner_user_id=p.id) mutual
 from profiles p left join pairings a on a.user_id=p.id where p.id in('${test285Pair[0]}','${test285Pair[1]}') order by p.id;commit;`);
 if(mode==='inspect'){
  const rows=pair();assert.deepEqual(rows.map(r=>r.invite_code),['88US9W','24FAGF']);assert.ok(rows.every(r=>r.mutual));
  assert.equal(rows[0].partner_user_id,rows[1].id);assert.equal(rows[1].partner_user_id,rows[0].id);
  assert.equal(rows[0].pair_version,'598d48d14cda41f9d15e119f9fb62a15');assert.equal(rows[0].pair_version,rows[1].pair_version);
  const funcs=query(`begin read only;select oid::regprocedure::text signature,md5(prosrc) body,pg_get_functiondef(oid) definition,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in(${test285Functions.map(quote).join(',')}) order by oid;commit;`);
  assert.equal(funcs.length,test285Functions.length);save('database-before',{digest:test285Digest,rows,functions:funcs});
  console.log(JSON.stringify({readOnly:true,accounts:rows.map(r=>({code:r.invite_code,domain:r.domain,ownPlus:r.own_plus})),reviewedFunctions:funcs.length}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/database-before.json'));assert.equal(before.digest,test285Digest);assert.deepEqual(pair(),before.rows);
  const result=query(test285Transaction(before.functions,before.rows[0].pair_version)).find(r=>r.verified)?.verified;assert.ok(result?.protectedRowsUnchanged);save('database-applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
  const before=JSON.parse(fs.readFileSync(dir+'/database-before.json')),rows=pair();
  assert.deepEqual(rows.map(({effective_plus,...r})=>r),before.rows.map(({effective_plus,...r})=>r));
  const result=query(`begin read only;select jsonb_build_object('digest',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
   'config',(select to_jsonb(t) from burrow_temporary_test_pair t),
   'realSameDomain',same_economic_domain_v1('${test285Pair[0]}','${test285Pair[1]}'),
   'allowed',burrow_test_pair_allowed_v1('${test285Pair[0]}','${test285Pair[1]}'),
   'reverseAllowed',burrow_test_pair_allowed_v1('${test285Pair[1]}','${test285Pair[0]}'),
   'tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'anon',has_table_privilege('anon',oid,'select,insert,update,delete'),'authenticated',has_table_privilege('authenticated',oid,'select,insert,update,delete'),'serviceWrite',has_table_privilege('service_role',oid,'insert,update,delete'))) from pg_class where oid in('burrow_temporary_test_pair'::regclass,'burrow_test_transfer_admissions'::regclass)),
   'rpc',(select jsonb_agg(jsonb_build_object('name',proname,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in('burrow_test_pair_allowed_v1','burrow_pair_economy_allowed_v1'))) verified;commit;`)[0].verified;
  assert.equal(result.digest,createHash('md5').update(source).digest('hex'));assert.equal(result.allowed,true);assert.equal(result.reverseAllowed,true);assert.equal(result.realSameDomain,false);
  assert.ok(rows.every(r=>r.effective_plus));for(const t of result.tables){assert.ok(t.rls);assert.equal(t.anon,false);assert.equal(t.authenticated,false);assert.equal(t.serviceWrite,false);}
  for(const r of result.rpc){assert.equal(r.anon,false);assert.equal(r.authenticated,false);assert.equal(r.service,true);}
  save('database-verified',{...result,rows,verifiedAt:new Date().toISOString()});console.log(JSON.stringify({migration:285,accounts:rows.map(r=>({code:r.invite_code,domain:r.domain,ownPlus:r.own_plus,effectivePlus:r.effective_plus})),allowedBothDirections:true,enabledAt:result.config.enabled_at,expiresAt:result.config.expires_at,permissionsVerified:true}));
 }else throw Error('Use inspect / apply / verify');
}
