// Explicit Admin-only snapshot: no native output, API runtime or local secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
assert.ok(!/(?:_authToken|_password|_auth\s*=|password\s*=)/i.test(fs.readFileSync(path.join(root,'.npmrc'),'utf8')));
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'novame-admin-window-release-'));
const roots=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.npmrc','.vercelignore',
 'apps/admin','packages/core','packages/domain','packages/engine','packages/api-client','packages/tsconfig','tools/build-admin-shop-assets.cjs'];
const forbidden=new Set(['node_modules','.next','.git','.turbo','.expo','.vercel','.pnpm-store','dist','build']);
for(const relative of roots){const source=path.join(root,relative),target=path.join(destination,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.cpSync(source,target,{recursive:true,filter:file=>{
  if(file===source)return true;const name=path.basename(file);
  assert.ok(!fs.lstatSync(file).isSymbolicLink(),`Unexpected symlink: ${path.relative(root,file)}`);
  return !forbidden.has(name)&&!name.startsWith('.env')&&!/\.(?:p8|keystore|ipa|apk|aab|log|tsbuildinfo)$/.test(name);
 }});
}
const project={projectId:'prj_uQSVQISOpSpHUgV6sjO4NEqaDASH',orgId:'team_LqL9kutCs8amcePuwOnyqrlO',projectName:'novame-monorepo-admin'};
fs.mkdirSync(path.join(destination,'.vercel'));fs.writeFileSync(path.join(destination,'.vercel/project.json'),JSON.stringify(project));
assert.ok(!fs.existsSync(path.join(destination,'apps/api')));assert.ok(!fs.existsSync(path.join(destination,'apps/mobile')));
console.log(JSON.stringify({destination,...project}));
