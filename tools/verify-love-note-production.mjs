// Production acceptance uses only disposable, owned accounts. Never send a
// letter to an existing user or modify a real account's allowance/history.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
assert.ok(process.argv.includes('--fixtures'),'Explicit --fixtures authorization required');
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error(){}});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(new URL(url).hostname,'qleeohkhbrdvznbwgqad.supabase.co');
const opts={auth:{persistSession:false,autoRefreshToken:false}},db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts);
const wsDir=fs.readdirSync(path.join(root,'node_modules/.pnpm')).filter(n=>n.startsWith('ws@8.')).sort().at(-1);
const WebSocket=require(path.join(root,'node_modules/.pnpm',wsDir,'node_modules/ws'));
const origin='https://api.soulsayit.com',runId=randomUUID(),purpose='codex-love-note-245-production-verification';
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9)??`/private/tmp/novame-love-note-245-${runId}.json`;
const users=[],counts=new Map(),listeners=new Set();let failure;
const report={origin,runId,checks:[],realUserWrites:0,fixtureUsers:[],cleanup:{complete:false}};
function save(){fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
function check(name){report.checks.push(name);save();console.log(JSON.stringify({passed:name}));}
async function result(p){const r=await p;assert.ifError(r.error);return r.data;}
async function api(route,u,{method='GET',body}={}){
 const r=await fetch(origin+route,{method,headers:{...(u?{Authorization:`Bearer ${u.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 return{status:r.status,data:await r.json(),retryAfter:r.headers.get('retry-after'),cache:r.headers.get('cache-control')};
}
async function owned(u){const r=await db.auth.admin.getUserById(u.id);assert.ifError(r.error);assert.equal(r.data.user.app_metadata.purpose,purpose);assert.equal(r.data.user.app_metadata.verificationRun,runId);assert.ok(r.data.user.email.endsWith('@example.invalid'));}
async function home(u,partner=null){const r=await api('/api/vnext/bootstrap?friendVisits=2',u);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.profile.id,u.id);assert.equal(r.data.partner?.id??null,partner?.id??null);assert.match(r.cache??'',/no-store/);return r.data;}
async function send(u,key,extra={},status=200){const r=await api('/api/vnext/command',u,{method:'POST',body:{action:'save_memory',body:'💌 Disposable production verification letter',idempotencyKey:key,...extra}});assert.equal(r.status,status,JSON.stringify(r.data));return r;}
async function allowance(u){return result(db.from('love_note_send_limits').select('daily_count,minute_sends,day_start,day_end').eq('user_id',u.id).single());}
async function wallet(u){return{wallet:await result(db.from('wallets').select('carrot_balance,version').eq('user_id',u.id).single()),ledger:await result(db.from('currency_ledger').select('id,delta,idempotency_key').eq('user_id',u.id).order('id'))};}
async function subscribe(u){await u.client.realtime.setAuth(u.token);await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('realtime subscribe timeout')),20000);
 u.client.channel('burrow:'+u.id,{config:{private:true}}).on('broadcast',{event:'burrow_changed'},event=>{
  if(Object.keys(event.payload??{}).some(k=>k!=='id'))report.unexpectedPrivatePayload=true;
  counts.set(u.id,(counts.get(u.id)??0)+1);for(const listener of listeners)listener();
 }).subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});
});}
async function notified(before){await new Promise((resolve,reject)=>{
 const done=()=>{if(users.every(u=>(counts.get(u.id)??0)>(before.get(u.id)??0))){clearTimeout(timer);listeners.delete(done);resolve();}};
 const timer=setTimeout(()=>{listeners.delete(done);reject(Error('both Love Note notifications not received'));},20000);listeners.add(done);done();
});assert.ok(!report.unexpectedPrivatePayload,'private broadcasts must not include note text');}
try{
 assert.equal((await api('/api/vnext/command',null,{method:'POST',body:{action:'save_memory',body:'💌 Unauthorized',idempotencyKey:runId}})).status,401);check('unauthenticated API rejected');
 for(let i=0;i<2;i++){
  const email=`codex-love-note-245-${runId}-${i}@example.invalid`,password=randomBytes(32).toString('base64url');
  const r=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Love Note QA ${i}`}});assert.ifError(r.error);
  const u={id:r.data.user.id,credentials:{email,password},client:createClient(url,key,{...opts,realtime:{transport:WebSocket}})};users.push(u);report.fixtureUsers.push(u.id);save();
  const signed=await u.client.auth.signInWithPassword(u.credentials);assert.ifError(signed.error);u.token=signed.data.session.access_token;
  assert.equal((await api('/api/user-sync?userId='+u.id,u)).status,200);
 }
 const[a,b]=users;await home(a);await send(a,'solo-'+runId);
 assert.equal((await result(db.from('love_note_send_limits').select('user_id').eq('user_id',a.id))).length,0);check('unpaired private Save Love Note preserved without consuming partner-send quota');
 const status=await api('/api/friends/status?userId='+b.id,b);assert.ok(status.data.inviteCode);
 assert.equal((await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:status.data.inviteCode,relationship:'Partner'}})).status,200);
 await home(a,b);await home(b,a);await Promise.all(users.map(subscribe));const initial=await Promise.all(users.map(wallet));
 check('paired Home and both private realtime subscriptions healthy');
 const before=new Map(counts),keys=Array.from({length:5},(_,i)=>`note-${runId}-${i}`);
 const sends=await Promise.all(keys.map(k=>send(a,k)));assert.ok(sends.every(r=>r.data.applied===true));await notified(before);
 let quota=await allowance(a);assert.equal(quota.daily_count,5);assert.equal(quota.minute_sends.length,5);check('five concurrent-device sends accepted and both partners notified');
 const rejected=await send(a,'minute-block-'+runId,{},429);assert.equal(rejected.data.error,'love_note_minute_limit');assert.equal(rejected.data.limit,5);assert.ok(+rejected.retryAfter>=1&&+rejected.retryAfter<=60);
 assert.equal((await allowance(a)).daily_count,5);check('sixth send returns 429 with bounded Retry-After and consumes no allowance');
 const replay=await send(a,keys[0]);assert.equal(replay.data.applied,false);assert.equal(replay.data.entryId,sends[0].data.entryId);
 assert.equal((await send(a,keys[0],{body:'💌 Changed request'},409)).data.error,'idempotency_conflict');assert.equal((await allowance(a)).daily_count,5);check('receipt retry succeeds at cap; conflicting key cannot resend or count twice');
 await send(b,'b-independent-'+runId);assert.equal((await allowance(b)).daily_count,1);
 const ha=await home(a,b),hb=await home(b,a),ids=sends.map(r=>r.data.entryId);
 for(const h of [ha,hb])for(const id of ids)assert.ok(h.memoryEntries.some(n=>n.id===id),'both Home snapshots must include committed letters');
 const denied=await a.client.from('love_note_send_limits').select('*').eq('user_id',a.id);assert.equal(denied.error?.code,'42501');check('partner has independent quota; both Home snapshots match; private counters inaccessible to clients');
 await owned(a);await result(db.from('love_note_send_limits').update({daily_count:99,minute_sends:[]}).eq('user_id',a.id).select('user_id').single());
 const hundredth=await send(a,'day-100-'+runId);assert.equal(hundredth.data.applied,true);assert.equal((await allowance(a)).daily_count,100);
 const daily=await send(a,'day-101-'+runId,{userId:b.id},429);assert.equal(daily.data.error,'love_note_daily_limit');assert.equal(daily.data.limit,100);assert.ok(+daily.retryAfter>=1);
 assert.equal((await send(a,'day-100-'+runId)).data.applied,false);assert.equal((await allowance(a)).daily_count,100);assert.equal((await allowance(b)).daily_count,1);
 check('100th daily send accepted, 101st returns 429, actor spoofing ignored and same-key replay remains safe');
 const restarted=createClient(url,key,opts),signed=await restarted.auth.signInWithPassword(a.credentials);assert.ifError(signed.error);
 const fresh={id:a.id,token:signed.data.session.access_token};assert.ok((await home(fresh,b)).memoryEntries.some(n=>n.id===hundredth.data.entryId));
 assert.equal((await send(fresh,'restart-block-'+runId,{},429)).data.error,'love_note_daily_limit');check('fresh sign-in preserves stored letters and daily allowance');
 await owned(a);await result(db.from('memory_room_entries').update({deleted_at:new Date().toISOString()}).eq('id',hundredth.data.entryId).eq('author_id',a.id).select('id').single());
 assert.equal((await send(a,'delete-bypass-'+runId,{},429)).data.error,'love_note_daily_limit');
 assert.deepEqual(await Promise.all(users.map(wallet)),initial);check('deleting a letter cannot refund quota; wallets and ledgers remain unchanged');
}catch(error){failure=error;report.failure=error.message;console.error(JSON.stringify({failed:error.message}));}
finally{
 for(const u of users){try{await u.client.removeAllChannels();u.client.realtime.disconnect();}catch{}}
 try{
  for(const u of users)await owned(u);
  const ids=users.map(u=>u.id);
  if(ids.length){
   // Every removed record belongs to the identities tagged above. Normal
   // profile cascades remove memory, receipt, Moments, pairing and quota rows.
   for(const u of users){await result(db.from('profiles').delete().eq('id',u.id));const r=await db.auth.admin.deleteUser(u.id);assert.ifError(r.error);}
   for(const [table,column]of[['profiles','id'],['wallets','user_id'],['love_note_send_limits','user_id'],['memory_room_entries','author_id'],['moment_events','actor_id'],['burrow_command_receipts','actor_id']]){
    const r=await db.from(table).select('*',{head:true,count:'exact'}).in(column,ids);assert.ifError(r.error);assert.equal(r.count,0,table);
   }
   for(const u of users){const r=await db.auth.admin.getUserById(u.id);assert.ok(r.error||!r.data.user);}
  }
  report.cleanup={complete:true,removedAccounts:users.length,removedOwnedFixtureData:true};
 }catch(error){report.cleanup.error=error.message;failure??=error;}
 report.passed=!failure;save();console.log(JSON.stringify({report:target,passed:report.passed,checks:report.checks.length,cleanup:report.cleanup}));
}
if(failure)process.exitCode=1;
