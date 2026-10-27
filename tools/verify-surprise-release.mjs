// Read-only production smoke check. No accounts, media, reservations or coins
// are created/changed. Deployed-source hashes are checked separately in Vercel.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {SURPRISE_FRAMES} from '../apps/api/src/lib/burrow-surprise.mjs';

const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error:console.error});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref=fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim();
assert.equal(new URL(url).hostname,`${ref}.supabase.co`,'Credentials must target the linked production project');
assert.equal(SURPRISE_FRAMES.length,36);
assert.equal(new Set(SURPRISE_FRAMES).size,36);
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const flag=await db.from('app_config').select('value').eq('key','app_major_update_enabled').single();
assert.ifError(flag.error);assert.ok(['true','1'].includes(flag.data.value));
const revision=await db.from('app_config').select('value').eq('key','app_major_update_content_revision').single();
assert.ifError(revision.error);assert.ok(revision.data.value);
const catalog=await db.from('catalog_items').select('stable_id,title,metadata')
  .eq('revision_id',revision.data.value).eq('item_type','surprise').eq('category','surprises').eq('status','active');
assert.ifError(catalog.error);
assert.deepEqual(catalog.data.map(row=>row.stable_id).sort(),SURPRISE_FRAMES.map(id=>`surprise:${id}`).sort());
const art=JSON.parse(fs.readFileSync(path.join(root,'apps/admin/src/generated/shop-art.json'),'utf8')).categories.surprises;
for(const row of catalog.data){
  const id=row.stable_id.slice('surprise:'.length);
  assert.equal(row.metadata.frameId,id);
  assert.equal(row.title,art.find(frame=>frame.frameId===id)?.name);
}
const api='https://api.soulsayit.com/api/vnext/surprise';
for(const method of ['GET','POST']){
  const response=await fetch(api,{method,signal:AbortSignal.timeout(20000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  assert.equal(response.status,401,`${method} must require authentication`);
  assert.equal((await response.json()).error,'Unauthorized');
  assert.match(response.headers.get('cache-control')??'',/no-store/);
}
console.log(JSON.stringify({api,linkedProjectVerified:true,rolloutEnabled:true,activeCatalogFrames:catalog.data.length,exactCurrentFrameSet:true,namesAndMetadataMatch:true,authenticationRequired:true,cache:'no-store',productionWrites:0}));
