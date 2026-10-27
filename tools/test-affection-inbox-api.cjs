const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
test('batched Receive updates exact, deduplicated membership for authenticated recipient only',async()=>{
 const A='11111111-1111-4111-8111-111111111111',E='22222222-2222-4222-8222-222222222222',calls=[];
 const query={update:body=>{calls.push(['update',body]);return query;},eq:(...args)=>{calls.push(['eq',...args]);return query;},
  in:(...args)=>{calls.push(['in',...args]);return query;},is:(...args)=>{calls.push(['is',...args]);return query;},select:async()=>({data:[{id:E}]})};
 const route=load('apps/api/src/app/api/vnext/command/route.js',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
  '@/lib/adventure-bootstrap.mjs':{},'@/lib/burrow-reward-wallet.mjs':{},
  '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,appMajorUpdateServiceClient:()=>({from:table=>{assert.equal(table,'affection_events');return query;}})}});
 const result=await route.POST({text:async()=>JSON.stringify({action:'mark_affection_read',ids:[E,E,'invalid']})});
 assert.equal(result.body.success,true);assert.equal(result.body.updated,1);
 assert.deepEqual(Array.from(calls.find(c=>c[0]==='in')[2]),[E]);
 assert.deepEqual(calls.find(c=>c[0]==='eq'),['eq','recipient_id',A]);
 assert.deepEqual(calls.find(c=>c[0]==='is'),['is','read_at',null]);
});
