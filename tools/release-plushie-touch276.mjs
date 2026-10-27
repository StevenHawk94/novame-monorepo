// Explicit user approval: API + migration 276 only, after isolated validation.
// Never deploy the working checkout wholesale or publish a mobile binary.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-touch276-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const base='/private/tmp/burrow-dual-bunny-release.JZLeN5',project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const name='20261025000276_plushie_touch',version=name.slice(0,14),source=fs.readFileSync(root+'/supabase/migrations/'+name+'.sql','utf8');
const hash=(s,a='sha1')=>createHash(a).update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const save=(n,v)=>fs.writeFileSync(dir+'/'+n+'.json',JSON.stringify(v,null,2)+'\n',{mode:0o600}),read=n=>JSON.parse(fs.readFileSync(dir+'/'+n+'.json'));
const overlays=['apps/api/src/app/api/vnext/plushie-touch/route.js','apps/api/src/app/api/cron/plushie-touch-cleanup/route.js',
 'apps/api/src/app/api/vnext/room-photo/route.js','apps/api/src/lib/system-notification-copy.mjs','apps/api/src/lib/push-notifications.js',
 'apps/api/src/app/api/notifications/register/route.js','apps/api/vercel.json','packages/domain/src/index.ts','packages/domain/src/plushie-touch.ts'];
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Vercel metadata read');return r.json();}
function files(tree){const out=new Map();function walk(nodes,p=''){for(const n of nodes){const key=p+n.name;if(n.type==='directory')walk(n.children??[],key+'/');else out.set(key,n.uid);}}walk(tree.find(n=>n.name==='src').children);return out;}
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
const tables=['profiles','subscriptions','wallets','currency_ledger','catalog_items','user_inventory','catalog_purchases','gifts','iap_transactions','burrow_coin_transactions',
 'burrow_sandbox_coin_transactions','orders','room_loadouts','room_photos','room_photo_uploads','moment_events','adventures','adventure_encounter_plans','adventure_results',
 'app_announcements','user_read_announcements','force_updates','couple_journal_pages','couple_journal_answers','app_config','burrow_shop_catalog_releases','burrow_shop_release_support',
 'adventure_parties','pairings','notification_outbox','device_push_tokens'];
const fingerprints=tables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg((to_jsonb(t)${t==='device_push_tokens'?"-'plushie_touch_version'":''})::text,E'\\n' order by (to_jsonb(t)${t==='device_push_tokens'?"-'plushie_touch_version'":''})::text),'')) digest from public.${t} t`).join(' union all ');
const functions=`select oid,proname,proacl,prosecdef,proconfig,md5(pg_get_functiondef(oid)) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f'`;
function state(){return query(`begin read only;select jsonb_build_object('migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version>='20261024000272'),
 'functions',(select jsonb_agg(to_jsonb(f) order by oid) from (${functions})f)) state;rollback;`)[0].state;}
function sql(){return `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('burrow:touch276-release',0));
 create temporary table guard_rows_before on commit drop as ${fingerprints};
 create temporary table guard_functions_before on commit drop as ${functions};
 create temporary table guard_acl_before on commit drop as select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table guard_rows_after on commit drop as ${fingerprints};
 do $guard$begin
 if exists(select * from guard_rows_before except select * from guard_rows_after) or exists(select * from guard_rows_after except select * from guard_rows_before) then raise exception 'Protected user rows changed';end if;
 if exists(select * from guard_functions_before where proname<>'system_notification_context_v1' except ${functions}) then raise exception 'Unrelated function changed';end if;
 if exists(select 1 from guard_functions_before b join pg_proc a using(oid) where b.proname='system_notification_context_v1' and
 (a.proname<>'system_notification_context_before_touch_v1' or a.proacl is distinct from b.proacl or a.prosecdef is distinct from b.prosecdef or a.proconfig is distinct from b.proconfig)) then raise exception 'Old notification policy grants changed';end if;
 if exists(select * from guard_acl_before except select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r') then raise exception 'Existing table ACL changed';end if;
 if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like '%plushie_touch%'
 and(has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Unexpected client RPC grant';end if;
 if exists(select 1 from device_push_tokens where plushie_touch_version<>0) then raise exception 'Old device capability changed';end if;
 end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','plushie_touch',array[${quote(source)}]);
 select jsonb_build_object('protectedTables',(select count(*) from guard_rows_before),'protectedRowsUnchanged',true,'existingTablePermissionsUnchanged',true,'oldDeviceCapability',0) verified;
 commit;`;}
