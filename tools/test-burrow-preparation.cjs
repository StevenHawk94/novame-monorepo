const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
function images(){
 const calls=[],reads=[];
 const api=load('apps/mobile/src/lib/prepared-burrow-images.ts',{
  'react-native':{Image:{resolveAssetSource:id=>({uri:'file:///'+id})}},
  './metro-asset-uri':{normalizeMetroAssetUri:x=>x},
  'expo-image':{Image:{loadAsync:(source,options)=>{const read=deferred();calls.push({source,options});reads.push(read);return read.promise;}}},
 });return{api,calls,reads,done(i){reads[i].resolve({width:128,height:128,scale:1,id:i});}};
}
test('native image preparation coalesces, reuses the exact native ref and upgrades rather than shrinking',async()=>{
 const h=images(),a=h.api.prepareBurrowImage(1,512),b=h.api.prepareBurrowImage(1,256);
 assert.equal(h.calls.length,1);h.done(0);const image=await a;assert.equal(await b,image);
 assert.equal(h.api.preparedBurrowImage(1),image);assert.equal(await h.api.prepareBurrowImage(1,512),image);
 const large=h.api.prepareBurrowImage(1,1200);assert.equal(h.calls.length,2);h.done(1);const upgraded=await large;
 assert.equal(await h.api.prepareBurrowImage(1,128),upgraded);assert.equal(h.calls.length,2);
});
test('failed decode is retryable and batch decode never starts more than two jobs at once',async()=>{
 const h=images(),bad=h.api.prepareBurrowImage(1);h.reads[0].reject(Error('bad bytes'));await assert.rejects(bad);
 const retry=h.api.prepareBurrowImage(1);h.done(1);await retry;
 const batch=h.api.prepareBurrowImages([2,3,4,4],256);assert.equal(h.calls.length,4);
 h.done(2);await flush();assert.equal(h.calls.length,5);h.done(3);h.done(4);await batch;
});
test('LRU remains bounded while Home and the incoming page stay resident',async()=>{
 const h=images();h.api.retainHomeImages([1]);h.api.retainPageImages([2]);
 for(let n=1;n<=80;n++){const work=h.api.prepareBurrowImage(n,100);h.done(h.reads.length-1);await work;}
 assert.ok(h.api.preparedBurrowImage(1));assert.ok(h.api.preparedBurrowImage(2));assert.equal(h.api.preparedBurrowImage(3),undefined);assert.ok(h.api.preparedBurrowImage(80));
});
test('both Home/map periods stay decoded through unrelated page thumbnail eviction',async()=>{
 const h=images();h.api.retainEnvironmentImages([1,2,3,4,5]);h.api.retainHomeImages([6]);h.api.retainPageImages([7]);
 for(let n=1;n<=90;n++){const work=h.api.prepareBurrowImage(n,100);h.done(h.reads.length-1);await work;}
 for(let n=1;n<=7;n++)assert.ok(h.api.preparedBurrowImage(n));
 assert.equal(h.api.preparedBurrowImage(8),undefined);
});
test('onboarding Home preparation includes both local periods and cannot resolve before environment preparation',async()=>{
 const environment=deferred(),calls=[],pins=[],floor={source:1},background={source:2,nightSource:3};
 const api=load('apps/mobile/src/lib/home-art-preparation.ts',{
  'react-native':{Platform:{OS:'web'},TurboModuleRegistry:{get:()=>null}},
  './burrow-art-assets':{HOME_BACKGROUND_FLOOR:floor,BURROW_FIXED_ART:{letter:{source:4}},burrowArtFor:()=>background,burrowArtForItem:()=>null},
  './burrow-home-layout':{HOME_ART_PLACEMENTS:[]},'./burrow-presentation':{roomSlots:()=>({couple_doll:{stable_id:'visible-toy'}})},
  './burrow-map-model':{burrowMapEnvironment:()=>({season:'autumn'})},'./use-burrow-storefront':{countryForVisit:()=> 'US'},
  './burrow-outfit-assets':{OUTFIT_LAYERS:{default:{}},outfitKey:()=> 'default'},
  './prepared-burrow-images':{prepareBurrowImages:async s=>calls.push([...s]),preparedBurrowImage:()=>({}),preparedImageKey:String,retainHomeImages:s=>pins.push([...s])},
  './burrow-room-photo-cache':{loadRoomPhoto:async photo=>{calls.push('photo:'+photo.id);return 'file:///'+photo.id;}},'./coin-ui-asset':{COIN_UI_ASSET:5},
  './burrow-environment-state':{prepareBurrowEnvironment:context=>{calls.push(context);return environment.promise;},refreshBurrowEnvironment:async()=>calls.push('final-local-check')},
 });
 const data={profile:{id:'A',timezone_name:'UTC'},roomPhotos:[{id:'frame',ownerId:'A',kind:'frame'},
  {id:'visible',ownerId:'A',kind:'doll',toyId:'visible-toy'},
  {id:'unused',ownerId:'A',kind:'doll',toyId:'unused-toy'},
  {id:'private',ownerId:'B',kind:'frame'}]};let complete=false;
 const first=api.prepareHomeArt(data).then(()=>{complete=true;});const cached=api.prepareHomeArt(data);
 await flush();assert.equal(complete,false);assert.equal(api.isHomeArtPrepared(data),false);assert.equal(calls.length,2);
 environment.resolve();await first;await cached;
 assert.deepEqual(calls[2],[1,2,3,4,5]);assert.ok(calls.includes('final-local-check'));
 assert.ok(pins.at(-1).includes(3));
 assert.equal(api.isHomeArtPrepared(data),true,'returning Home can choose prepared new art in its first render');
 assert.ok(calls.includes('photo:visible'));assert.ok(calls.includes('photo:frame'));
 assert.ok(!calls.includes('photo:unused'));assert.ok(!calls.includes('photo:private'));
});
test('foreground warmup is staggered, scope-fenced and cancelled before unseen jobs start',async()=>{
 const jobs=[],calls=[];let data={catalogComplete:true,profile:{id:'A'},partner:null},epoch=1,state='active';
 const api=load('apps/mobile/src/lib/burrow-foreground-prewarm.ts',{
  'react-native':{AppState:{get currentState(){return state;}}},'./burrow-store':{getBurrowSnapshot:()=>({data})},
  './session-lifecycle':{sessionEpoch:()=>epoch},'./ui-idle':{stageForegroundJobs:next=>{jobs.push(...next);return()=>jobs.splice(0);}},
  './burrow-page-entry':{warmBurrowGameOverview:async()=>calls.push('game-data')},
  './release-room-api':{releaseRoomScope:d=>d.profile.id,fetchReleaseRoom:async()=>calls.push('release-data')},
  './burrow-page-art':{warmBurrowPageArt:async kind=>calls.push(kind)},
 });
 const cancel=api.prewarmBurrowPages();assert.equal(jobs.length,6);assert.ok(jobs[0].delayMs<jobs[5].delayMs);
 jobs[0].run();jobs[1].run();jobs[2].run();jobs[3].run();assert.deepEqual(calls,['affection','adventure','shop','game-data','game']);
 state='background';jobs[4].run();assert.equal(calls.length,5);
 state='active';epoch++;jobs[5].run();assert.equal(calls.length,5);cancel();assert.equal(jobs.length,0);
});
test('prewarm follows actual Shop thumbnails and every visible Game category without removed Latest previews',async()=>{
 const calls=[],resident=new Set();
 const api=load('apps/mobile/src/lib/burrow-page-art.ts',{
  'react-native':{Dimensions:{get:()=>({width:390,height:400})}},
  './game-room-layout':load('apps/mobile/src/lib/game-room-layout.ts'),
  './burrow-art-assets':{BURROW_BACKGROUNDS:{common:100},burrowArtForItem:item=>({source:item.source,thumbnail:item.thumb})},
  './burrow-collection-options':{decorationOptions:(items,category)=>items.filter(item=>item.category===category)},
  './burrow-shop-categories':load('apps/mobile/src/lib/burrow-shop-categories.ts'),
  './prepared-burrow-images':{retainPageImages(){},preparedImageKey:String,preparedBurrowImage:source=>resident.has(source)?{}:undefined,
    prepareBurrowImages:async sources=>{calls.push(Array.from(sources));sources.forEach(source=>resident.add(source));}},
  './burrow-game-room-content':{GAME_ROOM_CATEGORIES:['A','B','C'],GAME_ROOM_GAMES:[{id:'first',category:'A'},{id:'second',category:'B'},{id:'last',category:'C'}],gameRailItems:games=>games.filter(game=>game.active)},
  './burrow-game-room-art':{gameRoomBackground:200,gameRoomIcons:{first:202,second:203,last:204}},
  './burrow-ui-assets':{BURROW_GAME_RULE_ICONS:[205,206,207]},
  '../../assets/burrow-webp/game room/waiting-page.webp':208,
 });
 const data={catalog:[{category:'wallpapers',source:1,thumb:2},{category:'outfits',source:4,thumb:5},{category:'cushions',source:3},...['first','second','last'].map(id=>({stable_id:'game:'+id}))]};
 await api.warmBurrowPageArt('shop',data);assert.deepEqual(calls[0],[100,5,2]);
 await api.warmBurrowPageArt('game',data);assert.deepEqual(calls[1],[202,203,204,205,206,207,208]);
 assert.equal(api.burrowPageArtReady('shop',data),true);resident.delete(5);assert.equal(api.burrowPageArtReady('shop',data),false);
 await api.warmBurrowPageArt('shop',data);assert.equal(api.burrowPageArtReady('shop',data),true);
});
test('a complete Home survives a year without opening another owner or promoting partial catalogues',()=>{
 const time=clock(),disk=new Map(),api=load('apps/mobile/src/lib/burrow-cache.ts',{
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},
  '../shared/storage/keys':{kBurrowSnapshot:{name:'snapshot'},kBurrowWallet:{name:'wallet'},kBurrowActionKeys:{name:'actions'}},
 },time.globals);
 const value={pairAccessVerified:true,catalogComplete:true,profile:{id:'A'},roomPhotos:[],memoryEntries:[],moments:[],catalog:[],inventory:[],loadouts:[]};
 api.persistBurrowSnapshot(value);time.advance(365*86400000);assert.equal(api.readBurrowSnapshot('A').data.catalogComplete,true);
 assert.equal(api.readBurrowSnapshot('A').data.pairAccessVerified,undefined);
 assert.equal(api.readBurrowSnapshot('B'),null);delete value.catalogComplete;api.persistBurrowSnapshot(value);assert.equal(api.readBurrowSnapshot('A').data.catalogComplete,undefined);
});
test('onboarding prepares actual Home resources, and the actual renderer reuses native refs',()=>{
 const read=path=>fs.readFileSync('apps/mobile/'+path,'utf8');
 assert.match(read('app/(onboarding)/index.tsx'),/prepareHomeArt/);
 assert.match(read('src/components/burrow/burrow-image.tsx'),/preparedBurrowImage\(props.source\)/);
 assert.match(read('src/components/burrow/outfit-bunny-native.tsx'),/return prepareBunny\(outfit,variant\)/);
 assert.match(read('src/components/burrow/burrow-screen.tsx'),/setPreparedHome\(homeDesign\)/);
 assert.doesNotMatch(read('src/lib/burrow-cache.ts'),/MAX_CACHE_AGE/);
});
