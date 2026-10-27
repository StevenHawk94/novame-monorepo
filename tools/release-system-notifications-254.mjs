// Narrow release helper: read-only unless db-apply is explicitly selected.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-notifications254-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261020000254',name='system_notification_policy',project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const source=fs.readFileSync(root+`/supabase/migrations/${version}_${name}.sql`,'utf8');
const hash=(bytes,alg='sha1')=>createHash(alg).update(bytes).digest('hex');
const save=(name,data)=>fs.writeFileSync(dir+'/'+name,JSON.stringify(data,null,2)+'\n',{mode:0o600});
const readSaved=name=>JSON.parse(fs.readFileSync(dir+'/'+name,'utf8'));
const expected=['apps/api/src/app/api/court/[sessionId]/route.js','apps/api/src/app/api/cron/push-notifications/route.js','apps/api/src/app/api/marketing/partner-reflect-paywall/route.js','apps/api/src/app/api/notifications/register/route.js','apps/api/src/app/api/reflect/finalize/route.js','apps/api/src/app/api/vnext/command/route.js','apps/api/src/app/api/vnext/surprise/route.js','apps/api/src/lib/bunny-court.js','apps/api/src/lib/push-notifications.js','apps/api/src/lib/system-notification-copy.mjs','apps/api/vercel.json'].sort();
async function vercel(route){
 const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Vercel read '+route);return r.json();
}
function files(tree){const result=new Map();function visit(nodes,prefix=''){for(const n of nodes){const p=prefix+n.name;if(n.type==='directory')visit(n.children??[],p+'/');else result.set(p,n.uid);}}const src=tree.find(n=>n.name==='src');assert.ok(src?.children);visit(src.children);return result;}
function query(sql){const output=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(output)?output:output.rows;}
const names=['notification_timezone_v1','enqueue_affection_push_v1','enqueue_surprise_push_v1','capture_system_notification_v1','adventure_reminder_eligible_v1','prepare_system_notifications_v1','system_notification_context_v1'];
const sqlNames=names.map(n=>"'"+n+"'").join(',');
function dbState(){return query(`select jsonb_build_object(
 'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
 'previous',exists(select 1 from supabase_migrations.schema_migrations where version='20261020000253'),
 'protected',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in(${sqlNames})),
 'functions',(select jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'))) from pg_proc where pronamespace='public'::regnamespace and proname in(${sqlNames})),
 'tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'anon',has_table_privilege('anon',oid,'select,insert,update,delete'),'authenticated',has_table_privilege('authenticated',oid,'select,insert,update,delete'))) from pg_class where relnamespace='public'::regnamespace and relname in('system_notification_policy','system_notification_sources')),
 'triggers',(select jsonb_object_agg(oid::text,pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace) and tgname not in('affection_system_notification','surprise_system_notification')),
 'profiles',(select count(*) from profiles)
 ) state;`)[0].state;}
