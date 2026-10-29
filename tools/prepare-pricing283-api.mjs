// Rebuild only the verified current production API plus the reviewed catalog
// capability index. Never upload unrelated dirty workspace source.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readProductionShopSupport,verifyShopClientSupport} from './check-shop-client-support.mjs';
const root=path.resolve(import.meta.dirname,'..');
const [prior,filesPath,productionPath,out]=process.argv.slice(2);
assert.ok(out?.startsWith('/private/tmp/burrow-pricing283.'));
const current=JSON.parse(fs.readFileSync(productionPath));
assert.equal(current.id,'dpl_6BsmLMPJX2RJqtKfuxQxSfvu2wfU','Production changed: re-audit the deployment baseline');
const release=JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json')));
const support=verifyShopClientSupport(release,readProductionShopSupport());
const snapshot=fs.mkdtempSync(out+'/api-'),manifest=JSON.parse(fs.readFileSync(filesPath));
const entries=[];
function walk(rows,prefix=''){
 for(const row of rows){const full=prefix+row.name;
  if(row.type==='directory')walk(row.children??[],full+'/');
  else if(row.type==='file')entries.push({path:full.replace(/^src\//,''),sha1:row.uid});
 }
}
walk(manifest.filter(row=>row.name==='src'));assert.equal(entries.length,292);
for(const row of entries){
 assert.ok(!row.path.startsWith('/')&&!row.path.split('/').includes('..'));
 assert.ok(!row.path.includes('node_modules')&&!row.path.includes('.env'));
 const bytes=fs.readFileSync(path.join(prior,row.path));
 assert.equal(createHash('sha1').update(bytes).digest('hex'),row.sha1,row.path);
 fs.mkdirSync(path.dirname(path.join(snapshot,row.path)),{recursive:true});
 fs.writeFileSync(path.join(snapshot,row.path),bytes);
}
const changed='packages/domain/src/generated/shop-catalog-release.json';
fs.copyFileSync(path.join(root,changed),path.join(snapshot,changed));
const before=JSON.parse(fs.readFileSync(path.join(prior,changed)));
assert.deepEqual(before.products,release.products,'No new product/art/availability changes');
for(const [id,ids]of Object.entries(before.clients))assert.deepEqual(release.clients[id],ids);
fs.mkdirSync(path.join(snapshot,'.vercel'));
const project=JSON.parse(fs.readFileSync(path.join(prior,'.vercel/project.json')));
assert.equal(project.projectId,'prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4');
fs.writeFileSync(path.join(snapshot,'.vercel/project.json'),JSON.stringify(project));
const report={snapshot,priorDeployment:current.id,verifiedProductionFiles:entries.length,changedFiles:[changed],support,
 files:entries.map(row=>({path:row.path,sha1:createHash('sha1').update(fs.readFileSync(path.join(snapshot,row.path))).digest('hex')}))};
fs.writeFileSync(out+'/api-snapshot.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,files:undefined}));
