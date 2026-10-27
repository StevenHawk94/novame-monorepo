const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
const file='apps/mobile/src/lib/surprise-frame-assets.ts';
const frames=load(file,{}, {require:f=>path.resolve(path.dirname(file),f)}).SURPRISE_FRAME_OPTIONS;
const geometry=require('../apps/mobile/src/lib/surprise-frame-geometry.json');
const art=require('../apps/admin/src/generated/shop-art.json');
test('all 36 originals have filename-derived names, unique identities and exact Admin copies',()=>{
 const files=fs.readdirSync('apps/mobile/assets/burrow-webp/surprise-room').filter(f=>/^\d+_.+\.webp$/.test(f));
 assert.equal(frames.length,36);assert.equal(new Set(frames.map(f=>f.id)).size,36);
 assert.deepEqual(Array.from(frames,f=>path.basename(f.source)).sort(),files.sort());
 for(const frame of frames){
  assert.equal(frame.name,path.basename(frame.source).replace(/^\d+_/,'').replace(/\.webp$/,'').replaceAll('_',' '));
  const preview=art.categories.surprises.find(p=>p.frameId===frame.id);assert.equal(preview.name,frame.name);
  const bytes=fs.readFileSync(frame.source);assert.deepEqual(fs.readFileSync('apps/admin/public'+preview.url),bytes);
  assert.equal(preview.url,'/shop-art/'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.webp');
  const hole=geometry[frame.id];assert.ok(hole.path.startsWith('M')&&hole.path.endsWith('Z'));
  assert.ok(hole.bounds.every(n=>Number.isFinite(n)&&n>0&&n<512));
  assert.ok(hole.bounds[2]/hole.bounds[3]>.5&&hole.bounds[2]/hole.bounds[3]<2);
 }
 assert.equal(frames.filter(f=>f.name==='Birthday Cake').length,1);
 assert.equal(frames.find(f=>f.id==='christmas_wreath').name,'Christmas Wreath');
});
test('Admin resolves Surprise by immutable identity, not a coincidental ordinal',()=>{
 const {shopPreview}=load('apps/admin/src/lib/burrow-shop-pricing.js',{'../generated/shop-art.json':art});
 assert.equal(shopPreview({category:'surprises',metadata:{frameId:'christmas_wreath',artOrdinal:1}}).name,'Christmas Wreath');
 assert.equal(shopPreview({category:'surprises',stable_id:'surprise:pumpkin',metadata:{}}).name,'Pumpkin');
 assert.equal(shopPreview({category:'surprises',metadata:{frameId:'halloween',artOrdinal:1}}),null);
});
test('API and mobile new-send IDs exactly match all 36 current originals',async()=>{
 const {SURPRISE_FRAMES}=await import('../apps/api/src/lib/burrow-surprise.mjs');
 const client=fs.readFileSync('apps/mobile/src/lib/surprise-api.ts','utf8').match(/SURPRISE_FRAMES = (\[[^\n]+\]) as const/)[1];
 assert.deepEqual(JSON.parse(client.replaceAll("'",'"')),SURPRISE_FRAMES);
 assert.deepEqual(SURPRISE_FRAMES,Array.from(frames,frame=>frame.id));
});
test('retired assets and manifests are gone and regeneration cannot bring them back',()=>{
 for(const file of ['apps/mobile/assets/burrow-webp/surprise-room-legacy','apps/mobile/src/lib/surprise-frame-legacy.ts','apps/mobile/src/lib/surprise-frame-legacy-geometry.json'])assert.equal(fs.existsSync(file),false);
 for(const file of ['apps/mobile/src/components/burrow/surprise-art.tsx','tools/build-surprise-frames.cjs'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/surprise-room-legacy|surprise-frame-legacy|SURPRISE_LEGACY_FRAME_OPTIONS|LegacyPortrait/);
 const generator=fs.readFileSync('tools/build-surprise-frames.cjs','utf8');assert.match(generator,/require\('\.\/sync-shop-catalog\.cjs'\)/);
 assert.doesNotMatch(generator,/fs\.readdirSync|stable_id not in/,'filename discovery cannot reassign or retire permanent IDs');
});
