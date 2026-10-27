// A local authoring build uses the single catalog pipeline. Curated Vercel
// snapshots omit the native project and verify the exact generated artifacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
if(fs.existsSync(path.join(root,'apps/mobile/src/lib/burrow-art-assets.ts'))){
  require('./sync-shop-catalog.cjs').sync();
}else{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'apps/admin/src/generated/shop-art.json')));
  const release=JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json')));
  if(manifest.catalogRelease!==release.release)throw Error('Admin/API catalog release mismatch');
  const entries=Object.values(manifest.products).map(p=>p.preview).filter(Boolean);
  if(!entries.length)throw Error('Missing generated Shop previews');
  for(const url of entries.flatMap(p=>[p.url,p.landscapeUrl].filter(Boolean))){
    if(!/^\/shop-art\/[a-f0-9]{24}\.webp$/.test(url))throw Error('Invalid Shop preview path');
    const bytes=fs.readFileSync(path.join(root,'apps/admin/public',url));
    if(url!=='/shop-art/'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.webp')throw Error('Corrupt Shop preview');
  }
  console.log(`Admin Shop: ${entries.length} bundled previews verified`);
}
