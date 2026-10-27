// Explicit, user-authorized security release. Never deploy the dirty workspace.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-security271-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const baselineReport='/private/tmp/burrow-memories268-release.EJLldG';
const migrations=['20261024000269_security_boundaries','20261024000270_store_subscription_state','20261024000271_economic_domains','20261024000272_fixed_economic_calendar'];
const hash=(bytes,algorithm='sha1')=>createHash(algorithm).update(bytes).digest('hex');
const save=(name,value)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json','utf8'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const overlays=[
 '.vercelignore','pnpm-lock.yaml','apps/api/package.json','apps/api/vercel.json','apps/api/next.config.js','tools/check-apple-store-config.mjs','tools/check-avatar-runtime.mjs','apps/api/src/middleware.ts',
 ...['security-boundary.js','auth-guard.ts','burrow-coins.mjs','apple-store-state.mjs','google-store-state.mjs',
 'store-subscription-state.mjs','store-subscription-jobs.mjs','store-finish-jobs.mjs','store-entitlement.js','profile-avatar-image.mjs',
 'burrow-unpaired-bootstrap.mjs','app-major-update.js','reflect-completion.js','reflect-analysis-jobs.js','economic-calendar-contract.mjs','user-local-date.js'].map(n=>'apps/api/src/lib/'+n),
 ...['apple-iap','google-iap','book-payment','payment-checkout','payment-result','webhooks/airwallex','webhooks/apple','webhooks/google',
 'delete-account','upload-avatar','vnext/coins/verify','vnext/command','vnext/surprise','duo/join','duo/status','user-sync','me-stats',
 'announcements','reflect','reflect/prepare','reflect/finalize','reflect/enrich','reflect/status','friends/insights','friends/insights/history',
 'dev/set-tier','cron/store-reconcile','vnext/bootstrap'].map(n=>'apps/api/src/app/api/'+n+'/route.js'),
];
async function vercel(route){
 const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Vercel metadata read');return r.json();
}
function query(sql){
 const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(r)?r:r.rows;
}
function sourceFiles(tree){const result=new Map();function walk(nodes,prefix=''){for(const n of nodes){const p=prefix+n.name;if(n.type==='directory')walk(n.children??[],p+'/');else result.set(p,n.uid)}}walk(tree.find(n=>n.name==='src').children);return result;}
function state(){return query(`begin read only;select jsonb_build_object(
 'migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version>='20261023000267'),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f')) state;rollback;`)[0].state;}
const protectedTables=['profiles','subscriptions','wallets','currency_ledger','catalog_items','user_inventory','catalog_purchases','gifts','iap_transactions',
 'burrow_coin_transactions','burrow_sandbox_coin_transactions','orders','room_loadouts','room_photos','room_photo_uploads','moment_events','adventures',
 'app_announcements','user_read_announcements','force_updates','couple_journal_pages','couple_journal_answers'];
const fingerprints=protectedTables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
const allowed=new Set(['apply_store_subscription','apply_burrow_coin_purchase_v2','has_own_active_plus','burrow_has_plus_v1','sync_pair_plus_entitlements',
 'accelerate_adventure_for_plus_v1','begin_saved_reflect_pre_share_v1','burrow_affection_state_v1','burrow_bootstrap_core_v1',
 'burrow_record_policy_v1','claim_court_ai_credit','claim_reflect_ai_enhancement','complete_affection_v1','complete_saved_reflect',
 'daily_plus_bonus_state_v1','purchase_catalog_item_v1','purchase_room_loadout_v1','select_room_music_v1','solo_burrow_initialize_v1',
 'solo_burrow_purchase_v1','solo_burrow_start_adventure_v1','start_adventure_v1','submit_reflect','submit_reflect_with_kind','burrow_service_offer_v1']);
for(const match of fs.readFileSync(root+'/supabase/migrations/20261024000272_fixed_economic_calendar.sql','utf8')
 .matchAll(/\('([a-z_0-9]+)','(?:p_[a-z_]+|new.author_id)'\)/g))allowed.add(match[1]);
