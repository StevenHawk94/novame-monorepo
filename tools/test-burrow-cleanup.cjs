const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const actor='00000000-0000-0000-0000-000000000001';
const path=`${actor}/00000000-0000-0000-0000-000000000002.jpg`;
async function cleanup(options={}) {
  const removed=[],acked=[];let rpcCalls=0;
  const helper=await import('../apps/api/src/lib/burrow-photo.mjs');
  const db={rpc:async name=>{assert.equal(name,'collect_room_photo_garbage_v1');rpcCalls++;return {data:options.paths??[path],error:options.queryError};},
    storage:{from:bucket=>{assert.equal(bucket,'burrow-room-photos');return {remove:async keys=>{removed.push(keys);return {error:options.storageError};}};}},
    from:table=>{assert.equal(table,'room_photo_garbage');return {delete:()=>({eq:async(key,value)=>{assert.equal(key,'private_path');acked.push(value);return {error:options.ackError};}})};}};
  const route=load('apps/api/src/app/api/cron/room-photo-cleanup/route.js',{
    'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200,headers:config.headers})}},
    '@/lib/app-major-update':{appMajorUpdateServiceClient:()=>db},'@/lib/burrow-photo.mjs':helper,
  },{process:{env:{CRON_SECRET:options.noSecret?'':'secret'}}});
  return {removed,acked,rpcCalls:()=>rpcCalls,run:(authorized=true)=>route.GET(new Request('https://example.invalid',{headers:authorized?{authorization:'Bearer secret'}:{}}))};
}
test('room cleanup authenticates before collector and fails closed without configured secret',async()=>{
  for(const options of [{},{noSecret:true}]){const h=await cleanup(options);assert.equal((await h.run(!!options.noSecret)).status,401);assert.equal(h.rpcCalls(),0);}
});
test('cleanup uses exact immutable room bucket object and acknowledges after success',async()=>{
  const h=await cleanup();const r=await h.run();assert.equal(r.body.removed,1);assert.equal(r.headers['Cache-Control'],'no-store');
  assert.equal(h.removed[0][0],path);assert.equal(h.acked[0],path);
});
test('failed storage deletion never acknowledges, failed acknowledgement remains retryable',async()=>{
  const h=await cleanup({storageError:true});assert.equal((await h.run()).status,503);assert.equal(h.acked.length,0);
  const ack=await cleanup({ackError:true});assert.equal((await ack.run()).status,503);assert.equal((await ack.run()).status,503);
  assert.equal(ack.removed.length,2);assert.equal(ack.removed[1][0],path);
});
test('entire cleanup batch is validated before any deletion',async()=>{
  for(const bad of ['../other.jpg',`${actor}/`,`${actor}/../../secret.jpg`,'https://remote.invalid/photo',`${actor}/${'-'.repeat(36)}.jpg`,null]) {
    const h=await cleanup({paths:[path,bad]});assert.equal((await h.run()).status,503);assert.equal(h.removed.length,0);
  }
});
test('collector errors, oversized batches and nonarrays cannot reach storage',async()=>{
  for(const options of [{queryError:true},{paths:{}},{paths:Array(101).fill(path)}]) {
    const h=await cleanup(options);assert.equal((await h.run()).status,503);assert.equal(h.removed.length,0);
  }
  assert.equal((await (await cleanup({paths:[]})).run()).body.removed,0);
});

function rollup(options={}) {
  let queries=0,checks=0;
  const db={from:()=>{queries++;return {select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[]})})})})};}};
  const route=load('apps/api/src/app/api/cron/insights-rollup/route.js',{
    'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200})}},
    '@supabase/supabase-js':{createClient:()=>db},'@/lib/reflect-analysis-store':{mergeConnectionCandidatePayload(){throw Error('should not merge');}},
    '@/lib/app-major-update':{majorUpdateEnabled:async()=>{checks++;if(options.configError)throw Error('offline');return options.enabled!==false;}},
  },{process:{env:{CRON_SECRET:'secret'}}});
  return {queries:()=>queries,checks:()=>checks,run:(auth=true)=>route.GET(new Request('https://example.invalid',{headers:auth?{authorization:'Bearer secret'}:{}}))};
}
test('retired Insight rollup stops before reading or modifying candidate jobs',async()=>{
  const h=rollup();assert.equal((await h.run()).body.paused,true);assert.equal(h.queries(),0);
});
test('Insight rollup checks cron authentication first and configuration failure preserves queue',async()=>{
  const h=rollup();assert.equal((await h.run(false)).status,401);assert.equal(h.checks(),0);
  const failed=rollup({configError:true});assert.equal((await failed.run()).status,503);assert.equal(failed.queries(),0);
});
test('legacy mode continues to read pending Insight candidates',async()=>{
  const h=rollup({enabled:false});assert.equal((await h.run()).body.applied,0);assert.equal(h.queries(),1);
});

