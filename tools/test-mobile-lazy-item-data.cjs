const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {load}=require('./lifecycle-test-utils.cjs');
const persons=load('packages/engine/src/items/tap-person-items.ts').TAP_PERSON_ITEMS;
const display=load('packages/engine/src/items/display-catalog.ts',{
 './tap-your-day-display.json': require('../packages/engine/src/items/tap-your-day-display.json'), './display-catalog.json':require('../packages/engine/src/items/display-catalog.json'),'./tap-person-items':{TAP_PERSON_ITEMS:persons},
}).ITEM_DISPLAY_CATALOG;
test('retired vocabulary and its loaders are absent; historical IDs remain',()=>{
 execFileSync(process.execPath,['tools/build-mobile-item-data.cjs','--check']);
 assert.equal(Object.keys(display).length,5651);
 for(const file of ['apps/mobile/assets/data/legacy-item-matching.dict','apps/mobile/src/lib/legacy-item-dictionary.ts',
 'apps/mobile/src/lib/item-rule-cache.ts','packages/engine/src/items/item-matcher.ts','packages/engine/src/items/dictionary.json'])
  assert.equal(fs.existsSync(file),false,file);
 for(const entry of ['index.ts','mobile.ts']) {
  const source=fs.readFileSync('packages/engine/src/'+entry,'utf8');
  assert.doesNotMatch(source,/item-matcher|item-rules|ITEM_DICTIONARY/);
 }
});
test('actual native import graph excludes the full JSON dictionary and keeps native headless tasks',()=>{
 const scan=JSON.parse(execFileSync(process.execPath,['tools/audit-runtime-reachability.cjs'],{encoding:'utf8'}));
 assert.ok(!scan.apps.mobile.largestReachableData.some(row=>row.file.endsWith('/dictionary.json')));
 assert.ok(scan.apps.mobile.largestReachableData.some(row=>row.file.endsWith('/display-catalog.json')));
 assert.ok(!scan.apps.mobile.candidates.some(row=>row.file.endsWith('background-widget-refresh.ts')));
 assert.equal(scan.unresolved.length,0);
});
test('display-only consumers retain history/remote overrides without requesting matching data',()=>{
 let current=null,refreshes=0;
 const remote=load('apps/mobile/src/lib/remote-items.ts',{
  '@novame/engine':{ITEM_DISPLAY_CATALOG:display},
  './item-manifest-cache':{getCachedRemoteItemManifest:()=>current,remoteItemAssetUrl:key=>key},
 });
 const first=remote.mergedItemDictionary();assert.equal(first.items['memory.0002_coffee'].displayName,'Coffee');assert.equal(refreshes,0);
 assert.equal(remote.mergedItemDictionary(),first,'stable cache, no full index clone per tile');
 current={items:[{itemId:'memory.0002_coffee',iconName:'Reviewed coffee',category:'Food',rarity:'rare',emoji:'☕',bagsCategory:'Food & Fun',imageKey:'new.webp'}]};
 const next=remote.mergedItemDictionary();assert.notEqual(next,first);assert.equal(next.items['memory.0002_coffee'].displayName,'Reviewed coffee');
 assert.equal(remote.itemDisplayName('memory.0002_coffee'),'Reviewed coffee');assert.equal(remote.itemBagsCategory('memory.0002_coffee'),'Food & Fun');
 assert.equal(first.items['memory.0002_coffee'].displayName,'Coffee','old display object stays immutable');
 assert.equal(remote.mergedItemDictionary(),next);assert.equal(refreshes,0);
});
