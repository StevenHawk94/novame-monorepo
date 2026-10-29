// Exact migration/release SQL, real isolated PostgreSQL and synthetic data only.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,afterEach,test} from 'node:test';import assert from 'node:assert/strict';
import {securityTestDb} from './security-test-db.mjs';
import {test285Pair,test285Transaction,test285Functions} from './release-test-pair285.mjs';
const [B,A]=test285Pair,C=randomUUID(),D=randomUUID(),oldA='b8ebeeb8-4353-4baa-a75e-ace1ab4a0af1',oldB='d896d176-96f7-4f7f-af15-42284f251251';
const src=n=>fs.readFileSync(`supabase/migrations/${n}.sql`,'utf8');
function definition(sql,name){const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);if(!start)throw Error(name);const tail=sql.slice(start.index),d=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(d[1],d.index+d[0].length);return tail.slice(0,end+d[1].length)+';';}
let h,db,q,rpc,toy,photos={},verified,game,frame;
const pv=(a=A,b=B)=>rpc('burrow_pair_version_v1',[a,b]);
const day=async a=>(await rpc('economic_calendar_v1',[a])).localDate;
const snapshot=(patch={})=>({store:'apple',environment:'sandbox',credential:'test285-'+randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000*30).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString(),...patch});
async function deny(sql,args,pattern=/economic_domain_mismatch/){await db.exec('savepoint rejected');await assert.rejects(q(sql,args),pattern);await db.exec('rollback to savepoint rejected');}
async function close(kind='disabled'){
 if(kind==='expired')await q("update burrow_temporary_test_pair set enabled_at=statement_timestamp()-interval '169 hours',expires_at=statement_timestamp()-interval '1 hour'");
 else await q('update burrow_temporary_test_pair set enabled=false');
}
async function start(user=A){
 const record=randomUUID(),key=randomUUID();await q("insert into reflects(id,user_id,local_date,journal_kind) values($1,$2,(now() at time zone economic_timezone_v1($2))::date,'tap_your_day')",[record,user]);
 await q('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[user,record]);
 const partner=(await q('select partner_user_id from pairings where user_id=$1',[user]))[0]?.partner_user_id??null;
 const args=[user,record,key,h.release.release,partner,partner?await pv(user,partner):null];return{args,result:await rpc('start_adventure_v5',args)};
}
const clip={version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]};
const touchArgs=async(user=A,partner=B)=>[user,partner,await pv(user,partner),await day(user),randomUUID(),toy,photos[user],clip];
before(async()=>{
 h=await securityTestDb();({db,query:q,rpc}=h);
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
 alter table pairings add column relationship text;alter table pairings add column relationship_since date;
 create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;
 alter table profiles add column invite_code text;`);
 await db.exec(src('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(src('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(src('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 for(const n of ['20261021000257_adventure_production_duration','20261025000273_bunny_identity','20261025000274_cooperative_adventure','20261025000275_bind_unpaired_adventure',
  '20261025000276_plushie_touch','20261026000277_touch_note_v2'])await db.exec(src(n));
 for(const id of [A,B,C,D,oldA,oldB]){await q('insert into auth.users(id) values($1)',[id]);await q('insert into profiles(id) values($1)',[id]);await q('insert into wallets(user_id,carrot_balance) values($1,10000)',[id]);}
 await q('update profiles set invite_code=case when id=$1 then $2 else $3 end where id in($1,$4)',[A,'24FAGF','88US9W',B]);
 await rpc('pair_immediately',[A,B,'Partner',null]);await rpc('pair_immediately',[C,D,'Partner',null]);await rpc('pair_immediately',[oldA,oldB,'Partner',null]);
 await rpc('admit_store_economic_domain_v1',[A,'sandbox']);await rpc('admit_store_economic_domain_v1',[C,'sandbox']);
 await db.exec(src('20261027000280_touch_note_test_pair'));
 for(const name of ['interact_burrow_toy_batch_v1','interact_burrow_toy_v1'])await db.exec(definition(src('20261022000258_plushie_moment_windows'),name));
 await db.exec(src('20261027000281_personal_plushie_photo_visibility'));await db.exec(src('20261027000282_received_touch_history_and_personal_photo_moments'));
 // Replace only the fixture's minimal stub with the actual Surprise schema.
 await db.exec('drop table burrow_surprises');
 const surprise=src('20261008000204_burrow_surprise_room');
 await db.exec(surprise.slice(surprise.indexOf('create table public.burrow_surprises'),surprise.indexOf('alter table public.burrow_surprises enable')));
 await db.exec('alter table burrow_surprises add column price_paid integer not null default 300;create trigger security_surprise_domain before insert or update of sender_id,recipient_id,paid_at on burrow_surprises for each row execute function enforce_economic_transfer_v1();'.replace(' or update of sender_id,recipient_id,paid_at',''));
 const services=src('20261013000227_burrow_service_catalog_permissions');
 await db.exec(definition(services,'prepare_burrow_surprise_v2'));
 await db.exec(src('20261022000261_surprise_paid_delivery'));
 await db.exec("alter table burrow_surprises drop constraint burrow_surprises_frame_check;alter table burrow_surprises add constraint burrow_surprises_frame_check check(burrow_shop_frame_storage_v1(frame))");
 await db.exec('drop trigger security_surprise_domain on burrow_surprises;create trigger security_surprise_domain before insert or update of sender_id,recipient_id,paid_at on burrow_surprises for each row execute function enforce_economic_transfer_v1()');
 await db.exec("alter table burrow_game_unlocks add column if not exists price_paid integer default 150;alter table burrow_game_unlocks drop constraint if exists burrow_game_unlocks_price_paid_check;create table if not exists burrow_game_purchase_receipts(actor_id uuid,key uuid,game_id text,price_paid integer,primary key(actor_id,key));");
 await db.exec(definition(src('20261015000238_burrow_free_games'),'burrow_game_unlock_v2'));
 await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.equal(await rpc('burrow_has_plus_v1',[B]),false,'pre-migration production account is not shared Plus');
 const quotes=new Map((await q('select stable_id,price,plus_only from catalog_items')).map(p=>[p.stable_id,p]));
 h.priced=h.release.products.map(p=>({...p,price:quotes.get(p.id).price,plusOnly:quotes.get(p.id).plus_only}));
 game=h.priced.find(p=>p.type==='game'&&p.status==='active'&&p.price>0&&!p.plusOnly);frame=h.priced.find(p=>p.type==='surprise'&&p.status==='active');
 toy=h.release.products.find(p=>p.category==='couple_dolls'&&p.metadata.starter).id;
 for(const user of [A,B]){photos[user]=randomUUID();await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by) values($1,least($2::uuid,$3::uuid),greatest($2::uuid,$3::uuid),$2,'doll',$4,'qa/synthetic.jpg',$2)",[photos[user],user,user===A?B:A,toy]);}
 await q("update app_config set value='true' where key in('adventure_friends_v2_enabled','app_major_update_enabled')");
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations(version) values('20261028000284');");
 if(process.env.BURROW_TEST285_DEPLOYED_FUNCTIONS){
  const rows=JSON.parse(fs.readFileSync(process.env.BURROW_TEST285_DEPLOYED_FUNCTIONS)).rows;
  const reviewed=rows.filter(r=>test285Functions.includes(r.signature.split('(')[0]));assert.equal(reviewed.length,test285Functions.length);
  for(const r of reviewed)await db.exec(r.definition);
 }
 const originals=await q("select oid::regprocedure::text signature,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and proname=any($1)",[test285Functions]);
 const transaction=test285Transaction(originals,await pv()),wallets=await q('select * from wallets order by user_id');
 await assert.rejects(db.exec(transaction.replace('create temporary table test285_after','update wallets set carrot_balance=1;create temporary table test285_after')),/Protected rows changed/);await db.exec('rollback');
 assert.deepEqual(await q('select * from wallets order by user_id'),wallets);
 await assert.rejects(db.exec(transaction.replace('create temporary table test285_after',()=>"create or replace function public.same_economic_domain_v1(p_a uuid,p_b uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select true$$;create temporary table test285_after")),/Unrelated function changed/);await db.exec('rollback');
 verified=(await db.exec(transaction)).find(r=>r.rows?.some(v=>v.verified))?.rows.find(v=>v.verified).verified;assert.ok(verified.protectedRowsUnchanged);
 // Re-run the existing cross-feature isolation/recovery suite against the
 // candidate, not only against its historical pre-288 baseline.
 if(process.env.BURROW_PLUS288_CANDIDATE==='1'||process.env.BURROW_ADVENTURE289_CANDIDATE==='1')await db.exec(src('20261029000288_adventure_upgrade_and_owned_games'));
 if(process.env.BURROW_ADVENTURE289_CANDIDATE==='1')await db.exec(src('20261029000289_adventure_nudge_availability'));
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('exact release transaction preserves old rows/security and enables only current approved reciprocal pair for exactly 168 hours',async()=>{
 assert.ok(verified.protectedSets>30);assert.ok(verified.unrelatedFunctionsUnchanged);assert.ok(verified.existingPermissionsUnchanged);
 for(const[a,b]of[[A,B],[B,A]]){assert.equal(await rpc('burrow_test_pair_allowed_v1',[a,b]),true);assert.equal(await rpc('burrow_pair_economy_allowed_v1',[a,b]),true);assert.equal(await rpc('same_economic_domain_v1',[a,b]),false);}
 for(const[a,b]of[[A,C],[C,D],[A,A],[null,B],[oldA,oldB]])assert.equal(await rpc('burrow_test_pair_allowed_v1',[a,b]),false);
 assert.equal((await q("select extract(epoch from(expires_at-enabled_at))::int seconds from burrow_temporary_test_pair"))[0].seconds,604800);
 for(const table of ['burrow_temporary_test_pair','burrow_test_transfer_admissions'])for(const role of ['anon','authenticated','service_role'])for(const action of ['INSERT','UPDATE','DELETE'])assert.equal((await q('select has_table_privilege($1,$2,$3) allowed',[role,table,action]))[0].allowed,false);
 for(const role of ['anon','authenticated'])for(const name of ['burrow_test_pair_allowed_v1','burrow_pair_economy_allowed_v1'])assert.equal((await q('select has_function_privilege($1,$2,$3) allowed',[role,name+'(uuid,uuid)','execute']))[0].allowed,false);
 await deny("update burrow_temporary_test_pair set expires_at=enabled_at+interval '169 hours'",[],/check constraint/);
});
test('Plus shares a verified active subscription only; expiry/disable/revocation remove authority without rewriting economic domains',async()=>{
 assert.equal(await rpc('has_own_active_plus',[B]),false);assert.equal(await rpc('burrow_has_plus_v1',[B]),true);
 const home=await rpc('burrow_bootstrap_v2',[B]);assert.equal(home.error??null,null,JSON.stringify(home));assert.equal(home.hasPlus,true,'Home receives current shared Plus without fabricating a profile subscription');
 const domains=await q('select * from account_economic_domains order by user_id');
 await rpc('refresh_economic_entitlements_v1',[B]);assert.equal((await q('select subscription_tier from profiles where id=$1',[B]))[0].subscription_tier,'plus');
 await close('expired');assert.equal(await rpc('burrow_has_plus_v1',[B]),false);assert.equal(await rpc('burrow_has_plus_v1',[A]),true);
 await rpc('refresh_economic_entitlements_v1',[B]);assert.equal((await q('select subscription_tier from profiles where id=$1',[B]))[0].subscription_tier,'free');
 assert.deepEqual(await q('select * from account_economic_domains order by user_id'),domains);
 assert.equal((await rpc('admit_store_economic_domain_v1',[A,'production'])).error,'sandbox_account_conflict');
});
test('revoked verified subscription cannot be revived by the active exception or cached profile tiers',async()=>{
 const old=(await q('select snapshot from store_subscription_states where user_id=$1',[A]))[0].snapshot;
 const later=new Date(Date.now()+1000).toISOString();const result=await rpc('reconcile_store_subscription_v3',[A,{...old,state:'revoked',observedAt:later,eventAt:later}]);assert.equal(result.success,true);
 assert.equal(await rpc('burrow_has_plus_v1',[A]),false);assert.equal(await rpc('burrow_has_plus_v1',[B]),false);assert.equal(await rpc('burrow_test_pair_allowed_v1',[A,B]),true);
});
test('disabled switch denies all new pair permissions, stale profile labels cannot grant; same-domain and old Touch-only exceptions retain scope',async()=>{
 await close();assert.equal(await rpc('burrow_test_pair_allowed_v1',[A,B]),false);assert.equal(await rpc('burrow_has_plus_v1',[B]),false);
 await q("update profiles set subscription_tier='plus' where id=$1",[B]);assert.equal(await rpc('burrow_has_plus_v1',[B]),false);
 assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[oldA,oldB,await pv(oldA,oldB)]),true);assert.equal(await rpc('burrow_test_pair_allowed_v1',[oldA,oldB]),false);
 assert.equal(await rpc('burrow_pair_economy_allowed_v1',[oldA,oldB]),true,'ordinary same-domain pair unchanged');
 await rpc('admit_store_economic_domain_v1',[oldA,'sandbox']);assert.equal(await rpc('burrow_pair_economy_allowed_v1',[oldA,oldB]),false,'old Touch exception does not grant general economy');
});
test('existing usage from another relationship is not reset by temporary shared Plus',async()=>{
 await q("insert into plushie_touch_sends(user_id,command_key,local_date,request_hash,receipt) values($1,$2,$3,$4,$5)",[B,randomUUID(),await day(B),'a'.repeat(32),{success:true,version:1,messageId:randomUUID()}]);
 assert.equal((await rpc('plushie_touch_state_v2',[B,await pv()])).remaining,0);
 assert.equal((await rpc('send_plushie_touch_v1',await touchArgs(B,A))).error,'touch_quota_used');
});
test('relationship rotation, one-way pairing or foreign partner cannot inherit temporary permissions',async()=>{
 const version=await pv();await q('delete from pairings where user_id in($1,$2)',[A,B]);assert.equal(await rpc('burrow_test_pair_allowed_v1',[A,B]),false);
 await rpc('pair_immediately',[A,B,'Partner',null]);assert.notEqual(await pv(),version);assert.equal(await rpc('burrow_test_pair_allowed_v1',[A,B]),false);
 assert.equal(await rpc('burrow_has_plus_v1',[B]),false);
});
test('Couple Adventure joins one frozen progress stream with independent log/reward records and replay; expiry prevents new joining/Nudge',async()=>{
 const a=await start(A);assert.equal(a.result.durationSeconds,10800);assert.equal(a.result.joined,false);
 assert.equal((await rpc('adventure_team_snapshot_v1',[A])).nudgeAvailable,true);
 const key=randomUUID();const n=await rpc('nudge_adventure_v1',[A,a.result.team.id,key]);assert.equal(n.alreadySent,false);assert.deepEqual(await rpc('nudge_adventure_v1',[A,a.result.team.id,key]),n);
 const payload=(await q("select payload from notification_outbox where event_key=$1",['adventure-nudge:'+a.result.team.id]))[0].payload;
 assert.equal((await rpc('system_notification_context_v1',[B,'adventure_invite',payload])).allowed,true);
 const b=await start(B);assert.equal(b.result.joined,true);assert.equal(b.result.team.id,a.result.team.id);assert.equal((await q('select count(*)::int n from adventures where user_id in($1,$2)',[A,B]))[0].n,2);
 const deadline=b.result.endsAt;await close('expired');assert.equal((await rpc('adventure_team_snapshot_v1',[A])).team.endsAt,deadline);
 assert.equal((await rpc('system_notification_context_v1',[B,'adventure_invite',payload])).allowed,false);
 assert.deepEqual(await rpc('start_adventure_v5',b.args),b.result,'committed result survives expiry without a second start');
});
test('pre-pair never-bound Solo can recover for this pair only under its frozen generation',async()=>{
 await q('delete from pairings where user_id in($1,$2)',[A,B]);const a=await start(A);await rpc('pair_immediately',[A,B,'Partner',null]);
 // New relationship is NOT implicitly allowed; explicitly seed only this isolated test's approved generation.
 await q('update burrow_temporary_test_pair set pair_version=$1',[await pv()]);
 const current=await rpc('adventure_team_snapshot_v1',[B]);assert.equal(current.joinable.id,a.result.team.id);
 const b=await start(B);assert.equal(b.result.joined,true);
});
test('already running independent Solo journeys do not merge on permission activation; expired exception prevents new join and Nudge',async()=>{
 await close();const a=await start(A),b=await start(B);assert.notEqual(a.result.team.id,b.result.team.id);assert.equal(b.result.joined,false);
 await q('update burrow_temporary_test_pair set enabled=true');assert.equal((await rpc('adventure_team_snapshot_v1',[A])).team.id,a.result.team.id);assert.equal((await rpc('adventure_team_snapshot_v1',[B])).team.id,b.result.team.id);
 await close('expired');assert.equal((await rpc('nudge_adventure_v1',[A,a.result.team.id,randomUUID()])).error,'adventure_invite_unavailable');
});
test('an active exception does not admit a third-party transfer; rejected insert rolls back an earlier debit',async()=>{
 const item=h.priced.find(p=>p.metadata.slot&&!p.metadata.starter&&p.price>0&&p.status==='active');
 const before=(await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance;
 await db.exec('savepoint foreign_transfer');await q('update wallets set carrot_balance=carrot_balance-100 where user_id=$1',[A]);
 await assert.rejects(q("insert into gifts(sender_id,recipient_id,item_id,reason,idempotency_key) values($1,$2,$3,'shop','foreign')",[A,D,item.id]),/economic_domain_mismatch/);
 await db.exec('rollback to savepoint foreign_transfer');assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,before);
});
test('paid games honor real prices, independent debit and idempotency; expired exception denies a fresh paid offer',async()=>{
 assert.ok(game);const args=[B,game.metadata.gameId,randomUUID(),game.price],before=(await q('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance;
 const receipt=await rpc('burrow_game_unlock_v2',args);assert.equal(receipt.error,null);assert.equal(receipt.charged,true);
 assert.equal((await rpc('burrow_game_unlock_v2',args)).charged,false);assert.equal((await q('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance,before-game.price);
 await close('expired');assert.equal((await rpc('burrow_game_unlock_v2',args)).unlocked,true,'paid ownership remains');
 assert.equal((await rpc('burrow_service_offer_v1',[B,game.id,'game'])).error,game.plusOnly?'plus_required':'economic_domain_mismatch');
 assert.equal((await rpc('burrow_service_offer_v1',[C,game.id,'game'])).error,game.plusOnly?'plus_required':'economic_domain_mismatch');
});
test('Shop gift admits only approved transfers, debits sender once, survives expiry claim without permission to a new transfer',async()=>{
 const item=h.priced.find(p=>p.metadata.slot&&!p.metadata.starter&&p.price>0&&p.status==='active');assert.ok(item);
 const args=[A,B,item.id,'gift285',item.price],before=(await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance;
 const receipt=await rpc('purchase_catalog_item_v2',args);assert.equal(receipt.error,null);assert.equal((await rpc('purchase_catalog_item_v2',args)).applied,false);
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,before-item.price);
 const gift=(await q('select id from gifts where sender_id=$1 and recipient_id=$2',[A,B]))[0].id;
 await close('expired');const claimed=await rpc('claim_personal_shop_gift_v1',[B,gift,false,await pv()]);assert.equal(claimed.error,null);assert.equal(claimed.applied,true);
 assert.equal((await q('select 1 from user_inventory where owner_id=$1 and item_id=$2',[B,item.id])).length,1);
 await deny('insert into gifts(sender_id,recipient_id,item_id,reason,idempotency_key) values($1,$2,$3,$4,$5)',[A,B,item.id,'shop','new-expired']);
 await deny('update gifts set recipient_id=$1 where id=$2',[D,gift]);
});
test('Surprise real payment is idempotent; paid upload completion survives expiry, unpaid ticket cannot be newly charged',async()=>{
 assert.ok(frame);const input=[B,A,await pv(),randomUUID(),frame.metadata.frameId,1000,'a'.repeat(64),frame.price];
 const paid=await rpc('pay_burrow_surprise_v1',input);assert.equal(paid.error??null,null,JSON.stringify(paid));assert.equal(paid.paid,true);assert.deepEqual(await rpc('pay_burrow_surprise_v1',input),paid);
 const pending=await rpc('prepare_burrow_surprise_v2',[...input.slice(0,3),randomUUID(),...input.slice(4)]);assert.ok(pending.id);
 for(const id of [paid.id,pending.id]){const row=(await q('select * from burrow_surprises where id=$1',[id]))[0];await q("insert into storage.objects(bucket_id,name) values('burrow-surprises',$1),('burrow-surprises',$2)",[row.photo_path,row.audio_path]);}
 await close('expired');const complete=await rpc('complete_burrow_surprise_v1',[B,paid.id]);assert.equal(complete.applied,true,JSON.stringify(complete));assert.equal((await rpc('complete_burrow_surprise_v1',[B,paid.id])).applied,false);
 await deny('update burrow_surprises set paid_at=now() where id=$1',[pending.id]);
 const balance=(await q('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance;
 assert.equal((await rpc('complete_burrow_surprise_v1',[B,pending.id])).error,'economic_domain_mismatch','legacy unpaid completion cannot debit after expiry');
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance,balance);
 await deny('insert into burrow_surprises(sender_id,recipient_id,pair_version,idempotency_key,frame,photo_path,audio_path,duration_ms,digest) values($1,$2,$3,$4,$5,$6,$7,1000,$8)',[A,B,await pv(),randomUUID(),frame.metadata.frameId,'x','y','b'.repeat(64)]);
});
test('Touch Note keeps true domains, shared Plus daily quotas and incoming-only history; expiry denies new sends but not committed replay/read',async()=>{
 for(const user of [A,B]){const state=await rpc('plushie_touch_state_v2',[user,await pv()]);assert.equal(state.sameDomain,false);assert.equal(state.sendAllowed,true);assert.equal(state.hasPlus,true);assert.equal(state.sendHasPlus,true);}
 const input=await touchArgs(A,B),sent=await rpc('send_plushie_touch_v1',input);assert.equal(sent.success,true);
 assert.equal((await rpc('send_plushie_touch_v1',await touchArgs(A,B))).error,'touch_quota_used');
 assert.equal((await rpc('read_plushie_touch_v2',[A,await pv(),sent.messageId,false])).error,'not_found');
 await close('expired');assert.equal((await rpc('plushie_touch_state_v2',[B,await pv()])).sendAllowed,false);
 assert.deepEqual(await rpc('send_plushie_touch_v1',input),sent);assert.equal((await rpc('send_plushie_touch_v1',await touchArgs(B,A))).error,'economic_domain_conflict');
 assert.equal((await rpc('read_plushie_touch_v2',[B,await pv(),sent.messageId,true])).message.id,sent.messageId);
});
