// Explicitly authorized production acceptance. Mutate disposable identities
// only; journal their IDs immediately and remove their records in finally.
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
const {load}=require(path.join(root,'tools/lifecycle-test-utils.cjs'));
const {giftCollectionModel}=load('apps/mobile/src/lib/adventure-gift-collection-model.ts');
const {roomSlots}=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}});
const origin='https://api.soulsayit.com',runId=randomUUID(),purpose='codex-gift-shelf-production-verification';
const users=[],captures={};let failure;
const target=process.argv.find(x=>x.startsWith('--report='))?.slice(9)??`/private/tmp/novame-gift-shelf-production-${runId}.json`;
const report={origin,runId,checks:[],fixtureUsers:[],realUserWrites:0,cleanup:{complete:false}};
function save(){fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
function check(name){report.checks.push(name);save();console.log(JSON.stringify({passed:name}));}
async function result(p){const r=await p;assert.ifError(r.error);return r.data;}
async function api(route,u,{method='GET',body}={}){
 const start=performance.now(),r=await fetch(origin+route,{method,headers:{...(u?{Authorization:`Bearer ${u.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 return{status:r.status,data:await r.json(),ms:Math.round(performance.now()-start),cache:r.headers.get('cache-control')};
}
async function home(u,partner=null){const r=await api('/api/vnext/bootstrap?friendVisits=2',u);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.profile.id,u.id);assert.equal(r.data.partner?.id??null,partner?.id??null);assert.match(r.cache??'',/no-store/);report.homeMs??=[];report.homeMs.push(r.ms);return r.data;}
async function place(u,itemId,extra={},status=200){const r=await api('/api/vnext/command',u,{method:'POST',body:{action:'select_adventure_gift',itemId,...extra}});assert.equal(r.status,status,JSON.stringify(r.data));if(status===200){assert.equal(r.data.applied,true);assert.equal(r.data.itemId,itemId);}return r.data;}
const shelf=(h,u)=>roomSlots(h,u.id).shelf_decor?.stable_id;
async function wallet(u){return{wallet:await result(db.from('wallets').select('carrot_balance,version').eq('user_id',u.id).single()),ledger:await result(db.from('currency_ledger').select('id,delta').eq('user_id',u.id).order('id'))};}
async function freshSession(u){const c=createClient(url,key,opts),r=await c.auth.signInWithPassword(u.credentials);assert.ifError(r.error);return{id:u.id,token:r.data.session.access_token};}
function verifyOrder(h,u,first,count){const m=giftCollectionModel(h,u.id),category=m.categories.find(c=>c.name==='Animal Statues');assert.equal(m.categories.length,15);assert.equal(category.found.stable_id,first);assert.equal(category.count,count);for(const row of h.inventory.filter(i=>i.owner_id===u.id&&i.item_id.startsWith('adventure_gift_')))assert.ok(Number.isFinite(Date.parse(row.acquired_at)),row.item_id+' acquisition time missing');}
async function capture(name,h,u){
 // Synthetic test data only, without tokens, credentials or private history.
 captures[name]={...h,roomPhotos:[],memoryEntries:[],moments:[],gifts:[],affectionInbox:[]};
 const memory=new Map(),storage={set:(k,v)=>memory.set(k,v),getString:k=>memory.get(k),remove:k=>memory.delete(k)};
 const imports={'./storage':{storage},'../shared/storage/keys':{kBurrowSnapshot:{name:'qa-snapshot'},kBurrowActionKeys:{name:'qa-actions'}}};
 load('apps/mobile/src/lib/burrow-cache.ts',imports).persistBurrowSnapshot(h);
 // Fresh module/realm: no in-memory store or optimistic receipt survives.
 const reloaded=load('apps/mobile/src/lib/burrow-cache.ts',imports).readBurrowSnapshot(u.id);
 assert.ok(reloaded);assert.equal(shelf(reloaded.data,u),shelf(h,u));
 verifyOrder(reloaded.data,u,u.first,u.count);
 assert.equal(load('apps/mobile/src/lib/burrow-cache.ts',imports).readBurrowSnapshot(randomUUID()),null);
}
try{
 assert.equal((await api('/api/vnext/command',null,{method:'POST',body:{action:'select_adventure_gift',itemId:'adventure_gift_1'}})).status,401);check('unauthenticated shelf mutation denied');
 for(let i=0;i<2;i++){
  const credentials={email:`codex-gift-shelf-${runId}-${i}@example.invalid`,password:randomBytes(32).toString('base64url')};
  const r=await db.auth.admin.createUser({...credentials,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Gift Shelf QA ${i}`}});assert.ifError(r.error);
  const u={id:r.data.user.id,credentials};users.push(u);report.fixtureUsers.push(u.id);save();Object.assign(u,await freshSession(u));
  assert.equal((await api('/api/user-sync?userId='+u.id,u)).status,200);
  await home(u);
 }
 const[a,b]=users;a.first='adventure_gift_2';a.count=2;b.first='adventure_gift_3';b.count=1;
 const fixtures=[{id:'f'+randomUUID().slice(1),owner_id:a.id,item_id:a.first,source:'adventure',acquired_at:'2026-10-14T12:00:00Z'},
  {id:'0'+randomUUID().slice(1),owner_id:a.id,item_id:'adventure_gift_1',source:'adventure',acquired_at:'2026-10-15T12:00:00Z'},
  {id:randomUUID(),owner_id:b.id,item_id:b.first,source:'adventure',acquired_at:'2026-10-15T12:00:00Z'}];
 await result(db.from('user_inventory').insert(fixtures));
 const initial=await Promise.all(users.map(wallet));
 let ha=await home(a),hb=await home(b);verifyOrder(ha,a,a.first,2);verifyOrder(hb,b,b.first,1);
 assert.ok(!ha.inventory.some(i=>i.owner_id===b.id));assert.ok(!hb.inventory.some(i=>i.owner_id===a.id));
 for(const f of fixtures){const h=f.owner_id===a.id?ha:hb;assert.equal(Date.parse(h.inventory.find(i=>i.id===f.id).acquired_at),Date.parse(f.acquired_at));}
 check('unpaired live bootstrap includes correct acquired_at; first-acquired representative beats reversed UUID order; inventories isolated');
 await place(a,'adventure_gift_1');assert.equal(shelf(await home(a),a),'adventure_gift_1');
 await Promise.all([place(a,a.first),place(a,a.first)]);ha=await home(a);assert.equal(shelf(ha,a),a.first);
 await place(b,b.first);hb=await home(b);assert.equal(shelf(hb,b),b.first);
 const rejected=await place(a,b.first,{},400);assert.equal(rejected.error,'item_not_owned');
 assert.equal(shelf(await home(a),a),a.first);check('unpaired shelf replacement and duplicate taps persist one selection; unowned gift rejected');
 for(const[u,name]of[[a,'soloA'],[b,'soloB']]){const h=await home(await freshSession(u));assert.equal(shelf(h,u),u.first);await capture(name,h,u);}
 check('unpaired fresh authenticated sessions and actual mobile cache reload retain selection, chronology and account isolation');
 const status=await api('/api/friends/status?userId='+b.id,b);assert.ok(status.data.inviteCode);
 assert.equal((await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:status.data.inviteCode,relationship:'Partner'}})).status,200);
 ha=await home(a,b);hb=await home(b,a);assert.equal(ha.pairVersion,hb.pairVersion);
 for(const h of[ha,hb]){verifyOrder(h,a,a.first,2);verifyOrder(h,b,b.first,1);assert.equal(shelf(h,a),a.first);assert.equal(shelf(h,b),b.first);}
 check('paired live bootstrap preserves both inventories/acquired times, separate counts and both prior shelf displays');
 await place(a,'adventure_gift_1',{userId:b.id,ownerId:b.id});
 ha=await home(a,b);hb=await home(b,a);for(const h of[ha,hb]){assert.equal(shelf(h,a),'adventure_gift_1');assert.equal(shelf(h,b),b.first);}
 assert.equal((await place(a,b.first,{},400)).error,'item_not_owned');
 const denied=await createClient(url,key,opts).rpc('select_adventure_gift_v2',{p_user_id:a.id,p_item_id:a.first});assert.ok(denied.error);
 check('paired replacement visible to both fresh Home reads; forged owner ignored; partner inventory and unauthenticated RPC cannot authorize placement');
 for(const[u,partner,name,expected]of[[a,b,'pairedA','adventure_gift_1'],[b,a,'pairedB',b.first]]){const h=await home(await freshSession(u),partner);assert.equal(shelf(h,u),expected);await capture(name,h,u);}
 assert.deepEqual(await Promise.all(users.map(wallet)),initial);
 const displays=await result(db.from('adventure_gift_display').select('user_id,gift_id').in('user_id',users.map(u=>u.id)));assert.equal(displays.length,2);
 check('paired fresh sessions/cache module restart retain owner-specific shelf and sorting; no coin debit, wallet-version change or extra display rows');
 const capturePath=target.replace(/\.json$/,'.snapshots.json');fs.writeFileSync(capturePath,JSON.stringify(captures));report.syntheticSnapshots=capturePath;
}catch(error){failure=error;report.failure=error.message;console.error(JSON.stringify({failed:error.message}));}
finally{
 try{
  for(const u of users){const r=await db.auth.admin.getUserById(u.id);assert.ifError(r.error);assert.equal(r.data.user.app_metadata.purpose,purpose);assert.equal(r.data.user.app_metadata.verificationRun,runId);assert.ok(r.data.user.email.endsWith('@example.invalid'));}
  const ids=users.map(u=>u.id);
  if(ids.length){
   const visits=await result(db.from('friend_visit_instances_v2').select('id,pair_low,pair_high').or(ids.map(id=>`pair_low.eq.${id},pair_high.eq.${id}`).join(',')));
   assert.ok(visits.every(v=>ids.includes(v.pair_low)&&ids.includes(v.pair_high)));
   if(visits.length)await result(db.from('friend_visit_instances_v2').delete().in('id',visits.map(v=>v.id)));
   await result(db.from('user_friend_discoveries').delete().in('user_id',ids));
   for(const u of users){await result(db.from('profiles').delete().eq('id',u.id));const r=await db.auth.admin.deleteUser(u.id);assert.ifError(r.error);}
   for(const[table,column]of[['profiles','id'],['user_inventory','owner_id'],['adventure_gift_display','user_id'],['wallets','user_id'],['currency_ledger','user_id']]){const r=await db.from(table).select('*',{head:true,count:'exact'}).in(column,ids);assert.ifError(r.error);assert.equal(r.count,0,table);}
   for(const u of users){const r=await db.auth.admin.getUserById(u.id);assert.ok(r.error||!r.data.user);}
  }
  report.cleanup={complete:true,removedAccounts:users.length,removedOwnedFixtureData:true};
 }catch(error){report.cleanup.error=error.message;failure??=error;}
 report.passed=!failure;save();console.log(JSON.stringify({report:target,passed:report.passed,checks:report.checks.length,cleanup:report.cleanup}));
}
if(failure)process.exitCode=1;
