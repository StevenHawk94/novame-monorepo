const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',path=`${A}/22222222-2222-4222-8222-222222222222.jpg`;
function harness({storageFailure=false,ackFailure=false,invalid=false}={}){
 const state={queued:[path],removed:[],acks:[],rpc:0,storageFailure,ackFailure};
 const db={rpc:async name=>{assert.equal(name,'collect_room_photo_garbage_v1');state.rpc++;return {data:invalid?[path,'../other-private-object']:state.queued.slice()};},
  storage:{from:bucket=>{assert.equal(bucket,'burrow-room-photos');return {remove:async paths=>{state.removed.push(paths);return state.storageFailure?{error:'offline'}:{};}};}},
  from:table=>{assert.equal(table,'room_photo_garbage');return {delete:()=>({in:async(column,paths)=>{assert.equal(column,'private_path');if(state.ackFailure)return {error:'offline'};state.acks.push(paths);state.queued=state.queued.filter(p=>!paths.includes(p));return {};}})};}};
 const route=load('apps/api/src/app/api/cron/room-photo-cleanup/route.js',{
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
  '@/lib/app-major-update':{appMajorUpdateServiceClient:()=>db},
  '@/lib/burrow-photo.mjs':{PHOTO_BUCKET:'burrow-room-photos',photoUUID:v=>/^[a-f0-9-]{36}$/.test(v)},
 },{process:{env:{CRON_SECRET:'fixture-only-secret'}}});
 return {state,run:(secret='fixture-only-secret')=>route.GET({headers:{get:()=>`Bearer ${secret}`}})};
}
test('photo cleanup is authenticated, scheduled every five minutes and only deletes acknowledged explicit private objects',async()=>{
 const cron=JSON.parse(fs.readFileSync('apps/api/vercel.json')).crons.find(c=>c.path==='/api/cron/room-photo-cleanup');assert.equal(cron.schedule,'*/5 * * * *');
 const h=harness();assert.equal((await h.run('wrong')).status,401);assert.equal(h.state.rpc,0);
 const result=await h.run();assert.equal(result.status,200);assert.equal(result.body.removed,1);assert.deepEqual(h.state.removed,[[path]]);assert.deepEqual(h.state.acks,[[path]]);assert.deepEqual(h.state.queued,[]);
});
test('failed Storage deletion leaves queued work and the next run retries the same path',async()=>{
 const h=harness({storageFailure:true});assert.equal((await h.run()).status,503);assert.deepEqual(h.state.queued,[path]);assert.deepEqual(h.state.acks,[]);
 h.state.storageFailure=false;assert.equal((await h.run()).status,200);assert.equal(h.state.removed.length,2);assert.deepEqual(h.state.queued,[]);
});
test('failed queue acknowledgement retains retry work; malformed batches cannot delete even their valid first path',async()=>{
 const h=harness({ackFailure:true});assert.equal((await h.run()).status,503);assert.deepEqual(h.state.queued,[path]);
 h.state.ackFailure=false;assert.equal((await h.run()).status,200);assert.deepEqual(h.state.queued,[]);
 const bad=harness({invalid:true});assert.equal((await bad.run()).status,503);assert.deepEqual(bad.state.removed,[]);assert.deepEqual(bad.state.acks,[]);
});
test('unlimited metadata suppresses stale daily hints without removing pending-crop protection',()=>{
 const editor=fs.readFileSync('apps/mobile/src/components/burrow/room-photo.tsx','utf8');assert.match(editor,/!data\.photoUsage\?\.doll\.unlimited && toyPhotoChangedToday/);
 const bootstrap=fs.readFileSync('apps/api/src/app/api/vnext/bootstrap/route.js','utf8');assert.match(bootstrap,/doll\?\.unlimited === true \? \{ dollChangeUsed: false, dollPhotoChangesUsed: \[\], dollPhotoChangeTargetsUsed: \[\]/);
 const history=fs.readFileSync('apps/mobile/app/(main)/frame-photo-history.tsx','utf8');assert.match(history,/except the current photo in your frame/);
});