if(mode==='sql')console.log(JSON.stringify({tables,sql:sql()}));
else if(mode==='inspect'){
 const before=state();assert.ok(before.migrations['20261025000275']);assert.ok(!before.migrations[version]);save('before',before);save('migration',{version,md5:hash(source,'md5')});
 const live=(await vercel('/v9/projects/'+project)).targets.production;assert.equal(live.id,'dpl_Av3STtJZg9ikSTLkkr8iPMrNLZgV');save('previous-deployment',live);
 save('live-source',await vercel('/v6/deployments/'+live.id+'/files'));console.log(JSON.stringify({preflight:true,previous:live.id,protectedTables:tables.length}));
}else if(mode==='snapshot'){
 const snapshot=JSON.parse(fs.readFileSync(base+'/snapshot.json')),manifest=JSON.parse(fs.readFileSync(base+'/snapshot-manifest.json'));
 const deployed=files(read('live-source'));assert.equal(deployed.size,manifest.length);
 const destination=fs.mkdtempSync('/private/tmp/burrow-touch276-api.');
 for(const e of manifest){assert.equal(deployed.get(e.file),e.sha1,'Live source drift '+e.file);assert.equal(hash(fs.readFileSync(snapshot.destination+'/'+e.file)),e.sha1);
  fs.mkdirSync(path.dirname(destination+'/'+e.file),{recursive:true});fs.copyFileSync(snapshot.destination+'/'+e.file,destination+'/'+e.file);}
 for(const file of overlays){fs.mkdirSync(path.dirname(destination+'/'+file),{recursive:true});fs.copyFileSync(root+'/'+file,destination+'/'+file);}
 // The existing exports and deployment schedule may only be extended.
 assert.equal(fs.readFileSync(destination+'/packages/domain/src/index.ts','utf8').replace("export * from './plushie-touch';\n",''),fs.readFileSync(snapshot.destination+'/packages/domain/src/index.ts','utf8'));
 const old=JSON.parse(fs.readFileSync(snapshot.destination+'/apps/api/vercel.json')),next=JSON.parse(fs.readFileSync(destination+'/apps/api/vercel.json'));
 assert.deepEqual({...next,crons:next.crons.filter(c=>c.path!=='/api/cron/plushie-touch-cleanup')},old);
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 const entries=[...new Set([...manifest.map(e=>e.file),...overlays])].map(file=>({file,sha1:hash(fs.readFileSync(destination+'/'+file))}));
 save('snapshot',{destination,overlays,files:entries.length});save('snapshot-manifest',entries);console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 const d=await vercel('/v13/deployments/'+host.replace('https://',''));assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),map=files(tree),manifest=read('snapshot-manifest');assert.equal(map.size,manifest.length);
 for(const e of manifest)assert.equal(map.get(e.file),e.sha1,'Candidate source drift '+e.file);
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 save('candidate',{id:d.id,url:d.url});console.log(JSON.stringify(read('candidate')));
}else if(mode==='apply'){
 assert.ok(read('candidate').id);assert.equal(hash(source,'md5'),read('migration').md5);assert.deepEqual(state(),read('before'));
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 const result=query(sql());save('applied',result.find(r=>r.verified)?.verified);save('after',state());console.log(JSON.stringify({migration:276,...read('applied')}));
}else if(mode==='verify'){
 const after=state();assert.equal(after.migrations[version],hash(source,'md5'));
 for(const f of read('before').functions){const n=after.functions.find(v=>v.oid===f.oid);assert.ok(n);if(f.proname!=='system_notification_context_v1')assert.deepEqual(n,f);else assert.equal(n.proname,'system_notification_context_before_touch_v1');}
 const live=(await vercel('/v9/projects/'+project)).targets.production;assert.equal(live.id,read('candidate').id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,live.id);
 const smoke=[];for(const route of ['/api/vnext/plushie-touch?pair='+'a'.repeat(32),'/api/cron/plushie-touch-cleanup','/api/vnext/bootstrap','/api/vnext/bunny']){
  const r=await fetch('https://api.soulsayit.com'+route,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,401);smoke.push({route,status:r.status});}
 const report={migration:276,md5:hash(source,'md5'),deployment:live.id,domainVerified:'api.soulsayit.com',verifiedAt:new Date().toISOString(),...read('applied'),smoke};save('live',report);console.log(JSON.stringify(report));
}else throw Error('Use sql/inspect/snapshot/candidate/apply/verify');