if(mode==='inspect'){
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),before=files(tree);save('previous-source-files.json',tree);save('previous-deployment.json',{id:d.id,url:d.url});
 save('previous-admin.json',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 const changed=[...before].filter(([file,uid])=>!fs.existsSync(root+'/'+file)||hash(fs.readFileSync(root+'/'+file))!==uid).map(([file])=>file).filter(file=>file!=='pnpm-lock.yaml').sort();
 assert.deepEqual(changed,expected.filter(file=>before.has(file)),'Unrelated production API changes must not ride along');
 const uid=before.get('pnpm-lock.yaml'),lock=await vercel('/v8/deployments/'+d.id+'/files/'+uid),bytes=Buffer.from(lock.data,'base64');assert.equal(hash(bytes),uid);
 fs.writeFileSync(dir+'/previous-pnpm-lock.yaml',bytes);save('preflight-source.json',{liveId:d.id,liveUrl:d.url,lockfileSha1:uid,changedExistingFiles:changed});
 console.log(JSON.stringify({liveId:d.id,lockfileSha1:uid,changedExistingFiles:changed}));
}else if(mode==='candidate'){
 const log=fs.readFileSync(dir+'/deploy.log','utf8'),host=log.match(/https:\/\/(novame-monorepo-[a-z0-9]+-soulsayit\.vercel\.app)/)?.[1];assert.ok(host);
 const d=await vercel('/v13/deployments/'+host);assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files');save('candidate-source-files.json',tree);const now=files(tree),before=files(readSaved('previous-source-files.json'));
 const changed=[...now].filter(([file,uid])=>before.get(file)!==uid).map(([file])=>file).sort();assert.deepEqual(changed,expected);
 for(const file of before.keys())assert.ok(now.has(file),'Removed production source '+file);
 const snapshot=readSaved('snapshot.json').destination;
 for(const [file,uid] of now){assert.ok(!file.startsWith('apps/mobile/')&&!file.startsWith('apps/admin/')&&!file.split('/').some(part=>part.startsWith('.env')));assert.equal(hash(fs.readFileSync(snapshot+'/'+file)),uid,file);}
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,readSaved('previous-deployment.json').id);
 const environment=await vercel('/v9/projects/'+project+'/env');
 for(const key of ['CRON_SECRET','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL'])assert.ok(environment.envs.some(e=>e.key===key&&e.target?.includes('production')),'Missing production environment name '+key);
 assert.ok(d.crons?.some(cron=>cron.path==='/api/cron/avatar-cleanup')||JSON.parse(fs.readFileSync(snapshot+'/apps/api/vercel.json')).crons.some(cron=>cron.path==='/api/cron/avatar-cleanup'));
 const result={id:d.id,url:d.url,readyState:d.readyState,changedFiles:changed,verifiedFiles:now.size,productionEnvironmentNamesVerified:true};save('candidate-verification.json',result);console.log(JSON.stringify(result));
}else if(mode==='live'){
 const d=readSaved('candidate-verification.json'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,d.id);
 assert.equal(p.crons?.deploymentId,d.id);assert.equal(p.crons.disabledAt,null);
 assert.ok(p.crons.definitions.some(c=>c.path==='/api/cron/avatar-cleanup'&&c.schedule==='50 * * * *'));
 assert.ok(p.crons.definitions.some(c=>c.path==='/api/cron/push-notifications'&&c.schedule==='* * * * *'));
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,d.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=readSaved('previous-admin.json');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const result={productionId:d.id,domain:'https://api.soulsayit.com',adminUnchanged:true,avatarCleanupCronRegistered:true,notificationCronRegistered:true,verifiedAt:new Date().toISOString()};save('live-verification.json',result);console.log(JSON.stringify(result));
}else if(mode==='db-check'){
 const state=dbState();assert.equal(state.previous,true);assert.equal(state.sourceHash,null);assert.equal(state.functions,null);assert.equal(state.tables,null);
 save('database-preflight.json',state);console.log(JSON.stringify({profiles:state.profiles,previousMigration:true,backedUpBusinessDefinitions:Object.keys(state.protected).length}));
}else if(mode==='db-apply'){
 const before=readSaved('database-preflight.json');assert.equal(before.sourceHash,null);assert.ok(!source.includes('$migration254$'));
 // Short locks protect an in-transaction data comparison; no business data is modified.
 const protectedTables=['profiles','pairings','adventures','affection_events','burrow_surprises','device_push_tokens'];
 const snapshotSql=protectedTables.map(table=>`select '${table}'::text name, count(*) n, md5(coalesce(string_agg((to_jsonb(t)-'notification_version'-'adventure_reminder_enabled')::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${table} t`).join(' union all ');
 const sql=`begin;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:migration:20261020000254',0));
 lock table ${protectedTables.map(t=>'public.'+t).join(',')} in share row exclusive mode;
 do $guard$ begin if not exists(select 1 from supabase_migrations.schema_migrations where version='20261020000253') or exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'migration prerequisite mismatch';end if;end $guard$;
 create temporary table notification254_before on commit drop as ${snapshotSql};
 ${source}
 create temporary table notification254_after on commit drop as ${snapshotSql};
 do $guard$ begin if exists((select * from notification254_before except select * from notification254_after) union all (select * from notification254_after except select * from notification254_before)) then raise exception 'business data changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$migration254$${source}$migration254$]);commit;`;
 fs.writeFileSync(dir+'/apply254.sql',sql,{mode:0o600});query(sql);const after=dbState();assert.equal(after.sourceHash,hash(source,'md5'));assert.deepEqual(after.protected,before.protected);assert.deepEqual(after.triggers,before.triggers);
 assert.equal(after.functions.length,7);for(const f of after.functions){assert.equal(f.anon,false);assert.equal(f.authenticated,false);if(f.name!=='capture_system_notification_v1')assert.equal(f.service,true);assert.ok(f.config.includes('search_path=public, pg_temp'));}
 assert.equal(after.tables.length,2);for(const t of after.tables){assert.equal(t.rls,true);assert.equal(t.anon,false);assert.equal(t.authenticated,false);}
 save('database-postcheck.json',after);console.log(JSON.stringify({migration:version,sourceVerified:true,existingBusinessDataUnchanged:true,businessFunctionsAndTriggersUnchanged:true,serviceOnlyFunctions:true,privateRlsTables:true}));
}else if(mode==='db-verify'){
 const state=dbState(),before=readSaved('database-preflight.json');
 assert.equal(state.sourceHash,hash(source,'md5'));assert.deepEqual(state.protected,before.protected);assert.deepEqual(state.triggers,before.triggers);
 const result=query(`select jsonb_build_object(
 'newTriggers',(select count(*) from pg_trigger where tgname in('affection_system_notification','surprise_system_notification') and tgenabled='O'),
 'reminderPredicate',public.adventure_reminder_eligible_v1('00000000-0000-0000-0000-000000000000','2026-10-20','2026-10-20T20:00:00Z'),
 'gameContextsValid',not exists(select 1 from (select public.system_notification_context_v1(pair_low,'game_ready',jsonb_build_object('sessionId',id)) c from burrow_game_sessions order by created_at desc limit 10) s where jsonb_typeof(c->'allowed') is distinct from 'boolean'),
 'affectionContextsValid',not exists(select 1 from (select public.system_notification_context_v1(recipient_id,'affection_received',jsonb_build_object('eventId',id,'senderId',sender_id,'pairVersion',public.burrow_pair_version_v1(sender_id,recipient_id))) c from affection_events order by completed_at desc limit 10) s where jsonb_typeof(c->'allowed') is distinct from 'boolean')
 ) verified;`)[0].verified;
 assert.equal(Number(result.newTriggers),2);assert.equal(result.reminderPredicate,true);assert.equal(result.gameContextsValid,true);assert.equal(result.affectionContextsValid,true);
 save('database-runtime-verification.json',{...result,readOnly:true,businessFunctionsAndTriggersUnchanged:true});console.log(JSON.stringify(result));
}else if(mode==='smoke'){
 const origin=process.argv[4]??'https://api.soulsayit.com',checks=[];
 for(const [route,method,wanted,body] of [['/api/app-config','GET',200],['/api/update-profile','GET',401],['/api/update-profile','POST',401,{userId:'not-a-user'}],['/api/upload-avatar','POST',401,{action:'prepare'}],['/api/cron/avatar-cleanup','GET',401],['/api/cron/push-notifications','GET',401],['/api/notifications/register','POST',401,{userId:'not-a-user'}],['/api/marketing/partner-reflect-paywall?userId=not-a-user','GET',401],['/api/vnext/bootstrap','GET',401],['/api/vnext/game-room?mode=overview','GET',401],['/api/friends/pair?userId=not-a-user','GET',401]]){
 const args=['--silent','--show-error','--retry','1','--connect-timeout','10','--max-time','25','--write-out','\nHTTP_STATUS:%{http_code}'];
 if(body)args.push('--request',method,'--header','Content-Type: application/json','--data',JSON.stringify(body));
 const candidate=!origin.includes('api.soulsayit.com');
 const output=candidate?execFileSync(process.execPath,['/Users/nihao/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js','curl',route,'--deployment',origin,'--scope','soulsayit','--',...args],{cwd:readSaved('snapshot.json').destination,encoding:'utf8',timeout:70000,stdio:['ignore','pipe','pipe']})
 :execFileSync('curl',[...args,origin+route],{encoding:'utf8',timeout:65000,stdio:['ignore','pipe','pipe']});
 const match=output.match(/HTTP_STATUS:(\d{3})\s*$/);assert.ok(match,'Missing status '+route);const status=Number(match[1]);assert.equal(status,wanted,route);
 if(status===401)assert.equal(JSON.parse(output.slice(0,match.index).trim()).error,'Unauthorized');checks.push({route,method,status});}
 const result={origin,passed:true,checks,accountsCreated:0,userDataWrites:0};save(origin.includes('api.soulsayit.com')?'production-smoke.json':'candidate-smoke.json',result);console.log(JSON.stringify(result));
}else throw Error('Unknown release mode');
