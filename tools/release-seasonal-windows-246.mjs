// Read-only by default. --apply backs up precisely the old-window scope, then
// installs exactly migration 246 plus its history record in one transaction.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),version='20261018000246',name='burrow_seasonal_window_frames';
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const source=fs.readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
const hash=value=>createHash('md5').update(value).digest('hex');
function query(sql){const r=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],
 {cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
const prefix=`with old as(select stable_id from public.catalog_items where category='windows' and stable_id not like 'window_frame_%'),
 gifts_old as(select id from public.gifts where item_id in(select stable_id from old)),
 purchases_old as(select id from public.catalog_purchases where item_id in(select stable_id from old)),
 adventures_old as(select adventure_id from public.adventure_results where item_id in(select stable_id from old) or gift_id in(select id from gifts_old))`;
const contains=column=>`exists(select 1 from old where jsonb_path_exists(coalesce(${column},'{}'::jsonb),'$.** ? (@ == $id)',jsonb_build_object('id',old.stable_id)))`;
const scopes={catalog_items:"stable_id in(select stable_id from old)",user_inventory:"item_id in(select stable_id from old)",
 room_loadouts:"item_id in(select stable_id from old)",room_music:"track_id in(select stable_id from old)",
 gifts:"id in(select id from gifts_old)",catalog_purchases:"id in(select id from purchases_old)",
 adventure_results:"adventure_id in(select adventure_id from adventures_old)",adventures:"id in(select adventure_id from adventures_old)",
 adventure_gift_display:"gift_id in(select stable_id from old)",adventure_encounter_plans:"gift_id in(select stable_id from old)",
 burrow_shop_price_audit:"item_id in(select stable_id from old)",currency_ledger:"reference_type='catalog_item' and reference_id in(select stable_id from old)",
 friend_visits:`reward_item_id in(select stable_id from old) or gift_id in(select id from gifts_old) or ${contains('content_snapshot')}`,
 burrow_command_receipts:`${contains('request')} or ${contains('response')}`,adventure_logs:contains('payload'),
 moment_events:`${contains('payload')} or reference_type='catalog_item' and reference_id in(select stable_id from old)
  or reference_type='gift' and reference_id in(select id::text from gifts_old)
  or reference_type='catalog_purchase' and reference_id in(select id::text from purchases_old)
  or reference_type='adventure' and reference_id in(select adventure_id::text from adventures_old)`};
function backup(){return query(`${prefix} select jsonb_build_object(${Object.entries(scopes).map(([table,where])=>
 `'${table}',coalesce((select jsonb_agg(to_jsonb(t)) from public.${table} t where ${where}),'[]'::jsonb)`).join(',')}) snapshot;`)[0].snapshot;}
function state(){return query(`select jsonb_build_object(
 'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'prerequisite',exists(select 1 from supabase_migrations.schema_migrations where version='20261018000245'),
 'wallets',(select md5(coalesce(string_agg(to_jsonb(w)::text,'' order by to_jsonb(w)::text),'')) from public.wallets w),
 'otherCatalog',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by stable_id),'')) from public.catalog_items c where category<>'windows'),
 'functions',(select md5(string_agg(oid::text||prosrc,'' order by oid)) from pg_proc where pronamespace='public'::regnamespace),
 'windows',(select jsonb_agg(to_jsonb(c) order by (metadata->>'artOrdinal')::integer) from public.catalog_items c where category='windows'),
 'missingDefault',(select count(*) from public.profiles p where not exists(select 1 from public.user_inventory i where i.owner_id=p.id and i.item_id='window_frame_cross_dark_wood'))
 ) verification;`)[0].verification;}
const before=state();assert.equal(before.prerequisite,true);
let backupFile=null,applied=false;
if(process.argv.includes('--apply')&&!before.sourceHash){
 const snapshot=backup();assert.equal(snapshot.catalog_items.length,32,'Unexpected replacement scope; inspect before deleting');
 const backupRoot=path.join(root,'supabase/backups');fs.mkdirSync(backupRoot,{recursive:true});
 const directory=fs.mkdtempSync(path.join(backupRoot,'window-246-'));
 // *.tmp is excluded by Git and deployment archives; keep the backup durable
 // in the workspace, owner-readable only, instead of relying on OS temp files.
 backupFile=path.join(directory,'old-window-records.json.tmp');
 const record={project:'qleeohkhbrdvznbwgqad',version,createdAt:new Date().toISOString(),sourceHash:hash(source),before,snapshot};
 fs.writeFileSync(backupFile,JSON.stringify(record,null,2)+'\n',{mode:0o600});
 assert.deepEqual(JSON.parse(fs.readFileSync(backupFile,'utf8')),record,'Backup must round-trip before deletion');
 assert.ok(!source.includes('$migration246$'));
 const body=source.replace(/^([\s\S]*?)\bbegin;\s*/i,'$1').replace(/commit;\s*$/i,'');
 query(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:window-migration-246',0));
 do $$begin if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'already registered';end if;end $$;
 ${body}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration246$${source}$migration246$]);commit;`);
 applied=true;
}
const after=state();
assert.equal(after.wallets,before.wallets,'Wallets changed during release; inspect before continuing');
assert.equal(after.otherCatalog,before.otherCatalog,'Other products must remain unchanged');
assert.equal(after.functions,before.functions,'No public RPC may change');
if(process.argv.includes('--apply')||process.argv.includes('--verify')){
 assert.equal(after.sourceHash,hash(source));assert.equal(after.windows.length,39);assert.equal(after.missingDefault,0);
 for(const [i,w] of after.windows.entries()){
  assert.equal(w.price,200);assert.equal(w.status,'active');assert.equal(w.metadata.artOrdinal,i+1);
  assert.equal(w.stable_id,'window_frame_'+w.metadata.windowFrameKey.toLowerCase());
  assert.equal(w.title,w.metadata.windowFrameKey.replaceAll('_',' '));
 }
 assert.equal(after.windows[0].metadata.windowFrameKey,'Cross_Dark_Wood');assert.equal(after.windows[0].metadata.starter,true);
 const remaining=backup();assert.ok(Object.values(remaining).every(rows=>rows.length===0),'Old-window references must be gone');
}
const report={migration:246,appliedThisRun:applied,migrated:!!after.sourceHash,exactSource:after.sourceHash===hash(source),
 windows:after.windows.length,allPrices200:after.windows.every(w=>w.price===200),default:'Cross_Dark_Wood',
 walletsUnchanged:true,otherCatalogUnchanged:true,publicFunctionsUnchanged:true,backupFile};
const reportFile=process.argv.find(x=>x.startsWith('--report='))?.slice(9);
if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
