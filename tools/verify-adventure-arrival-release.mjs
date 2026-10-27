// Read-only release checks. No production accounts, plans or rewards are created.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const source=fs.readFileSync(path.join(root,'supabase/migrations/20261015000240_adventure_arrival_display.sql'),'utf8');
const bodies=[...source.matchAll(/create function public\.(\w+)\([^;]*?as \$\$([\s\S]*?)\$\$;/g)];
assert.equal(bodies.length,2);
const sql=`select jsonb_build_object(
 'migrationApplied',exists(select 1 from supabase_migrations.schema_migrations where version='20261015000240'),
 'uniqueInventory',exists(select 1 from pg_constraint where conrelid='public.user_inventory'::regclass and pg_get_constraintdef(oid)='UNIQUE (owner_id, item_id)'),
 'uniqueAdventureResult',exists(select 1 from pg_constraint where conrelid='public.adventure_results'::regclass and pg_get_constraintdef(oid)='UNIQUE (adventure_id)'),
 'functions',(select jsonb_object_agg(p.proname,jsonb_build_object('hash',md5(p.prosrc),
   'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
   'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in('adventure_display_v1','adventure_command_v2','adventure_command_before_arrival_v3')),
 'privacyProbe',public.adventure_display_v1('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')->>'error'
) as verification`;
const raw=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024}));
const result=(Array.isArray(raw)?raw:raw.rows)[0].verification;
assert.equal(result.migrationApplied,true);
assert.equal(result.uniqueInventory,true);assert.equal(result.uniqueAdventureResult,true);
for(const [,name,body] of bodies){
 const live=result.functions[name];assert.ok(live,name);
 assert.equal(live.hash,createHash('md5').update(body).digest('hex'),`${name}: exact deployed migration body`);
 assert.equal(live.service,true);assert.equal(live.anon,false);assert.equal(live.authenticated,false);
}
assert.ok(result.functions.adventure_command_before_arrival_v3);
const previousSource=fs.readFileSync(path.join(root,'supabase/migrations/20261011000219_adventure_unified_settlement.sql'),'utf8');
const previousBody=previousSource.match(/create function public\.adventure_command_v2\([^;]*?as \$\$([\s\S]*?)\$\$;/)[1];
assert.equal(result.functions.adventure_command_before_arrival_v3.hash,createHash('md5').update(previousBody).digest('hex'),'original reward dispatcher remains unchanged');
assert.equal(result.functions.adventure_command_before_arrival_v3.anon,false);
assert.equal(result.functions.adventure_command_before_arrival_v3.authenticated,false);
assert.equal(result.privacyProbe,'not_found');
console.log(JSON.stringify({migration:240,applied:true,exactFunctionBodies:true,originalRewardDispatcherUnchanged:true,
  uniqueInventory:true,uniqueAdventureResult:true,serviceOnly:true,privacyProbe:'not_found',productionRewardWrites:0}));
if(process.argv.includes('--api')){
 const endpoint='https://api.soulsayit.com/api/vnext/adventure?adventureId=00000000-0000-0000-0000-000000000002';
 const response=await fetch(endpoint,{signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,401);assert.equal((await response.json()).error,'Unauthorized');
 console.log(JSON.stringify({endpoint:'https://api.soulsayit.com/api/vnext/adventure',routeLive:true,unauthenticatedStatus:401}));
}
