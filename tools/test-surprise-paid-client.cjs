const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const draft={userId:'u',partnerId:'p',pairVersion:'a'.repeat(32),key:'key',frame:'santa',photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000,expectedPrice:300,deliveryVersion:1};
function harness(options={}){
 const calls=[];let epoch=1;
 const api=load('apps/mobile/src/lib/surprise-api.ts',{
  'expo-file-system/legacy':{getInfoAsync:async()=>({exists:!options.missing}),readAsStringAsync:async uri=>{calls.push('local:'+uri);return uri==='face.jpg'?'PHOTO':'AUDIO';},EncodingType:{Base64:'base64'}},
  'expo-crypto':{randomUUID:()=>'',CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_,s)=>createHash('sha256').update(s).digest('hex')},
  './api':{apiClient:{post:async(path,body)=>{calls.push(body);return options.pay?options.pay():{id:'paid',wallet:{balance:700,version:2}};}}},
  './async-lifecycle':{withDeadline:p=>p},'./storage':{},'@/shared/storage/keys':{},'@/shared/storage/artifacts':{},
  './session-lifecycle':{sessionEpoch:()=>epoch},'./coin-reward-store':{},'./surprise-history-cache':{},'./surprise-media-cache':{},
 });
 const transport=async body=>{calls.push(body);return{id:'paid'};};
 return{calls,send:(d=draft,paid=false)=>api.sendSurprise(d,transport,r=>calls.push({paid:r.id}),paid),switchAccount:()=>epoch++};
}
test('all media remains local until pay confirms; only metadata/digest is submitted first, then the immutable media body uploads',async()=>{
 const wait=deferred(),h=harness({pay:()=>wait.promise}),task=h.send();await flush();
 const request=h.calls.find(x=>x?.action==='pay');assert.ok(request);assert.equal(request.photo,undefined);assert.equal(request.audio,undefined);assert.equal(request.expectedPrice,300);
 assert.equal(request.digest,createHash('sha256').update(JSON.stringify(['santa',12000,'PHOTO','AUDIO'])).digest('hex'));
 assert.equal(h.calls.some(x=>x?.action==='deliver_paid'),false);
 wait.resolve({id:'paid'});await task;assert.deepEqual(h.calls.at(-2),{paid:'paid'});assert.equal(h.calls.at(-1).action,'deliver_paid');assert.equal(h.calls.at(-1).photo,'PHOTO');
});
test('payment rejection or ambiguous timeout never begins a media upload',async()=>{
 for(const error of [{status:409,body:{error:'insufficient_balance'}},Error('timeout')]){
  const h=harness({pay:async()=>{throw error;}});await assert.rejects(h.send());assert.equal(h.calls.some(x=>x?.action==='deliver_paid'),false);
 }
});
test('switching account while paying prevents upload and prevents publishing its receipt',async()=>{
 const wait=deferred(),h=harness({pay:()=>wait.promise}),task=h.send();await flush();h.switchAccount();wait.resolve({id:'paid'});
 await assert.rejects(task,/session_changed/);assert.equal(h.calls.some(x=>x?.action==='deliver_paid'||x?.paid),false);
});
test('legacy queued jobs keep the old single-upload protocol without a second payment step',async()=>{
 const h=harness();await h.send({...draft,deliveryVersion:undefined});assert.equal(h.calls.some(x=>x?.action==='pay'),false);assert.equal(h.calls.at(-1).action,'send');
});
test('receipt-confirmed paid retries skip another payment request; missing durable files reject before any network upload',async()=>{
 const h=harness();await h.send(draft,true);assert.equal(h.calls.some(x=>x?.action==='pay'),false);assert.equal(h.calls.at(-1).action,'deliver_paid');
 const missing=harness({missing:true});await assert.rejects(missing.send(),e=>e.status===400&&e.body.reason==='local_media_missing');assert.equal(missing.calls.length,0);
});
