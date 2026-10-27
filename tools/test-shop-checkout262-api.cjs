const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const release=require('../catalog/generated/shop-catalog-release.json'),wall=release.products.find(p=>p.category==='wallpapers'&&p.status==='active'&&p.seed.price>0);
const plain=x=>JSON.parse(JSON.stringify(x));
function harness(response={data:{total:150,checkoutId:'key',applied:true}},personal=true){const calls=[],wallet=[];
 const service=load('apps/api/src/lib/app-major-update.js',{'@supabase/supabase-js':{},'@/lib/auth-guard':{}});
 const route=load('apps/api/src/app/api/vnext/command/route.js',{
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
  '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,user,data)=>{wallet.push(user);return data;}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:service.commandStatus,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args:plain(args)});return response;}})},
 });return{calls,wallet,post:body=>route.POST(new Request('https://example.test/api/vnext/command',{
  method:'POST',headers:{'x-burrow-catalog':release.release,...(personal?{'x-burrow-rooms':'personal-v2'}:{})},body:JSON.stringify(body)}))};}
const delta={action:'purchase_room_changes',slots:{wallpaper:wall.id},idempotencyKey:'key',partnerId:B,pairVersion:'a'.repeat(32),
 expectedPrices:{[wall.id]:150},expectedTotal:150};
test('delta binds authenticated user, original scope and exact changed quotes; wallet receipt included',async()=>{
 const h=harness();assert.equal((await h.post({...delta,ownerId:B})).status,200);
 assert.equal(h.calls[0].name,'purchase_personal_room_changes_v1');assert.equal(h.calls[0].args.p_user_id,A);
 assert.deepEqual(h.calls[0].args.p_changes,{wallpaper:wall.id});assert.equal(h.calls[0].args.p_partner_id,undefined);
 assert.equal(h.calls[0].args.p_catalog_release,release.release);assert.deepEqual(h.wallet,[A]);
});
test('invalid scope, quote, total and empty delta never reach transaction',async()=>{
 const h=harness();for(const patch of [{partnerId:'bad'},{pairVersion:null},{expectedTotal:-1},{expectedTotal:1.1},
  {expectedPrices:{}},{expectedPrices:{[wall.id]:'150'}},{slots:{}},{slots:[]},{outfitItemId:{}}])
  assert.equal((await h.post({...delta,...patch})).status,400,JSON.stringify(patch));
 assert.equal(h.calls.length,0);
});
test('installed old clients remain on legacy protocol, never implicitly activating the personal writer',async()=>{
 const h=harness(undefined,false);assert.equal((await h.post(delta)).status,200);
 assert.equal(h.calls[0].name,'purchase_room_changes_v1');assert.equal(h.calls[0].args.p_partner_id,B);
});
test('retired full-room checkout never reaches a shared writer, even with new capability',async()=>{
 const h=harness();assert.equal((await h.post({action:'purchase_room_loadout',slots:{wallpaper:wall.id,
  decor:'decor_leaf_frame_01',shelf_decor:'burrow_art_shelf_decor_01'},idempotencyKey:'old',expectedPrices:{[wall.id]:150,decor_leaf_frame_01:0,burrow_art_shelf_decor_01:0}})).status,426);
 assert.equal(h.calls.length,0);
});
test('scoped single purchases keep original recipient and price; missing migration stays retryable without fallback',async()=>{
 const h=harness();assert.equal((await h.post({action:'purchase_catalog_item',scoped:true,itemId:wall.id,recipientId:B,
  expectedPrice:150,idempotencyKey:'gift',partnerId:B,pairVersion:'a'.repeat(32)})).status,200);
 assert.equal(h.calls[0].name,'purchase_catalog_item_scoped_v1');assert.equal(h.calls[0].args.p_recipient_id,B);
 const unavailable=harness({error:{code:'PGRST202'}}),reply=await unavailable.post(delta);
 assert.equal(reply.status,503);assert.equal(reply.body.error,'checkout_unavailable');assert.equal(unavailable.calls.length,1);
});
