// Scoped production migration with function rollback and transactional row guards.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2),version='20261022000258',name='plushie_moment_windows';
assert.ok(dir?.startsWith('/private/tmp/burrow-toy258-release.'));
assert.equal(fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const source=fs.readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8'),md5=s=>createHash('md5').update(s).digest('hex');
const changed=['burrow_moment_quest_progress','interact_burrow_toy_batch_v1','interact_burrow_toy_v1','solo_burrow_toy_v1'];
const names=changed.map(n=>`'${n}'`).join(',');
const save=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2),{mode:0o600});
function query(sql){const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json',sql],{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
function state(){return query(`select jsonb_build_object(
 'previous',exists(select 1 from supabase_migrations.schema_migrations where version='20261021000257'),
 'migrationHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'writers',(select jsonb_object_agg(proname,jsonb_build_object('definition',pg_get_functiondef(oid),'oid',oid,'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and proname in(${names})),
 'protected',(select md5(string_agg(oid::text||pg_get_functiondef(oid),E'\n' order by oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in(${names},'record_burrow_toy_window_v1')),
 'triggers',(select jsonb_object_agg(oid::text,pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace))
 ) state;`)[0].state;}
const signature='public.record_burrow_toy_window_v1(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,date,integer,text,text)';
function verify(before,after){assert.equal(after.migrationHash,md5(source));assert.equal(after.protected,before.protected);assert.deepEqual(after.triggers,before.triggers);
 for(const [n,old]of Object.entries(before.writers)){assert.equal(after.writers[n].oid,old.oid);assert.deepEqual(after.writers[n].grants,old.grants);}
 const grants=query(`select has_function_privilege('anon','${signature}','execute') anon,has_function_privilege('authenticated','${signature}','execute') authenticated,has_function_privilege('service_role','${signature}','execute') service`)[0];
 assert.deepEqual(grants,{anon:false,authenticated:false,service:true});}
if(mode==='inspect'){
 const before=state();assert.equal(before.previous,true);assert.equal(before.migrationHash,null);assert.equal(Object.keys(before.writers).length,4);save('preflight',before);
 fs.writeFileSync(dir+'/rollback.sql',`begin;set local lock_timeout='5s';\n${Object.values(before.writers).map(w=>w.definition+';').join('\n')}\ndrop function ${signature};\nalter table public.moment_events drop column toy_window_started_at;\ndelete from supabase_migrations.schema_migrations where version='${version}' and md5(statements[1])='${md5(source)}';\nnotify pgrst,'reload schema';commit;`,{mode:0o600});
 console.log(JSON.stringify({previousMigration:true,writersBackedUp:4,rollbackPrepared:true}));
}else if(mode==='apply'){
 const before=JSON.parse(fs.readFileSync(dir+'/preflight.json'));assert.deepEqual(state(),before,'Database functions changed since preflight');
 const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
 const guard=Object.entries(before.writers).map(([n,w])=>`if md5(pg_get_functiondef(${w.oid}))<>'${md5(w.definition)}' then raise exception 'writer drift: ${n}';end if;`).join('\n');
 const tables=['moment_events','daily_quest_assignments','quest_progress_vnext','burrow_command_receipts'];
 const snapshot=tables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg((to_jsonb(t)-'toy_window_started_at')::text,E'\\n' order by (to_jsonb(t)-'toy_window_started_at')::text),'')) digest from public.${t} t`).join(' union all ');
 const sql=`begin;set local lock_timeout='5s';set local statement_timeout='60s';select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));
 lock table ${tables.map(t=>'public.'+t).join(',')} in share mode;
 do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'already migrated';end if;${guard}end $guard$;
 create temporary table toy258_before on commit drop as ${snapshot};
 ${body}
 create temporary table toy258_after on commit drop as ${snapshot};
 do $guard$ begin if exists(select * from toy258_before except select * from toy258_after) or exists(select * from toy258_after except select * from toy258_before) then raise exception 'existing Moments, tasks or receipts changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration258$${source}$migration258$]);commit;`;
 fs.writeFileSync(dir+'/apply.sql',sql,{mode:0o600});query(sql);const after=state();verify(before,after);save('verified',after);
 console.log(JSON.stringify({migration:version,verified:true,oldRowsUnchanged:true,otherFunctionsAndTriggersUnchanged:true,privateServiceOnly:true}));
}else if(mode==='verify'){const before=JSON.parse(fs.readFileSync(dir+'/preflight.json'));verify(before,state());console.log(JSON.stringify({migration:version,verified:true}));}
else throw Error('Use inspect, apply or verify');
