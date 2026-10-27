const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const release=require('../packages/domain/src/generated/shop-catalog-release.json');
const rows=Object.entries(release.clients).flatMap(([version,ids])=>ids.map(product_id=>({release:version,product_id})));
test('production preflight accepts every exact registered capability',async()=>{
 const {verifyShopClientSupport}=await import('./check-shop-client-support.mjs');
 assert.equal(verifyShopClientSupport(release,rows).currentProducts,496);
});
test('the missing current registration reproduces the release blocker',async()=>{
 const {verifyShopClientSupport}=await import('./check-shop-client-support.mjs');
 assert.throws(()=>verifyShopClientSupport(release,rows.filter(r=>r.release!==release.release)),/capability missing/);
});
test('partial, broadened and altered historical capabilities block deployment',async()=>{
 const {verifyShopClientSupport}=await import('./check-shop-client-support.mjs');
 assert.throws(()=>verifyShopClientSupport(release,rows.slice(1)),/capability mismatch/);
 assert.throws(()=>verifyShopClientSupport(release,[...rows,{release:release.release,product_id:'not-reviewed'}]),/capability mismatch/);
});
test('production snapshot preparation requires the read-only database check before copying sources',()=>{
 const script=fs.readFileSync('tools/prepare-api-production-release.mjs','utf8');
 assert.ok(script.indexOf('readProductionShopSupport());')<script.indexOf('fs.mkdtempSync('));
 assert.match(script,/verifyShopClientSupport/);
});
