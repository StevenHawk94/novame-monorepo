// Scoped production release: preserve financial functions and register the
// exact migration in the same transaction as its schema changes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261018000244',name='friend_visit_prepared_dialogue';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
assert.match(source,/^begin;[\s\S]*commit;\s*$/);
const body=source.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
const hash=x=>createHash('md5').update(x).digest('hex');
const functions=[...source.matchAll(/create (?:or replace )?function public\.(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];
assert.equal(functions.length,3);
const protectedNames=['respond_friend_visit_v2','change_carrot_balance_v1'];
function query(sql){const r=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
function state(){return query(`select jsonb_build_object(
 'migrated',exists(select 1 from supabase_migrations.schema_migrations where version='${version}'),
 'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'prerequisites',(select count(*) from supabase_migrations.schema_migrations where version in('20261014000235','20261014000236','20261017000243')),
 'protected',(select jsonb_object_agg(proname,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname in(${protectedNames.map(n=>`'${n}'`).join(',')})),
 'functions',(select jsonb_object_agg(proname,jsonb_build_object('hash',md5(prosrc),'definer',prosecdef,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in('prepare_friend_visit_v3','respond_friend_visit_v3','friend_visit_view_v2')),
 'rls',(select relrowsecurity from pg_class where oid=to_regclass('public.friend_visit_preparations_v3')),
 'tableAnon',case when to_regclass('public.friend_visit_preparations_v3') is not null then has_table_privilege('anon','public.friend_visit_preparations_v3','select,insert,update,delete') end,
 'tableAuthenticated',case when to_regclass('public.friend_visit_preparations_v3') is not null then has_table_privilege('authenticated','public.friend_visit_preparations_v3','select,insert,update,delete') end,
 'schedulerCooldown',position('d.first_seen_at at time zone' in pg_get_functiondef('public.schedule_friend_visit_v2(uuid,date)'::regprocedure))>0,
 'untouchedPrematureVisits',(select count(*) from friend_visit_instances_v2 v where v.ended_at is null and v.first_completed_at is null and not exists(select 1 from friend_visit_sessions_v2 s where s.visit_id=v.id) and not exists(select 1 from user_friend_discoveries d where d.friend_id=v.friend_id and d.user_id in(v.pair_low,v.pair_high) and d.interaction_completed_at is not null and (d.first_seen_at at time zone coalesce((select timezone from friend_visit_schedule_v2 where pair_low=v.pair_low and pair_high=v.pair_high and pair_version=v.pair_version),'UTC'))::date<v.visit_date))
 ) verification;`)[0].verification;}
const before=state();assert.equal(before.prerequisites,3);assert.ok(before.protected.respond_friend_visit_v2);assert.ok(before.protected.change_carrot_balance_v1);
let applied=false;
if(process.argv.includes('--apply')&&!before.migrated){
 assert.equal(before.rls,null);assert.ok(!source.includes('$migration244$'));
 query(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
 select pg_advisory_xact_lock(hashtextextended('novame:friend-visit-migration-244',0));
 do $$begin if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'already registered'; end if; end $$;
 ${body}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration244$${source}$migration244$]);commit;`);applied=true;
}
const after=state();assert.deepEqual(after.protected,before.protected);
if(process.argv.includes('--apply')||process.argv.includes('--verify')){
 assert.equal(after.sourceHash,hash(source));assert.equal(after.rls,true);assert.equal(after.tableAnon,false);assert.equal(after.tableAuthenticated,false);assert.equal(after.schedulerCooldown,true);
 for(const [,name,body] of functions){const f=after.functions[name];assert.equal(f.hash,hash(body));assert.equal(f.definer,true);assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,true);}
}
const report={migration:244,version,linkedProjectVerified:true,appliedThisRun:applied,migrated:after.migrated,exactSource:after.sourceHash===hash(source),protectedFunctionsUnchanged:true,protectedHashes:after.protected,serviceOnlyPreparedDialogues:after.rls&&after.tableAnon===false&&after.tableAuthenticated===false,schedulerCooldown:after.schedulerCooldown,untouchedPrematureVisitsBefore:before.untouchedPrematureVisits,untouchedPrematureVisitsAfter:after.untouchedPrematureVisits};
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
