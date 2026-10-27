// Validate the existing workspace lock in an isolated manifest-only checkout.
// Never purge or relink the user's active local node_modules directories.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'novame-branding-lock-check-'));
try {
  for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc'])fs.copyFileSync(path.join(root,file),path.join(directory,file));
  for(const group of ['apps','packages'])for(const entry of fs.readdirSync(path.join(root,group),{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const relative=path.join(group,entry.name,'package.json'),source=path.join(root,relative);
    if(!fs.existsSync(source))continue;
    const target=path.join(directory,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
  }
  const before=fs.readFileSync(path.join(directory,'pnpm-lock.yaml'));
  const output=execFileSync('pnpm',['install','--lockfile-only','--frozen-lockfile','--offline','--ignore-scripts'],
    {cwd:directory,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
  assert.doesNotMatch(output,/Proceed\?|reinstalled from scratch/);
  assert.match(output,/Done in|Lockfile is up to date|Already up to date/);
  assert.deepEqual(fs.readFileSync(path.join(directory,'pnpm-lock.yaml')),before);
  const manifest=require('../apps/mobile/package.json');assert.equal(manifest.devDependencies.sharp,'0.35.0');
  console.log(JSON.stringify({frozenWorkspaceLockVerified:true,offline:true,mobileSharpPinned:'0.35.0',activeNodeModulesChanged:false}));
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
