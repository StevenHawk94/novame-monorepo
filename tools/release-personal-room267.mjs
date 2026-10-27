// User-authorized, scoped release. Never signs in as a user or makes purchases.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-personal267-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261023000267',source=fs.readFileSync(root+'/supabase/migrations/'+version+'_personal_room_isolation.sql','utf8');
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const hash=(s,alg='sha1')=>createHash(alg).update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const save=(name,v)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(v,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json','utf8'));
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Vercel read '+route);return r.json();}
function files(tree){const result=new Map();function walk(nodes,prefix=''){for(const n of nodes){const p=prefix+n.name;
 if(n.type==='directory')walk(n.children??[],p+'/');else result.set(p,n.uid);}}walk(tree.find(n=>n.name==='src').children);return result;}
const protectedTables=['catalog_items','user_inventory','wallets','currency_ledger','catalog_purchases','gifts','room_photos','room_photo_uploads','moment_events','adventures','daily_quest_assignments','quest_progress_vnext','app_announcements','user_read_announcements','force_updates'];
const digests=protectedTables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
function state(){return query(`select jsonb_build_object(
 'migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version in('20261023000266','${version}')),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f')) state;`)[0].state;}
function unchanged(before,after){for(const [oid,fn] of Object.entries(before.functions)){const next=after.functions[oid];assert.ok(next,'Removed '+fn.name);
 assert.deepEqual(next.grants,fn.grants,'Changed grants '+fn.name);if(fn.name!=='burrow_reward_wallet_state_v1')assert.equal(next.definition,fn.definition,'Unrelated function changed '+fn.name);}}
const overlays=['apps/api/src/middleware.ts','apps/api/src/lib/app-major-update.js','apps/api/src/lib/personal-room-contract.mjs',
 'apps/api/src/app/api/vnext/command/route.js','apps/api/src/app/api/vnext/bootstrap/route.js','apps/api/src/app/api/vnext/room-photo/route.js'];
if(mode==='inspect'){
 const before=state();assert.ok(before.migrations['20261023000266']);assert.ok(!before.migrations[version]);save('before',before);
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id),tree=await vercel('/v6/deployments/'+d.id+'/files');
 save('previous-deployment',{id:d.id,url:d.url});save('previous-source',tree);save('previous-admin',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 // Layout rows are the only mutable user state in this migration; save exact
 // originals locally with private permissions, in addition to the DB archive.
 save('original-layouts',query('select to_jsonb(l) row from public.room_loadouts l'));
 const counts=query("select table_name from information_schema.tables where table_schema='public' and table_name in('app_announcements','user_read_announcements','force_updates')");
 save('notice-tables',counts);
 console.log(JSON.stringify({preflight:true,production:d.id,layoutsBackedUp:read('original-layouts').length,noticeTables:counts}));
}else if(mode==='apply'){
 const before=read('before'),current=state();unchanged(before,current);assert.ok(!current.migrations[version]);
 // Protected-table identities are resolved in preflight; never silently skip.
 query(`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));
 create temporary table personal267_before on commit drop as ${digests};
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table personal267_after on commit drop as ${digests};
 do $guard$ begin if exists(select * from personal267_before except select * from personal267_after)
 or exists(select * from personal267_after except select * from personal267_before) then raise exception 'Protected user rows changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','personal_room_isolation',array[${quote(source)}]);commit;`);
 const after=state();unchanged(before,after);assert.equal(after.migrations[version],hash(source,'md5'));save('database-verified',after);
 const permissions=query(`select p.proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('purchase_personal_room_changes_v1','claim_personal_shop_gift_v1','activate_personal_room_v1','burrow_bootstrap_v2','prepare_personal_toy_photo_v1','complete_personal_toy_photo_v1','current_personal_burrow_toy_v1','personal_burrow_toy_photo_target_allowed_v1')`);
 assert.equal(permissions.length,8);for(const r of permissions)assert.ok(!r.anon&&!r.authenticated&&r.service);save('permissions',permissions);
 console.log(JSON.stringify({migration:267,sourceVerified:true,protectedUserRowsUnchanged:true,unrelatedFunctionsAndGrantsUnchanged:true,serviceOnly:true}));
}else if(mode==='snapshot'){
 const baseline='/private/tmp/burrow-launch266-api.6JaIll',manifest=JSON.parse(fs.readFileSync('/private/tmp/burrow-launch266-release.yJQPZw/api-manifest.json'));
 const deployed=files(read('previous-source'));assert.equal(deployed.size,manifest.length,'Production baseline changed');
 for(const e of manifest){assert.equal(deployed.get(e.file),e.sha1,'Production baseline differs '+e.file);assert.equal(hash(fs.readFileSync(baseline+'/'+e.file)),e.sha1);}
 const destination=fs.mkdtempSync('/private/tmp/burrow-personal267-api.');
 for(const e of manifest){fs.mkdirSync(path.dirname(destination+'/'+e.file),{recursive:true});fs.copyFileSync(baseline+'/'+e.file,destination+'/'+e.file);}
 for(const file of overlays){fs.mkdirSync(path.dirname(destination+'/'+file),{recursive:true});fs.copyFileSync(root+'/'+file,destination+'/'+file);}
 const entries=[...new Set([...manifest.map(e=>e.file),...overlays])].map(file=>({file,sha1:hash(fs.readFileSync(destination+'/'+file))}));
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 save('snapshot',{destination,files:entries.length,overlayFiles:overlays});save('snapshot-manifest',entries);console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 assert.ok(host);const d=await vercel('/v13/deployments/'+host.replace('https://',''));
 assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');const tree=await vercel('/v6/deployments/'+d.id+'/files'),now=files(tree),manifest=read('snapshot-manifest');
 assert.equal(now.size,manifest.length);for(const entry of manifest)assert.equal(now.get(entry.file),entry.sha1,'Candidate differs '+entry.file);
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 save('candidate',{id:d.id,url:d.url,filesVerified:manifest.length});console.log(JSON.stringify(read('candidate')));
}else if(mode==='live'){
 const d=read('candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,d.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,d.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('previous-admin');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const after=state();unchanged(read('before'),after);assert.equal(after.migrations[version],hash(source,'md5'));
 const result={migration:267,api:d.id,domain:'https://api.soulsayit.com',adminUnchanged:true,verifiedAt:new Date().toISOString()};save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/apply/snapshot/candidate/live');
