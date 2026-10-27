const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const lib='apps/mobile/src/lib/';
test('each room resolves only its requested owner, never a shared or lower-ID fallback',()=>{
 const {roomSlots}=load(lib+'burrow-presentation.ts',{'@novame/engine':{}});
 const item=id=>({stable_id:id,item_type:'decor',category:'lamps',status:'active',metadata:{slot:'lamp'}});
 const data={profile:{id:'A'},partner:{id:'B'},catalog:[item('a'),item('b'),item('shared')],adventureCollection:{displays:[]},
  loadouts:[{room_type:'home',owner_id:'A',slot:'lamp',item_id:'a'},{room_type:'home',owner_id:'B',slot:'lamp',item_id:'b'},
   {room_type:'our',owner_id:null,slot:'lamp',item_id:'shared'}]};
 assert.equal(roomSlots(data,'A').lamp.stable_id,'a');assert.equal(roomSlots(data,'B').lamp.stable_id,'b');
});
test('purchase journal is a registered user resource, not a raw unowned storage key',()=>{
 const source=fs.readFileSync(lib+'burrow-store.ts','utf8'),keys=fs.readFileSync('apps/mobile/src/shared/storage/keys.ts','utf8');
 assert.match(keys,/kShopPurchases\s*=\s*defineKey\('burrow\.shop-purchases\.v1',\s*'user'/);
 assert.doesNotMatch(source,/storage\.(?:set|getString)\('burrow\.shop-purchases\.v1'/);
});
test('token acquisition cannot move an old intent into a new identity',async()=>{
 const auth=deferred(),calls=[];let identity='A';
 const {ApiClient}=load('packages/api-client/src/index.ts',{'./error':{ApiError:class extends Error{}}},{FormData,
  fetch:async(...args)=>{calls.push(args);return{ok:true,text:async()=>'{"success":true}'};}});
 const client=new ApiClient({baseUrl:'https://invalid.local',getToken:()=>auth.promise,getRequestContext:()=>({key:identity,actorId:identity})});
 const request=client.post('/command',{action:'select_room_music'});identity='B';auth.resolve('B-token');
 await assert.rejects(request,/session_changed/);assert.equal(calls.length,0);
});
test('late response bytes from the previous identity cannot reach the new account',async()=>{
 const body=deferred();let identity='A';
 const {ApiClient}=load('packages/api-client/src/index.ts',{'./error':{ApiError:class extends Error{}}},{FormData,
  fetch:async()=>({ok:true,text:()=>body.promise})});
 const client=new ApiClient({baseUrl:'https://invalid.local',getToken:async()=> 'token-A',getRequestContext:()=>({key:identity,actorId:identity})});
 const request=client.get('/bootstrap');await flush();identity='B';body.resolve('{"private":"A"}');await assert.rejects(request,/session_changed/);
});
test('the server rejects an intent actor which differs from verified JWT identity',async()=>{
 const {authenticatedUserId}=load('apps/api/src/lib/app-major-update.js',{'@supabase/supabase-js':{},'@/lib/auth-guard':{verifyToken:async()=>({id:'A'})}});
 const request=actor=>({headers:new Headers({authorization:'Bearer token-A',...(actor?{'x-burrow-actor':actor}:{})})});
 assert.equal(await authenticatedUserId(request('B')),null);assert.equal(await authenticatedUserId(request('A')),'A');assert.equal(await authenticatedUserId(request()),'A');
});
test('one failing identity observer cannot prevent every other domain from clearing private state',()=>{
 const session=load(lib+'session-lifecycle.ts');let resets=0;
 session.subscribeSessionIdentity(()=>{throw Error('observer');});session.subscribeSessionIdentity(()=>resets++);
 session.observeSessionIdentity('A');session.observeSessionIdentity('B');assert.equal(resets,2);assert.equal(session.sessionUserId(),'B');
});
test('a committed receipt retries local application, never the monetary request or rejection',async()=>{
 const time=clock(),{createCoinOperationQueue}=load(lib+'coin-operation-queue.ts');let sends=0,applies=0,rejected=0;
 const queue=createCoinOperationQueue({owner:()=> 'A',active:()=>true,load:()=>[],save(){},project(){},
  send:async()=>{sends++;return{success:true};},confirm(){if(++applies===1)throw Error('observer_failed');},reject(){rejected++;},
  definitive:()=>true,schedule:(f,ms)=>time.globals.setTimeout(f,ms),cancel:id=>time.globals.clearTimeout(id)});
 const result=queue.enqueue({id:'one',owner:'A',path:'/api/vnext/command',payload:{action:'claim_daily_quest'},key:'one',amount:10,deferred:false});
 result.catch(()=>{});await flush();assert.equal(queue.pending().length,1);assert.equal(rejected,0);
 time.advance(2000);await flush();await result;assert.equal(sends,1);assert.equal(applies,2);assert.equal(rejected,0);assert.equal(queue.pending().length,0);
});
