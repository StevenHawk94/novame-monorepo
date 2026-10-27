// Read-only production verification: never edits offers, creates unlocks or
// touches wallets. Exercise actual free/paid writes only in the isolated DB tests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const source=fs.readFileSync(path.join(root,'supabase/migrations/20261015000238_burrow_free_games.sql'),'utf8');
const definitions=[...source.matchAll(/create or replace function public\.(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];
assert.equal(definitions.length,3);
const names=definitions.map(([,name])=>`'${name}'`).join(',');
const sql=`select jsonb_build_object(
 'catalogueHash',(select md5(coalesce(jsonb_agg(jsonb_build_array(stable_id,price,plus_only,shop_price_version,status,revision_id) order by stable_id)::text,'[]')) from public.catalog_items),
 'migrated',exists(select 1 from supabase_migrations.schema_migrations where version='20261015000238'),
 'functions',(select jsonb_agg(f) from (select proname as name,md5(prosrc) as hash,prosecdef as security_definer,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in(${names})) f),
 'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conname='burrow_game_unlocks_price_paid_check')
) as verification;`;
const output=execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
const parsed=JSON.parse(output);
const rows=Array.isArray(parsed)?parsed:parsed.rows;
assert.ok(Array.isArray(rows),'Unexpected Supabase query result');
const result=rows[0]?.verification;assert.ok(result?.catalogueHash);
if(!process.argv.includes('--before')){
 assert.equal(result.migrated,true);
 for(const [,name,body] of definitions){
  const row=result.functions.find(r=>r.name===name);assert.ok(row,name);
  assert.equal(row.hash,createHash('md5').update(body).digest('hex'),`${name} must exactly match the tested migration`);
  assert.equal(row.security_definer,true);assert.equal(row.anon,false);assert.equal(row.authenticated,false);
  if(name!=='burrow_service_offer_v1')assert.equal(row.service,true);
 }
 assert.match(result.constraint??'',/price_paid >= 0/);
 const before=process.argv.find(arg=>arg.startsWith('--compare='))?.slice('--compare='.length);
 if(before)assert.equal(result.catalogueHash,JSON.parse(fs.readFileSync(before,'utf8')).catalogueHash,'Migration must not change live prices, Plus flags or catalogue');
}
console.log(JSON.stringify({linkedProjectVerified:true,catalogueHash:result.catalogueHash,
 ...(!process.argv.includes('--before')?{migration:238,exactSqlFunctionsVerified:3,privateRpcGrantsVerified:true,zeroConstraintVerified:true}:{}),productionUserWrites:0}));
