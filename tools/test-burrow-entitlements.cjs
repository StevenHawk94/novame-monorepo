const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const catalog=require('../apps/api/src/data/burrow-game-room-v1.json');
test('Admin price/Plus overlays cannot rewrite bundled game content',()=>{
 const content=load('apps/mobile/src/lib/burrow-game-room-content.ts',{'../../../api/src/data/burrow-game-room-v1.json':catalog});
 const g=catalog.games[0],state=content.localGameOverview({products:{[g.id]:{price:420,plus_only:true,active:true}}});
 assert.equal(state.games[0].price,420);assert.equal(state.games[0].plus_only,true);
 assert.equal(state.games[1].active,false);assert.equal(content.localGameSession({gameId:g.id}).questions,g.questions);
});
test('Plus face remains editable after first and second save; each room/Doll has an independent quota',()=>{
 const {toyPhotoChangedToday}=load('apps/mobile/src/lib/burrow-toy-photos.ts');
 const data={profile:{id:'me'},localDate:'2026-10-13',dollPhotoChangesUsed:['toy'],photoUsage:{localDate:'2026-10-13',doll:{limit:3,targets:[{ownerId:'me',toyId:'toy',used:1}]}}};
 assert.equal(toyPhotoChangedToday(data,'toy'),false);data.photoUsage.doll.targets[0].used=2;assert.equal(toyPhotoChangedToday(data,'toy'),false);
 data.photoUsage.doll.targets[0].used=3;assert.equal(toyPhotoChangedToday(data,'toy'),true);
 assert.equal(toyPhotoChangedToday(data,'other'),false);assert.equal(toyPhotoChangedToday(data,'toy','partner'),false);
 data.photoUsage.doll.limit=1;assert.equal(toyPhotoChangedToday(data,'toy'),true);
});
function historyRoute({authorized=true,denied=false}={}){
 const calls=[],signed=[];
 const route=load('apps/api/src/app/api/vnext/room-photo/route.js',{
  'next/server':{NextResponse:{json:(body,init)=>({body,status:init.status})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>authorized?'actor':null,majorUpdateEnabled:async()=>true,commandStatus:()=>400,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:denied?{error:'invalid_request'}:{hasPlus:false,nextCursor:null,items:[{id:'history',created_at:'2026-10-13',private_path:'authorized/path.jpg'}]}};},
    storage:{from:()=>({createSignedUrls:async(paths)=>{signed.push(...paths);return {data:paths.map(path=>({path,signedUrl:'signed-private-url'}))};}})}})},
  '@/lib/burrow-photo.mjs':{PHOTO_BUCKET:'private-photos',PHOTO_LINK_SECONDS:300,photoUUID:()=>true},
 },{URL});return {calls,signed,get:(query='')=>route.GET({url:'https://test/api/vnext/room-photo?mode=history'+query})};
}
test('History signs only JWT-authorized paths and never exposes private file keys',async()=>{
 const h=historyRoute(),result=await h.get('&owner=unrelated&path=evil');
 assert.equal(result.status,200);assert.equal(h.calls[0].args.p_user,'actor');assert.deepEqual(h.signed,['authorized/path.jpg']);
 assert.equal(result.body.items[0].url,'signed-private-url');assert.equal(JSON.stringify(result.body).includes('authorized/path'),false);
 const unsigned=historyRoute({authorized:false});assert.equal((await unsigned.get()).status,401);assert.equal(unsigned.calls.length,0);
 const denied=historyRoute({denied:true});assert.equal((await denied.get()).status,400);assert.equal(denied.signed.length,0);
});
test('History and shared Doll photo UI retain global edge navigation and use no disk archive',()=>{
 const history=fs.readFileSync('apps/mobile/app/(main)/frame-photo-history.tsx','utf8');
 assert.ok(history.includes('Photos older than 7 days are hidden. Join Plus to unlock unlimited photo history!'));
 assert.ok(history.includes('Free photos are permanently deleted after 30 days.'));assert.ok(history.includes('cachePolicy="memory"'));
 assert.ok(!history.includes('gestureEnabled'));assert.ok(!history.includes('FileSystem'));
 const sheet=fs.readFileSync('apps/mobile/src/components/burrow/photo-frame-sheet.tsx','utf8');assert.ok(sheet.includes('History'));assert.ok(!sheet.includes('Remove Photo'));
 const doll=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');assert.ok(!doll.includes("pickRoomPhoto('library')"));assert.ok(!doll.includes('onSaved={()=>setPhotoChangeUsed(true)}'));
});
test('Photo cleanup batches exact verified paths and leaves failed Storage deletion queued',async()=>{
 const valid='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
 for(const scenario of ['good','malformed','storage-failed']){
  let collected=0;const deletes=[],acks=[];
  const route=load('apps/api/src/app/api/cron/room-photo-cleanup/route.js',{
   'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
   '@/lib/burrow-photo.mjs':{PHOTO_BUCKET:'private',photoUUID:value=>/^[a-f0-9-]{36}$/.test(value)},
   '@/lib/app-major-update':{appMajorUpdateServiceClient:()=>({rpc:async()=>({data:collected++?[]:[scenario==='malformed'?'../arbitrary.jpg':valid]}),
    storage:{from:()=>({remove:async paths=>{deletes.push(paths);return {error:scenario==='storage-failed'?new Error('unavailable'):null};}})},
    from:()=>({delete:()=>({in:async(key,paths)=>{acks.push({key,paths});return {};}})})})},
  },{process:{env:{CRON_SECRET:'test'}}});
  const request={headers:{get:()=> 'Bearer test'}};
  assert.equal((await route.GET({headers:{get:()=>null}})).status,401);
  const result=await route.GET(request);
  if(scenario==='good'){assert.equal(result.body.removed,1);assert.deepEqual(deletes,[[valid]]);assert.equal(acks.length,1);}
  else{assert.equal(result.status,503);assert.equal(acks.length,0);if(scenario==='malformed')assert.equal(deletes.length,0);}
 }
});
