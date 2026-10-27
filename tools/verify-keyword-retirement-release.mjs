// Read-only production checks. No journals, user identifiers or secrets are printed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const tables=['item_learning_candidates','item_learning_jobs','item_learning_occurrences',
  'item_learning_decisions','item_match_removals','item_keyword_rule_events'];
const functions=['item_rule_snapshot(text,bigint)','publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)',
  'publish_item_rules_batch(text,jsonb,bigint,uuid)','claim_item_learning_jobs()',
  'record_item_learning_evidence(uuid,text,text,text,text,numeric,boolean)'];
const ref=fs.readFileSync('supabase/.temp/project-ref','utf8').trim();
assert.equal(ref,'qleeohkhbrdvznbwgqad');
const fingerprints=tables.map(table=>`select '${table}' as name,count(*)::int as count,
  md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as hash from public.${table} t`).join(' union all ');
const sql=`select jsonb_build_object(
 'migrationApplied',exists(select 1 from supabase_migrations.schema_migrations where version='20261015000241'),
 'evidence',(select jsonb_agg(t order by name) from (${fingerprints}) t),
 'functions',(select jsonb_agg(jsonb_build_object('role',r,'function',f,'allowed',has_function_privilege(r,f,'execute')))
   from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[${functions.map(x=>`'${x}'`).join(',')}]) f),
 'tables',(select jsonb_agg(jsonb_build_object('role',r,'table',t,'action',a,'allowed',has_table_privilege(r,t,a)))
   from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[${tables.map(x=>`'${x}'`).join(',')}]) t
   cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) a)
 ) as result;`;
const raw=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024}));
const result=(Array.isArray(raw)?raw:raw.rows)[0].result;
if(!process.argv.includes('--capture')) {
  assert.equal(result.migrationApplied,true);
  for(const row of result.functions)assert.equal(row.allowed,false,JSON.stringify(row));
  for(const row of result.tables)assert.equal(row.allowed,row.role==='service_role'&&row.action==='SELECT',JSON.stringify(row));
  const beforeFile=process.argv.find(x=>x.startsWith('--compare='))?.slice(10);
  if(beforeFile)assert.deepEqual(result.evidence,JSON.parse(fs.readFileSync(beforeFile,'utf8')).evidence,'Historical evidence must remain byte-for-byte unchanged');
}
const report=process.argv.find(x=>x.startsWith('--report='))?.slice(9);
if(report)fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({mode:process.argv.includes('--capture')?'capture':'verify',migration:241,
  applied:result.migrationApplied,evidence:result.evidence,checkedFunctions:result.functions.length,
  checkedTablePrivileges:result.tables.length,passed:true}));
