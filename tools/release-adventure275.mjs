// User approved migration 275 only, after isolated validation. No API overlay,
// fake production purchases, user-content reads or unrelated migrations.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-adventure275-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const name='20261025000275_bind_unpaired_adventure',version=name.slice(0,14),source=fs.readFileSync(root+'/supabase/migrations/'+name+'.sql','utf8');
const md5=s=>createHash('md5').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const save=(name,value)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],
  {cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(result)?result:result.rows;}
const tables=['profiles','subscriptions','wallets','currency_ledger','catalog_items','user_inventory','catalog_purchases','gifts','iap_transactions','burrow_coin_transactions',
 'burrow_sandbox_coin_transactions','orders','room_loadouts','room_photos','room_photo_uploads','moment_events','adventures','adventure_encounter_plans','adventure_results',
 'app_announcements','user_read_announcements','force_updates','couple_journal_pages','couple_journal_answers','app_config','burrow_shop_catalog_releases','burrow_shop_release_support'];
const fingerprints=tables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
const functions=`select oid,proname,proacl,prosecdef,proconfig,md5(pg_get_functiondef(oid)) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
function state(){return query(`begin read only;select jsonb_build_object(
 'migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version>='20261024000272'),
 'functions',(select jsonb_agg(to_jsonb(f) order by oid) from (${functions}) f),
 'eligible',(select count(*) from adventure_parties p join pairings a on a.user_id=p.leader_id join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
 where p.partner_id is null and p.pair_version is null and p.follower_id is null and p.rule_version=5 and p.ends_at>now()+interval '10 minutes')) state;rollback;`)[0].state;}
function compareFunctions(before,after){for(const f of before.functions){const next=after.functions.find(n=>n.oid===f.oid);assert.ok(next,'Function removed '+f.proname);
 if(f.proname==='adventure_team_snapshot_v1')assert.deepEqual({...next,definition:f.definition},f);else assert.deepEqual(next,f,'Unrelated function changed '+f.proname);}}
function migrationTransaction(){
 const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
 return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('burrow:adventure275-release',0));
 create temporary table guard_rows_before on commit drop as ${fingerprints};
 create temporary table guard_parties_before on commit drop as select * from adventure_parties;
 create temporary table guard_functions_before on commit drop as ${functions};
 create temporary table guard_acl_before on commit drop as select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';
 ${body}
 create temporary table guard_rows_after on commit drop as ${fingerprints};
 do $guard$begin
 if exists(select * from guard_rows_before except select * from guard_rows_after) or exists(select * from guard_rows_after except select * from guard_rows_before)
 then raise exception 'Protected user rows changed';end if;
 if exists(select id from guard_parties_before except select id from adventure_parties) or exists(select id from adventure_parties except select id from guard_parties_before)
 then raise exception 'Party inserted or removed';end if;
 if exists(select 1 from guard_parties_before b join adventure_parties a using(id) where to_jsonb(a) is distinct from to_jsonb(b) and (
  (to_jsonb(a)-'partner_id'-'pair_version'-'revision') is distinct from (to_jsonb(b)-'partner_id'-'pair_version'-'revision')
  or b.partner_id is not null or b.pair_version is not null or b.follower_id is not null or b.rule_version<>5
  or a.revision<>b.revision+1 or b.ends_at<=now()+interval '10 minutes'
  or a.partner_id is null or a.pair_version is distinct from burrow_pair_version_v1(a.leader_id,a.partner_id)
  or not same_economic_domain_v1(a.leader_id,a.partner_id)
  or not exists(select 1 from pairings p join pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id where p.user_id=a.leader_id and p.partner_user_id=a.partner_id)
  or not exists(select 1 from adventures x where x.id=a.leader_adventure_id and x.party_id=a.id and x.user_id=a.leader_id and x.status='in_progress' and x.ends_at>now()+interval '10 minutes')
 )) then raise exception 'Unexpected party change';end if;
 if exists(select * from guard_functions_before where proname<>'adventure_team_snapshot_v1' except ${functions})
 then raise exception 'Unrelated function/ACL changed';end if;
 if exists(select 1 from guard_functions_before b join pg_proc a using(oid) where b.proname='adventure_team_snapshot_v1' and
 (a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig))
 then raise exception 'Snapshot grants changed';end if;
 if exists(select * from guard_acl_before except select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r')
 then raise exception 'Table grants/RLS changed';end if;
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('bind_unpaired_adventures_v1','bind_adventure_after_pair_v1','adventure_team_snapshot_v1')
 and(has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE')))
 then raise exception 'Unexpected client RPC grant';end if;
 end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','bind_unpaired_adventure',array[${quote(source)}]);
 select jsonb_build_object('changedParties',(select count(*) from guard_parties_before b join adventure_parties a using(id) where to_jsonb(a) is distinct from to_jsonb(b)),
 'protectedTables',(select count(*) from guard_rows_before),'protectedRowsUnchanged',true,'permissionsUnchanged',true) verified;
 commit;`;
}
if(mode==='sql'){
 // No network or database access. Rehearse this exact wrapper in PGlite.
 console.log(JSON.stringify({tables,sql:migrationTransaction()}));
}else if(mode==='inspect'){
 const before=state();assert.equal(before.migrations['20261025000274'],md5(fs.readFileSync(root+'/supabase/migrations/20261025000274_cooperative_adventure.sql','utf8')));
 assert.ok(!before.migrations[version]);save('before',before);save('migration',{version,md5:md5(source)});
 console.log(JSON.stringify({preflight:true,eligibleUnboundParties:before.eligible,protectedTables:tables.length}));
}else if(mode==='apply'){
 assert.equal(md5(source),read('migration').md5);const before=state();assert.ok(!before.migrations[version]);
 assert.deepEqual(before.functions,read('before').functions,'Definitions changed since review');assert.deepEqual(before.migrations,read('before').migrations);
 const result=query(migrationTransaction());
 const after=state();compareFunctions(before,after);assert.equal(after.migrations[version],md5(source));save('after',after);save('applied',result.find(r=>r.verified)?.verified);
 console.log(JSON.stringify({migration:275,...read('applied')}));
}else if(mode==='verify'){
 const current=state();assert.equal(current.migrations[version],md5(source));compareFunctions(read('before'),current);
 const smoke=[];for(const route of ['/api/vnext/bunny','/api/vnext/bootstrap']){
  const r=await fetch('https://api.soulsayit.com'+route,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,401);smoke.push({route,status:r.status});
 }
 const report={migration:275,verifiedAt:new Date().toISOString(),hash:md5(source),...read('applied'),apiDeploymentPerformed:false,smoke};save('live',report);console.log(JSON.stringify(report));
}else throw Error('Use sql/inspect/apply/verify');
