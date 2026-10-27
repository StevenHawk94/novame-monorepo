// Public checks are read-only. --fixtures explicitly creates TWO disposable
// identities, exercises only those identities, and removes them in finally.
// No real-user reads/mutations, successful purchases, or payment-store calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error(){}});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref=fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim();
assert.equal(ref,'qleeohkhbrdvznbwgqad');assert.equal(new URL(url).hostname,`${ref}.supabase.co`);
assert.ok(key&&process.env.SUPABASE_SERVICE_ROLE_KEY,'Local credentials required; never print them');
const origin='https://api.soulsayit.com';
const runId=randomUUID(),purpose='codex-startup-release-verification';
const created=[],clients=[],events=[],watchers=new Set();let phase='initial';
const report={origin,runId,checks:[],homeReads:[],realUserWrites:0,successfulPurchases:0,storeCalls:0,cleanup:{complete:false}};
const options={auth:{persistSession:false,autoRefreshToken:false}};
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const plain=x=>JSON.parse(JSON.stringify(x));
function check(name){report.checks.push(name);console.log(JSON.stringify({passed:name}));}
function profileDatabase(user,scope){
 if(!process.argv.includes('--profile'))return;
 assert.ok(created.includes(user),'Only this run\'s disposable identity may be profiled');
 assert.match(user.id,/^[a-f0-9-]{36}$/);
 const sql=`explain (analyze,format json) select public.burrow_bootstrap_v1('${user.id}'::uuid);`;
 const raw=JSON.parse(execFileSync('supabase',['db','query','--linked','--output','json',sql],{
  cwd:root,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024}));
 const rows=Array.isArray(raw)?raw:raw.rows;
 const plan=rows[0]['QUERY PLAN'][0];
 const result={scope,planningMs:plan['Planning Time'],executionMs:plan['Execution Time']};
 (report.databaseProfiles??=[]).push(result);console.log(JSON.stringify({databaseProfile:result}));
}
async function api(route,user,{method='GET',body}={}){
 const start=performance.now();
 const response=await fetch(origin+route,{method,headers:{...(user?{Authorization:`Bearer ${user.token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
 const headersMs=Math.round(performance.now()-start);
 const data=await response.json();
 return {status:response.status,data,ms:Math.round(performance.now()-start),headersMs,
  serverTiming:response.headers.get('server-timing'),region:response.headers.get('x-vercel-id'),
  cache:response.headers.get('cache-control')};
}
async function home(user,expectedPartner){
 const result=await api('/api/vnext/bootstrap?friendVisits=2',user);
 assert.equal(result.status,200,`bootstrap ${result.status}: ${result.data.error}`);assert.equal(result.data.success,true);
 assert.equal(result.data.profile.id,user.id);assert.equal(result.data.partner?.id??null,expectedPartner);
 assert.ok(Array.isArray(result.data.catalog)&&result.data.catalog.length>36);
 assert.ok(Number.isInteger(result.data.wallet.balance));assert.ok(Number.isFinite(Date.parse(result.data.serverNow)));
 assert.match(result.data.localDate,/^\d{4}-\d{2}-\d{2}$/);assert.match(result.cache??'',/no-store/);
 report.homeReads.push({phase,paired:!!expectedPartner,ms:result.ms,headersMs:result.headersMs,
  serverTiming:result.serverTiming,region:result.region,catalogItems:result.data.catalog.length,
  responseBytes:Buffer.byteLength(JSON.stringify(result.data)),catalogBytes:Buffer.byteLength(JSON.stringify(result.data.catalog))});
 console.log(JSON.stringify({home:report.homeReads.at(-1)}));
 return result.data;
}
function waitFor(predicate,label,timeout=20000){
 if(predicate())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const done=()=>{if(predicate()){clearTimeout(timer);watchers.delete(done);resolve();}};
  const timer=setTimeout(()=>{watchers.delete(done);reject(Error(`Timed out: ${label}`));},timeout);watchers.add(done);
 });
}
async function subscribe(user,client,topic,event){
 let channel;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Realtime subscribe timeout')),15000);
  channel=client.channel(`${topic}:${user.id}`,{config:{private:true}}).on('broadcast',{event},()=>{
   events.push({phase,userId:user.id,topic,event});for(const fn of watchers)fn();
  }).subscribe(status=>{
   if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
   else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(`Realtime ${status}`));}
  });
 });
 return channel;
}
async function delivered(users){
 const expectedPhase=phase;
 await waitFor(()=>users.every(u=>events.some(e=>e.phase===expectedPhase&&e.userId===u.id&&e.topic==='pairing')),'both private pairing notifications');
 check(`${phase}: both private pairing notifications delivered`);
}
async function state(users){
 const ids=users.map(u=>u.id);
 const wallets=await db.from('wallets').select('user_id,carrot_balance,version').in('user_id',ids).order('user_id');assert.ifError(wallets.error);
 const ledger=await db.from('currency_ledger').select('id',{count:'exact',head:true}).in('user_id',ids);assert.ifError(ledger.error);
 const inventory=await db.from('user_inventory').select('owner_id,item_id').in('owner_id',ids).order('owner_id').order('item_id');assert.ifError(inventory.error);
 const unlocks=await db.from('burrow_game_unlocks').select('owner_id,game_id').in('owner_id',ids).order('owner_id').order('game_id');assert.ifError(unlocks.error);
 return {wallets:wallets.data,ledger:ledger.count,inventoryHash:createHash('sha256').update(JSON.stringify(inventory.data)).digest('hex'),unlocks:unlocks.data};
}
async function fixtures(){
 const wsDir=fs.readdirSync(path.join(root,'node_modules/.pnpm')).filter(name=>name.startsWith('ws@8.')).sort().at(-1);
 assert.ok(wsDir,'Installed WebSocket transport required');
 const WebSocket=require(path.join(root,'node_modules/.pnpm',wsDir,'node_modules/ws'));
 for(let index=0;index<2;index++){
  const email=`codex-startup-${runId}-${index}@example.invalid`,password=randomBytes(32).toString('base64url');
  const result=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Startup QA ${index}`}});
  assert.ifError(result.error);const id=result.data.user.id;created.push(id);
  const client=createClient(url,key,{...options,realtime:{transport:WebSocket}});clients.push(client);
  const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
  const token=signed.data.session?.access_token;assert.ok(token);
  const user={id,token,client};created[index]=user;
  assert.equal((await api('/api/user-sync?userId='+id,user)).status,200);
 }
 const [a,b]=created;
 for(const user of created){await home(user,null);await home(user,null);}
 profileDatabase(a,'unpaired');
 check('authenticated unpaired Home complete for both identities, including repeated reads');
 const codes=[];
 for(const user of created){
  const status=await api('/api/friends/status?userId='+user.id,user);assert.equal(status.status,200);assert.ok(status.data.inviteCode);
  const repeat=await api('/api/friends/status?userId='+user.id,user);assert.equal(repeat.data.inviteCode,status.data.inviteCode);codes.push(status.data.inviteCode);
  await user.client.realtime.setAuth(user.token);
  await subscribe(user,user.client,'pairing','pairing_changed');
  await subscribe(user,user.client,'burrow','pair_changed');
 }
 check('stable invite codes and both private realtime subscriptions authorized');
 const unauthorized=await api('/api/friends/status?userId='+b.id,a);assert.equal(unauthorized.status,401);check('foreign identity read rejected');
 phase='pair';
 const paired=await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:codes[1],relationship:'Partner'}});assert.equal(paired.status,200,paired.data.error);assert.equal(paired.data.success,true);
 await delivered(created);
 let [ha,hb]=await Promise.all([home(a,b.id),home(b,a.id)]);assert.equal(ha.pairVersion,hb.pairVersion);assert.ok(ha.pairVersion);
 const firstVersion=ha.pairVersion;
 check('both Home snapshots paired with the same relationship generation');
 profileDatabase(a,'paired');
 if(process.argv.includes('--home-samples')){
  for(let index=0;index<10;index++)await home(index%2?a:b,index%2?b.id:a.id);
  await Promise.all([home(a,b.id),home(b,a.id),home(a,b.id),home(b,a.id)]);
  check('repeated and overlapping paired Home reads stay in the current relationship scope');
 }
 const before=await state(created);
 const mine=new Set(ha.inventory.filter(row=>row.owner_id===a.id).map(row=>row.item_id));
 const item=ha.catalog.find(row=>row.item_type==='decor'&&!row.plus_only&&row.price>0&&row.price<999999&&!mine.has(row.stable_id));assert.ok(item,'safe quoted-price rejection candidate');
 const rejected=await api('/api/vnext/command',a,{method:'POST',body:{action:'purchase_catalog_item',itemId:item.stable_id,idempotencyKey:randomUUID(),expectedPrice:item.price+1}});
 assert.equal(rejected.status,409);assert.equal(rejected.data.error,'price_changed');check('Shop altered quote rejected before debit');
 const game=ha.catalog.find(row=>row.item_type==='game'&&!row.plus_only&&row.price>0);assert.ok(game);
 const gameId=game.metadata?.gameId??game.stable_id.slice('game:'.length);
 const gameRejected=await api('/api/vnext/game-room',a,{method:'POST',body:{action:'unlock',gameId,key:randomUUID(),expectedPrice:game.price+1}});
 assert.equal(gameRejected.status,409);assert.equal(gameRejected.data.error,'price_changed');check('Game altered quote rejected before unlock/debit');
 const plus=ha.catalog.find(row=>row.item_type==='game'&&row.plus_only);assert.ok(plus);assert.equal(ha.hasPlus,false);
 const plusRejected=await api('/api/vnext/game-room',a,{method:'POST',body:{action:'unlock',gameId:plus.metadata?.gameId??plus.stable_id.slice('game:'.length),key:randomUUID(),expectedPrice:plus.price}});
 assert.equal(plusRejected.status,403);assert.equal(plusRejected.data.error,'plus_required');check('Plus access remains server-checked');
 const invalid=await api('/api/vnext/command',a,{method:'POST',body:{action:'purchase_catalog_item',itemId:item.stable_id,idempotencyKey:randomUUID(),expectedPrice:-1}});assert.equal(invalid.status,400);
 const receipt=await api('/api/vnext/coins/verify',a,{method:'POST',body:{platform:'ios',productId:'invalid',purchaseToken:''}});assert.equal(receipt.status,400);check('invalid amount and invalid receipt rejected without payment-store requests');
 const privateRpc=await a.client.rpc('purchase_catalog_item_v2',{p_buyer_id:a.id,p_recipient_id:a.id,p_item_id:item.stable_id,p_idempotency_key:randomUUID(),p_expected_price:item.price+1});
 assert.ok(privateRpc.error);assert.equal(privateRpc.error.code,'42501');check('authenticated client cannot directly execute financial service RPC');
 assert.deepEqual(plain(await state(created)),plain(before));check('rejected requests left wallet versions, ledgers, inventories and unlocks unchanged');
 phase='unpair';
 const unpaired=await api('/api/friends/pair',a,{method:'DELETE',body:{userId:a.id}});assert.equal(unpaired.status,200);assert.equal(unpaired.data.success,true);
 await delivered(created);await Promise.all([home(a,null),home(b,null)]);
 for(const user of created){const pair=await api('/api/friends/pair?userId='+user.id,user);assert.equal(pair.status,200);assert.equal(pair.data.paired,false);}
 check('Unpair clears both Home and Menu pairing states');
 phase='repair';
 const repaired=await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:codes[1],relationship:'Partner'}});assert.equal(repaired.status,200,repaired.data.error);
 await delivered(created);[ha,hb]=await Promise.all([home(a,b.id),home(b,a.id)]);
 assert.equal(ha.pairVersion,hb.pairVersion);assert.notEqual(ha.pairVersion,firstVersion);
 check('re-pair creates a fresh shared generation, not the former relationship scope');
 if(process.argv.includes('--keyword-retirement')) {
  const retired=await api('/api/item-rules?catalog=old',a);
  assert.equal(retired.status,410);assert.equal(retired.data.error,'keyword_matching_retired');
  check('authenticated old rules endpoint is retired without loading rules');
  const groups=JSON.parse(fs.readFileSync(path.join(root,'packages/engine/src/items/tap-your-day-local.json'),'utf8'));
  const choice=groups[0].defaults[0];assert.ok(choice.itemId);
  const newItems=JSON.parse(fs.readFileSync(path.join(root,'packages/engine/src/items/tap-your-day-display.json'),'utf8'));
  const catalog=await db.from('items').select('id,display_name,rarity').in('id',Object.keys(newItems));
  assert.ifError(catalog.error);assert.equal(catalog.data.length,207);
  for(const item of catalog.data){assert.equal(item.display_name,newItems[item.id].displayName);assert.equal(item.rarity,'common');}
  check('all 207 new manual IDs are registered with canonical metadata');
  const current=groups.flatMap(group=>[...group.defaults,...group.optional]);
  const sampleNew=groups.flatMap(group=>{
   const choices=[...group.defaults,...group.optional].filter(x=>x.itemId.startsWith('memory.new_'));
   return [choices[0],choices.at(-1)].filter(Boolean);
  });
  const selected=[...new Map([choice,...sampleNew,...['memory.new_ice_cream','memory.new_beer'].map(id=>current.find(x=>x.itemId===id))].map(x=>[x.itemId,x])).values()];
  assert.ok(selected.length<=30&&selected.length>10);
  const save=async(user,input)=>api('/api/reflect/prepare',user,{method:'POST',body:{
   userId:user.id,promptId:9,idempotencyKey:randomUUID(),...input,
  }});
  const manual=await save(a,{mode:'prompt',selectionVersion:'tap-your-day-v5',body:'',
   selectedItems:selected.map(x=>({itemId:x.itemId,label:'Spoofed label',kind:'wrong'}))});
  assert.equal(manual.status,200,manual.data.error);
  assert.equal(manual.data.matches.length,selected.length);
  assert.deepEqual(manual.data.matches.map(({itemId,label})=>({itemId,label})),selected);
  assert.equal(manual.data.matches[0].itemId,choice.itemId);
  assert.equal(manual.data.matches[0].label,choice.label);
  const savedItems=await db.from('reflect_items').select('item_id,match_label').eq('user_id',a.id).eq('reflect_id',manual.data.reflectId);
  assert.ifError(savedItems.error);
  assert.deepEqual(savedItems.data.map(x=>({itemId:x.item_id,label:x.match_label})).sort((x,y)=>x.itemId.localeCompare(y.itemId)),[...selected].sort((x,y)=>x.itemId.localeCompare(y.itemId)));
  check('v5 selections across new categories and renamed-file icons persist all IDs and canonical labels');
  const text=await save(b,{mode:'typing',body:'Made coffee, ate pizza and went running.',
   selectedItems:[{itemId:choice.itemId}],matchingVersion:{catalog:'old',revision:999},removedItemIds:[]});
  assert.equal(text.status,200,text.data.error);assert.deepEqual(text.data.matches,[]);
  const retry=await api('/api/reflect/prepare',a,{method:'POST',body:{userId:a.id,promptId:9,
   idempotencyKey:randomUUID(),mode:'prompt',selectionVersion:'tap-your-day-v5',
   body:'',selectedItems:[{itemId:'untrusted.fake'}]}});
  assert.equal(retry.status,400);assert.equal(retry.data.error,'invalid_selection_item');
  const persisted=await db.from('reflect_drafts').select('user_id,matches').in('user_id',[a.id,b.id]);
  assert.ifError(persisted.error);
  assert.equal(persisted.data.find(x=>x.user_id===a.id)?.matches[0]?.itemId,choice.itemId);
  assert.deepEqual(persisted.data.find(x=>x.user_id===b.id)?.matches,[]);
  check('manual selection saves stable IDs and canonical names; text never creates automatic icons; fabricated IDs rejected');
 }
 report.realtimeEvents=events.map(({phase,topic,event})=>({phase,topic,event}));
}
async function publicChecks(){
 for(const route of ['/api/vnext/bootstrap','/api/vnext/command','/api/vnext/game-room','/api/vnext/coins/verify','/api/friends/pair']){
  const post=['/api/vnext/command'].includes(route);const result=await api(route,null,post?{method:'POST',body:{}}:{});assert.equal(result.status,401,route);
  (report.publicReads??=[]).push({route,ms:result.ms,headersMs:result.headersMs,serverTiming:result.serverTiming,region:result.region});
 }
 check('all Home/pairing/financial routes reject unauthenticated requests');
}
let failed;
try {
 const coldFirst=process.argv.includes('--cold-home-first');
 if(!coldFirst)await publicChecks();
 if(process.argv.includes('--fixtures'))await fixtures();
 else report.authenticatedChecks='Not run: pass --fixtures to explicitly create disposable verification identities';
 if(coldFirst)await publicChecks();
 if(process.argv.includes('--expect-regional-home')){
  assert.ok(report.homeReads.length>=10);
  assert.ok(report.homeReads.every(row=>row.serverTiming&&row.region?.includes('::pdx1::')),'Home must execute next to the database');
  assert.ok(report.homeReads.every(row=>row.ms<5000),'A sampled Home request exceeded five seconds; inspect timing stages');
  check('all sampled regional Home reads completed under five seconds');
 }
}catch(error){failed=error;report.failure=error.message;}
finally {
 for(const client of clients){try{await client.removeAllChannels();client.realtime.disconnect();}catch{}}
 const cleanup=[];
 for(const entry of created){
  const id=typeof entry==='string'?entry:entry.id;
  try{
   const auth=await db.auth.admin.getUserById(id);assert.ifError(auth.error);
   assert.equal(auth.data.user.app_metadata?.verificationRun,runId);assert.equal(auth.data.user.app_metadata?.purpose,purpose);
   const profile=await db.from('profiles').delete().eq('id',id);assert.ifError(profile.error);
   const removed=await db.auth.admin.deleteUser(id);assert.ifError(removed.error);cleanup.push({id,removed:true});
  }catch(error){cleanup.push({id,removed:false,error:error.message});}
 }
 report.cleanup={complete:cleanup.every(row=>row.removed),identities:cleanup};
 report.passed=!failed&&report.cleanup.complete;
 const target=process.argv.find(arg=>arg.startsWith('--report='))?.slice('--report='.length);
 if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
if(failed||!report.cleanup.complete)process.exitCode=1;
