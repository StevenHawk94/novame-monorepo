// Authorized Shop repair release. No real purchases/claims or user impersonation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-shop262-release.'));
assert.equal(fs.readFileSync(root+'/supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261022000262',source=fs.readFileSync(root+'/supabase/migrations/'+version+'_shop_checkout_repair.sql','utf8');
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const changed=new Set(['save_room_loadout_v1','solo_burrow_loadout_v1','save_bunny_outfit_v1','solo_burrow_outfit_v1','burrow_toy_photo_target_allowed_v1','burrow_reward_wallet_state_v1']);
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
const protectedTables=['catalog_items','user_inventory','wallets','currency_ledger','catalog_purchases','gifts','room_loadouts','room_photos','moment_events','adventures','daily_quest_assignments','quest_progress_vnext'];
const digests=protectedTables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
function state(){return query(`select jsonb_build_object(
 'migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version in('20261022000261','${version}')),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'),
 'serviceOnly',(select bool_and(not has_function_privilege(r,fn,'execute') and has_function_privilege('service_role',fn,'execute'))
  from (values('anon'),('authenticated')) roles(r) cross join
  (values('public.purchase_room_changes_v1(uuid,uuid,text,jsonb,jsonb,integer,text,text)'),('public.purchase_catalog_item_scoped_v1(uuid,uuid,text,uuid,text,integer,text,text)')) funcs(fn)
  where to_regprocedure(fn) is not null)) state;`)[0].state;}
function unchanged(before,after){for(const [oid,fn] of Object.entries(before.functions)){const next=after.functions[oid];assert.ok(next,'Removed '+fn.name);
 assert.deepEqual(next.grants,fn.grants,'Changed grants '+fn.name);if(!changed.has(fn.name))assert.equal(next.definition,fn.definition,'Unrelated function changed '+fn.name);}}
if(mode==='inspect'){
 const before=state();assert.ok(before.migrations['20261022000261']);assert.ok(!before.migrations[version]);save('before',before);
 fs.writeFileSync(dir+'/original-functions.sql',Object.values(before.functions).filter(f=>changed.has(f.name)).map(f=>f.definition+';').join('\n'),{mode:0o600});
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id),tree=await vercel('/v6/deployments/'+d.id+'/files');
 save('previous-deployment',{id:d.id,url:d.url});save('previous-source',tree);save('previous-admin',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 const differences=[...files(tree)].filter(([f,uid])=>fs.existsSync(root+'/'+f)&&hash(fs.readFileSync(root+'/'+f))!==uid).map(([f])=>f);
 save('source-differences',differences);console.log(JSON.stringify({preflight:true,functionBackups:Object.keys(before.functions).length,production:d.id,differences}));
}else if(mode==='apply'){
 const before=read('before'),current=state();unchanged(before,current);assert.ok(!current.migrations[version]);
 query(`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));
 create temporary table checkout262_before on commit drop as ${digests};
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table checkout262_after on commit drop as ${digests};
 do $guard$ begin if exists(select * from checkout262_before except select * from checkout262_after)
  or exists(select * from checkout262_after except select * from checkout262_before) then raise exception 'Protected user rows changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','shop_checkout_repair',array[${quote(source)}]);commit;`);
 const after=state();unchanged(before,after);assert.equal(after.migrations[version],hash(source,'md5'));assert.equal(after.serviceOnly,true);save('database-verified',after);
 console.log(JSON.stringify({migration:262,sourceVerified:true,protectedUserRowsUnchanged:true,unrelatedFunctionDefinitionsAndGrantsUnchanged:true,serviceOnly:true}));
}else if(mode==='snapshot'){
 const require=createRequire(import.meta.url),ignore=require('/Users/nihao/.npm/_npx/249ca9fcd30c476a/node_modules/ignore');
 const rules=ignore().add(fs.readFileSync(root+'/.vercelignore','utf8')),destination=fs.mkdtempSync('/private/tmp/burrow-shop262-api.');
 const roots=['apps/api','packages/core','packages/domain','packages/engine','packages/tsconfig','tools/verify-shop-release.cjs','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.npmrc','.vercelignore'];
 const entries=[];function copy(relative){if(!fs.existsSync(root+'/'+relative)||rules.ignores(relative)
  ||relative.split('/').some(p=>p.startsWith('.env')||p==='.gitignore'))return;
  const stat=fs.lstatSync(root+'/'+relative);if(stat.isDirectory()){if(rules.ignores(relative+'/'))return;for(const n of fs.readdirSync(root+'/'+relative))copy(relative+'/'+n);}
  else if(stat.isFile()){assert.ok(!relative.split('/').some(p=>p.startsWith('.env')));assert.ok(!relative.startsWith('apps/mobile/'));
   fs.mkdirSync(path.dirname(destination+'/'+relative),{recursive:true});fs.copyFileSync(root+'/'+relative,destination+'/'+relative);entries.push({file:relative,sha1:hash(fs.readFileSync(root+'/'+relative)),bytes:stat.size});}}
 roots.forEach(copy);assert.ok(entries.length>200);fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 save('snapshot',{destination,files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)});save('snapshot-manifest',entries);
 console.log(JSON.stringify(read('snapshot')));
}else if(mode==='candidate'){
 const host=process.argv[4];assert.ok(host);const d=await vercel('/v13/deployments/'+host.replace('https://',''));
 assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');const tree=await vercel('/v6/deployments/'+d.id+'/files'),now=files(tree),manifest=read('snapshot-manifest');
 for(const entry of manifest)assert.equal(now.get(entry.file),entry.sha1,'Candidate differs: '+entry.file);
 for(const f of now.keys())assert.ok(!f.startsWith('apps/mobile/')&&!f.startsWith('apps/admin/')&&!f.split('/').some(p=>p.startsWith('.env')));
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('previous-deployment').id);
 save('candidate-source',tree);save('candidate',{id:d.id,url:d.url,filesVerified:manifest.length});console.log(JSON.stringify(read('candidate')));
}else if(mode==='live'){
 const d=read('candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,d.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,d.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('previous-admin');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 const after=state();unchanged(read('before'),after);assert.equal(after.migrations[version],hash(source,'md5'));assert.equal(after.serviceOnly,true);
 const result={migration:262,api:d.id,domain:'https://api.soulsayit.com',adminUnchanged:true,verifiedAt:new Date().toISOString()};save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/apply/snapshot/candidate/live');
