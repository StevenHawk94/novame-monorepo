// Local checks include authoring sources; Vercel receives generated artifacts only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(fs.existsSync(path.join(root,'catalog/burrow-shop-products.json'))){
 require('./sync-shop-catalog.cjs').sync({check:true});
}else{
 const release=require('../packages/domain/src/generated/shop-catalog-release.json');
 const adminPath=path.join(root,'apps/admin/src/generated/shop-art.json');
 const art=fs.existsSync(adminPath)?JSON.parse(fs.readFileSync(adminPath)):null;
 if(art)assert.equal(release.release,art.catalogRelease,'API/Admin catalog release mismatch');
 assert.ok(release.clients[release.legacyRelease]&&release.clients[release.release],'Missing bundle capabilities');
 for(const [id,p]of Object.entries(release.products)){
  assert.ok(['active','retired','draft'].includes(p.status),'Invalid catalog status '+id);
  if(art)assert.equal(p.status,art.products[id]?.status,'Missing Admin product '+id);
 }
 console.log('Bundled Shop artifacts verified (native sources excluded)');
}
