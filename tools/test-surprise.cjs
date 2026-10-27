const {test}=require('node:test');const assert=require('node:assert/strict');const {webcrypto}=require('node:crypto');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',KEY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const box=(name,...chunks)=>{const content=Buffer.concat(chunks),header=Buffer.alloc(8);header.writeUInt32BE(content.length+8);header.write(name,4);return Buffer.concat([header,content]);};
function audioFile(ms=12000,handler='soun'){
 const mvhd=Buffer.alloc(24);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(ms,16);
 const hdlr=Buffer.alloc(16);hdlr.write(handler,8);
 return Buffer.concat([box('ftyp',Buffer.from('M4A \x00\x00\x00\x00M4A ')),box('moov',box('mvhd',mvhd),box('trak',box('mdia',box('hdlr',hdlr)))),box('mdat',Buffer.alloc(32))]);
}
const photo=Buffer.from([255,216,255,192,0,11,8,2,0,2,0,1,1,17,0,255,218,0,8,1,1,0,0,63,0,42,255,217]).toString('base64');
const body={action:'send',partnerId:B,pairVersion:'a'.repeat(32),key:KEY,frame:'santa',durationMs:12000,photo,audio:audioFile().toString('base64')};
const retired=['bunny','flower','star','halloween','valentine','new_year','good_morning','sweet_dreams','kiss_you','cuddle_time','thank_you','movie_night','dinner_date','you_got_this','proud_of_you','feel_better','welcome_home','autumn_pumpkin','birthday_cake'];
test('every current frame accepts the same valid media; retired frames are rejected',async()=>{
 const {SURPRISE_FRAMES,decodeSurprise}=await import('../apps/api/src/lib/burrow-surprise.mjs');
 assert.equal(SURPRISE_FRAMES.length,36);
 for(const frame of SURPRISE_FRAMES)assert.equal(decodeSurprise({...body,frame}).durationMs,12000,frame);
 for(const frame of retired)assert.throws(()=>decodeSurprise({...body,frame}),/invalid_request/,frame);
});
test('all nineteen retired IDs fail before upload, reservation, or spending',async()=>{
 for(const frame of retired){const h=await harness();assert.equal((await h.post({frame})).status,400,frame);assert.equal(h.uploads.length,0);assert.equal(h.calls.some(call=>call.name==='prepare_burrow_surprise_v2'||call.name==='complete_burrow_surprise_v1'),false);}
});
async function harness(options={}){
 const helper=await import('../apps/api/src/lib/burrow-surprise.mjs');const calls=[],uploads=[],signed=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});if(name==='check_rate_limit')return {data:{allowed:options.allowed!==false}};
  if(options.denied)return {data:{error:'not_found'}};
  if(name==='pay_burrow_surprise_v1')return {data:{id:KEY,paid:true}};
  if(name==='cancel_paid_burrow_surprise_v1')return {data:{cancelled:true,refunded:true}};
  if(name==='prepare_burrow_surprise_v2')return {data:{id:KEY,photoPath:`${A}/${KEY}/face.jpg`,audioPath:`${A}/${KEY}/voice.m4a`,committed:options.committed}};
  if(name==='complete_burrow_surprise_v1')return {data:{id:KEY,applied:!options.committed}};
  if(name==='burrow_surprise_send_status_v1')return {data:{committed:!!options.committed,paid:!!options.paid,...(options.committed?{id:KEY,sentAt:'2026-10-17T00:00:00Z'}:{})}};
  return {data:args.p_id?{photoPath:'face',audioPath:'voice'}:{items:[]}};
 },storage:{from:bucket=>{assert.equal(bucket,'burrow-surprises');return{upload:async(...args)=>{uploads.push(args);return{error:options.uploadError};},createSignedUrl:async(...args)=>{signed.push(args);return {data:{signedUrl:'private-link'}};}};}}};
 const route=load('apps/api/src/app/api/vnext/surprise/route.js',{
  'next/server':{NextResponse:{json:(body,{status=200}={})=>({body,status})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>options.unauthorized?null:A,appMajorUpdateServiceClient:()=>db,majorUpdateEnabled:async()=>options.enabled!==false},
  '@/lib/burrow-reward-wallet.mjs':{readRewardWallet:async()=>({wallet:{balance:700,version:1},credits:[]})},
  '@/lib/burrow-photo.mjs':await import('../apps/api/src/lib/burrow-photo.mjs'),
  '@/lib/burrow-surprise.mjs':helper,
 },{crypto:webcrypto,TextEncoder,URL});
 return {calls,uploads,signed,post:(patch={})=>route.POST(new Request('https://test/api/vnext/surprise',{method:'POST',body:JSON.stringify({...body,...patch})})),get:(id='')=>route.GET(new Request(`https://test/api/vnext/surprise${id?`?id=${id}`:''}`)),query:query=>route.GET(new Request(`https://test/api/vnext/surprise?${query}`))};
}
test('AAC parser checks real container duration, audio track and bounded boxes',async()=>{const {decodeSurprise}=await import('../apps/api/src/lib/burrow-surprise.mjs');assert.equal(decodeSurprise(body).durationMs,12000);for(const audio of [audioFile(61000),audioFile(12000,'vide'),Buffer.alloc(100),audioFile().subarray(0,35)])assert.throws(()=>decodeSurprise({...body,audio:audio.toString('base64')}));assert.equal(decodeSurprise({...body,durationMs:20000}).durationMs,12000);});
test('send stages immutable media, uploads both files then commits; wallet returned as a versioned snapshot',async()=>{const h=await harness();const result=await h.post();assert.equal(result.status,200);assert.equal(h.uploads.length,2);assert.equal(h.uploads[0][2].upsert,false);assert.equal(h.uploads[1][2].contentType,'audio/mp4');assert.equal(h.calls.at(-1).name,'complete_burrow_surprise_v1');assert.equal(result.body.wallet.balance,700);assert.deepEqual(result.body.coinState.wallet,result.body.wallet);});
test('committed retry skips uploading; storage failure cannot invoke charge',async()=>{const done=await harness({committed:true});assert.equal((await done.post()).status,200);assert.equal(done.uploads.length,0);const failed=await harness({uploadError:{statusCode:503}});assert.equal((await failed.post()).status,503);assert.equal(failed.calls.some(call=>call.name==='complete_burrow_surprise_v1'),false);});
test('invalid upload, unauthorized, feature-off and rate limits fail before media or charge',async()=>{for(const patch of [{frame:'custom'},{key:'bad'},{photo:'bad'},{durationMs:60001}]){const h=await harness();assert.equal((await h.post(patch)).status,400);assert.equal(h.uploads.length,0);}for(const [options,status] of [[{unauthorized:true},401],[{enabled:false},403],[{allowed:false},429]]){const h=await harness(options);assert.equal((await h.post()).status,status);assert.equal(h.uploads.length,0);}});
test('private signed links require authorized RPC; listing does not sign or download files',async()=>{const h=await harness();await h.get();assert.equal(h.signed.length,0);await h.get(KEY);assert.equal(h.signed.length,2);assert.equal(h.signed[0][1],300);const denied=await harness({denied:true});assert.equal((await denied.get(KEY)).status,404);assert.equal(denied.signed.length,0);});
test('open request only acknowledges after explicit playback, never recharges',async()=>{const h=await harness();assert.equal((await h.post({action:'open',id:KEY})).status,200);assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_open,true);assert.equal(h.uploads.length,0);});
test('new payment accepts metadata only, returns a wallet receipt and never uploads or publishes media',async()=>{
 const h=await harness();const result=await h.post({action:'pay',photo:undefined,audio:undefined,digest:'b'.repeat(64),expectedPrice:300});
 assert.equal(result.status,200);assert.equal(result.body.paid,true);assert.equal(result.body.wallet.balance,700);assert.equal(h.uploads.length,0);
 assert.equal(h.calls.at(-1).name,'pay_burrow_surprise_v1');assert.equal(h.calls.some(x=>x.name==='complete_burrow_surprise_v1'),false);
 const bad=await harness();assert.equal((await bad.post({action:'pay',digest:'b'.repeat(64),expectedPrice:300})).status,400);assert.equal(bad.calls.length,0);
});
test('paid delivery rejects unpaid tickets before upload and accepts a verified paid order with bounded native duration rounding',async()=>{
 const unpaid=await harness();assert.equal((await unpaid.post({action:'deliver_paid',expectedPrice:300})).status,400);assert.equal(unpaid.uploads.length,0);
 const paid=await harness({paid:true});assert.equal((await paid.post({action:'deliver_paid',expectedPrice:300,durationMs:11999})).status,200);assert.equal(paid.uploads.length,2);
 const mismatch=await harness({paid:true});assert.equal((await mismatch.post({action:'deliver_paid',expectedPrice:300,durationMs:9000})).status,400);assert.equal(mismatch.uploads.length,0);
});
test('paid cancellation remains authenticated and cannot upload, publish or charge another send',async()=>{
 const h=await harness();const result=await h.post({action:'cancel_paid'});assert.equal(result.status,200);assert.equal(result.body.refunded,true);assert.equal(h.calls[0].name,'cancel_paid_burrow_surprise_v1');assert.equal(h.uploads.length,0);
 const denied=await harness({unauthorized:true});assert.equal((await denied.post({action:'pay',photo:undefined,audio:undefined,digest:'b'.repeat(64),expectedPrice:300})).status,401);assert.equal(denied.calls.length,0);
});
test('photo crop maps the exact live viewport opening to square pixels for portrait and landscape',()=>{const {surpriseFaceCrop}=load('apps/mobile/src/lib/surprise-photo-geometry.ts');for(const [w,h] of [[400,600],[600,400],[512,512]]){const crop=surpriseFaceCrop(w,h,300);assert.equal(crop.width,crop.height);assert.equal(crop.width,Math.min(w,h)*.42);assert.ok(Math.abs(crop.originX+crop.width/2-w/2)<1e-7);assert.ok(Math.abs(crop.originY+crop.height/2-(h/2+Math.min(w,h)*.08))<1e-7);}assert.throws(()=>surpriseFaceCrop(400,400,300,1,{x:500,y:0}));});
test('inbox ignores stale account/pair responses and deduplicates simultaneous refreshes',async()=>{const hooksHarness=hooks(),first=deferred(),second=deferred();let identity,epoch=1,calls=0;
 const store=load('apps/mobile/src/lib/surprise-inbox.ts',{'react':hooksHarness.react,'./surprise-history-cache':{rememberSurprises(){},rememberSurpriseOpened(){}},'./surprise-api':{listSurprises:()=>++calls===1?first.promise:second.promise},'./session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}}});
 const a=store.refreshSurpriseInbox('A');assert.equal(a,store.refreshSurpriseInbox('A'));epoch++;identity();const b=store.refreshSurpriseInbox('B');first.resolve({items:[{id:'old'}]});await a;second.resolve({items:[{id:'new'}]});await b;
 hooksHarness.react.useSyncExternalStore=(_sub,get)=>get();assert.equal(store.useSurpriseInbox()[0].id,'new');
});
test('a delivery broadcast during an older inbox request discards it and immediately refetches the new message',async()=>{
 const h=hooks(),first=deferred(),second=deferred();let calls=0;h.react.useSyncExternalStore=(_sub,get)=>get();
 const store=load('apps/mobile/src/lib/surprise-inbox.ts',{react:h.react,'./surprise-history-cache':{rememberSurprises(){},rememberSurpriseOpened(){}},'./surprise-api':{listSurprises:()=>++calls===1?first.promise:second.promise},'./session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity(){}}});
 const unsubscribe=store.subscribeSurpriseRefresh(()=>void store.refreshSurpriseInbox('pair'));
 const pending=store.refreshSurpriseInbox('pair');store.notifySurpriseChanged();assert.equal(calls,1);
 first.resolve({items:[{id:'old'}]});await pending;assert.equal(calls,2);assert.equal(store.useSurpriseInbox().length,0);
 second.resolve({items:[{id:'new'}]});await new Promise(setImmediate);assert.equal(store.useSurpriseInbox()[0].id,'new');unsubscribe();
});
test('receipt GET verifies the exact current pair/key before returning wallet, never uploads or charges',async()=>{
 for(const committed of [false,true]){
  const h=await harness({committed}),result=await h.query(`key=${KEY}&partnerId=${B}&pairVersion=${'a'.repeat(32)}`);
  assert.equal(result.status,200);assert.equal(result.body.committed,committed);assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'burrow_surprise_send_status_v1');
  assert.equal(h.calls[0].args.p_user,A);assert.equal(h.calls[0].args.p_partner,B);assert.equal(h.uploads.length,0);assert.equal(h.signed.length,0);assert.equal(!!result.body.wallet,committed);
 }
 const h=await harness();for(const query of [`key=${KEY}`,`key=bad&partnerId=${B}&pairVersion=${'a'.repeat(32)}`,`id=${KEY}&key=${KEY}&partnerId=${B}&pairVersion=${'a'.repeat(32)}`])assert.equal((await h.query(query)).status,400);
 assert.equal(h.calls.length,0);
});

test('arrival thumbnail signs only the face, never the private voice, and requires authorization',async()=>{
 const h=await harness();assert.equal((await h.query(`id=${KEY}&photoOnly=1`)).body.audioUrl,undefined);
 assert.deepEqual(h.signed.map(call=>call[0]),['face']);
 const denied=await harness({denied:true});assert.equal((await denied.query(`id=${KEY}&photoOnly=1`)).status,404);assert.equal(denied.signed.length,0);
});
test('history API validates direction and paired cursors without ever signing media',async()=>{
 const h=await harness();assert.equal((await h.query('history=received')).status,200);assert.equal(h.calls.at(-1).name,'burrow_surprise_history_v1');assert.equal(h.signed.length,0);
 for(const query of ['history=all','history=sent&before=2026-10-08T12:00:00Z','history=sent&before=bad&beforeId='+KEY,'history=sent&id='+KEY])assert.equal((await h.query(query)).status,400);
 assert.equal((await h.query(`history=sent&before=2026-10-08T12:00:00Z&beforeId=${KEY}`)).status,200);assert.equal(h.calls.at(-1).args.p_before_id,KEY);
});
test('all twenty cutouts map the tall camera viewport to correctly sized, non-stretched photos',()=>{
 const {surpriseFaceCrop}=load('apps/mobile/src/lib/surprise-photo-geometry.ts');
 const holes=require('../apps/mobile/src/lib/surprise-frame-geometry.json');
 for(const [frame,{bounds,path}] of Object.entries(holes)){
  const normalized=bounds.map(value=>value/512),crop=surpriseFaceCrop(1200,2000,390,1,{x:0,y:0},normalized,844,115);
  const scale=Math.max(390/1200,844/2000);
  assert.ok(Math.abs(crop.width/crop.height-bounds[2]/bounds[3])<1e-8,frame);
  const left=(390-1200*scale)/2,top=(844-2000*scale)/2;
  assert.ok(Math.abs(left+crop.originX*scale-normalized[0]*390)<1e-7,frame);
  assert.ok(Math.abs(top+crop.originY*scale-(115+normalized[1]*390))<1e-7,frame);
  assert.ok(path.startsWith('M')&&path.endsWith('Z'));
 }
});
test('Surprise rectangular face crops are accepted without loosening room/toy photo ratios',async()=>{
 const helper=await import('../apps/api/src/lib/burrow-surprise.mjs'),room=await import('../apps/api/src/lib/burrow-photo.mjs');
 const rectangle=Buffer.from(body.photo,'base64');rectangle.writeUInt16BE(480,7);
 const encoded=rectangle.toString('base64');assert.ok(helper.decodeSurprise({...body,frame:'ghost',photo:encoded}).photo);
 assert.throws(()=>room.decodeRoomPhoto(encoded));
 rectangle.writeUInt16BE(150,7);assert.throws(()=>helper.decodeSurprise({...body,photo:rectangle.toString('base64')}));
});
