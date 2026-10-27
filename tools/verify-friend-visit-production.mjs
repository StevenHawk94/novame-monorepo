// Explicit --fixtures creates two disposable identities, exercises the real
// production HTTP/realtime boundaries, and removes only owned test records.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
assert.ok(process.argv.includes('--fixtures'),'Explicit fixture authorization required');
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error(){}});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(new URL(url).hostname,'qleeohkhbrdvznbwgqad.supabase.co');
const opts={auth:{persistSession:false,autoRefreshToken:false}},db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts);
const wsDir=fs.readdirSync(path.join(root,'node_modules/.pnpm')).filter(n=>n.startsWith('ws@8.')).sort().at(-1);
const WebSocket=require(path.join(root,'node_modules/.pnpm',wsDir,'node_modules/ws'));
const origin='https://api.soulsayit.com',runId=randomUUID(),purpose='codex-friend-244-production-verification';
const users=[],counts=new Map(),listeners=new Set();let failure;
const report={origin,runId,checks:[],realUserWrites:0,fixtureUsers:[],cleanup:{complete:false}};
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9)??`/private/tmp/novame-friend-244-${runId}.json`;
function save(){fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
function check(name){report.checks.push(name);save();console.log(JSON.stringify({passed:name}));}
async function result(p){const r=await p;assert.ifError(r.error);return r.data;}
async function api(route,user,{method='GET',body}={}){
 const start=performance.now(),r=await fetch(origin+route,{method,headers:{...(user?{Authorization:`Bearer ${user.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 return{status:r.status,data:await r.json(),ms:Math.round(performance.now()-start),cache:r.headers.get('cache-control')};
}
async function home(u,partner){const r=await api('/api/vnext/bootstrap?friendVisits=2',u);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.profile.id,u.id);assert.equal(r.data.partner?.id,partner.id);assert.match(r.cache??'',/no-store/);(report.homeMs??=[]).push(r.ms);return r.data;}
async function command(u,body,status=200){const r=await api('/api/vnext/command',u,{method:'POST',body});assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
async function prepare(u,v,version){return command(u,{action:'prepare_friend_visit_v3',visitId:v,pairVersion:version});}
function answer(u,v,p,choice,extra={}){return command(u,{action:'respond_friend_visit_v3',visitId:v,pairVersion:p.pairVersion,sessionId:p.sessionId,choiceId:choice,...extra});}
async function wallet(u){const w=await result(db.from('wallets').select('carrot_balance,version').eq('user_id',u.id).single());const l=await result(db.from('currency_ledger').select('id,delta,idempotency_key').eq('user_id',u.id).order('id'));return{...w,ledger:l};}
async function owned(u){const r=await db.auth.admin.getUserById(u.id);assert.ifError(r.error);assert.equal(r.data.user.app_metadata.purpose,purpose);assert.equal(r.data.user.app_metadata.verificationRun,runId);assert.ok(r.data.user.email.endsWith('@example.invalid'));}
async function subscribe(u){
 await u.client.realtime.setAuth(u.token);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('realtime subscribe timeout')),20000);
 u.client.channel('burrow:'+u.id,{config:{private:true}}).on('broadcast',{event:'burrow_changed'},event=>{
  const payload=event.payload??{};if(Object.keys(payload).some(k=>k!=='id')){report.privatePayloadUnexpected=true;}
  counts.set(u.id,(counts.get(u.id)??0)+1);for(const fn of listeners)fn();
 }).subscribe(s=>{if(s==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(s)){clearTimeout(timer);reject(Error(s));}});});
}
async function notified(before){await new Promise((resolve,reject)=>{const test=()=>{if(users.every(u=>(counts.get(u.id)??0)>(before.get(u.id)??0))){clearTimeout(timer);listeners.delete(test);resolve();}};const timer=setTimeout(()=>{listeners.delete(test);reject(Error('both private visit notifications not received'));},20000);listeners.add(test);test();});assert.ok(!report.privatePayloadUnexpected,'notifications must not leak dialogue/answer data');}
async function seedVisit(a,b,version,question,date){
 const q=await result(db.from('friend_visit_questions_v2').select('id,friend_id,kind,content').eq('id',question).eq('status','active').single());
 return result(db.from('friend_visit_instances_v2').insert({pair_low:[a.id,b.id].sort()[0],pair_high:[a.id,b.id].sort()[1],pair_version:version,visit_date:date,friend_id:q.friend_id,question_id:q.id,kind:q.kind,content_snapshot:q.content,waiting_line:'Waiting for {partner}'}).select('id').single());
}
try{
 assert.equal((await api('/api/vnext/command',null,{method:'POST',body:{action:'prepare_friend_visit_v3'}})).status,401);check('unauthenticated visit API denied');
 for(let i=0;i<2;i++){
  const email=`codex-friend-244-${runId}-${i}@example.invalid`,password=randomBytes(32).toString('base64url');
  const r=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Friend QA ${i}`}});assert.ifError(r.error);
  const u={id:r.data.user.id,client:createClient(url,key,{...opts,realtime:{transport:WebSocket}})};users.push(u);report.fixtureUsers.push(u.id);save();
  const signed=await u.client.auth.signInWithPassword({email,password});assert.ifError(signed.error);u.token=signed.data.session.access_token;
  assert.equal((await api('/api/user-sync?userId='+u.id,u)).status,200);
 }
 const[a,b]=users,status=await api('/api/friends/status?userId='+b.id,b);assert.ok(status.data.inviteCode);
 const paired=await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:status.data.inviteCode,relationship:'Partner'}});assert.equal(paired.status,200,JSON.stringify(paired.data));
 let ha=await home(a,b),hb=await home(b,a);assert.equal(ha.pairVersion,hb.pairVersion);const version=ha.pairVersion;
 assert.equal(ha.friendVisit,null);assert.equal(hb.friendVisit,null);await Promise.all(users.map(subscribe));check('paired Home and both private realtime subscriptions verified');
 const revision=await result(db.from('app_config').select('value').eq('key','app_major_update_content_revision').single());
 const adv=await result(db.from('adventures').insert({user_id:a.id,partner_id:b.id,local_date:ha.localDate,status:'completed',started_at:new Date().toISOString(),ends_at:new Date().toISOString(),duration_seconds:60,content_revision:revision.value,idempotency_key:'friend-244-'+runId}).select('id').single());
 await result(db.from('user_friend_discoveries').insert({user_id:a.id,friend_id:'adventure_friend_mm',source_adventure_id:adv.id,first_seen_at:new Date().toISOString(),interaction_completed_at:new Date().toISOString()}));
 assert.equal((await home(a,b)).friendVisit,null);assert.equal((await home(b,a)).friendVisit,null);check('first encounter calendar day cannot schedule an immediate visit');
 await result(db.from('user_friend_discoveries').update({first_seen_at:new Date(Date.now()-2*86400000).toISOString()}).eq('user_id',a.id).eq('friend_id','adventure_friend_mm'));
 ha=await home(a,b);hb=await home(b,a);assert.ok(ha.friendVisit);assert.equal(ha.friendVisit.id,hb.friendVisit.id);const visit=ha.friendVisit.id;
 assert.equal(ha.friendVisit.myCompleted,false);assert.equal(hb.friendVisit.partnerCompleted,false);assert.ok(!JSON.stringify(ha.friendVisit).includes('choices'));check('eligible prior-day discovery schedules one shared redacted visitor');
 const initial=await Promise.all(users.map(wallet));
 const pa=await prepare(a,visit,version),pb=await prepare(b,visit,version);assert.equal(pa.mode,'independent');assert.equal(pb.mode,'independent');assert.equal(pa.type,'Trivia');assert.equal((await prepare(a,visit,version)).sessionId,pa.sessionId);
 assert.deepEqual(await Promise.all(users.map(wallet)),initial);assert.ok(pa.choices.every(c=>Array.isArray(c.feedback)&&c.feedback.length));check('preparation returns stable cached feedback/rewards without granting coins');
 const wrong=pa.choices.find(c=>c.reward===5),correct=pb.choices.find(c=>c.reward===10);assert.ok(wrong&&correct);
 const denied=await a.client.rpc('prepare_friend_visit_v3',{p_user_id:a.id,p_visit_id:visit,p_pair_version:version});assert.equal(denied.error?.code,'42501');
 const stale=await command(a,{action:'prepare_friend_visit_v3',visitId:visit,pairVersion:'0'.repeat(32)},409);assert.equal(stale.error,'pair_changed');
 const foreign=await command(b,{action:'respond_friend_visit_v3',visitId:visit,pairVersion:version,sessionId:pa.sessionId,choiceId:'A'},409);assert.equal(foreign.error,'visit_session_changed');check('private RPC, stale pair and foreign session rejected');
 let before=new Map(counts);
 const concurrent=await Promise.all([answer(a,visit,pa,wrong.id,{userId:b.id,reward:999,feedback:['forged']}),answer(a,visit,pa,wrong.id)]);
 assert.equal(concurrent.filter(r=>r.applied).length,1);assert.equal(concurrent.reduce((s,r)=>s+r.reward,0),5);assert.deepEqual(concurrent.find(r=>r.applied).feedback,wrong.feedback);await notified(before);
 ha=await home(a,b);hb=await home(b,a);assert.equal(ha.friendVisit.myCompleted,true);assert.equal(hb.friendVisit.partnerCompleted,true);assert.equal(hb.friendVisit.myCompleted,false);
 assert.equal((await wallet(a)).carrot_balance,initial[0].carrot_balance+5);assert.equal((await wallet(b)).carrot_balance,initial[1].carrot_balance);check('concurrent duplicate answers credit 5 once; actor/reward spoofing ignored; both clients receive realtime and correct Home state');
 const follow=await prepare(b,visit,version);assert.equal(follow.mode,'followup');assert.notEqual(follow.sessionId,pb.sessionId);
 before=new Map(counts);const br=await answer(b,visit,pb,correct.id);assert.equal(br.reward,10);assert.deepEqual(br.feedback,correct.feedback);await notified(before);
 assert.equal((await home(a,b)).friendVisit,null);assert.equal((await home(b,a)).friendVisit,null);assert.equal((await wallet(b)).carrot_balance,initial[1].carrot_balance+10);check('frozen independent token remains valid after partner responds; second answer credits 10 and closes both views');
 const replay=await answer(a,visit,pa,wrong.id);assert.equal(replay.applied,false);assert.equal(replay.reward,0);
 const conflict=await command(a,{action:'respond_friend_visit_v3',visitId:visit,pairVersion:version,sessionId:pa.sessionId,choiceId:pa.choices.find(c=>c.id!==wrong.id).id},409);assert.equal(conflict.error,'idempotency_conflict');check('reentry/retry never rewards twice; changing a committed choice is rejected');
 // Owned fixture only: seed a second published Guess question to exercise
 // actual partner-matrix followup without changing global schedule or content.
 const previous=new Date(ha.localDate+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
 const guess=await seedVisit(a,b,version,'AR-V16',previous.toISOString().slice(0,10));
 const ga=await prepare(a,guess.id,version);assert.equal(ga.type,'Guess');assert.equal(ga.mode,'independent');before=new Map(counts);await answer(a,guess.id,ga,'A');await notified(before);
 assert.equal((await home(b,a)).friendVisit.partnerCompleted,true);const gb=await prepare(b,guess.id,version);assert.equal(gb.mode,'followup');assert.notEqual(gb.question,ga.question);
 const q=await result(db.from('friend_visit_questions_v2').select('content').eq('id','AR-V16').single());assert.deepEqual(gb.choices.find(c=>c.id==='B').feedback,q.content.coupleReplies['A:B'].map(s=>s.replaceAll('{partner}',ha.profile.display_name||'your partner')));
 before=new Map(counts);const second=await answer(b,guess.id,gb,'B');assert.deepEqual(second.feedback,gb.choices.find(c=>c.id==='B').feedback);assert.equal(second.reward,10);await notified(before);
 assert.equal((await home(a,b)).friendVisit,null);assert.equal((await home(b,a)).friendVisit,null);check('later opener receives prepared personalized Guess followup; answer and completion synchronize to both clients');
 for(const[u,index,delta]of[[a,0,15],[b,1,20]]){
  const w=await wallet(u);assert.equal(w.carrot_balance,initial[index].carrot_balance+delta);const newLedger=w.ledger.filter(l=>!initial[index].ledger.some(old=>old.id===l.id));assert.equal(newLedger.length,2);assert.equal(newLedger.reduce((s,l)=>s+l.delta,0),delta);assert.equal(new Set(newLedger.map(l=>l.idempotency_key)).size,2);
  const discoveries=await result(db.from('user_friend_discoveries').select('interaction_completed_at').eq('user_id',u.id));assert.ok(discoveries.some(d=>d.interaction_completed_at));
 }
 check('authoritative wallets/ledgers match exactly: A +15, B +20, one entry per visit/person; both friend collections unlocked');
 const retained=await Promise.all(users.map(wallet));
 const oldVersion=version;assert.equal((await api('/api/friends/pair',a,{method:'DELETE',body:{userId:a.id}})).status,200);
 const invalid=await command(a,{action:'respond_friend_visit_v3',visitId:guess.id,pairVersion:oldVersion,sessionId:ga.sessionId,choiceId:'A'},409);assert.equal(invalid.error,'pair_changed');assert.deepEqual(await Promise.all(users.map(wallet)),retained);check('unpair invalidates old visit authorization without altering settled rewards');
}catch(error){failure=error;report.failure=error.message;console.error(JSON.stringify({failed:error.message}));}
finally{
 for(const u of users){try{await u.client.removeAllChannels();u.client.realtime.disconnect();}catch{}}
 try{
  for(const u of users)await owned(u);
  const ids=users.map(u=>u.id);
  if(ids.length){
   // Preparations have other_answerer NO ACTION references: remove owned
   // pair visits before profile cascade. Never touch another user's visits.
   const visits=await result(db.from('friend_visit_instances_v2').select('id,pair_low,pair_high').or(ids.map(id=>`pair_low.eq.${id},pair_high.eq.${id}`).join(',')));
   assert.ok(visits.every(v=>ids.includes(v.pair_low)&&ids.includes(v.pair_high)));
   if(visits.length)await result(db.from('friend_visit_instances_v2').delete().in('id',visits.map(v=>v.id)));
   await result(db.from('user_friend_discoveries').delete().in('user_id',ids));
   for(const u of users){await result(db.from('profiles').delete().eq('id',u.id));const r=await db.auth.admin.deleteUser(u.id);assert.ifError(r.error);}
   for(const table of ['profiles','wallets','currency_ledger','adventures','user_friend_discoveries','friend_visit_preparations_v3','friend_visit_answers_v2']){
    const r=await db.from(table).select('*',{head:true,count:'exact'}).in(table==='profiles'?'id':'user_id',ids);assert.ifError(r.error);assert.equal(r.count,0,table);
   }
   for(const u of users){const r=await db.auth.admin.getUserById(u.id);assert.ok(r.error||!r.data.user);}
  }
  report.cleanup={complete:true,removedAccounts:users.length,removedOwnedFixtureData:true};
 }catch(error){report.cleanup.error=error.message;failure??=error;}
 report.passed=!failure;save();console.log(JSON.stringify({report:target,passed:report.passed,checks:report.checks.length,cleanup:report.cleanup}));
}
if(failure)process.exitCode=1;
