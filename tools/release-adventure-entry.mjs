// Authorized narrow API-only patch. All other bytes come from the verified
// current production snapshot, NOT this dirty working checkout.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const [mode,dir,host]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
assert.ok(dir?.startsWith('/private/tmp/burrow-adventure-entry-release.'));
const project='prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4',team='team_LqL9kutCs8amcePuwOnyqrlO';
const overlay='apps/api/src/app/api/vnext/adventure/route.js';
const hash=b=>createHash('sha1').update(b).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(dir+'/'+n+'.json'));
const save=(n,v)=>fs.writeFileSync(dir+'/'+n+'.json',JSON.stringify(v,null,2)+'\n',{mode:0o600});
async function api(route){
 const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json')).token;
 const response=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+team,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Vercel metadata read');return response.json();
}
function files(tree){const out=new Map();function walk(nodes,prefix=''){for(const n of nodes){const key=prefix+n.name;
 if(n.type==='directory')walk(n.children??[],key+'/');else{assert.ok(!key.includes('..')&&!key.startsWith('/'));out.set(key,n.uid);}}}
 walk(tree.find(n=>n.name==='src').children);return out;}
if(mode==='snapshot'){
 const live=(await api('/v9/projects/'+project)).targets.production;assert.equal(live.id,'dpl_DwFgnMqPsVN2nAFR4556oSRZVaq4');
 const source=files(await api('/v6/deployments/'+live.id+'/files'));
 const base=JSON.parse(fs.readFileSync('/private/tmp/burrow-touch276-release.E1rZqa/snapshot.json'));
 const destination=fs.mkdtempSync('/private/tmp/burrow-adventure-entry-api.');
 for(const [file,sha1]of source){
  assert.ok(!file.startsWith('apps/mobile/')&&!file.startsWith('apps/admin/')&&!file.split('/').some(s=>s.startsWith('.env')));
  const bytes=fs.readFileSync(base.destination+'/'+file);assert.equal(hash(bytes),sha1,'Production baseline drift: '+file);
  fs.mkdirSync(path.dirname(destination+'/'+file),{recursive:true});fs.copyFileSync(base.destination+'/'+file,destination+'/'+file);
 }
 fs.copyFileSync(root+'/'+overlay,destination+'/'+overlay);
 fs.mkdirSync(destination+'/.vercel');fs.copyFileSync(root+'/.vercel/project.json',destination+'/.vercel/project.json');
 const manifest=[...source].map(([file,sha1])=>({file,sha1:file===overlay?hash(fs.readFileSync(destination+'/'+file)):sha1}));
 assert.equal(manifest.filter(e=>source.get(e.file)!==e.sha1).length,1);
 save('previous',{id:live.id,url:live.url});save('manifest',manifest);save('snapshot',{destination,overlay,files:manifest.length});
 console.log(JSON.stringify(read('snapshot')));
}else if(mode==='refresh-overlay'){
 const snapshot=read('snapshot'),manifest=read('manifest');
 assert.ok(snapshot.destination.startsWith('/private/tmp/burrow-adventure-entry-api.'));
 fs.copyFileSync(root+'/'+overlay,snapshot.destination+'/'+overlay);
 save('manifest',manifest.map(e=>e.file===overlay?{...e,sha1:hash(fs.readFileSync(root+'/'+overlay))}:e));
 console.log(JSON.stringify({updatedOnly:overlay,destination:snapshot.destination}));
}else if(mode==='candidate'){
 const d=await api('/v13/deployments/'+host.replace('https://',''));assert.equal(d.projectId,project);assert.equal(d.readyState,'READY');
 const remote=files(await api('/v6/deployments/'+d.id+'/files')),manifest=read('manifest');assert.equal(remote.size,manifest.length);
 for(const e of manifest)assert.equal(remote.get(e.file),e.sha1,'Candidate drift: '+e.file);
 assert.equal((await api('/v9/projects/'+project)).targets.production.id,read('previous').id);
 save('candidate',{id:d.id,url:d.url,verifiedFiles:manifest.length});console.log(JSON.stringify(read('candidate')));
}else if(mode==='verify'){
 const live=(await api('/v9/projects/'+project)).targets.production;assert.equal(live.id,read('candidate').id);
 const alias=await api('/v4/aliases/api.soulsayit.com');assert.equal(alias.deploymentId??alias.deployment?.id,live.id);
 const statuses={};for(const endpoint of ['/api/vnext/adventure?coordination=1','/api/vnext/adventure','/api/vnext/bootstrap','/api/vnext/plushie-touch']){
  const response=await fetch('https://api.soulsayit.com'+endpoint,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,401);statuses[endpoint]=response.status;
 }
 save('live',{id:live.id,url:live.url,domain:'api.soulsayit.com',verifiedAt:new Date().toISOString(),statuses,onlySourceChange:overlay,noMigration:true});
 console.log(JSON.stringify(read('live')));
}else throw Error('snapshot / candidate / verify required');
