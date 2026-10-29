// User-authorized, two-account Touch Note exception only. No API/App release.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),version='20261027000280',name='touch_note_test_pair';
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
export const touch280Digest=createHash('sha256').update(source).digest('hex');
export const touch280Pair=['b8ebeeb8-4353-4baa-a75e-ace1ab4a0af1','d896d176-96f7-4f7f-af15-42284f251251'];
const quoted=s=>"'"+s.replaceAll("'","''")+"'";
export function touch280Transaction(){
 const audit=table=>`create temporary table ${table}(name text primary key,n bigint,digest text) on commit drop;
do $audit$declare t record;begin
 for t in select name from touch280_tables loop
 execute format('insert into ${table} select %L,count(*),md5(coalesce(string_agg(v::text,E''\\n'' order by v::text),'''')) from (select to_jsonb(t) v from %s t) a',t.name,t.name);
 end loop;end $audit$;`;
 const funcs=`select oid,proname,proargtypes::text args,proacl,prosecdef,proconfig,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow:touch280-release',0));
do $$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261026000277')
 or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected migration baseline';end if;
end $$;
create temporary table touch280_tables on commit drop as select format('%I.%I',schemaname,tablename) name from pg_tables where schemaname='public' or (schemaname='auth' and tablename='users');
create temporary table touch280_functions on commit drop as ${funcs};
create temporary table touch280_permissions on commit drop as
 select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) v from pg_class where relnamespace='public'::regnamespace
 union all select to_jsonb(p) from pg_policies p where schemaname='public';
${audit('touch280_before')}
${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
${audit('touch280_after')}
do $guard$begin
 if exists(select * from touch280_before except select * from touch280_after) or exists(select * from touch280_after except select * from touch280_before) then raise exception 'Protected rows changed';end if;
 if exists(select * from touch280_functions where proname not in('send_plushie_touch_v1','plushie_touch_state_v2') except ${funcs}) then raise exception 'Unrelated function changed';end if;
 if exists(select 1 from touch280_functions b join pg_proc a using(oid) where a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig) then raise exception 'Existing function security changed';end if;
 if exists(select v from touch280_permissions except
  (select jsonb_build_array('relation',oid,relacl,relrowsecurity,relforcerowsecurity) from pg_class where relnamespace='public'::regnamespace
   union all select to_jsonb(p) from pg_policies p where schemaname='public')) then raise exception 'Existing table security changed';end if;
 if (select count(*) from plushie_touch_test_pair)<>1 then raise exception 'Unexpected exception scope';end if;
 if exists(select 1 from pg_roles where rolname in('anon','authenticated') and
  (has_table_privilege(rolname,'plushie_touch_test_pair','SELECT,INSERT,UPDATE,DELETE') or has_function_privilege(rolname,'plushie_touch_test_pair_allowed_v1(uuid,uuid,text)','EXECUTE'))) then raise exception 'Client test-pair access';end if;
 if same_economic_domain_v1('${touch280Pair[0]}','${touch280Pair[1]}') then raise exception 'Expected cross-domain test pair';end if;
 if not plushie_touch_test_pair_allowed_v1('${touch280Pair[0]}','${touch280Pair[1]}',burrow_pair_version_v1('${touch280Pair[0]}','${touch280Pair[1]}')) then raise exception 'Exception not active for current pair';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quoted(source)}]);
select jsonb_build_object('migration',280,'sha256','${touch280Digest}','protectedSets',(select count(*) from touch280_before),'protectedRowsUnchanged',true,'unrelatedFunctionsUnchanged',true,'existingPermissionsUnchanged',true,'exceptionPairs',1) verified;
commit;`;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-touch280.'));
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const save=(file,value)=>fs.writeFileSync(`${dir}/${file}.json`,JSON.stringify(value,null,2),{mode:0o600});
 function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
  const parsed=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(parsed)?parsed:parsed.rows;}
 const check=()=>query(`begin read only;select p.id,p.invite_code,economic_domain_v1(p.id) domain,burrow_has_plus_v1(p.id) has_plus,
  a.partner_user_id,burrow_pair_version_v1(p.id,a.partner_user_id) pair_version,
  exists(select 1 from pairings b where b.user_id=a.partner_user_id and b.partner_user_id=p.id) mutual
  from profiles p left join pairings a on a.user_id=p.id where p.id in('${touch280Pair[0]}','${touch280Pair[1]}') order by p.id;commit;`);
 if(mode==='inspect'){
  const rows=check();assert.deepEqual(rows.map(r=>r.invite_code),['HA54J3','YRZQDM']);assert.ok(rows.every(r=>r.mutual));
  assert.equal(rows[0].partner_user_id,rows[1].id);assert.equal(rows[1].partner_user_id,rows[0].id);
  assert.notEqual(rows[0].domain,rows[1].domain);assert.equal(rows[0].pair_version,rows[1].pair_version);
  const functions=query("begin read only;select oid,proname,pg_get_functiondef(oid) definition,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in('send_plushie_touch_v1','plushie_touch_state_v2');commit;");
  save('before',{rows,functions,digest:touch280Digest});console.log(JSON.stringify({readOnly:true,mutuallyPaired:true,accounts:rows.map(r=>({code:r.invite_code,domain:r.domain,hasPlus:r.has_plus}))}));
 }else if(mode==='apply'){
  const before=JSON.parse(fs.readFileSync(dir+'/before.json'));assert.equal(before.digest,touch280Digest);assert.deepEqual(check(),before.rows);
  const result=query(touch280Transaction()).find(r=>r.verified)?.verified;assert.ok(result?.protectedRowsUnchanged);save('applied',result);console.log(JSON.stringify(result));
 }else if(mode==='verify'){
  const before=JSON.parse(fs.readFileSync(dir+'/before.json'));assert.deepEqual(check(),before.rows);
  const recorded=query(`begin read only;select md5(statements[1]) digest from supabase_migrations.schema_migrations where version='${version}';commit;`);
  assert.equal(recorded[0]?.digest,createHash('md5').update(source).digest('hex'));
  const rows=query(`begin read only;select t.pair_version,t.enabled,
   same_economic_domain_v1(t.pair_low,t.pair_high) same_domain,
   plushie_touch_test_pair_allowed_v1(t.pair_low,t.pair_high,t.pair_version) allowed,
   plushie_touch_test_pair_allowed_v1(t.pair_high,t.pair_low,t.pair_version) reverse_allowed,
   plushie_touch_test_pair_allowed_v1(t.pair_low,'d14b8f6f-11e6-493a-9515-687a1de113e9',t.pair_version) bkjwh6_allowed
   from plushie_touch_test_pair t;commit;`);
  assert.equal(rows.length,1);assert.deepEqual(rows[0],{pair_version:before.rows[0].pair_version,enabled:true,same_domain:false,allowed:true,reverse_allowed:true,bkjwh6_allowed:false});
  save('verified',{rows,digest:touch280Digest,migrationRecorded:true,accountDomainsAndEntitlementsUnchanged:true});console.log(JSON.stringify({migration:280,migrationRecorded:true,allowedBothDirections:true,sameDomainStillFalse:true,BKJWH6Excluded:true,accountDomainsAndEntitlementsUnchanged:true}));
 }else throw Error('Use inspect / apply / verify');
}
