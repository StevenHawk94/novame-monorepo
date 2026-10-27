const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',G='22222222-2222-4222-8222-222222222222';
function harness(reply={data:{giftId:G,itemId:'lamp',applied:true}}){const calls=[];
 const route=load('apps/api/src/app/api/vnext/command/route.js',{
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},'@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,v)=>v},
  '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:e=>e?403:200,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return reply;}})},
 });return {calls,post:body=>route.POST({headers:{get:name=>name==='x-burrow-rooms'?'personal-v2':null},text:async()=>JSON.stringify(body)})};}
test('new atomic action binds recipient to auth and checks replace + pair version; legacy action stays compatible',async()=>{
 const h=harness();const payload={action:'claim_shop_gift',giftId:G,replace:true,pairVersion:'v1',recipientId:G};
 assert.equal((await h.post(payload)).status,200);assert.equal(h.calls[0].name,'claim_personal_shop_gift_v1');assert.equal(h.calls[0].args.p_recipient_id,A);
 assert.equal(h.calls[0].args.p_replace,true);assert.equal(h.calls[0].args.p_pair_version,'v1');
 for(const patch of [{replace:'yes'},{giftId:'bad'},{pairVersion:null}])assert.equal((await h.post({...payload,...patch})).status,400);
 assert.equal(h.calls.length,1);assert.equal((await h.post({action:'claim_gift',giftId:G})).status,200);assert.equal(h.calls[1].name,'claim_gift_v1');
});
test('rolling deployment missing RPC fails safely without claiming, replacing or charging through a fallback',async()=>{
 const h=harness({error:{code:'PGRST202'}}),result=await h.post({action:'claim_shop_gift',giftId:G,replace:false,pairVersion:'v1'});
 assert.equal(result.status,503);assert.equal(result.body.error,'gift_claim_unavailable');assert.equal(h.calls.length,1);
});
test('retired gift metadata is supplemented only for already authorized pending IDs, never re-listed for sale',async()=>{
 const {readShopGiftCatalog}=await import('../apps/api/src/lib/burrow-shop-gifts.mjs');const calls=[];
 const snapshot={partner:{id:'B'},catalog:[{stable_id:'listed'}],gifts:[{sender_id:'B',item_id:'retired'},
  {sender_id:'B',item_id:'retired'},{sender_id:'B',item_id:'listed'},{sender_id:'outsider',item_id:'private'}]};
 const db={from:name=>({select:columns=>({in:(field,ids)=>{calls.push({name,columns,field,ids});return Promise.resolve({data:[{stable_id:'retired',status:'retired'}]});}})})};
 const rows=await readShopGiftCatalog(db,snapshot);assert.deepEqual(calls[0].ids,['retired']);assert.equal(rows[0].status,'retired');
 assert.deepEqual(snapshot.catalog,[{stable_id:'listed'}]);
 assert.deepEqual(await readShopGiftCatalog(db,{catalog:[],gifts:[]}),[]);assert.equal(calls.length,1);
});
