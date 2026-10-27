// Explicit approval: migration 277 and Vercel API/Admin, never an App release.
// `sql` is also exercised in the isolated database tests before production.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-touch277-release.'));
const name='20261026000277_touch_note_v2',version=name.slice(0,14),source=fs.readFileSync(root+'/supabase/migrations/'+name+'.sql','utf8');
const digest=createHash('md5').update(source).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
export const tables=['profiles','subscriptions','wallets','currency_ledger','catalog_items','user_inventory','catalog_purchases','gifts','iap_transactions',
 'burrow_coin_transactions','burrow_sandbox_coin_transactions','orders','room_loadouts','room_photos','room_photo_uploads','moment_events',
 'adventures','adventure_encounter_plans','adventure_results','app_announcements','user_read_announcements','force_updates','couple_journal_pages',
 'couple_journal_answers','app_config','burrow_shop_catalog_releases','burrow_shop_release_support','adventure_parties','pairings',
 'notification_outbox','device_push_tokens','plushie_touch_messages','plushie_touch_sends'];
const fingerprints=tables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
const functions=`select oid,proname,proargtypes::text args,proacl,prosecdef,proconfig,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
const allowed="'valid_plushie_touch_clip_v1','prune_plushie_touch_v1','plushie_touch_state_v1','read_plushie_touch_v1','system_notification_context_v1','cleanup_plushie_touch_v1'";
export function migrationSql(){return `begin isolation level repeatable read;
 set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('burrow:touch277-release',0));
 do $preflight$begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261025000276')
 or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Unexpected migration baseline';end if;
 end $preflight$;
 create temporary table guard_rows_before on commit drop as ${fingerprints};
 create temporary table guard_functions_before on commit drop as ${functions};
 create temporary table guard_acl_before on commit drop as select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table guard_rows_after on commit drop as ${fingerprints};
 do $guard$begin
 if exists(select * from guard_rows_before except select * from guard_rows_after) or exists(select * from guard_rows_after except select * from guard_rows_before) then raise exception 'Protected user rows changed';end if;
 if exists(select * from guard_functions_before where proname not in(${allowed}) except ${functions}) then raise exception 'Unrelated function changed';end if;
 if exists(select 1 from guard_functions_before b join pg_proc a using(oid) where b.proname in('valid_plushie_touch_clip_v1','system_notification_context_v1')
 and (a.proname is distinct from case b.proname when 'valid_plushie_touch_clip_v1' then 'valid_plushie_touch_clip_legacy_v1' else 'system_notification_context_before_touch_v2' end
 or md5(a.prosrc) is distinct from b.body or a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig)) then raise exception 'Legacy function body or grants changed';end if;
 if exists(select * from guard_acl_before except select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r') then raise exception 'Existing table ACL changed';end if;
 if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like '%plushie_touch%'
 and(has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Unexpected client RPC grant';end if;
 if not has_function_privilege('service_role','plushie_touch_state_v2(uuid,text)','EXECUTE') or not has_function_privilege('service_role','read_plushie_touch_v2(uuid,text,uuid,boolean)','EXECUTE') then raise exception 'Missing service RPC grant';end if;
 if not valid_plushie_touch_clip_v2('{"version":2,"durationMs":60000,"touches":2,"events":[[0,0,0,500,500],[500,2,0,500,500]]}'::jsonb) then raise exception 'V2 hold validation failed';end if;
 end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','touch_note_v2',array[${quote(source)}]);
 select jsonb_build_object('migration',277,'md5','${digest}','protectedTables',(select count(*) from guard_rows_before),'protectedRowsUnchanged',true,'existingPermissionsUnchanged',true,'legacyBodiesPreserved',true) verified;
 commit;`;}
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(result)?result:result.rows;}
const save=(file,value)=>fs.writeFileSync(dir+'/'+file+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
if(mode==='sql')console.log(JSON.stringify({tables,sql:migrationSql()}));
else if(mode==='inspect'){
 assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
 const state=query(`begin read only;select jsonb_build_object('migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version>='20261025000273'),
 'functions',(select jsonb_agg(to_jsonb(f)) from (select p.oid,p.proname,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f')f),
 'permissions',(select jsonb_agg(to_jsonb(t)) from (select oid,relname,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r')t)) state;rollback;`)[0].state;
 assert.ok(state.migrations['20261025000276']);assert.ok(!state.migrations[version]);save('before',state);save('migration',{version,md5:digest});
 console.log(JSON.stringify({preflight:true,version,protectedTables:tables.length,backupDefinitions:state.functions.length}));
}else if(mode==='apply'){
 const approved=JSON.parse(fs.readFileSync(dir+'/migration.json'));assert.equal(approved.md5,digest);assert.ok(fs.existsSync(dir+'/before.json'));
 const candidate=JSON.parse(fs.readFileSync(dir+'/api-candidate.json'));assert.equal(candidate.readyState,'READY');
 const result=query(migrationSql()).find(r=>r.verified)?.verified;assert.ok(result?.protectedRowsUnchanged);save('applied',result);console.log(JSON.stringify(result));
}else if(mode==='verify'){
 const rows=query(`begin read only;select version,md5(statements[1]) digest from supabase_migrations.schema_migrations where version='${version}';rollback;`);
 assert.equal(rows[0]?.digest,digest);assert.ok(JSON.parse(fs.readFileSync(dir+'/applied.json')).protectedRowsUnchanged);
 console.log(JSON.stringify({migration:277,recorded:true,md5:digest}));
}else throw Error('Use sql / inspect / apply / verify');
