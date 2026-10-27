const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
for(const platform of ['ios','android'])test(`${platform}: retired library stays idle; gift and announcement downloads survive pause/resume and cache reuse`,async()=>{
 const cached=new Set(),downloads=[];
 const ensure=async url=>{downloads.push(url);cached.add(url);return 'file://'+url;};
 const api=load('apps/mobile/src/lib/download-queue.ts',{
  'react-native':{Platform:{OS:platform},AppState:{currentState:'active'},InteractionManager:{runAfterInteractions:fn=>{fn();return{cancel(){}};}}},
  'expo-image':{Image:{getCachePathAsync:async url=>cached.has(url)?'file://'+url:null,prefetch:async url=>Boolean(await ensure(url))}},
  './outfits':{getCachedOutfitVideoUri:async()=>null,ensureOutfitVideoCached:async()=>{throw Error('retired outfit requested');}},
  './base-item-icons':{isBaseItemIconUrl:()=>false},
  './android-r2-file-cache':{isAndroidR2FileCached:async url=>cached.has(url),getAndroidR2CachedUri:url=>cached.has(url)?'file://'+url:null,ensureAndroidR2FileCached:ensure},
 });
 api.startDownloadQueue();api.markAndroidP0UiReady();api.stageLatestManifest();api.stageRemoteItemImages();
 await new Promise(setImmediate);assert.deepEqual(downloads,[]);
 const gift='https://media.novameapp.com/burrow/adventure-gifts/v1/current.webp';
 assert.equal(await api.ensurePriorityR2Image(gift,-1),'file://'+gift);
 assert.equal(await api.ensurePriorityR2Image(gift,-1),'file://'+gift);assert.equal(downloads.length,1);
 api.pauseDownloadQueue();const announcement='https://media.novameapp.com/Announcements/current.png';
 const pending=api.ensurePriorityR2Image(announcement,-200);await new Promise(setImmediate);assert.equal(downloads.length,1);
 api.resumeDownloadQueue();assert.equal(await pending,'file://'+announcement);
 assert.deepEqual(downloads,[gift,announcement]);api.resetDownloadQueue();
});
test('old diary art remains blank without removing metadata or the local Tap bundle',()=>{
 const base=load('apps/mobile/src/lib/base-item-icons.ts');assert.equal(base.baseItemIconUrl('memory.0002_coffee'),'');
 const manifest={items:[{itemId:'memory.0002_coffee',iconName:'Coffee',category:'food',imageKey:'Items/old.webp'}]};
 const remote=load('apps/mobile/src/lib/remote-items.ts',{'@novame/engine':{ITEM_DISPLAY_CATALOG:{}},'./item-manifest-cache':{getCachedRemoteItemManifest:()=>manifest}});
 assert.equal(remote.remoteImageUri('memory.0002_coffee'),'');assert.equal(remote.itemDisplayName('memory.0002_coffee'),'Coffee');
 assert.equal(JSON.parse(fs.readFileSync('apps/mobile/src/lib/bundled-item-ids.json')).itemIds.length,386);
});
test('retired probe is network-free and deletion is exact-key/backup/ETag guarded',async()=>{
 const probe=load('apps/mobile/src/lib/content-version.ts',{}, {fetch(){throw Error('obsolete probe');}});await probe.checkContentVersionInBackground();
 const tool=fs.readFileSync('tools/retired-r2-assets.mjs','utf8');
 assert.match(tool,/assert\.ok\(retiredKeys\.has\(x.key\)/);
 assert.match(tool,/assert\.equal\(hash\(bytes\),saved.sha256\)/);
 assert.match(tool,/DeleteObjectCommand\(\{Bucket,Key:x.key,IfMatch:x.etag\}\)/);
 assert.match(tool,/assert\.deepEqual\(remaining.get\(x.key\),x\)/);
});
