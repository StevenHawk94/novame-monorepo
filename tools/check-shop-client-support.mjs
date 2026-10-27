// Read-only production preflight; capability metadata must precede API/App release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
export function verifyShopClientSupport(release,rows){
 const actual=new Map();for(const row of rows){const set=actual.get(row.release)??new Set();set.add(row.product_id);actual.set(row.release,set);}
 for(const [version,ids]of Object.entries(release.clients)){
  assert.ok(actual.has(version),`Production Shop capability missing: ${version}; register before deployment`);
  assert.deepEqual([...actual.get(version)].sort(),[...ids].sort(),`Production Shop capability mismatch: ${version}`);
 }
 return {versions:Object.keys(release.clients).length,currentRelease:release.release,currentProducts:release.clients[release.release].length};
}
export function readProductionShopSupport(){
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'burrow-shop-support-preflight.'));
 const sql="select release,product_id from public.burrow_shop_release_support order by release,product_id;";
 fs.writeFileSync(path.join(dir,'query.sql'),sql,{mode:0o600});
 const parsed=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',path.join(dir,'query.sql')],{cwd:root,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(parsed)?parsed:parsed.rows;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const release=JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json')));
 console.log(JSON.stringify({...verifyShopClientSupport(release,readProductionShopSupport()),readOnly:true}));
}
