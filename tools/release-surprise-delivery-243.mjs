// Apply ONLY migration 243 to the explicitly linked production project.
// No old migration replay, user writes, media changes or wallet changes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261017000243',name='surprise_delivery_recovery';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const digest=value=>createHash('md5').update(value).digest('hex');
const originalNames=['prepare_burrow_surprise_v2','complete_burrow_surprise_v1','read_burrow_surprises_v1','burrow_surprise_history_v1','change_carrot_balance_v1'];
const added=[...source.matchAll(/create function public\.(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];assert.equal(added.length,2);
function query(sql){
 const raw=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(raw)?raw:raw.rows;
}
function state(){return query(`select jsonb_build_object(
 'migrated',exists(select 1 from supabase_migrations.schema_migrations where version='${version}'),
 'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'prerequisite',exists(select 1 from supabase_migrations.schema_migrations where version='20261016000242'),
 'notifications',to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null,
 'rls',(select relrowsecurity from pg_class where oid='public.burrow_surprises'::regclass),
 'originals',(select jsonb_object_agg(proname,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname in(${originalNames.map(x=>`'${x}'`).join(',')})),
 'added',(select jsonb_object_agg(proname,jsonb_build_object('hash',md5(prosrc),'definer',prosecdef,
 'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),
 'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in('burrow_surprise_send_status_v1','broadcast_surprise_delivery_v1')),
 'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(oid),'enabled',tgenabled)) from pg_trigger where tgrelid='public.burrow_surprises'::regclass and tgname='surprise_delivery_changed' and not tgisinternal)
 ) verification;`)[0].verification;}
const before=state();assert.equal(before.prerequisite,true);assert.equal(before.notifications,true);assert.equal(before.rls,true);
assert.equal(Object.keys(before.originals).length,originalNames.length);
let applied=false;
if(process.argv.includes('--apply')&&!before.migrated){
 assert.equal(before.added,null);assert.equal(before.triggers,null);assert.ok(!source.includes('$migration243$'));
 query(`begin;set local lock_timeout='5s';set local statement_timeout='30s';
 select pg_advisory_xact_lock(hashtextextended('novame:surprise-migration-243',0));
 do $$begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'migration already registered'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261016000242') then raise exception 'missing prerequisite 242'; end if;
 end $$;
 ${source}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration243$${source}$migration243$]);
 commit;`);applied=true;
}
const after=state();assert.deepEqual(after.originals,before.originals,'Existing financial/history bodies must remain byte-identical');
if(process.argv.includes('--apply')||process.argv.includes('--verify')){
 assert.equal(after.migrated,true);assert.equal(after.sourceHash,digest(source));assert.equal(after.rls,true);
 for(const [,fn,body] of added){const live=after.added[fn];assert.equal(live.hash,digest(body));assert.equal(live.definer,true);assert.equal(live.anon,false);assert.equal(live.authenticated,false);}
 assert.equal(after.added.burrow_surprise_send_status_v1.service,true);
 assert.equal(after.triggers.length,1);assert.equal(after.triggers[0].enabled,'O');assert.match(after.triggers[0].definition,/AFTER INSERT OR UPDATE OF sent_at, opened_at/);
}
const report={migration:243,version,linkedProjectVerified:true,appliedThisRun:applied,migrated:after.migrated,
 exactSource:after.migrated&&after.sourceHash===digest(source),originalTransactionAndHistoryBodiesUnchanged:true,originalHashes:after.originals,
 privateNotificationsAvailable:after.notifications,rls:after.rls,serviceOnlyReceipt:!!after.added?.burrow_surprise_send_status_v1?.service,
 productionUserWrites:0,productionWalletWrites:0};
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
