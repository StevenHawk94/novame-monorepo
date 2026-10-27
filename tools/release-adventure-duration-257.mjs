// Narrow database-only release. No API/Admin deployment or existing-row update.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2),root=process.cwd(),version='20261021000257',name='adventure_production_duration';
assert.ok(dir?.startsWith('/private/tmp/burrow-duration257-release.'));
assert.equal(fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const source=fs.readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
const hash=value=>createHash('md5').update(value).digest('hex');
const save=(file,data)=>fs.writeFileSync(`${dir}/${file}.json`,JSON.stringify(data,null,2),{mode:0o600});
function query(sql){const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(result)?result:result.rows;}
const state=()=>query(`select jsonb_build_object(
 'previous',exists(select 1 from supabase_migrations.schema_migrations where version='20261021000256'),
 'migrationHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'writers',(select jsonb_object_agg(proname,jsonb_build_object('definition',pg_get_functiondef(oid),'oid',oid,'grants',proacl,'security',prosecdef,'config',proconfig)) from pg_proc where pronamespace='public'::regnamespace and proname in('start_adventure_v1','solo_burrow_start_adventure_v1')),
 'protected',(select md5(string_agg(oid::text||pg_get_functiondef(oid),E'\n' order by oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in('start_adventure_v1','solo_burrow_start_adventure_v1','burrow_test_adventure_duration_v1')),
 'triggers',(select jsonb_object_agg(oid::text,pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace) and tgname<>'burrow_test_adventure_duration'),
 'testTrigger',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.adventures'::regclass and tgname='burrow_test_adventure_duration'),
 'testFunction',(select pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace and proname='burrow_test_adventure_duration_v1')
) state;`)[0].state;
function verify(before,after){
 assert.equal(after.migrationHash,hash(source));assert.equal(after.testTrigger,null);assert.equal(after.testFunction,null);
 assert.equal(after.protected,before.protected);assert.deepEqual(after.triggers,before.triggers);
 for(const [key,old]of Object.entries(before.writers))assert.deepEqual(after.writers[key],{...old,definition:old.definition.replaceAll('then 7200 else 28800','then 7200 else 21600')});
}
if(mode==='inspect'){
 const before=state();assert.equal(before.previous,true);assert.equal(before.migrationHash,null);assert.ok(before.testTrigger);assert.ok(before.testFunction);
 assert.equal(Object.keys(before.writers).length,2);for(const writer of Object.values(before.writers))assert.ok(writer.definition.includes('then 7200 else 28800'));
 save('preflight',before);
 fs.writeFileSync(dir+'/rollback.sql',`begin;\n${Object.values(before.writers).map(w=>w.definition+';').join('\n')}\n${before.testFunction};\n${before.testTrigger};\ndelete from supabase_migrations.schema_migrations where version='${version}' and md5(statements[1])='${hash(source)}';\nnotify pgrst,'reload schema';commit;`,{mode:0o600});
 console.log(JSON.stringify({previousMigration:true,durationWriters:2,testOverridePresent:true,rollbackPrepared:true}));
}else if(mode==='apply'){
 const before=JSON.parse(fs.readFileSync(dir+'/preflight.json','utf8')),latest=state();assert.deepEqual(latest,before,'Database changed since preflight');
 const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
 const checks=Object.entries(before.writers).map(([key,writer])=>`if pg_get_functiondef('public.${key}(uuid,uuid,text)'::regprocedure)<>$old257$${writer.definition}$old257$ then raise exception 'duration writer drift';end if;`).join('\n');
 const sql=`begin;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));
 lock table public.adventures in share mode;
 do $guard$ begin if not exists(select 1 from supabase_migrations.schema_migrations where version='20261021000256') or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'migration prerequisite mismatch';end if;${checks}end $guard$;
 create temporary table duration257_before on commit drop as select count(*) n,md5(coalesce(string_agg(to_jsonb(a)::text,E'\n' order by id),'')) digest from public.adventures a;
 ${body}
 do $guard$ begin if exists(select 1 from duration257_before b cross join (select count(*) n,md5(coalesce(string_agg(to_jsonb(a)::text,E'\n' order by id),'')) digest from public.adventures a) x where b.n<>x.n or b.digest<>x.digest) then raise exception 'existing Adventure changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration257$${source}$migration257$]);commit;`;
 fs.writeFileSync(dir+'/apply.sql',sql,{mode:0o600});query(sql);const after=state();verify(before,after);save('postcheck',after);
 console.log(JSON.stringify({migration:version,freeSeconds:21600,plusSeconds:7200,oldJourneysUnchanged:true,otherFunctionsAndTriggersUnchanged:true}));
}else if(mode==='verify'){
 const before=JSON.parse(fs.readFileSync(dir+'/preflight.json','utf8')),after=state();verify(before,after);save('verified',after);console.log(JSON.stringify({migration:version,verified:true}));
}else throw Error('Use inspect, apply or verify');
