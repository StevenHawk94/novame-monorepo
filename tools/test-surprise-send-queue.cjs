const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',PAIR='a'.repeat(32),KEY='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const draft={userId:A,partnerId:B,pairVersion:PAIR,key:KEY,frame:'santa',photoUri:'private/face.jpg',audioUri:'private/voice.m4a',durationMs:2000,locked:true,expectedPrice:300};
function harness(options={}){
 const timer=clock(),disk=options.disk??new Map(),h=hooks();let user=A,epoch=1,identity,active='active';
 const sends=[],lookups=[],released=[],wallets=[],remembered=[],writes=[],holds=[],settlements=[],rejections=[],cancellations=[];
 h.react.useSyncExternalStore=(_subscribe,get)=>get();
 const transport=async()=>{};
 const api=load('apps/mobile/src/lib/surprise-send-queue.ts',{
  react:h.react,'react-native':{AppState:{get currentState(){return active;}}},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'@/shared/storage/keys':{kSurpriseOutbox:{name:'outbox'}},
  './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>user,subscribeSessionIdentity:fn=>{identity=fn;}},
  './api':{apiClient:{get:async path=>{lookups.push(path);return options.status?options.status():{committed:false};},post:async(_path,body)=>{cancellations.push(body);return options.cancel?options.cancel():{cancelled:true,refunded:false};}}},
  './surprise-api':{sendSurprise:async(d,t,paid)=>{assert.equal(t,transport);sends.push(d);if(options.paid)paid(options.paid);return options.send?options.send(d):{id:ID};},saveSurpriseDraft:d=>writes.push(d),readSurpriseDraft:()=>options.latestDraft??draft,releaseSurpriseFile:async path=>released.push(path)},
  './surprise-send-transport':{uploadSurpriseInBackground:transport,clearConfirmedSurpriseUploads:async()=>{}},
  './surprise-history-cache':{rememberSurprises:(_s,rows)=>remembered.push(...rows)},
  './surprise-media-cache':{keepSentSurpriseMedia:async()=>{if(options.archive)await options.archive();}},
  './coin-reward-store':{syncCoinWallet:wallet=>wallets.push(wallet),projectCoinSpend:(...args)=>holds.push(args),settleCoinSpend:(...args)=>settlements.push(args),rejectCoinSpend:key=>rejections.push(key)},
  './async-lifecycle':{withDeadline:p=>p},'./surprise-inbox':{notifySurpriseChanged(){}},
  'expo-crypto':{randomUUID:()=> 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},'./surprise-preparation':{prepareSurprise:async()=>{}},
 },timer.globals);
 api.setSurpriseDeliveryContext({userId:A,partnerId:B,pairVersion:PAIR,verified:options.verified!==false});
 return {...api,timer,disk,sends,lookups,released,wallets,remembered,writes,holds,settlements,rejections,cancellations,read:()=>api.useSurpriseOutbox(),
  account:next=>{user=next;epoch++;identity();},background:()=>{active='background';}};
}
test('intent is durable immediately, duplicate taps enqueue once and no work runs inline',async()=>{
 const pending=deferred(),q=harness({send:()=>pending.promise});q.enqueueSurprise(draft);q.enqueueSurprise(draft);
 assert.equal(q.read().length,1);assert.equal(q.sends.length,0);assert.match(q.disk.get('outbox'),/cccccccc/);
 q.timer.advance(250);await flush();assert.equal(q.sends.length,1);assert.equal(q.released.length,0);
 pending.resolve({id:ID});await flush();assert.equal(q.read()[0].state,'sent');assert.deepEqual(q.released,[draft.photoUri,draft.audioUri]);
});
test('a lost acknowledgement recovers the original receipt after restart without re-upload or second debit',async()=>{
 const disk=new Map([['outbox',JSON.stringify([{draft,queuedAt:1,state:'sending'}])]]);
 const q=harness({disk,status:()=>({committed:true,id:ID,wallet:{balance:700,version:2}})});
 await q.resumeSurpriseOutbox();assert.equal(q.sends.length,0);assert.equal(q.read()[0].sentId,ID);assert.equal(q.wallets.length,1);
 assert.match(q.lookups[0],/partnerId=/);assert.match(q.lookups[0],/pairVersion=/);
});
test('ambiguous failure backs off then queries a receipt before attempting another upload',async()=>{
 let committed=false;const q=harness({status:()=>committed?{committed:true,id:ID}:{committed:false},send:async()=>{committed=true;throw Error('network_timeout');}});
 q.enqueueSurprise(draft);q.timer.advance(250);await flush();assert.equal(q.read()[0].state,'queued');assert.equal(q.sends.length,1);
 q.timer.advance(2000);await flush();assert.equal(q.read()[0].state,'sent');assert.equal(q.sends.length,1);
});
test('a definite media rejection stays visible with its reason and never auto-retries or spends',async()=>{
 const q=harness({send:async()=>{throw{status:400,body:{error:'invalid_request',reason:'audio_too_short'}};}});
 q.enqueueSurprise(draft);q.timer.advance(250);await flush();const job=q.read()[0];assert.equal(job.state,'failed');assert.match(q.surpriseSendFailure(job),/one full second/);
 q.timer.advance(60000);await flush();assert.equal(q.sends.length,1);assert.equal(q.wallets.length,0);assert.equal(q.released.length,0);
});
test('only explicit send rejection can unlock a revised draft; uncertain receipts and conflicts keep the same identity',async()=>{
 const q=harness({send:async()=>{throw{status:400,body:{error:'invalid_request',reason:'audio_too_short'}};}});
 q.enqueueSurprise(draft);q.timer.advance(250);await flush();assert.equal(q.canEditRejectedSurprise(q.read()[0]),true);
 const revised=q.reviseRejectedSurprise(KEY);assert.notEqual(revised.key,KEY);assert.equal(revised.locked,false);assert.equal(revised.expectedPrice,undefined);
 assert.equal(revised.photoUri,draft.photoUri);assert.equal(q.released.length,0);assert.equal(q.read().length,0);
 for(const row of [{state:'queued',error:'network_timeout'},{state:'failed',error:'idempotency_conflict',failureStage:'send'},{state:'failed',error:'invalid_request',failureStage:'receipt'}])assert.equal(q.canEditRejectedSurprise(row),false);
});
test('known-price confirmation stays frozen; creating a new draft cannot overwrite pending job media or receipt',async()=>{
 const pending=deferred(),newDraft={...draft,key:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',photoUri:'private/second.jpg'};
 const q=harness({latestDraft:newDraft,send:()=>pending.promise});q.enqueueSurprise(draft);q.timer.advance(250);await flush();
 q.enqueueSurprise(newDraft);assert.equal(q.read().length,2);assert.equal(q.read()[0].draft.photoUri,draft.photoUri);assert.equal(q.sends[0].expectedPrice,300);
 pending.resolve({id:ID});await flush();assert.equal(q.writes.some(x=>x.key===KEY),false);
});
test('disk-copy failure cannot hide a paid receipt or delete the sender originals',async()=>{
 const q=harness({archive:async()=>{throw Error('disk_full');}});q.enqueueSurprise(draft);q.timer.advance(250);await flush();
 assert.equal(q.read()[0].state,'sent');assert.equal(q.released.length,0);assert.equal(q.remembered.length,1);
});
test('cached pairing can accept local intent but network sending waits for fresh pairing verification',async()=>{
 const q=harness({verified:false});q.enqueueSurprise(draft);q.timer.advance(250);await flush();assert.equal(q.sends.length,0);
 q.setSurpriseDeliveryContext({userId:A,partnerId:B,pairVersion:PAIR,verified:true});await q.resumeSurpriseOutbox();assert.equal(q.sends.length,1);
});
test('late old-account receipts cannot write a new account wallet/history or mark its draft sent',async()=>{
 const pending=deferred(),q=harness({send:()=>pending.promise});q.enqueueSurprise(draft);q.timer.advance(250);await flush();q.account(B);
 pending.resolve({id:ID,wallet:{balance:700,version:2}});await flush();assert.equal(q.wallets.length,0);assert.equal(q.remembered.length,0);assert.equal(q.writes.length,0);
});
test('unpair retires old queued media and late results cannot surface in a new relationship',async()=>{
 const pending=deferred(),q=harness({send:()=>pending.promise});q.enqueueSurprise(draft);q.timer.advance(250);await flush();q.setSurpriseDeliveryContext(null);
 pending.resolve({id:ID});await flush();assert.equal(q.read().length,0);assert.equal(q.remembered.length,0);assert.deepEqual(q.released,[draft.photoUri,draft.audioUri]);
});
test('prepaid intent projects immediately only after disk persistence, without starting network work during the tap',()=>{
 const q=harness(),next={...draft,deliveryVersion:1};q.enqueueSurprise(next);assert.deepEqual(q.holds,[[`surprise-send:${KEY}`,300]]);assert.equal(q.lookups.length,0);assert.equal(q.sends.length,0);
 const broken=new Map();broken.set=()=>{throw Error('disk_full');};const failed=harness({disk:broken});assert.throws(()=>failed.enqueueSurprise(next),/disk_full/);assert.equal(failed.holds.length,0);
});
test('restart restores a pending hold and lost payment acknowledgement is reconciled before retrying delivery',async()=>{
 let sent=false;const next={...draft,deliveryVersion:1},disk=new Map([['outbox',JSON.stringify([{draft:next,queuedAt:1,state:'sending'}])]]);
 const q=harness({disk,status:()=>sent?{committed:true,id:ID,wallet:{balance:700,version:2}}:{committed:false,paid:true,wallet:{balance:700,version:2}},send:async()=>{sent=true;throw Error('offline');}});
 assert.equal(q.holds.length,1);await q.resumeSurpriseOutbox();assert.equal(q.read()[0].paid,true);assert.equal(q.settlements[0][1].balance,700);assert.equal(q.rejections.length,0);
 q.timer.advance(2000);await flush();assert.equal(q.read()[0].state,'sent');assert.equal(q.sends.length,1);assert.equal(q.cancellations.length,0);
});
test('definite rejection restores the projected debit only after server cancellation/refund is confirmed',async()=>{
 const q=harness({send:async()=>{throw{status:409,body:{error:'insufficient_balance'}};},cancel:()=>({cancelled:true,refunded:false,wallet:{balance:100,version:2}})});
 q.enqueueSurprise({...draft,deliveryVersion:1});q.timer.advance(250);await flush();assert.equal(q.read()[0].state,'failed');assert.equal(q.rejections.length,1);assert.equal(q.wallets[0].balance,100);
 assert.deepEqual(JSON.parse(JSON.stringify(q.cancellations)),[{action:'cancel_paid',key:KEY}]);assert.equal(q.released.length,0);
});
test('uncertain cancellation retains immutable intent and retries instead of unlocking potentially paid media',async()=>{
 const q=harness({send:async()=>{throw{status:400,body:{error:'invalid_request'}};},cancel:async()=>{throw Error('offline');}});
 q.enqueueSurprise({...draft,deliveryVersion:1});q.timer.advance(250);await flush();assert.equal(q.read()[0].state,'queued');assert.equal(q.rejections.length,0);assert.equal(q.canEditRejectedSurprise(q.read()[0]),false);assert.equal(q.released.length,0);
});
test('a cancellation racing with a delivered receipt marks sent without looping or refunding the committed gift',async()=>{
 const q=harness({send:async()=>{throw{status:409,body:{error:'pair_changed'}};},cancel:()=>({committed:true,id:ID,sentAt:'2026-10-22T00:00:00Z',wallet:{balance:700,version:2}})});
 q.enqueueSurprise({...draft,deliveryVersion:1});q.timer.advance(250);await flush();assert.equal(q.read()[0].state,'sent');assert.equal(q.sends.length,1);assert.equal(q.cancellations.length,1);assert.equal(q.rejections.length,0);
});
