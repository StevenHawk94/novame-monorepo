const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validate,sync,categories,treasureCategories}=require('./sync-shop-catalog.cjs');
const {load}=require('./lifecycle-test-utils.cjs');
const manifest=require('../catalog/burrow-shop-products.json'),ledger=require('../catalog/burrow-shop-identities.json');
const release=require('../packages/domain/src/generated/shop-catalog-release.json');
const clone=x=>JSON.parse(JSON.stringify(x));
const imports=file=>Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(([,quote,p])=>[p,path.resolve(path.dirname(file),p)]));
const artFile='apps/mobile/src/lib/generated/shop-product-art.ts';
const art=load(artFile,imports(artFile));
const api=load('apps/api/src/lib/shop-catalog-release.mjs',{'../../../../packages/domain/src/generated/shop-catalog-release.json':release});
const request=hash=>({headers:new Headers({'x-burrow-catalog':hash})});

test('all permanent products validate; no asset is served over the network',()=>{
 assert.equal(validate(manifest,ledger),true);assert.equal(manifest.products.length,Object.keys(ledger.identities).length);
 for(const p of manifest.products){
  if(p.art)assert.equal(art.SHOP_PRODUCT_ART[p.id].source,path.resolve('apps/mobile/assets',p.art.file));
  if(p.status==='active')assert.ok(art.SHOP_PRODUCT_IDS.has(p.id));
 }
 assert.deepEqual(treasureCategories,categories.filter(c=>!['outfits','wallpapers','couple_dolls','games','surprises'].includes(c)));
});
test('rename/reorder cannot change the ID to artwork association',()=>{
 const m=clone(manifest);m.products.reverse();m.products[0].title='Renamed';assert.ok(validate(m,ledger));
 for(const p of m.products)if(p.art)assert.equal(art.SHOP_PRODUCT_ART[p.id].source,path.resolve('apps/mobile/assets',p.art.file));
});
test('unapproved deletion/reused identity/missing art fail; ordinary retirement retains art',()=>{
 const p=manifest.products.find(p=>p.status==='active'&&p.art&&p.category==='lamps');
 const m=clone(manifest);m.products=m.products.filter(x=>x.id!==p.id);assert.throws(()=>validate(m,ledger),/Do not delete/);
 const changed=clone(manifest);changed.products.find(x=>x.id===p.id).category='tables';assert.throws(()=>validate(changed,ledger),/identity reused/);
 const missing=clone(manifest);missing.products.find(x=>x.id===p.id).art.file='missing.webp';assert.throws(()=>validate(missing,ledger),/asset missing/);
 const retired=clone(manifest);retired.products.find(x=>x.id===p.id).status='retired';assert.ok(validate(retired,ledger));
 const noArt=clone(retired);noArt.products.find(x=>x.id===p.id).art=null;assert.throws(()=>validate(noArt,ledger),/Missing artwork/);
});
test('only the 28 explicitly approved retired identities may omit their historical artwork',()=>{
 const removed=manifest.products.filter(p=>ledger.identities[p.id]?.retiredArtRemoved);
 assert.equal(removed.length,28);assert.equal(art.SHOP_REMOVED_ART_IDS.size,28);
 for(const p of removed){
  assert.equal(p.status,'retired');assert.equal(p.art,null);assert.equal(p.asset.file,undefined);
  assert.ok(art.SHOP_REMOVED_ART_IDS.has(p.id));assert.equal(art.SHOP_PRODUCT_ART[p.id],undefined);
  assert.equal(art.SHOP_PRODUCT_IDS.has(p.id),false);
  const restored=clone(manifest);restored.products.find(x=>x.id===p.id).status='active';
  assert.throws(()=>validate(restored,ledger),/must stay retired/);
 }
});
test('generated outputs are deterministic and fresh',()=>{sync({check:true});sync({check:true});});
test('Admin and mobile use the same ID, even when ordinal/title disagree',()=>{
 const admin=require('../apps/admin/src/generated/shop-art.json');
 const preview=load('apps/admin/src/lib/burrow-shop-pricing.js',{'../generated/shop-art.json':admin}).shopPreview;
 for(const p of manifest.products.filter(p=>p.art)){
  const a=preview({stable_id:p.id,category:p.category,title:'not the identity',metadata:{artOrdinal:9999}});
  assert.equal(a.name,p.title);assert.equal(admin.catalogRelease,art.BUNDLED_SHOP_RELEASE);
 }
});
test('unknown/no client capabilities fall back to baseline, not new products',()=>{
 assert.equal(api.shopClientRelease({}),release.legacyRelease);
 assert.equal(api.shopClientRelease(request('unknown')),release.legacyRelease);
 assert.equal(api.shopClientRelease(request(release.release)),release.release);
 const known=manifest.products.find(p=>p.art).id;
 assert.ok(api.shopItemSupported(known,{}));assert.equal(api.shopItemSupported('new-unpublished',request(release.release)),false);
 const rows=[{stable_id:known,category:release.products[known].category},{stable_id:'new-unpublished',category:'lamps'},
  {stable_id:'friend-gift',category:'adventure_collectable'}];
 assert.deepEqual(clone(api.shopCatalogForClient(rows,{})),[rows[0],rows[2]]);
});
test('retired supplement reads only authorized references; no extra read in normal bootstrap',async()=>{
 const p=manifest.products.find(p=>p.art&&p.category==='lamps'),calls=[];
 const db={from:table=>{assert.equal(table,'catalog_items');return{select:()=>({in:async(key,ids)=>{
  calls.push(ids);return{data:ids.map(stable_id=>({stable_id,category:'lamps',status:'retired'}))};}})};}};
 const snapshot={catalog:[],inventory:[{item_id:p.id},{item_id:'not-supported'}],loadouts:[],gifts:[]};
 const result=await api.projectShopCatalog(db,snapshot,{});
 assert.deepEqual(clone(calls),[[p.id]]);assert.equal(result.catalog.length,0);assert.equal(snapshot.catalog.length,0);
 await api.projectShopCatalog(db,{catalog:[{stable_id:p.id,category:p.category}],inventory:[{item_id:p.id}]},{});
 assert.equal(calls.length,1);
});
test('retired owned items no longer have a Collection or Shop placement path',()=>{
 const p={stable_id:'owned',category:'lamps',price:100,status:'retired',metadata:{artOrdinal:1}};
 const fn=load('apps/mobile/src/lib/burrow-collection-options.ts').decorationOptions;
 assert.equal(fn([p],'lamps',false,'me',[]).length,0);
 assert.equal(fn([p],'lamps',true,'me',[{owner_id:'me',item_id:'owned'}]).length,0);
});
test('default capability headers preserve authentication and per-request headers',async()=>{
 const calls=[];
 const {ApiClient}=load('packages/api-client/src/index.ts',{'./error':load('packages/api-client/src/error.ts')},{
  FormData,fetch:async(url,options)=>{calls.push({url,...options});return{ok:true,text:async()=>'{"ok":true}'};},
 });
 const headers={'X-Burrow-Catalog':release.release};
 const client=new ApiClient({baseUrl:'https://example.test',headers,getToken:async()=>'token'});
 headers['X-Burrow-Catalog']='mutated';
 await client.post('/api/vnext/command',{action:'care'},{headers:{'X-Request-Test':'test',Authorization:'must-not-win'}});
 assert.equal(calls[0].headers['X-Burrow-Catalog'],release.release);
 assert.equal(calls[0].headers.Authorization,'Bearer token');
 assert.equal(calls[0].headers['X-Request-Test'],'test');
 assert.equal(calls[0].headers['Content-Type'],'application/json');
 const tiny=fs.readFileSync('apps/mobile/src/lib/generated/shop-catalog-version.ts','utf8');
 assert.doesNotMatch(tiny,/require\(|assets\//,'reporting capabilities must not preload all images');
 assert.ok(tiny.includes(release.release));
});
test('managed artwork never maps an unknown ID to a different ordinal',()=>{
 const file='apps/mobile/src/lib/burrow-art-assets.ts';
 const model=load(file,imports(file));
 const product=manifest.products.find(p=>p.art&&p.category==='lamps');
 assert.equal(model.burrowArtForItem({stable_id:product.id,category:'lamps',title:'renamed',metadata:{artOrdinal:9999,catalogManaged:true}}).source,path.resolve('apps/mobile/assets',product.art.file));
 assert.equal(model.burrowArtForItem({stable_id:'unknown',category:'lamps',metadata:{artOrdinal:1,catalogManaged:true}}),undefined);
});
