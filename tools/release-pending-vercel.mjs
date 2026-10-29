// User-authorized API/Admin pending updates. Never includes mobile or evidence.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir,kind='api',candidateHost]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-photo286.'));assert.ok(['api','admin'].includes(kind));
const project=kind==='api'?'prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4':'prj_uQSVQISOpSpHUgV6sjO4NEqaDASH',team='team_LqL9kutCs8amcePuwOnyqrlO';
const save=(n,v)=>fs.writeFileSync(`${dir}/${kind}-${n}.json`,JSON.stringify(v,null,2),{mode:0o600}),read=n=>JSON.parse(fs.readFileSync(`${dir}/${kind}-${n}.json`));
async function vercel(route,{allowMissing=false}={}){const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
 const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});if(allowMissing&&r.status===404)return null;assert.equal(r.status,200,`Vercel read ${route}`);return r.json();}
function files(tree){const map=new Map();function walk(rows,prefix=''){for(const r of rows){const f=prefix+r.name;if(r.type==='directory')walk(r.children??[],f+'/');else if(r.type==='file')map.set(f,r.uid);}}const src=tree.find(n=>n.name==='src');assert.ok(src?.children);walk(src.children);return map;}
const sha=b=>createHash('sha1').update(b).digest('hex');
if(mode==='inspect'){
 const p=await vercel('/v9/projects/'+project),d=await vercel('/v13/deployments/'+p.targets.production.id);assert.equal(d.readyState,'READY');
 const tree=await vercel('/v6/deployments/'+d.id+'/files',{allowMissing:kind==='admin'});save('before',{id:d.id,url:d.url,projectId:project,crons:p.crons??null,sourceComparisonAvailable:!!tree});save('before-files',tree);
 console.log(JSON.stringify({kind,id:d.id,url:d.url,files:tree?files(tree).size:null,sourceComparisonAvailable:!!tree,crons:p.crons?.definitions??[]}));
}else if(mode==='candidate'){
 assert.match(candidateHost??'',/^novame-monorepo(?:-admin)?-[a-z0-9]+-soulsayit\.vercel\.app$/);
 const d=await vercel('/v13/deployments/'+candidateHost);assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,read('before').id,'Candidate must not be promoted early');
 const snapshot=read('snapshot').destination,tree=await vercel('/v6/deployments/'+d.id+'/files'),now=files(tree),before=read('before-files')?files(read('before-files')):new Map();
 const changed=[],removed=[...before.keys()].filter(f=>!now.has(f));
 for(const[f,digest]of now){assert.ok(!f.startsWith('apps/mobile/')&&!f.startsWith('outputs/')&&!f.split('/').some(p=>p.startsWith('.env')));assert.equal(sha(fs.readFileSync(path.join(snapshot,f))),digest,f);if(before.get(f)!==digest)changed.push(f);}
 save('candidate',{id:d.id,url:d.url,readyState:d.readyState,verifiedFiles:now.size,changedFiles:read('before-files')?changed:null,removedFiles:read('before-files')?removed:null,baselineSourceComparisonAvailable:!!read('before-files')});console.log(JSON.stringify(read('candidate')));
}else if(mode==='live'){
 const c=read('candidate'),p=await vercel('/v9/projects/'+project);assert.equal(p.targets.production.id,c.id);
 const domain=kind==='api'?'api.soulsayit.com':'novame-monorepo-admin.vercel.app';
 const a=await vercel('/v4/aliases/'+domain);assert.equal(a.deploymentId??a.deployment?.id,c.id);
 const checks=[];
 if(kind==='api'){
  assert.equal(p.crons.disabledAt,null);assert.equal(p.crons.deploymentId,c.id);assert.ok(p.crons.definitions.some(c=>c.path==='/api/cron/room-photo-cleanup'&&c.schedule==='*/5 * * * *'));
  for(const old of read('before').crons.definitions)assert.ok(p.crons.definitions.some(c=>c.path===old.path),'Existing cron missing '+old.path);
  for(const [endpoint,method,body]of [['/api/vnext/bootstrap','GET'],['/api/vnext/command','POST',{action:'complete_room_care_v2'}],['/api/vnext/room-photo','POST',{}],['/api/cron/room-photo-cleanup','GET']]){
   const r=await fetch('https://'+domain+endpoint,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.equal(r.status,401);checks.push({endpoint,status:r.status});
  }
 }else{
  // curl honors the host's proxy settings; direct Node connections to
  // *.vercel.app may time out here. Use the actual routed Admin login path.
  const status=execFileSync('curl',['--silent','--show-error','--location','--connect-timeout','10','--max-time','30','--output','/dev/null','--write-out','%{http_code}','https://'+domain+'/admin/login'],{encoding:'utf8',timeout:35000}).trim();
  assert.equal(status,'200');checks.push({endpoint:'/admin/login',status:200});
 }
 const result={...c,domain:'https://'+domain,verifiedAt:new Date().toISOString(),checks,crons:kind==='api'?p.crons.definitions:undefined};save('live',result);console.log(JSON.stringify(result));
}else throw Error('Use inspect / candidate / live');
