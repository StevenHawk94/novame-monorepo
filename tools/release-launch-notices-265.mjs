// Scoped releases 265/266: launch policy + API/Admin source snapshots.
// Never creates announcements, activates force updates, or impersonates users.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const [mode,dir,target]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(/^\/private\/tmp\/burrow-launch26[56]-release\./.test(dir??''));
const release=dir.startsWith('/private/tmp/burrow-launch266-')?266:265;
const version=release===266?'20261023000266':'20261023000265',name=release===266?'minimum_supported_version_policy':'announcement_launch_actions';
const source=fs.readFileSync(`${root}/supabase/migrations/${version}_${name}.sql`,'utf8');
const hash=(bytes,algorithm='sha1')=>createHash(algorithm).update(bytes).digest('hex');
const quote=text=>"'"+text.replaceAll("'","''")+"'";
const save=(key,value)=>fs.writeFileSync(`${dir}/${key}.json`,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=key=>JSON.parse(fs.readFileSync(`${dir}/${key}.json`,'utf8'));
const team='team_LqL9kutCs8amcePuwOnyqrlO';
function query(sql){
 assert.equal(fs.readFileSync(`${root}/supabase/.temp/project-ref`,'utf8').trim(),'qleeohkhbrdvznbwgqad');
 const result=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(result)?result:result.rows;
}
async function vercel(route){
 const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const response=await fetch(`https://api.vercel.com${route}${route.includes('?')?'&':'?'}teamId=${team}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,`Vercel read ${route}`);return response.json();
}
const fingerprint=`select 'announcements'::text name,md5(coalesce(string_agg((to_jsonb(t)-'button_text'-'action_url')::text,E'\\n' order by id),'')) digest from public.app_announcements t
 union all select 'reads',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by user_id,announcement_id),'')) from public.user_read_announcements t
 union all select 'force_updates',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by id),'')) from public.force_updates t`;
if(mode==='inspect'){
 const previous=release===266?'20261023000265':'20261023000264';
 const migrations=query(`select version,md5(statements[1]) hash from supabase_migrations.schema_migrations where version in('${previous}','${version}')`);
 assert.ok(migrations.some(m=>m.version===previous));save('migrations-before',migrations);
 save('content-before',query(fingerprint));
 for(const app of ['api','admin']){
  const p=await vercel('/v9/projects/'+(app==='api'?'prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4':'novame-monorepo-admin'));
  assert.equal(p.rootDirectory,`apps/${app}`);save(`${app}-before`,{id:p.id,name:p.name,rootDirectory:p.rootDirectory,deployment:p.targets.production.id});
 }
 console.log(JSON.stringify({release,migration:migrations.find(m=>m.version===version)??null,projectsVerified:true,contentFingerprintSaved:true}));
}else if(mode==='apply'){
 const existing=query(`select md5(statements[1]) hash from supabase_migrations.schema_migrations where version='${version}'`)[0];
 if(existing)assert.equal(existing.hash,hash(source,'md5'));
 else{
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  query(`begin;set local lock_timeout='5s';set local statement_timeout='30s';
   select pg_advisory_xact_lock(hashtextextended('novame:migration:${version}',0));
   lock table public.app_announcements,public.user_read_announcements,public.force_updates in share mode;
   create temporary table launch265_before on commit drop as ${fingerprint};
   ${body}
   create temporary table launch265_after on commit drop as ${fingerprint};
   do $guard$ begin if exists(select * from launch265_before except select * from launch265_after) or exists(select * from launch265_after except select * from launch265_before)
    then raise exception 'Announcement/read/force-update content changed';end if;end $guard$;
   insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);
   notify pgrst,'reload schema';commit;`);
 }
 const columns=query("select column_name,column_default,is_nullable from information_schema.columns where table_schema='public' and table_name='app_announcements' and column_name in('button_text','action_url') order by column_name");
 assert.equal(columns.length,2);
 const privileges=release===266?query("select has_function_privilege('anon','save_minimum_app_version_v1(text,text,text,boolean)','execute') anon,has_function_privilege('authenticated','save_minimum_app_version_v1(text,text,text,boolean)','execute') authenticated,has_function_privilege('service_role','save_minimum_app_version_v1(text,text,text,boolean)','execute') service")[0]:null;
 if(privileges)assert.deepEqual(privileges,{anon:false,authenticated:false,service:true});
 const result={migration:release,hash:hash(source,'md5'),columns,privileges,contentUnchanged:true};save('database',result);console.log(JSON.stringify(result));
}else if(mode==='snapshot'){
 assert.ok(['api','admin'].includes(target));const require=createRequire(import.meta.url);
 const ignore=require('/Users/nihao/.npm/_npx/249ca9fcd30c476a/node_modules/ignore');
 const rules=ignore().add(fs.readFileSync(root+'/.vercelignore','utf8'));
 const destination=fs.mkdtempSync(`/private/tmp/burrow-launch${release}-${target}.`),manifest=[];
 const roots=[`apps/${target}`,'packages/core','packages/domain','packages/engine','packages/tsconfig',...(target==='admin'?['packages/api-client']:[]),'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.npmrc','.vercelignore',
  target==='admin'?'tools/build-admin-shop-assets.cjs':'tools/verify-shop-release.cjs'];
 function copy(relative){
  if(!fs.existsSync(`${root}/${relative}`)||rules.ignores(relative)||relative.split('/').some(s=>s.startsWith('.env')||s==='.gitignore'))return;
  const stat=fs.lstatSync(`${root}/${relative}`);
  if(stat.isDirectory()){if(rules.ignores(relative+'/'))return;for(const entry of fs.readdirSync(`${root}/${relative}`))copy(relative+'/'+entry);}
  else if(stat.isFile()){
   assert.ok(!relative.startsWith('apps/mobile/')&&!relative.split('/').some(s=>['node_modules','.git','.next'].includes(s)));
   fs.mkdirSync(path.dirname(`${destination}/${relative}`),{recursive:true});fs.copyFileSync(`${root}/${relative}`,`${destination}/${relative}`);
   manifest.push({file:relative,sha1:hash(fs.readFileSync(`${root}/${relative}`)),bytes:stat.size});
  }
 }
 roots.forEach(copy);assert.ok(manifest.length>100);
 const p=read(`${target}-before`);fs.mkdirSync(destination+'/.vercel');fs.writeFileSync(destination+'/.vercel/project.json',JSON.stringify({projectId:p.id,orgId:team,projectName:p.name}));
 save(`${target}-manifest`,manifest);const result={destination,files:manifest.length,bytes:manifest.reduce((n,f)=>n+f.bytes,0)};save(`${target}-snapshot`,result);console.log(JSON.stringify(result));
}else if(mode==='candidate'){
 assert.ok(['api','admin'].includes(target));const url=process.argv[5];assert.ok(url?.startsWith('https://'));
 const before=read(`${target}-before`),p=await vercel('/v9/projects/'+before.id),d=await vercel('/v13/deployments/'+url.slice(8));
 assert.equal(p.targets.production.id,before.deployment,'Production moved before validation');assert.equal(d.projectId,before.id);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),files=new Map();
 function walk(nodes,prefix=''){for(const n of nodes){const file=prefix+n.name;if(n.type==='directory')walk(n.children??[],file+'/');else files.set(file,n.uid);}}walk(tree.find(n=>n.name==='src').children);
 for(const entry of read(`${target}-manifest`))assert.equal(files.get(entry.file),entry.sha1,`Candidate source mismatch: ${entry.file}`);
 for(const file of files.keys())assert.ok(!file.startsWith('apps/mobile/')&&!file.split('/').some(s=>s.startsWith('.env')));
 const result={id:d.id,url:d.url,sourceVerified:true,files:files.size};save(`${target}-candidate`,result);console.log(JSON.stringify(result));
}else if(mode==='verify'){
 const result={migration:read('database')};
 for(const app of ['api','admin']){
  const before=read(`${app}-before`),p=await vercel('/v9/projects/'+before.id),d=await vercel('/v13/deployments/'+p.targets.production.id);
  assert.equal(d.readyState,'READY');assert.notEqual(d.id,before.deployment);
  assert.equal(d.id,read(`${app}-candidate`).id);
  const alias=await vercel('/v4/aliases/'+(app==='api'?'api.soulsayit.com':'novame-monorepo-admin.vercel.app'));
  assert.equal(alias.deploymentId??alias.deployment?.id,d.id,'Production alias differs');
  const tree=await vercel('/v6/deployments/'+d.id+'/files'),files=new Map();
  function walk(nodes,prefix=''){for(const n of nodes){const file=prefix+n.name;if(n.type==='directory')walk(n.children??[],file+'/');else files.set(file,n.uid);}}walk(tree.find(n=>n.name==='src').children);
  for(const entry of read(`${app}-manifest`))assert.equal(files.get(entry.file),entry.sha1,`Source mismatch: ${entry.file}`);
  for(const file of files.keys())assert.ok(!file.startsWith('apps/mobile/')&&!file.split('/').some(s=>s.startsWith('.env')));
  result[app]={id:d.id,url:d.url,sourceVerified:true};
 }
 result.verifiedAt=new Date().toISOString();save('verified',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect/apply/snapshot/verify');
