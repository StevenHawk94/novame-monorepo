// Opt-in production acceptance using ONLY identities/media created by this run.
// Uses synthetic JPEG/AAC and ledger-backed test credit, never a store purchase.
// It does not read or mutate any existing user's account, balance or messages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodeSurprise,surpriseAudioDuration,SURPRISE_BUCKET} from '../apps/api/src/lib/burrow-surprise.mjs';
assert.ok(process.argv.includes('--fixtures'),'Explicit --fixtures required: creates and cleans this run’s temporary production test identities');
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error(){}});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'qleeohkhbrdvznbwgqad');
assert.equal(new URL(url).hostname,'qleeohkhbrdvznbwgqad.supabase.co');assert.ok(anon&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const origin='https://api.soulsayit.com',runId=randomUUID(),purpose='codex-surprise-243-production-acceptance';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const created=[],clients=[],counts=new Map(),waiters=new Set(),mediaCandidates=new Map();
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'novame-surprise-243-fixtures-'));
const report={origin,runId,checks:[],realUserWrites:0,storePurchases:0,temporaryIdentities:0,testSends:0,testDebits:0,mediaChecks:0,cleanup:{complete:false}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
function check(name){report.checks.push(name);console.log(JSON.stringify({passed:name}));}
async function api(route,user,{method='GET',body}={}){
 const response=await fetch(origin+route,{method,headers:{...(user?{Authorization:`Bearer ${user.token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 let data;try{data=await response.json();}catch{throw Error(`Non-JSON response on ${route.split('?')[0]} (${response.status})`);}
 return{status:response.status,data,cache:response.headers.get('cache-control')};
}
async function owned(user){
 assert.ok(created.includes(user));const auth=await db.auth.admin.getUserById(user.id);assert.ifError(auth.error);
 assert.equal(auth.data.user.app_metadata?.purpose,purpose);assert.equal(auth.data.user.app_metadata?.verificationRun,runId);
 assert.ok(auth.data.user.email.endsWith('@example.invalid'));
}
async function wallet(user){
 await owned(user);const result=await db.from('wallets').select('carrot_balance,version').eq('user_id',user.id).single();assert.ifError(result.error);
 const ledger=await db.from('currency_ledger').select('delta,reason,reference_type,reference_id,idempotency_key').eq('user_id',user.id).order('idempotency_key');assert.ifError(ledger.error);
 return{balance:result.data.carrot_balance,version:result.data.version,ledger:ledger.data};
}
async function history(user,direction){const result=await api(`/api/vnext/surprise?history=${direction}`,user);assert.equal(result.status,200,`history: ${result.data.error}`);assert.match(result.cache??'',/no-store/);return result.data.items;}
async function notificationAfter(before){
 const ready=()=>created.every(user=>(counts.get(user.id)??0)>(before.get(user.id)??0));
 if(ready()){assert.ok(!report.notificationPayloadUnexpected);return;}
 await new Promise((resolve,reject)=>{
  const done=()=>{if(ready()){clearTimeout(timer);waiters.delete(done);resolve();}};
  const timer=setTimeout(()=>{waiters.delete(done);reject(Error('Both private surprise notifications were not received'));},20000);waiters.add(done);
 });
 assert.ok(!report.notificationPayloadUnexpected,'Notifications must not disclose private media');
}
async function subscribe(user){
 const wsDir=fs.readdirSync(path.join(root,'node_modules/.pnpm')).filter(name=>name.startsWith('ws@8.')).sort().at(-1);
 const WebSocket=require(path.join(root,'node_modules/.pnpm',wsDir,'node_modules/ws'));
 const client=createClient(url,anon,{...options,realtime:{transport:WebSocket}});clients.push(client);
 await client.realtime.setAuth(user.token);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Private Surprise subscription timed out')),15000);
  client.channel(`burrow:${user.id}`,{config:{private:true}}).on('broadcast',{event:'surprise_changed'},event=>{
   report.notificationPayloadKeys=[...new Set([...(report.notificationPayloadKeys??[]),...Object.keys(event.payload??{})])];
   // Production Supabase realtime.send injects a random transport UUID into
   // otherwise-empty payloads. It is not a surprise/user/media identifier.
   if(Object.keys(event.payload??{}).some(key=>key!=='id'))report.notificationPayloadUnexpected=true;
   if(event.payload?.id&&!/^[a-f0-9-]{36}$/.test(event.payload.id))report.notificationPayloadUnexpected=true;
   counts.set(user.id,(counts.get(user.id)??0)+1);for(const done of waiters)done();
  }).subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(`Private Surprise channel ${status}`));}});
 });
}
async function createIdentity(index){
 const email=`codex-surprise-${runId}-${index}@example.invalid`,password=randomBytes(32).toString('base64url');
 const result=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Surprise QA ${index}`}});
 assert.ifError(result.error);const user={id:result.data.user.id};created.push(user);report.temporaryIdentities++;
 const client=createClient(url,anon,options);const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
 user.token=signed.data.session?.access_token;assert.ok(user.token);
 assert.equal((await api(`/api/user-sync?userId=${user.id}`,user)).status,200);return user;
}
async function media(user,id,expectedPhoto,expectedAudio){
 const result=await api(`/api/vnext/surprise?id=${id}`,user);assert.equal(result.status,200,`media: ${result.data.error}`);
 for(const [field,expected] of [['photoUrl',expectedPhoto],['audioUrl',expectedAudio]]){
  const link=new URL(result.data[field]);assert.equal(link.hostname,new URL(url).hostname);assert.ok(link.pathname.includes('/object/sign/'));
  const response=await fetch(link,{signal:AbortSignal.timeout(25000)});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),hash(expected));
  if(field==='audioUrl'){
   assert.equal(surpriseAudioDuration(bytes),surpriseAudioDuration(expectedAudio));
   const file=path.join(directory,`replay-${id}.m4a`);fs.writeFileSync(file,bytes);
   execFileSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{stdio:'pipe',timeout:15000});
  }
  report.mediaChecks++;
 }
}
let failure;
try{
 for(const method of ['GET','POST']){
  const result=await api('/api/vnext/surprise',null,{method,...(method==='POST'?{body:{}}:{})});assert.equal(result.status,401);assert.match(result.cache??'',/no-store/);
 }
 check('production Surprise API requires authentication and never caches private responses');
 const [a,b]=[await createIdentity(0),await createIdentity(1)];
 const status=await api(`/api/friends/status?userId=${b.id}`,b);assert.equal(status.status,200);assert.ok(status.data.inviteCode);
 const paired=await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:status.data.inviteCode,relationship:'Partner'}});
 assert.equal(paired.status,200,`pair: ${paired.data.error}`);assert.equal(paired.data.success,true);
 const snapshots=await Promise.all([a,b].map(async user=>{const result=await api('/api/vnext/bootstrap',user);assert.equal(result.status,200);assert.equal(result.data.success,true);return result.data;}));
 assert.equal(snapshots[0].partner.id,b.id);assert.equal(snapshots[1].partner.id,a.id);assert.equal(snapshots[0].pairVersion,snapshots[1].pairVersion);
 const version=snapshots[0].pairVersion;assert.match(version,/^[a-f0-9]{32}$/);
 const offer=snapshots[0].catalog.find(row=>row.item_type==='surprise'&&!row.plus_only&&row.status!=='inactive'&&row.price===300);
 assert.ok(offer,'A currently active, Admin-priced 300-coin non-Plus frame is required; never change live prices for a test');
 const frame=offer.metadata?.frameId??offer.stable_id.slice('surprise:'.length),price=offer.price;
 for(const [user,total] of [[a,price*2+17],[b,price+19]]){
  await owned(user);const funded=await db.rpc('change_carrot_balance_v1',{p_user_id:user.id,p_delta:total,p_reason:'release_verification',p_reference_type:'surprise_243_fixture',p_reference_id:runId,p_idempotency_key:`surprise-243-fixture:${runId}:${user.id}`});
  assert.ifError(funded.error);assert.equal(funded.data.error,null);
 }
 await Promise.all(created.map(subscribe));check('two isolated accounts pair successfully; both private Surprise channels are authorized');
 const sharp=createRequire(require.resolve('next/package.json'))('sharp');
 const photo=await sharp({create:{width:512,height:512,channels:3,background:'#e8ba72'}}).jpeg({quality:85}).toBuffer();
 const audioFile=path.join(directory,'synthetic-tone.m4a');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-ac','1','-c:a','aac','-b:a','64k','-y',audioFile],{stdio:'pipe',timeout:15000});
 const audio=fs.readFileSync(audioFile),durationMs=surpriseAudioDuration(audio);
 const body=(sender,recipient,declared=durationMs)=>{
  const key=randomUUID(),keys=mediaCandidates.get(sender.id)??new Set();keys.add(key);mediaCandidates.set(sender.id,keys);
  return{action:'send',key,partnerId:recipient.id,pairVersion:version,frame,durationMs:declared,photo:photo.toString('base64'),audio:audio.toString('base64'),expectedPrice:price};
 };
 const first=body(a,b);decodeSurprise(first);
 const initialA=await wallet(a),initialB=await wallet(b);
 const receiptQuery=(item,partner,ver=version)=>`/api/vnext/surprise?key=${item.key}&partnerId=${partner.id}&pairVersion=${ver}`;
 const missing=await api(receiptQuery(first,b),a);assert.equal(missing.status,200);assert.equal(missing.data.committed,false);assert.deepEqual(plain(await wallet(a)),plain(initialA));
 check('uncommitted receipt lookup performs no upload, reservation or debit');
 let before=new Map(counts);
 const concurrent=await Promise.all([api('/api/vnext/surprise',a,{method:'POST',body:first}),api('/api/vnext/surprise',a,{method:'POST',body:first})]);
 for(const result of concurrent)assert.equal(result.status,200,`first send: ${result.data.error}`);
 const firstId=concurrent[0].data.id;assert.ok(firstId);assert.equal(concurrent[1].data.id,firstId);report.testSends++;
 await notificationAfter(before);
 const afterFirst=await wallet(a);assert.equal(afterFirst.balance,initialA.balance-price);assert.equal(afterFirst.version,initialA.version+1);assert.equal(afterFirst.ledger.length,initialA.ledger.length+1);
 check('concurrent identical sends publish one message, debit once, and notify both participants');
 const recovered=await api(receiptQuery(first,b),a);assert.equal(recovered.status,200);assert.equal(recovered.data.id,firstId);assert.equal(recovered.data.committed,true);assert.equal(recovered.data.wallet.balance,afterFirst.balance);
 const afterRecover=await wallet(a);assert.deepEqual(plain(afterRecover),plain(afterFirst));
 const retry=await api('/api/vnext/surprise',a,{method:'POST',body:first});assert.equal(retry.status,200);assert.equal(retry.data.id,firstId);assert.deepEqual(plain(await wallet(a)),plain(afterFirst));
 const conflict=await api('/api/vnext/surprise',a,{method:'POST',body:{...first,durationMs:durationMs+1000}});assert.equal(conflict.status,409);assert.equal(conflict.data.error,'idempotency_conflict');assert.deepEqual(plain(await wallet(a)),plain(afterFirst));
 const stale=await api(receiptQuery(first,b,'b'.repeat(32)),a);assert.equal(stale.status,409);assert.equal(stale.data.error,'pair_changed');
 const foreignReceipt=await api(receiptQuery(first,a),b);assert.equal(foreignReceipt.status,200);assert.equal(foreignReceipt.data.committed,false);
 check('receipt recovery/retry preserves message and balance; altered payload and stale pair are rejected');
 before=new Map(counts);const second=body(a,b,durationMs+5000);
 const sent2=await api('/api/vnext/surprise',a,{method:'POST',body:second});assert.equal(sent2.status,200,`second send: ${sent2.data.error}`);assert.notEqual(sent2.data.id,firstId);report.testSends++;
 await notificationAfter(before);const afterSecond=await wallet(a);assert.equal(afterSecond.balance,initialA.balance-price*2);assert.equal(afterSecond.version,initialA.version+2);assert.equal(afterSecond.ledger.length,initialA.ledger.length+2);
 const debits=afterSecond.ledger.filter(row=>row.reason==='surprise_sent');assert.equal(debits.length,2);assert.ok(debits.every(row=>row.delta===-price));assert.deepEqual(debits.map(row=>row.reference_id).sort(),[firstId,sent2.data.id].sort());
 check('a second independent recording/send succeeds; encoded duration overrides an inaccurate client stopwatch');
 before=new Map(counts);const reverse=body(b,a),sent3=await api('/api/vnext/surprise',b,{method:'POST',body:reverse});assert.equal(sent3.status,200,`reverse send: ${sent3.data.error}`);report.testSends++;
 await notificationAfter(before);const afterReverse=await wallet(b);assert.equal(afterReverse.balance,initialB.balance-price);assert.equal(afterReverse.version,initialB.version+1);assert.equal(afterReverse.ledger.length,initialB.ledger.length+1);
 const [sentA,receivedB,sentB,receivedA]=await Promise.all([history(a,'sent'),history(b,'received'),history(b,'sent'),history(a,'received')]);
 assert.deepEqual(sentA.map(x=>x.id).sort(),[firstId,sent2.data.id].sort());assert.deepEqual(receivedB.map(x=>x.id).sort(),sentA.map(x=>x.id).sort());
 assert.deepEqual(sentB.map(x=>x.id),[sent3.data.id]);assert.deepEqual(receivedA.map(x=>x.id),[sent3.data.id]);
 assert.equal(sentA.find(x=>x.id===sent2.data.id).duration_ms,durationMs);
 assert.ok([...sentA,...receivedB,...sentB,...receivedA].every(row=>!('photo_path' in row)&&!('audio_path' in row)&&!('digest' in row)&&row.opened_at===null));
 check('both directions and both History tabs agree, preserve actual audio duration, and contain no private file keys');
 const beforeReplayA=await wallet(a),beforeReplayB=await wallet(b);
 for(const [sender,recipient,id] of [[a,b,firstId],[a,b,sent2.data.id],[b,a,sent3.data.id]]){
  await media(sender,id,photo,audio);await media(recipient,id,photo,audio);
 }
 assert.ok((await history(b,'received')).every(row=>row.opened_at===null));
 await api('/api/vnext/surprise',a,{method:'POST',body:{action:'open',id:firstId}});
 assert.equal((await history(b,'received')).find(row=>row.id===firstId).opened_at,null);
 before=new Map(counts);const opened=await api('/api/vnext/surprise',b,{method:'POST',body:{action:'open',id:firstId}});assert.equal(opened.status,200);await notificationAfter(before);
 const firstOpened=(await history(b,'received')).find(row=>row.id===firstId).opened_at;assert.ok(firstOpened);
 const openedAgain=await api('/api/vnext/surprise',b,{method:'POST',body:{action:'open',id:firstId}});assert.equal(openedAgain.status,200);
 assert.equal((await history(a,'sent')).find(row=>row.id===firstId).opened_at,firstOpened);
 await media(b,firstId,photo,audio);assert.equal((await history(b,'received')).find(row=>row.id===firstId).opened_at,firstOpened);
 assert.deepEqual(plain(await wallet(a)),plain(beforeReplayA));assert.deepEqual(plain(await wallet(b)),plain(beforeReplayB));
 check('sender/recipient can repeatedly download and decode exact replay media; only recipient acknowledgement opens it; replay/open never spends');
 const denied=await createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${a.token}`}}}).rpc('burrow_surprise_send_status_v1',{p_user:a.id,p_key:first.key,p_partner:b.id,p_version:version});
 assert.ok(denied.error);assert.equal(denied.error.code,'42501');
 const missingMedia=await api(`/api/vnext/surprise?id=${randomUUID()}`,a);assert.equal(missingMedia.status,404);
 check('public authenticated callers cannot bypass the service-only receipt RPC or read unknown private media');
 report.testDebits=3;report.testPricePerSend=price;report.syntheticMedia={jpegBytes:photo.length,aacBytes:audio.length,durationMs};
 report.realtimeDeliveredToBoth=true;report.nativeUiPlayback='Not exercised: authenticated API + actual downloaded AAC decoding, not a physical-device animation/camera acceptance';
}catch(error){failure=error;report.failure=error.message;console.error(JSON.stringify({failed:report.failure}));}
finally{
 for(const client of clients){try{await client.removeAllChannels();client.realtime.disconnect();}catch{}}
 const cleanup=[];
 for(const user of created){
  try{
   await owned(user);
   const messages=await db.from('burrow_surprises').select('id,sender_id,recipient_id,idempotency_key,photo_path,audio_path').eq('sender_id',user.id);assert.ifError(messages.error);
   // Keep the run's immutable key manifest: deleting one participant cascades
   // BOTH directions' message rows, but not the other sender's Storage objects.
   const keys=mediaCandidates.get(user.id)??new Set(),paths=[...keys].flatMap(key=>[`${user.id}/${key}/face.jpg`,`${user.id}/${key}/voice.m4a`]);
   for(const row of messages.data){assert.ok(created.some(other=>other.id===row.recipient_id));assert.match(row.idempotency_key,/^[a-f0-9-]{36}$/);
    assert.ok(keys.has(row.idempotency_key));assert.equal(row.photo_path,`${user.id}/${row.idempotency_key}/face.jpg`);assert.equal(row.audio_path,`${user.id}/${row.idempotency_key}/voice.m4a`);}
   if(paths.length){const removed=await db.storage.from(SURPRISE_BUCKET).remove(paths);assert.ifError(removed.error);}
   for(const key of keys){const remaining=await db.storage.from(SURPRISE_BUCKET).list(`${user.id}/${key}`);assert.ifError(remaining.error);assert.equal(remaining.data.length,0);}
   const profile=await db.from('profiles').delete().eq('id',user.id);assert.ifError(profile.error);
   const auth=await db.auth.admin.deleteUser(user.id);assert.ifError(auth.error);cleanup.push({id:user.id,removed:true,mediaObjects:paths.length});
  }catch(error){cleanup.push({id:user.id,removed:false,error:error.message});}
 }
 let remaining=0;
 if(created.length){for(const table of ['profiles','wallets','currency_ledger','burrow_surprises']){
  const column=table==='profiles'?'id':table==='burrow_surprises'?'sender_id':'user_id';
  const result=await db.from(table).select('*',{count:'exact',head:true}).in(column,created.map(user=>user.id));
  if(result.error){remaining++;continue;}remaining+=result.count??1;
 }}
 report.cleanup={complete:cleanup.length===created.length&&cleanup.every(x=>x.removed)&&remaining===0,remainingRows:remaining,identities:cleanup};
 report.passed=!failure&&report.cleanup.complete;
 // Only this run's newly-created synthetic files live in this exact temp dir.
 fs.rmSync(directory,{recursive:true,force:true});
 const target=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
if(failure||!report.cleanup.complete)process.exitCode=1;
