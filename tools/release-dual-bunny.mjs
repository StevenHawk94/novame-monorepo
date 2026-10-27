// Explicitly approved 2026-10-25; overlay ONLY this feature on verified live source.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {visualCatalogExpression} from './dual-bunny-release-guard.cjs';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-dual-bunny-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO',baselineReport='/private/tmp/burrow-security271-release.XJN1mi';
const migrations=['20261025000273_bunny_identity','20261025000274_cooperative_adventure'];
const hash=(s,alg='sha1')=>createHash(alg).update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const save=(name,value)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const overlays=['apps/api/src/app/api/vnext/bunny/route.js','apps/api/src/app/api/vnext/bootstrap/route.js',
 'apps/api/src/app/api/vnext/command/route.js','apps/api/src/lib/bunny-adventure-contract.mjs','apps/api/src/lib/system-notification-copy.mjs',
 'apps/api/src/lib/push-notifications.js','apps/api/src/app/api/notifications/register/route.js','apps/api/src/middleware.ts',
 'packages/domain/src/generated/shop-catalog-release.json','apps/api/src/lib/app-major-update.js'];
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Vercel metadata read');return r.json();}
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const value=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],
 {cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(value)?value:value.rows;}
function files(tree){const result=new Map();function walk(nodes,prefix=''){for(const n of nodes){const p=prefix+n.name;if(n.type==='directory')walk(n.children??[],p+'/');else result.set(p,n.uid);}}walk(tree.find(n=>n.name==='src').children);return result;}
function state(){return query(`begin read only;select jsonb_build_object('migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version>='20261023000267'),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f')) state;rollback;`)[0].state;}
const allowed=new Set(['pair_immediately','set_pairing','start_adventure_v1','solo_burrow_start_adventure_v1','accelerate_adventure_for_plus_v1','system_notification_context_v1']);
function unchanged(before,after){for(const [oid,fn]of Object.entries(before.functions)){assert.ok(after.functions[oid],'Function removed '+fn.name);if(!allowed.has(fn.name))assert.deepEqual(after.functions[oid],fn,'Unrelated function/ACL '+fn.name);}}
const tables=['profiles','subscriptions','wallets','currency_ledger','catalog_items','user_inventory','catalog_purchases','gifts','iap_transactions','burrow_coin_transactions',
 'burrow_sandbox_coin_transactions','orders','room_loadouts','room_photos','room_photo_uploads','moment_events','adventures','adventure_encounter_plans','adventure_results',
 'app_announcements','user_read_announcements','force_updates','couple_journal_pages','couple_journal_answers'];
