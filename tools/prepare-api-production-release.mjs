// Construct an explicit API-only release snapshot. CLI archive traversal must
// never touch native build artifacts, development credentials or unrelated apps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readProductionShopSupport,verifyShopClientSupport} from './check-shop-client-support.mjs';
const root=path.resolve(import.meta.dirname,'..');
// Never deploy an API that recognizes a bundle the transaction database rejects.
const shopSupport=verifyShopClientSupport(JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json'))),readProductionShopSupport());
assert.ok(!/(?:_authToken|_password|_auth\s*=|password\s*=)/i.test(fs.readFileSync(path.join(root,'.npmrc'),'utf8')),
 'Never include registry credentials in a release snapshot; configure them in Vercel instead');
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'novame-api-production-release-'));
const roots=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.npmrc','.vercelignore','.vercel/project.json',
 'apps/api','packages/core','packages/domain','packages/engine','packages/tsconfig','tools/verify-shop-release.cjs','tools/check-avatar-runtime.mjs'];
const forbidden=new Set(['node_modules','.next','.git','.turbo','.expo','.vercel','.pnpm-store','dist','build']);
for(const relative of roots){
 const source=path.join(root,relative);assert.ok(fs.existsSync(source),relative);
 fs.mkdirSync(path.dirname(path.join(destination,relative)),{recursive:true});
 fs.cpSync(source,path.join(destination,relative),{recursive:true,filter:file=>{
  if(file===source)return true;
  const name=path.basename(file);
  assert.ok(!fs.lstatSync(file).isSymbolicLink(),`Unexpected symbolic link in release source: ${path.relative(root,file)}`);
  return !forbidden.has(name)&&name!=='.DS_Store'&&!name.startsWith('.env')&&!/\.(?:p8|keystore|ipa|apk|aab|log|tsbuildinfo)$/.test(name);
 }});
}
// For a narrow API patch, retain the verified production lockfile rather than
// bundling unrelated pending mobile dependency changes from the workspace.
const lockfileFrom=process.argv.find(arg=>arg.startsWith('--lockfile-from='))?.slice('--lockfile-from='.length);
const lockfileHash=process.argv.find(arg=>arg.startsWith('--lockfile-sha1='))?.slice('--lockfile-sha1='.length);
if(lockfileFrom){
 assert.match(lockfileHash??'',/^[a-f0-9]{40}$/,'A verified production source hash is required');
 const bytes=fs.readFileSync(lockfileFrom);
 assert.equal(createHash('sha1').update(bytes).digest('hex'),lockfileHash);
 fs.copyFileSync(lockfileFrom,path.join(destination,'pnpm-lock.yaml'));
}
const project=JSON.parse(fs.readFileSync(path.join(destination,'.vercel/project.json'),'utf8'));
assert.equal(project.projectId,'prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4');
assert.ok(!fs.existsSync(path.join(destination,'apps/mobile')));assert.ok(!fs.existsSync(path.join(destination,'apps/admin')));
const files=[];
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else{
  assert.ok(!entry.name.startsWith('.env'));assert.ok(!file.includes('/node_modules/'));
  const contents=fs.readFileSync(file);files.push({path:path.relative(destination,file),bytes:contents.length,sha256:createHash('sha256').update(contents).digest('hex')});
 }
}}
walk(destination);
const report={destination,projectId:project.projectId,shopSupport,files:files.length,bytes:files.reduce((sum,f)=>sum+f.bytes,0),
 sourceHashes:Object.fromEntries(files.filter(f=>['apps/api/src/app/api/vnext/surprise/route.js','apps/api/src/lib/burrow-surprise.mjs','apps/api/src/app/api/vnext/command/route.js','apps/api/src/app/api/vnext/bootstrap/route.js','apps/api/src/lib/burrow-unpaired-bootstrap.mjs'].includes(f.path)).map(f=>[f.path,f.sha256]))};
const target=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