function unchanged(before,after){for(const [oid,fn]of Object.entries(before.functions)){
 const next=after.functions[oid];assert.ok(next,'Function removed '+fn.name);
 if(!allowed.has(fn.name))assert.deepEqual(next,fn,'Unrelated function/ACL '+fn.name);
}}
if(mode==='inspect'){
 const s=state();assert.ok(s.migrations['20261024000268']);assert.ok(!s.migrations['20261024000269']);save('before',s);
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);
 const tree=await vercel('/v6/deployments/'+d.id+'/files');save('previous-source',tree);
 save('previous-deployment',{id:d.id,url:d.url});save('previous-admin',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 console.log(JSON.stringify({preflight:true,production:d.id,rootDirectory:p.rootDirectory,buildCommand:p.buildCommand,protectedTables:protectedTables.length,overlays:overlays.length}));
}else if(mode==='snapshot'){
 const baseline=JSON.parse(fs.readFileSync(baselineReport+'/snapshot.json')).destination;
 const manifest=JSON.parse(fs.readFileSync(baselineReport+'/snapshot-manifest.json'));
 const deployed=sourceFiles(read('previous-source'));assert.equal(deployed.size,manifest.length);
 for(const e of manifest){assert.equal(deployed.get(e.file),e.sha1,'Baseline no longer current '+e.file);assert.equal(hash(fs.readFileSync(baseline+'/'+e.file)),e.sha1);}
 const destination=fs.mkdtempSync('/private/tmp/burrow-security271-api.');
 for(const e of manifest){fs.mkdirSync(path.dirname(destination+'/'+e.file),{recursive:true});fs.copyFileSync(baseline+'/'+e.file,destination+'/'+e.file);}
 for(const file of overlays){fs.mkdirSync(path.dirname(destination+'/'+file),{recursive:true});fs.copyFileSync(root+'/'+file,destination+'/'+file);}
 // Candidate build uses Production-only Sensitive variables in Vercel. Nothing
 // is exported to disk or the client. A bad key prevents the candidate building.
 const pkg=JSON.parse(fs.readFileSync(destination+'/apps/api/package.json'));
 pkg.scripts.build='node ../../tools/check-apple-store-config.mjs && '+pkg.scripts.build;
 fs.writeFileSync(destination+'/apps/api/package.json',JSON.stringify(pkg,null,2)+'\n');
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 const entries=[...new Set([...manifest.map(e=>e.file),...overlays])].map(file=>({file,sha1:hash(fs.readFileSync(destination+'/'+file))}));
 assert.ok(entries.every(e=>!e.file.startsWith('apps/mobile')&&!e.file.startsWith('apps/admin')&&!/\.env|\.p8/.test(e.file)));
 save('snapshot',{destination,files:entries.length,overlays,applePreflightRequired:true});save('snapshot-manifest',entries);console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 assert.ok(host);const d=await vercel('/v13/deployments/'+host.replace('https://',''));
 assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const files=sourceFiles(await vercel('/v6/deployments/'+d.id+'/files')),manifest=read('snapshot-manifest');assert.equal(files.size,manifest.length);
 for(const e of manifest)assert.equal(files.get(e.file),e.sha1,'Candidate differs '+e.file);
 const current=(await vercel('/v9/projects/'+project)).targets.production.id;
 const priorCandidate=fs.existsSync(dir+'/candidate.json')?read('candidate').id:null;
 assert.ok(current===read('previous-deployment').id||current===priorCandidate,'Production changed outside the verified release');
 save('candidate',{id:d.id,url:d.url});console.log(JSON.stringify(read('candidate')));
}else if(mode==='apply'){
 assert.ok(read('candidate').id);const current=state();assert.deepEqual(current,read('before'),'Database changed since preflight');
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 const sources=migrations.map(n=>fs.readFileSync(root+'/supabase/migrations/'+n+'.sql','utf8'));
 const body=sources.map((s,i)=>s.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')+
  `\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${migrations[i].slice(0,14)}','${migrations[i].slice(15)}',array[${quote(s)}]);`).join('\n');
 query(`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
  select pg_advisory_xact_lock(hashtextextended('novame:security271',0));
  create temporary table security271_before on commit drop as ${fingerprints};
  ${body}
  create temporary table security271_after on commit drop as ${fingerprints};
  do $guard$begin if exists(select * from security271_before except select * from security271_after)
   or exists(select * from security271_after except select * from security271_before) then raise exception 'Protected user rows changed';end if;end $guard$;
  commit;`);
 const after=state();unchanged(read('before'),after);
 migrations.forEach((n,i)=>assert.equal(after.migrations[n.slice(0,14)],hash(sources[i],'md5')));save('database-verified',after);
 console.log(JSON.stringify({migrations:[269,270,271,272],protectedUserRowsUnchanged:true,unrelatedFunctionsUnchanged:true}));
}else if(mode==='live'){
 const candidate=read('candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,candidate.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,candidate.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('previous-admin');
 assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const s=state();unchanged(read('before'),s);
 for(const n of migrations)assert.equal(s.migrations[n.slice(0,14)],hash(fs.readFileSync(root+'/supabase/migrations/'+n+'.sql'),'md5'));
 const permissions=query(`select p.proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated
  from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and not(p.oid::text=any(array[${Object.keys(read('before').functions).map(quote).join(',')}]))`);
 save('permissions',permissions);assert.ok(permissions.every(r=>!r.anon&&!r.authenticated));
 const result={migrations:[269,270,271,272],api:candidate.id,domain:'https://api.soulsayit.com',adminUnchanged:true,protectedTables:protectedTables.length,verifiedAt:new Date().toISOString()};
 save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/snapshot/candidate/apply/live');
