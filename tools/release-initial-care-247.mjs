// Read-only unless --apply is supplied. Apply exactly 247, never db push.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261018000247',name='burrow_initial_care_needs';
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const hash=createHash('md5').update(source).digest('hex');
const body=source.replace(/--[^\n]*(?:\n|$)/g,'').replace(/^\s*begin;\s*/i,'').replace(/commit;\s*$/i,'').trim();
assert.match(body,/^alter table public\.room_needs\s+alter column food_value set default 0,\s+alter column water_value set default 0;$/i);
assert.ok(!source.includes('$migration247$'));
function query(sql){
  const result=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{
    cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe'],
  }));
  return Array.isArray(result)?result:result.rows;
}
function state(){return query(`select jsonb_build_object(
  'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
  'previousMigration',exists(select 1 from supabase_migrations.schema_migrations where version='20261018000246'),
  'defaults',(select jsonb_object_agg(column_name,column_default) from information_schema.columns
    where table_schema='public' and table_name='room_needs' and column_name in ('food_value','water_value'))
  ) verification;`)[0].verification;}

const before=state();assert.equal(before.previousMigration,true,'Migration 246 must already be installed');
let proof=null;
if(process.argv.includes('--apply')&&!before.sourceHash){
  proof=query(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('novame:initial-care-migration-247',0));
    lock table public.room_needs in access exclusive mode;
    do $guard247$
    declare previous_hash text; next_hash text; previous_count bigint; next_count bigint;
    begin
      if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
        raise exception 'Migration already registered';
      end if;
      select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by owner_id),''))
        into previous_count,previous_hash from public.room_needs r;
      ${body}
      select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by owner_id),''))
        into next_count,next_hash from public.room_needs r;
      if previous_count<>next_count or previous_hash<>next_hash then
        raise exception 'Existing care state changed; rolling back';
      end if;
      insert into supabase_migrations.schema_migrations(version,name,statements)
        values('${version}','${name}',array[$migration247$${source}$migration247$]);
      perform set_config('novame.migration247_proof',jsonb_build_object(
        'existingRows',previous_count,'beforeHash',previous_hash,'afterHash',next_hash,
        'existingRowsAndTimestampsUnchanged',true)::text,false);
    end $guard247$;
    commit;
    select current_setting('novame.migration247_proof')::jsonb proof;`)[0].proof;
}
const after=state();
if(process.argv.includes('--apply')||process.argv.includes('--verify')){
  assert.equal(after.sourceHash,hash,'Registered migration must match exact source');
  for(const column of ['food_value','water_value'])assert.match(after.defaults[column],/^\(?0\)?(?:::(?:numeric|integer|real|double precision))?$/);
}
const report={migration:247,version,verifiedAt:new Date().toISOString(),linkedProjectVerified:true,
  appliedThisRun:proof!==null,exactSource:after.sourceHash===hash,defaults:after.defaults,proof,
  scope:'Only food_value and water_value column defaults; no existing row, timestamp, wallet or other product updates'};
const target=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);
if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
