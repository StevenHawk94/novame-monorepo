// Read-only by default. --apply installs exactly migration 245 and its history
// record in one transaction; no other pending migration is applied.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261018000245',name='love_note_send_limits';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const md5=value=>createHash('md5').update(value).digest('hex');
const functionBody=source.match(/create function public\.enforce_love_note_send_limits_v1\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
assert.ok(functionBody);assert.ok(!source.includes('$migration245$'));
const protectedNames=['save_memory_room_entry_v1','save_memory_room_durable_v1','save_memory_room_versioned_v1','lock_burrow_pair','change_carrot_balance_v1','broadcast_burrow_change'];
function query(sql){const r=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
function state(){return query(`select jsonb_build_object(
 'migrated',exists(select 1 from supabase_migrations.schema_migrations where version='${version}'),
 'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'prerequisites',(select count(*) from supabase_migrations.schema_migrations where version in('20260920000122','20260920000129','20260920000137','20261014000233','20261018000244')),
 'protected',(select jsonb_object_agg(proname,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname in(${protectedNames.map(n=>`'${n}'`).join(',')})),
 'function',(select jsonb_build_object('hash',md5(prosrc),'definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute')) from pg_proc where pronamespace='public'::regnamespace and proname='enforce_love_note_send_limits_v1'),
 'rls',(select relrowsecurity from pg_class where oid=to_regclass('public.love_note_send_limits')),
 'tableAnon',has_table_privilege('anon',to_regclass('public.love_note_send_limits'),'select,insert,update,delete'),
 'tableAuthenticated',has_table_privilege('authenticated',to_regclass('public.love_note_send_limits'),'select,insert,update,delete'),
 'trigger',(select jsonb_build_object('enabled',tgenabled,'definition',pg_get_triggerdef(oid)) from pg_trigger where tgrelid='public.memory_room_entries'::regclass and tgname='enforce_love_note_send_limits'),
 'index',(select indisvalid and indisready from pg_index where indexrelid=to_regclass('public.memory_room_entries_love_note_sender_time_idx'))
 ) verification;`)[0].verification;}
const before=state();assert.equal(before.prerequisites,5);
for(const name of protectedNames)assert.ok(before.protected[name],name);
let applied=false;
if(process.argv.includes('--apply')&&!before.migrated){
 assert.equal(before.rls,null);assert.equal(before.function,null);assert.equal(before.trigger,null);assert.equal(before.index,null);
 query(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:love-note-migration-245',0));
 do $$begin if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'already registered';end if;end $$;
 ${source}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration245$${source}$migration245$]);commit;`);
 applied=true;
}
const after=state();assert.deepEqual(after.protected,before.protected);
if(process.argv.includes('--apply')||process.argv.includes('--verify')){
 assert.equal(after.sourceHash,md5(source));assert.equal(after.rls,true);assert.equal(after.tableAnon,false);assert.equal(after.tableAuthenticated,false);
 assert.equal(after.function.hash,md5(functionBody));assert.equal(after.function.definer,true);assert.equal(after.function.anon,false);assert.equal(after.function.authenticated,false);
 assert.ok(after.function.config.includes('search_path=public, pg_temp'));
 assert.equal(after.trigger.enabled,'O');assert.match(after.trigger.definition,/BEFORE INSERT OR UPDATE OF body/);assert.equal(after.index,true);
}
const report={migration:245,version,linkedProjectVerified:true,appliedThisRun:applied,migrated:after.migrated,exactSource:after.sourceHash===md5(source),
 protectedFunctionsUnchanged:true,protectedHashes:after.protected,privateQuotaTable:after.rls===true&&after.tableAnon===false&&after.tableAuthenticated===false,
 function:after.function,trigger:after.trigger,indexReady:after.index};
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
