const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const crypto=require('node:crypto');
const {compareShopOffers}=load('apps/mobile/src/lib/shop-offer-order.ts');
test('Free precedes Plus regardless of membership; prices ascend within each group and equal prices are stable',()=>{
 const rows=Object.freeze([{id:'p50',price:50,plus_only:true},{id:'f500',price:500,plus_only:false},
  {id:'f0',price:0,plus_only:false},{id:'f80a',price:80},{id:'p30',price:30,plus_only:true},
  {id:'f80b',price:80},{id:'unknown',price:null}].map(Object.freeze));
 assert.deepEqual(Array.from([...rows].sort(compareShopOffers),r=>r.id),['f0','f80a','f80b','f500','unknown','p30','p50']);
 assert.equal(rows[0].id,'p50');
});
test('all approved room categories and Game/Surprise offers obey the same ordering',()=>{
 const catalog=require('../catalog/burrow-shop-products.json');
 for(const category of catalog.categories){
  const rows=catalog.products.filter(p=>p.category===category&&p.status==='active')
   .map(p=>({id:p.id,price:p.seed.price,plus_only:p.seed.plusOnly}));
  const ordered=rows.slice().reverse().sort(compareShopOffers);
  for(let i=1;i<ordered.length;i++){
   const a=ordered[i-1],b=ordered[i];
   assert.ok(!a.plus_only||b.plus_only,category+' Free before Plus');
   if(a.plus_only===b.plus_only)assert.ok(a.price<=b.price,category+' ascending prices');
  }
 }
});
test('all 496 source/generated seeds exactly match the final workbook cells, not the earlier suggested ratios',()=>{
 const approved=require('../catalog/approvals/pricing-2026-10-28.json');
 const manifest=require('../catalog/burrow-shop-products.json');
 const generated=require('../catalog/generated/shop-catalog-release.json');
 assert.equal(approved.records.length,496);assert.equal(new Set(approved.records.map(p=>p.id)).size,496);
 assert.equal(approved.records.filter(p=>p.plusOnly).length,153);
 assert.deepEqual(manifest.products.filter(p=>p.status==='active').map(p=>p.id).sort(),approved.records.map(p=>p.id).sort());
 for(const p of approved.records)for(const catalog of [manifest,generated]){
  const row=catalog.products.find(r=>r.id===p.id);
  assert.equal(row.seed.price,p.price,p.id);assert.equal(row.seed.plusOnly,p.plusOnly,p.id);
 }
 const values=approved.records.map(({id,price,plusOnly})=>({id,price,plusOnly})).sort((a,b)=>a.id.localeCompare(b.id));
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex'),approved.release.approvedValuesSha256);
});