for(const file of ['court/route.js','court/[sessionId]/route.js'])for(const method of ['GET','POST']) {
  test(`Court ${file} ${method} authenticates before rollout guard; new mode has no side effects`,async()=>{
    for(const mode of ['unauthorized','enabled','config-error','legacy']) {
      let touched=0,checks=0;
      const route=load(`apps/api/src/app/api/${file}`,{
        'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200})},after(){touched++;}},
        '@/lib/auth-guard':{verifyToken:async()=>mode==='unauthorized'?null:{id:'actor'}},
        '@/lib/app-major-update':{majorUpdateEnabled:async()=>{checks++;if(mode==='config-error')throw Error('config');return mode==='enabled';}},
        '@/lib/push-notifications':{drainPushNotificationOutbox(){touched++;}},
        '@/lib/bunny-court':{courtServiceClient:()=>({from:()=>{touched++;throw Error('legacy-reached');}}),loadPair:async()=>{touched++;throw Error('legacy-reached');}},
      },{URL,console:{error(){},warn(){}}});
      const result=await route[method](new Request('https://example.invalid?userId=actor',{method,...(method==='POST'?{body:JSON.stringify({userId:'actor',caseId:'case'})}:{})}),{params:Promise.resolve({sessionId:'session'})});
      assert.equal(result.status,mode==='unauthorized'?401:mode==='enabled'?410:500);
      assert.equal(touched,mode==='legacy'?1:0);if(mode==='unauthorized')assert.equal(checks,0);
    }
  });
}
test('Court cron pauses before expiring sessions or claiming jobs and preserves auth order',async()=>{
  for(const mode of ['unauthorized','enabled','config-error']) {
    let touched=0,checks=0;
    const route=load('apps/api/src/app/api/cron/bunny-court/route.js',{
      'next/server':{NextResponse:{json:(body,config={})=>({body,status:config.status??200})}},
      '@/lib/app-major-update':{majorUpdateEnabled:async()=>{checks++;if(mode==='config-error')throw Error('config');return true;}},
      '@/lib/bunny-court':{courtServiceClient:()=>({from:()=>{touched++;throw Error('unexpected');}})},
    },{process:{env:{CRON_SECRET:'secret'}}});
    const result=await route.GET(new Request('https://example.invalid',{headers:mode==='unauthorized'?{}:{authorization:'Bearer secret'}}));
    assert.equal(result.status,mode==='unauthorized'?401:mode==='config-error'?503:200);assert.equal(touched,0);
    if(mode==='unauthorized')assert.equal(checks,0);else if(mode==='enabled')assert.equal(result.body.paused,true);
  }
});
test('direct Court worker recovery fails closed before claiming work or invoking AI',async()=>{
  for(const failure of [false,true]) {
    let touched=0;
    const api=load('apps/api/src/lib/bunny-court.js',{
      '@supabase/supabase-js':{},'./ai':{},'./ai-usage':{},'./push-notifications':{},
      './bunny-court-rules-v2.mjs':{},'./bunny-court-rules-v3.mjs':{},'./bunny-court-rules-v4.mjs':{},'./user-local-date':{},
      './app-major-update':{majorUpdateEnabled:async()=>{if(failure)throw Error('config');return true;}},
    });
    const run=()=>api.processCourtVerdictJob({from(){touched++;throw Error('unexpected');}},'session');
    if(failure)await assert.rejects(run,/config/);else assert.equal(await run(),null);assert.equal(touched,0);
  }
});

test('push delivery excludes paused Court before limit, retaining ordinary partner notifications',async()=>{
  for(const enabled of [true,false]) {
    const queries=[],writes=[];
    const db={from:table=>{
      const q={table,ops:[],patch:null};queries.push(q);
      for(const method of ['select','eq','in','lt','lte','order','limit','not','maybeSingle'])q[method]=(...args)=>{q.ops.push([method,...args]);return q;};
      q.update=patch=>{q.patch=patch;writes.push(q);return q;};
      q.then=(resolve,reject)=>Promise.resolve().then(()=>{
        if(table==='device_push_tokens')return {data:[]};
        if(q.patch)return {data:q.patch.status==='sending'?{id:'claimed'}:null};
        const rows=[{id:'court',event_type:'court_ready'},{id:'partner',event_type:'partner_reflect'}];
        return {data:q.ops.some(x=>x[0]==='not')?rows.filter(x=>x.id==='partner'):rows};
      }).then(resolve,reject);
      return q;
    }};
    const api=load('apps/api/src/lib/push-notifications.js',{'./app-major-update':{majorUpdateEnabled:async()=>enabled}});
    const result=await api.drainPushNotificationOutbox(db);
    assert.equal(result.processed,enabled?1:2);
    const pending=queries.find(q=>!q.patch&&q.table==='notification_outbox');
    if(enabled){assert.ok(pending.ops.findIndex(x=>x[0]==='not')<pending.ops.findIndex(x=>x[0]==='limit'));
      assert.equal(writes.some(q=>q.ops.some(x=>x[0]==='eq'&&x[2]==='court')),false);
      assert.ok(writes[0].ops.some(x=>x[0]==='not'));
    }else assert.equal(pending.ops.some(x=>x[0]==='not'),false);
    assert.ok(writes.some(q=>q.ops.some(x=>x[0]==='eq'&&x[2]==='partner')));
  }
});
test('push configuration failure touches no queue rows and sends nothing',async()=>{
  let touched=0;
  const api=load('apps/api/src/lib/push-notifications.js',{'./app-major-update':{majorUpdateEnabled:async()=>{throw Error('config');}}});
  await assert.rejects(()=>api.drainPushNotificationOutbox({from(){touched++;}}),/config/);assert.equal(touched,0);
});
