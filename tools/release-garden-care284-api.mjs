// Reconstruct the exact live API, overlay ONLY the five reviewed garden files.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const [mode,dir]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-care284.'));
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const changed=['apps/api/src/app/api/vnext/bootstrap/route.js','apps/api/src/app/api/vnext/command/route.js','apps/api/src/lib/app-major-update.js','apps/api/src/lib/burrow-attention.mjs','apps/api/src/lib/room-care-contract.mjs'].sort();
const hash=bytes=>createHash('sha1').update(bytes).digest('hex');
const save=(name,data)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(data,null,2),{mode:0o600}),read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
async function vercel(route){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const response=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Vercel read '+route);return response.json();}
function files(tree){const map=new Map();function walk(nodes,prefix=''){for(const row of nodes){const full=prefix+row.name;if(row.type==='directory')walk(row.children??[],full+'/');else if(row.type==='file')map.set(full,row.uid);}}
 const src=tree.find(n=>n.name==='src');assert.ok(src?.children);walk(src.children);return map;}
if(mode==='prepare'){
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);
 assert.equal(d.id,'dpl_6g4mSrUyDMLgWB1quT4VxuZ1dAwt','Production changed; re-audit baseline');assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),live=files(tree);assert.equal(live.size,292);
 const prior='/private/tmp/burrow-pricing283.Ku9T63/api-Pv8Qw4',snapshot=fs.mkdtempSync(dir+'/api-');
 for(const [file,sha]of live){assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.split('/').some(p=>p.startsWith('.env')));
  const bytes=fs.readFileSync(path.join(prior,file));assert.equal(hash(bytes),sha,file);fs.mkdirSync(path.dirname(path.join(snapshot,file)),{recursive:true});fs.writeFileSync(path.join(snapshot,file),bytes);}
 for(const file of changed){fs.mkdirSync(path.dirname(path.join(snapshot,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(snapshot,file));}
 fs.mkdirSync(snapshot+'/.vercel');fs.copyFileSync(prior+'/.vercel/project.json',snapshot+'/.vercel/project.json');
 const diffs=changed.filter(file=>!live.has(file)||live.get(file)!==hash(fs.readFileSync(path.join(snapshot,file))));assert.deepEqual(diffs,changed);
 save('api-before',{id:d.id,url:d.url});save('api-before-files',tree);save('admin-before',await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'));
 save('api-snapshot',{snapshot,reviewedFiles:changed,baselineFiles:live.size,files:[...live].map(([file])=>({file,sha1:hash(fs.readFileSync(path.join(snapshot,file)))})),added:changed.filter(file=>!live.has(file))});
 console.log(JSON.stringify({snapshot,baseline:d.id,baselineFiles:live.size,changedFiles:changed}));
}else if(mode==='candidate'){
 const log=fs.readFileSync(dir+'/api-deploy.log','utf8'),host=log.match(/https:\/\/(novame-monorepo-[a-z0-9]+-soulsayit\.vercel\.app)/)?.[1];assert.ok(host);
 const d=await vercel('/v13/deployments/'+host);assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files'),now=files(tree),before=files(read('api-before-files')),snapshot=read('api-snapshot').snapshot;
 assert.deepEqual([...now].filter(([file,sha])=>before.get(file)!==sha).map(([file])=>file).sort(),changed);
 for(const file of before.keys())assert.ok(now.has(file),'Production file removed '+file);
 for(const [file,sha]of now){assert.ok(!file.startsWith('apps/mobile/')&&!file.startsWith('apps/admin/'));assert.equal(hash(fs.readFileSync(path.join(snapshot,file))),sha,file);}
 assert.equal((await vercel('/v9/projects/'+project)).targets.production.id,read('api-before').id,'Candidate must not be promoted early');
 const result={id:d.id,url:d.url,readyState:d.readyState,verifiedFiles:now.size,changedFiles:changed};save('api-candidate',result);console.log(JSON.stringify(result));
}else if(mode==='live'){
 const candidate=read('api-candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,candidate.id);
 const alias=await vercel('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,candidate.id);
 const admin=await vercel('/v4/aliases/novame-monorepo-admin.vercel.app'),old=read('admin-before');assert.equal(admin.deploymentId??admin.deployment?.id,old.deploymentId??old.deployment?.id);
 assert.equal(p.crons.disabledAt,null);assert.equal(p.crons.deploymentId,candidate.id);
 for(const endpoint of ['/api/cron/avatar-cleanup','/api/cron/push-notifications'])assert.ok(p.crons.definitions.some(c=>c.path===endpoint));
 const checks=[];for(const [endpoint,method,body]of [['/api/vnext/bootstrap','GET'],['/api/vnext/command','POST',{action:'complete_room_care_v2'}]]){
  const response=await fetch('https://api.soulsayit.com'+endpoint,{method,headers:method==='POST'?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,401);assert.equal((await response.json()).error,'Unauthorized');checks.push({endpoint,status:401});}
 const result={...candidate,domain:'https://api.soulsayit.com',adminUnchanged:true,cronsRegistered:true,authSmoke:checks,verifiedAt:new Date().toISOString()};save('api-live',result);console.log(JSON.stringify(result));
}else throw Error('Use prepare / candidate / live');
