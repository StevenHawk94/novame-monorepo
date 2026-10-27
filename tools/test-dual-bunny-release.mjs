import {test,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {visualCatalogExpression} from './dual-bunny-release-guard.cjs';
const {PGlite}=await import(process.env.BURROW_PGLITE_PATH),db=new PGlite();after(()=>db.close());
const current=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
const ids=current.products.filter(p=>p.type==='outfit').map(p=>p.id);
const clone=()=>structuredClone(current);
async function same(previous,incoming){return (await db.query(`select ${visualCatalogExpression('previous',ids)}=${visualCatalogExpression('incoming',ids)} equal
 from (select $1::jsonb previous,$2::jsonb incoming) source`,[JSON.stringify(previous),JSON.stringify(incoming)])).rows[0].equal;}
test('release gate permits only approved outfit bitmap hashes, still rejects money/rules/other art and product changes',async()=>{
 const old=clone();for(const p of old.products.filter(p=>p.type==='outfit'))p.asset.bundledArtHash='old';
 assert.equal(await same(old,current),true);
 for(const change of [
  p=>p.products.find(x=>x.type==='outfit').seed.price++,
  p=>{const seed=p.products.find(x=>x.type==='outfit').seed;seed.plusOnly=!seed.plusOnly;},
  p=>p.products.find(x=>x.type==='outfit').asset.renderer='other',
  p=>p.products.find(x=>x.type==='outfit').metadata.maliciousGrant=true,
  p=>p.products.find(x=>x.type!=='outfit').asset.bundledArtHash='unexpected',
  p=>p.products.pop(),
 ]){const candidate=clone();change(candidate);assert.equal(await same(old,candidate),false);}
});
