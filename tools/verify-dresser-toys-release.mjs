// Read-only release verification. Does not buy items, grant inventory or
// upload personal photos; decoded art/interaction/purchase tests run locally.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=path.resolve(import.meta.dirname,'..');
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
const sql=`select jsonb_build_object('migrated',exists(select 1 from supabase_migrations.schema_migrations where version='20261015000239'),
 'toys',(select jsonb_agg(t order by (metadata->>'artOrdinal')::int,stable_id) from
 (select stable_id,title,price,plus_only,shop_price_version,status,metadata,asset,revision_id from public.catalog_items where category='couple_dolls') t)) as verification;`;
const output=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024}));
const result=(Array.isArray(output)?output:output.rows)[0].verification;
assert.equal(result.migrated,true);assert.equal(result.toys.length,33);
const before=process.argv.find(arg=>arg.startsWith('--compare='))?.slice('--compare='.length);
if(before){const raw=JSON.parse(fs.readFileSync(before,'utf8'));const rows=Array.isArray(raw)?raw:raw.rows;
 assert.equal(rows.length,29);for(const row of rows)assert.deepEqual(result.toys.find(t=>t.stable_id===row.stable_id),row,`${row.stable_id} must remain untouched`);}
const art=JSON.parse(fs.readFileSync(path.join(root,'apps/admin/src/generated/shop-art.json'),'utf8')).categories.couple_dolls;
assert.equal(art.length,33);
for(const [i,name] of ['Racing Ace','Rockstar','Skater Boy','Y2K Idol'].entries()){
 const toy=result.toys[i+29];assert.equal(toy.stable_id,`burrow_art_couple_dolls_${30+i}`);
 assert.equal(toy.title,name);assert.equal(toy.price,300);assert.equal(toy.plus_only,false);assert.equal(toy.status,'active');
 assert.equal(toy.metadata.artOrdinal,30+i);assert.equal(toy.metadata.slot,'couple_doll');
 assert.equal(art[i+29].name,name);assert.equal(toy.asset.file,`burrow-webp/room decoration/interative toys on dresser/${name}.webp`);
}
console.log(JSON.stringify({migration:239,activeToys:33,refreshedExistingArt:29,newToys:4,newPrice:300,existingProductsUnchanged:!!before,productionUserWrites:0}));
if(process.argv.includes('--admin-art')){
 const run=promisify(execFile),origin='https://novame-monorepo-admin.vercel.app';let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<art.length){const item=art[next++];
  const {stdout}=await run('curl',['--silent','--show-error','--fail','--connect-timeout','10','--max-time','25','--retry','1',origin+item.url],{encoding:'buffer',maxBuffer:4*1024*1024});
  assert.equal(item.url,`/shop-art/${createHash('sha256').update(stdout).digest('hex').slice(0,24)}.webp`);
 }}));
 console.log(JSON.stringify({admin:origin,byteIdenticalLiveToyPreviews:33}));
}
