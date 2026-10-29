// Exact live API baseline, one reviewed legacy Duo projection consumer only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {readProductionShopSupport,verifyShopClientSupport} from './check-shop-client-support.mjs';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');assert.ok(dir?.startsWith('/private/tmp/burrow-test285.'));
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const changed=['apps/api/src/app/api/duo/status/route.js'],prior='/private/tmp/burrow-care284.tZAANp/api-ujwYnY';
const hash=v=>createHash('sha1').update(v).digest('hex'),save=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2),{mode:0o600}),read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const response=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Vercel read '+route);return response.json();}
function files(tree){const map=new Map();function walk(nodes,prefix=''){for(const row of nodes){const file=prefix+row.name;if(row.type==='directory')walk(row.children??[],file+'/');else if(row.type==='file')map.set(file,row.uid);}}
 const src=tree.find(n=>n.name==='src');assert.ok(src?.children);walk(src.children);return map;}
if(mode==='prepare'){
 const projectState=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+projectState.targets.production.id);
 assert.equal(d.id,'dpl_DsYWZZP5epoBzzgnekmBSAs1tbhU','Production changed; re-audit baseline');assert.equal(d.readyState,'READY');
 const support=verifyShopClientSupport(JSON.parse(fs.readFileSync(prior+'/packages/domain/src/generated/shop-catalog-release.json')),readProductionShopSupport());
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),live=files(tree);assert.equal(live.size,293);
 const snapshot=fs.mkdtempSync(dir+'/api-');for(const[file,sha]of live){assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.split('/').some(p=>p.startsWith('.env')));
  const bytes=fs.readFileSync(path.join(prior,file));assert.equal(hash(bytes),sha,file);fs.mkdirSync(path.dirname(path.join(snapshot,file)),{recursive:true});fs.writeFileSync(path.join(snapshot,file),bytes);}
 for(const file of changed){const before=fs.readFileSync(path.join(prior,file),'utf8'),after=fs.readFileSync(path.join(root,file),'utf8');
  assert.equal(after,before.replace("supabase.rpc('same_economic_domain_v1'","supabase.rpc('burrow_pair_economy_allowed_v1'"),'Only the reviewed RPC substitution may deploy');fs.copyFileSync(path.join(root,file),path.join(snapshot,file));}
 fs.mkdirSync(snapshot+'/.vercel');fs.copyFileSync(prior+'/.vercel/project.json',snapshot+'/.vercel/project.json');
 save('api-before',{id:d.id,url:d.url});save('api-before-files',tree);save('admin-before',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 save('api-snapshot',{snapshot,reviewedFiles:changed,baselineFiles:live.size,support});console.log(JSON.stringify({snapshot,baseline:d.id,reviewedFiles:changed,support}));
}else if(mode==='candidate'){
 const log=fs.readFileSync(dir+'/api-deploy.log','utf8'),host=log.match(/https:\/\/(novame-monorepo-[a-z0-9]+-soulsayit\.vercel\.app)/)?.[1];assert.ok(host);
 const d=await vercel('/v13/deployments/'+host);assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),now=files(tree),before=files(read('api-before-files')),snapshot=read('api-snapshot').snapshot;
 assert.deepEqual([...now].filter(([file,sha])=>before.get(file)!==sha).map(([file])=>file).sort(),changed);
 assert.equal(now.size,before.size);for(const[file,sha]of now){assert.ok(!file.startsWith('apps/mobile/')&&!file.startsWith('apps/admin/'));assert.equal(hash(fs.readFileSync(path.join(snapshot,file))),sha,file);}
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('api-before').id,'Candidate promoted early');
 const result={id:d.id,url:d.url,readyState:d.readyState,verifiedFiles:now.size,changedFiles:changed};save('api-candidate',result);console.log(JSON.stringify(result));
}else if(mode==='live'){
 const candidate=read('api-candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,candidate.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,candidate.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('admin-before');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 assert.equal(p.crons.disabledAt,null);assert.equal(p.crons.deploymentId,candidate.id);
 const checks=[];for(const endpoint of ['/api/duo/status?userId=unauthenticated-test','/api/vnext/bootstrap']){const r=await fetch('https://api.soulsayit.com'+endpoint,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,401);assert.equal((await r.json()).error,'Unauthorized');checks.push({endpoint,status:401});}
 const result={...candidate,domain:'https://api.soulsayit.com',adminUnchanged:true,cronsRegistered:true,authSmoke:checks,verifiedAt:new Date().toISOString()};save('api-live',result);console.log(JSON.stringify(result));
}else throw Error('Use prepare / candidate / live');