const fingerprints=tables.map(t=>{const json=t==='adventures'?"to_jsonb(t)-'party_id'":'to_jsonb(t)';return `select '${t}'::text name,count(*) n,md5(coalesce(string_agg((${json})::text,E'\\n' order by (${json})::text),'')) digest from public.${t} t`;}).join(' union all ');
if(mode==='catalog-audit'){
 const rows=query("begin read only;select payload from burrow_shop_catalog_releases where release=(select value from app_config where key='burrow_shop_active_release');rollback;");
 save('active-catalog',rows[0]?.payload);console.log(JSON.stringify({saved:!!rows[0]?.payload}));
}else if(mode==='inspect'){
 const s=state();assert.ok(s.migrations['20261024000272']);assert.ok(!s.migrations['20261025000273']);save('before',s);
 const audit=query(`begin read only;select count(*)::int pairs,count(*) filter(where f.requested_by is null or f.requested_by not in(a.user_id,a.partner_user_id))::int unknown_actor,
  min(a.created_at) earliest_pair from pairings a join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
  left join friendships f on f.user_a=a.user_id and f.user_b=a.partner_user_id and f.status='accepted' where a.user_id<a.partner_user_id;rollback;`)[0];
 save('actor-audit',audit);assert.equal(audit.unknown_actor,0,'Historical actor missing: ask user before assigning colours');
 const flags=query("begin read only;select key,value from app_config where key in('adventure_friends_v2_enabled','burrow_shop_active_release');rollback;");save('flags',flags);
 assert.equal(flags.find(r=>r.key==='adventure_friends_v2_enabled')?.value,'true','Existing encounter pipeline must be enabled');
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);
 assert.equal(d.id,JSON.parse(fs.readFileSync(baselineReport+'/live.json')).api,'Live source changed since last verified baseline');
 save('previous-deployment',{id:d.id,url:d.url});save('previous-source',await vercel('/v6/deployments/'+d.id+'/files'));save('previous-admin',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 console.log(JSON.stringify({preflight:true,production:d.id,pairs:audit.pairs,unknownActor:audit.unknown_actor,protectedTables:tables.length}));
}else if(mode==='snapshot'){
 const baseline=JSON.parse(fs.readFileSync(baselineReport+'/snapshot.json')).destination,manifest=JSON.parse(fs.readFileSync(baselineReport+'/snapshot-manifest.json'));
 const deployed=files(read('previous-source'));assert.equal(deployed.size,manifest.length);
 for(const e of manifest){assert.equal(deployed.get(e.file),e.sha1,'Live source mismatch '+e.file);assert.equal(hash(fs.readFileSync(baseline+'/'+e.file)),e.sha1);}
 const destination=fs.mkdtempSync('/private/tmp/burrow-dual-bunny-api.');
 for(const e of manifest){fs.mkdirSync(path.dirname(destination+'/'+e.file),{recursive:true});fs.copyFileSync(baseline+'/'+e.file,destination+'/'+e.file);}
 for(const f of overlays){fs.mkdirSync(path.dirname(destination+'/'+f),{recursive:true});fs.copyFileSync(root+'/'+f,destination+'/'+f);}
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 const entries=[...new Set([...manifest.map(e=>e.file),...overlays])].map(file=>({file,sha1:hash(fs.readFileSync(destination+'/'+file))}));
 save('snapshot',{destination,files:entries.length,overlays});save('snapshot-manifest',entries);console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 const d=await vercel('/v13/deployments/'+host.replace('https://',''));assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files');save('candidate-source',tree);
 const candidate=files(tree),manifest=read('snapshot-manifest');assert.equal(candidate.size,manifest.length);
 for(const e of manifest)assert.equal(candidate.get(e.file),e.sha1,'Candidate source mismatch '+e.file);
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 save('candidate',{id:d.id,url:d.url});console.log(JSON.stringify(read('candidate')));
}else if(mode==='apply'){
 assert.ok(read('candidate').id);assert.deepEqual(state(),read('before'));assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 const sources=migrations.map(n=>fs.readFileSync(root+'/supabase/migrations/'+n+'.sql','utf8'));
 const body=sources.map((s,i)=>s.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${migrations[i].slice(0,14)}','${migrations[i].slice(15)}',array[${quote(s)}]);`).join('\n');
 const publication=JSON.parse(fs.readFileSync(root+'/catalog/generated/shop-catalog-release.json'));
 // Visual-only release: append compatible client capabilities, do NOT publish
 // products, switch the active catalogue or reroll ANY reserved reward.
 const visualIds=JSON.parse(fs.readFileSync(root+'/catalog/burrow-shop-products.json')).products.filter(p=>p.type==='outfit').map(p=>p.id);
 assert.equal(visualIds.length,19);
 const normalized=alias=>visualCatalogExpression(alias,visualIds);
 const capabilities=`do $assets$declare incoming jsonb:=${quote(JSON.stringify(publication))}::jsonb;previous jsonb;c record;begin
 select payload into previous from burrow_shop_catalog_releases where release=(select value from app_config where key='burrow_shop_active_release');
 -- Only the approved nineteen outfit asset hashes may differ. Everything
 -- else, INCLUDING prices, eligibility, metadata and other art, stays exact.
 if ${normalized('previous')} is distinct from ${normalized('incoming')} then raise exception 'Non-visual catalog change';end if;
 for c in select * from jsonb_each(incoming->'clients') loop
  if exists(select 1 from burrow_shop_release_support where release=c.key) then
   if (select jsonb_agg(product_id order by product_id) from burrow_shop_release_support where release=c.key) is distinct from
    (select jsonb_agg(x order by x) from jsonb_array_elements_text(c.value) x) then raise exception 'Existing capability changed';end if;
  else insert into burrow_shop_release_support select c.key,x from jsonb_array_elements_text(c.value) x;end if;
 end loop;
 insert into burrow_shop_catalog_releases(release,app_version,payload) values(incoming->>'release',incoming->>'appVersion',incoming) on conflict do nothing;
 end $assets$;`;
 query(`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('burrow:dual-bunny-release',0));create temporary table bunny_before on commit drop as ${fingerprints};
 ${body}\n${capabilities}
 create temporary table bunny_after on commit drop as ${fingerprints};
 do $guard$begin if exists(select * from bunny_before except select * from bunny_after) or exists(select * from bunny_after except select * from bunny_before)
 then raise exception 'Protected user rows changed';end if;end $guard$;commit;`);
 const after=state();unchanged(read('before'),after);sources.forEach((s,i)=>assert.equal(after.migrations[migrations[i].slice(0,14)],hash(s,'md5')));save('database-verified',after);
 console.log(JSON.stringify({migrations:[273,274],protectedRowsUnchanged:true,activeCatalogUnchanged:true}));
}else if(mode==='live'){
 const candidate=read('candidate');assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,candidate.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,candidate.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('previous-admin');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const s=state();unchanged(read('before'),s);migrations.forEach(n=>assert.equal(s.migrations[n.slice(0,14)],hash(fs.readFileSync(root+'/supabase/migrations/'+n+'.sql'),'md5')));
 const permissions=query(`select proname,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc
 where pronamespace='public'::regnamespace and prokind='f' and not(oid::text=any(array[${Object.keys(read('before').functions).map(quote).join(',')}]))`);
 assert.ok(permissions.every(r=>!r.anon&&!r.authenticated));save('permissions',permissions);
 const smoke=[];
 for(const [route,method]of [['/api/vnext/bunny','GET'],['/api/vnext/bootstrap','GET'],['/api/vnext/command','POST']]){
  const response=await fetch('https://api.soulsayit.com'+route,{method,signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,401,'Unauthenticated endpoint '+route);smoke.push({route,method,status:response.status});
 }
 save('smoke',smoke);
 const identityCounts=query("begin read only;select variant,finalized,count(*)::int n from bunny_identities group by variant,finalized;rollback;");save('identity-counts',identityCounts);
 const result={migrations:[273,274],api:candidate.id,domain:'https://api.soulsayit.com',adminUnchanged:true,protectedTables:tables.length,verifiedAt:new Date().toISOString()};save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/snapshot/candidate/apply/live');
