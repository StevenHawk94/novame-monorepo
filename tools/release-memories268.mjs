// Scoped, user-approved Memories release; never signs in as an end user.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-memories268-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261024000268',source=fs.readFileSync(root+'/supabase/migrations/'+version+'_memories_page_lifecycle.sql','utf8');
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const hash=(s,alg='sha1')=>createHash(alg).update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const save=(name,value)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json','utf8'));
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});
 const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(result)?result:result.rows;}
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const response=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Vercel metadata read');return response.json();}
function files(tree){const result=new Map();function walk(nodes,prefix=''){for(const n of nodes){const p=prefix+n.name;if(n.type==='directory')walk(n.children??[],p+'/');else result.set(p,n.uid);}}walk(tree.find(n=>n.name==='src').children);return result;}
const tables=['catalog_items','user_inventory','wallets','currency_ledger','catalog_purchases','gifts','room_photos','room_photo_uploads','moment_events','adventures','daily_quest_assignments','quest_progress_vnext','app_announcements','user_read_announcements','force_updates','couple_journal_questions','couple_journal_pages','couple_journal_answers'];
const digests=tables.map(t=>{const json=t==='couple_journal_pages'?"to_jsonb(t)-'protocol'-'completed_at'-'next_available_at'-'question_snapshot'":'to_jsonb(t)';return `select '${t}'::text name,count(*) n,md5(coalesce(string_agg((${json})::text,E'\\n' order by (${json})::text),'')) digest from public.${t} t`;}).join(' union all ');
const allowed=new Set(['couple_journal_snapshot_v1','couple_journal_page_json_v1']);
function state(){return query(`select jsonb_build_object('migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version in('20261023000267','${version}')),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f')) state`)[0].state;}
function unchanged(before,after){for(const [oid,fn] of Object.entries(before.functions)){const next=after.functions[oid];assert.ok(next,'Function removed '+fn.name);if(!allowed.has(fn.name))assert.deepEqual(next,fn,'Unrelated function/grant changed '+fn.name);}}
const overlays=['apps/api/src/app/api/vnext/couple-journal/route.js','apps/api/src/lib/burrow-attention.mjs','apps/api/src/app/api/vnext/bootstrap/route.js','apps/api/src/middleware.ts'];
if(mode==='inspect'||mode==='reinspect'){
 const before=state();assert.ok(before.migrations['20261023000267']);
 if(mode==='reinspect'){
  assert.equal(before.migrations[version],hash(source,'md5'));save('initial-before',read('before'));save('initial-live',read('live'));
  save('baseline',read('snapshot'));save('baseline-manifest',read('snapshot-manifest'));
 }else{assert.ok(!before.migrations[version]);save('baseline',{destination:'/private/tmp/burrow-personal267-api.miZL9u'});
  save('baseline-manifest',JSON.parse(fs.readFileSync('/private/tmp/burrow-personal267-release.pYgBQe/snapshot-manifest.json')));}
 save('before',before);
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);
 save('previous-deployment',{id:d.id,url:d.url});save('previous-source',await vercel('/v6/deployments/'+d.id+'/files'));save('previous-admin',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 console.log(JSON.stringify({preflight:true,production:d.id,protectedTables:tables.length}));
}else if(mode==='apply'){
 const before=read('before'),current=state();unchanged(before,current);assert.ok(!current.migrations[version]);
 query(`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));create temporary table memories268_before on commit drop as ${digests};
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table memories268_after on commit drop as ${digests};
 do $guard$ begin if exists(select * from memories268_before except select * from memories268_after) or exists(select * from memories268_after except select * from memories268_before)
 then raise exception 'Protected user rows changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','memories_page_lifecycle',array[${quote(source)}]);commit;`);
 const after=state();unchanged(before,after);assert.equal(after.migrations[version],hash(source,'md5'));save('database-verified',after);
 const permissions=query(`select proname,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='public'::regnamespace and proname in('couple_journal_snapshot_v2','save_couple_journal_answer_v2','read_couple_journal_v2','couple_journal_attention_v2')`);
 assert.equal(permissions.length,4);permissions.forEach(p=>assert.ok(!p.anon&&!p.authenticated&&p.service));save('permissions',permissions);
 console.log(JSON.stringify({migration:268,protectedUserRowsUnchanged:true,unrelatedFunctionsUnchanged:true,serviceOnly:true}));
}else if(mode==='snapshot'){
 const baseline=read('baseline')?.destination,manifest=read('baseline-manifest');
 const deployed=files(read('previous-source'));assert.equal(deployed.size,manifest.length,'Production baseline changed');for(const e of manifest){assert.equal(deployed.get(e.file),e.sha1,'Production changed '+e.file);assert.equal(hash(fs.readFileSync(baseline+'/'+e.file)),e.sha1);}
 const destination=fs.mkdtempSync('/private/tmp/burrow-memories268-api.');for(const e of manifest){fs.mkdirSync(path.dirname(destination+'/'+e.file),{recursive:true});fs.copyFileSync(baseline+'/'+e.file,destination+'/'+e.file);}
 for(const f of overlays){fs.mkdirSync(path.dirname(destination+'/'+f),{recursive:true});fs.copyFileSync(root+'/'+f,destination+'/'+f);}
 const entries=[...new Set([...manifest.map(e=>e.file),...overlays])].map(file=>({file,sha1:hash(fs.readFileSync(destination+'/'+file))}));
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');save('snapshot',{destination,files:entries.length,overlays});save('snapshot-manifest',entries);console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 assert.ok(host);const d=await vercel('/v13/deployments/'+host.replace('https://',''));assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const now=files(await vercel('/v6/deployments/'+d.id+'/files')),manifest=read('snapshot-manifest');assert.equal(now.size,manifest.length);for(const e of manifest)assert.equal(now.get(e.file),e.sha1,'Candidate differs '+e.file);
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);save('candidate',{id:d.id,url:d.url});console.log(JSON.stringify(read('candidate')));
}else if(mode==='live'){
 const candidate=read('candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,candidate.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,candidate.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('previous-admin');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const after=state();unchanged(read('before'),after);assert.equal(after.migrations[version],hash(source,'md5'));
 const result={migration:268,api:candidate.id,domain:'https://api.soulsayit.com',adminUnchanged:true,verifiedAt:new Date().toISOString()};save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/apply/snapshot/candidate/live');
