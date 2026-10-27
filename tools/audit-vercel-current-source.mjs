// Compare authenticated production source receipts with local working bytes.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const dir=process.argv[2];assert.ok(dir?.startsWith('/private/tmp/'));fs.mkdirSync(dir,{recursive:true});
const token=JSON.parse(fs.readFileSync('/Users/nihao/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
const api=async route=>{const res=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId=team_LqL9kutCs8amcePuwOnyqrlO',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(res.status,200);return res.json();};
const hash=b=>createHash('sha1').update(b).digest('hex');const summary=[];
for(const [name,project]of [['api','prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4'],['admin','prj_uQSVQISOpSpHUgV6sjO4NEqaDASH']]){
 const current=await api('/v9/projects/'+project),deployment=await api('/v13/deployments/'+current.targets.production.id);assert.equal(deployment.readyState,'READY');
 const tree=await api('/v6/deployments/'+deployment.id+'/files'),files=new Map();
 const walk=(nodes,prefix='')=>{for(const node of nodes){const file=prefix+node.name;if(node.type==='directory')walk(node.children??[],file+'/');else files.set(file,node.uid);}};
 walk(tree.find(n=>n.name==='src').children);fs.writeFileSync(`${dir}/${name}-source.json`,JSON.stringify(tree));
 const changed=[...files].filter(([file,uid])=>!fs.existsSync(file)||hash(fs.readFileSync(file))!==uid).map(([file])=>file);
 const missing=[];function coverage(base){if(!fs.existsSync(base))return;for(const item of fs.readdirSync(base,{withFileTypes:true})){
  if(['node_modules','.next','.vercel','.git','dist','build','.turbo'].includes(item.name)||item.name.startsWith('.env')||item.name==='.DS_Store')continue;
  const file=path.join(base,item.name);if(item.isDirectory())coverage(file);else if(!files.has(file.replaceAll(path.sep,'/'))&&!/\.(log|tsbuildinfo)$/.test(file))missing.push(file);
 }}coverage(`apps/${name}/src`);coverage(`apps/${name}/public`);
 let mobileOnlyLockfileDifference=false;
 if(changed.includes('pnpm-lock.yaml')){
  const lock=await api(`/v8/deployments/${deployment.id}/files/${files.get('pnpm-lock.yaml')}`),remote=Buffer.from(lock.data,'base64').toString('utf8'),local=fs.readFileSync('pnpm-lock.yaml','utf8');
  assert.equal(hash(Buffer.from(remote)),files.get('pnpm-lock.yaml'));
  fs.writeFileSync(`${dir}/${name}-production-pnpm-lock.yaml`,remote);
  const strip=s=>s.replace(/^  apps\/mobile:\n[\s\S]*?(?=^  [^ \n]|^packages:|^snapshots:)/m,'');
  mobileOnlyLockfileDifference=strip(remote)===strip(local);
 }
 summary.push({name,id:deployment.id,url:deployment.url,sourceFiles:files.size,changed,localNotDeployed:missing,mobileOnlyLockfileDifference});
}
fs.writeFileSync(dir+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
