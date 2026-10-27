// User-approved removal of pre-cut masters and review material. Recoverable,
// exact-target moves only; never remove canonical runtime ears/tails or suites.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(root+'/catalog/burrow-shop-products.json'));
const runtime=new Set();for(const p of catalog.products.filter(p=>p.type==='outfit')){
 for(const f of [...Object.values(p.layers),...Object.values(p.bunnyVariants.pinky),...Object.values(p.bunnyThumbnails)]){
  const full=path.join(root,'apps/mobile/assets',f);assert.ok(fs.existsSync(full),f);runtime.add(full);
 }
}
const targets=['output/outfit-review','apps/mobile/assets/bunny outfits full','tools/integrate-bunny-variants.cjs'];
for(const p of catalog.products.filter(p=>p.type==='outfit'))for(const layer of ['1_head.webp','2_body.webp']){
 const file='apps/mobile/assets/burrow-webp/outfits/outfits-characters/'+p.asset.outfitKey+'/'+layer;
 if(fs.existsSync(root+'/'+file))targets.push(file);
}
const code=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);
 if(e.isDirectory())walk(file);else if(/\.(ts|tsx|js|jsx|json|mjs)$/.test(e.name))code.push(fs.readFileSync(file,'utf8'));
}}
walk(root+'/apps/mobile/src');walk(root+'/apps/mobile/app');
for(const target of targets){const full=path.join(root,target);assert.ok(!runtime.has(full));
 if(target.endsWith('.webp'))assert.ok(!code.some(text=>text.includes(target.replace('apps/mobile/',''))),'Referenced '+target);
}
if(process.argv[2]!=='--apply'){console.log(JSON.stringify({dryRun:true,targets,runtimeAssets:runtime.size}));process.exit(0);}
const archive=fs.mkdtempSync('/private/tmp/burrow-bunny-source-archive.');
for(const target of targets){assert.ok(fs.existsSync(root+'/'+target),'Already moved '+target);
 const dest=path.join(archive,target);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.renameSync(path.join(root,target),dest);
}
const report={at:new Date().toISOString(),archive,targets,runtimeAssetsRetained:runtime.size,recoverable:true};
fs.writeFileSync(root+'/tools/reports/bunny-asset-cleanup-2026-10-25.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
