const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('./lifecycle-test-utils.cjs');
const manifest=require('../catalog/burrow-shop-products.json'),ledger=require('../catalog/burrow-shop-identities.json');
const file='apps/mobile/src/lib/burrow-art-assets.ts';
const imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(([,q,p])=>[p,path.resolve(path.dirname(file),p)]));
const {burrowArtForItem}=load(file,imports);
test('removed retired art stays empty even for stale active-status caches and overlapping ordinals',()=>{
 for(const p of manifest.products.filter(p=>ledger.identities[p.id]?.retiredArtRemoved)){
  for(const status of ['retired','active',undefined]){
   const cached={stable_id:p.id,category:p.category,status,metadata:{artOrdinal:1}};
   assert.equal(burrowArtForItem(cached),null);
   assert.equal(burrowArtForItem(cached,p.category),null,'intentional blank never substitutes a current/default product');
  }
 }
 for(const p of manifest.products.filter(p=>p.status==='active'&&p.art))assert.ok(burrowArtForItem({stable_id:p.id,category:p.category,metadata:p.metadata}));
});
test('deleted retired originals/thumbnails have no mobile registry or Admin preview reference',()=>{
 const art=fs.readFileSync('apps/mobile/src/lib/generated/shop-product-art.ts','utf8');
 assert.doesNotMatch(art,/retired-shop\//);
 const admin=require('../apps/admin/src/generated/shop-art.json');
 for(const p of manifest.products.filter(p=>ledger.identities[p.id]?.retiredArtRemoved))assert.equal(admin.products[p.id].preview,null);
});
