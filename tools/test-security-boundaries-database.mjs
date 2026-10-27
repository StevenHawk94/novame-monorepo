import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {securityTestDb} from './security-test-db.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
let h,db,q,rpc;
before(async()=>{h=await securityTestDb({beforeCalendar:async({query:q})=>{
 await q('insert into auth.users(id) values($1)',[C]);
 await q("insert into profiles(id,timezone_name) values($1,'Asia/Shanghai')",[C]);
}});({db,query:q,rpc}=h)});
after(()=>db?.close());beforeEach(async()=>{
 await db.exec('begin');
 await q('insert into auth.users(id) values($1),($2)',[A,B]);
 await q('insert into profiles(id) values($1),($2)',[A,B]);
 await q('insert into wallets(user_id,carrot_balance) values($1,1000),($2,1000)',[A,B]);
});afterEach(()=>db.exec('rollback'));
const snapshot=(patch={})=>({store:'apple',environment:'production',credential:'12345678',transactionId:'23456789',
 productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),
 observedAt:new Date().toISOString(),eventAt:new Date().toISOString(),...patch});
const sub=(user=A,patch={})=>rpc('reconcile_store_subscription_v3',[user,snapshot(patch)]);
const plus=(user=A)=>rpc('burrow_has_plus_v1',[user]);
const pair=()=>q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
const coin=(user=A,env='sandbox',credential='coin-1',patch={})=>rpc('apply_burrow_coin_purchase_v2',[
 user,'apple',env,credential,'burrow.coin.200',1,0,new Date().toISOString(),env==='sandbox',...[]].map((v,i)=>patch[i]??v));

test('expired/revoked/pending/unknown state never grants; historic apply is closed',async()=>{
 for(const state of ['expired','revoked','on_hold','paused']){assert.equal((await sub(A,{state})).success,true);assert.equal(await plus(),false)}
 for(const patch of [{state:'pending'},{state:'active',periodEnd:new Date(Date.now()-1000).toISOString()},{periodEnd:null}]){
  assert.equal((await sub(A,patch)).error,'invalid_store_snapshot');assert.equal(await plus(),false);
 }
 assert.equal((await rpc('apply_store_subscription',[A,'apple','plus','solo','monthly',new Date(Date.now()+86400000).toISOString()])).error,'verified_state_required');
});
test('future active and verified grace grant, revocation removes both borrowed tiers',async()=>{
 await pair();assert.equal((await sub()).tier,'plus');assert.equal(await plus(A),true);assert.equal(await plus(B),true);
 await sub(A,{state:'grace_period'});assert.equal(await plus(B),true);
 await sub(A,{state:'revoked'});assert.equal(await plus(A),false);assert.equal(await plus(B),false);
});
test('receipt ownership and stale responses cannot overwrite latest authority',async()=>{
 const time=new Date();await sub(A,{observedAt:time.toISOString(),eventAt:time.toISOString()});
 assert.equal((await sub(B)).error,'purchase_account_conflict');
 const old=new Date(time.getTime()-1000).toISOString();assert.equal((await sub(A,{state:'revoked',observedAt:old,eventAt:old})).stale,true);
 assert.equal(await plus(),true);
});
test('automatic sandbox admission is sticky, shares only with sandbox partner',async()=>{
 await pair();assert.equal((await sub(A,{environment:'sandbox'})).tier,'plus');
 assert.equal(await rpc('economic_domain_v1',[A]),'sandbox');assert.equal(await plus(B),false);
 assert.equal((await coin(B)).error,null);assert.equal(await plus(B),true);
 assert.equal((await sub(A,{environment:'production'})).error,'sandbox_account_conflict');
 assert.equal((await coin(A,'production','live')).error,'sandbox_account_conflict');
});
test('real paid history prevents automatic sandbox conversion and does not lose coins',async()=>{
 await sub();assert.equal((await coin()).error,'production_account_conflict');assert.equal(await plus(),true);
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,1000);
});
test('corrupt/stale profile tiers cannot lift live quota; verified sandbox Plus only lifts its own quota',async()=>{
 await pair();await sub(A,{environment:'sandbox'});await q("update profiles set subscription_tier='plus' where id=$1",[B]);
 assert.equal((await rpc('burrow_affection_state_v1',[A,B])).affectionUsage.limit,6);
 assert.equal((await rpc('burrow_affection_state_v1',[B,A])).affectionUsage.limit,1);
 assert.equal(await plus(B),false);
});
test('paid collaborative games and new Surprise transfers cannot cross domains; free games still can',async()=>{
 await pair();await coin();
 await q(`insert into catalog_items(stable_id,revision_id,item_type,category,title,price,plus_only,status)
 select 'game:security',value,'game','games','Test',150,false,'active' from app_config where key='app_major_update_content_revision'`);
 assert.equal((await rpc('burrow_service_offer_v1',[A,'game:security','game'])).error,'economic_domain_mismatch');
 await q("update catalog_items set price=0 where stable_id='game:security'");
 assert.equal((await rpc('burrow_service_offer_v1',[A,'game:security','game'])).price,0);
 await q('savepoint surprise_attempt');
 await assert.rejects(q('insert into burrow_surprises(sender_id,recipient_id,idempotency_key) values($1,$2,$3)',[A,B,randomUUID()]),/economic_domain_mismatch/);
 await q('rollback to surprise_attempt');
});
test('cross-domain gift transaction rolls back earlier debit; own purchase still allowed',async()=>{
 await coin();await q('savepoint gift_attempt');
 await q('update wallets set carrot_balance=carrot_balance-100 where user_id=$1',[A]);
 await assert.rejects(q("insert into gifts(sender_id,recipient_id,item_id,reason,idempotency_key) select $1,$2,stable_id,'shop','cross' from catalog_items limit 1",[A,B]),/economic_domain_mismatch/);
 await q('rollback to gift_attempt');
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,1200);
 await q("insert into catalog_purchases(buyer_id,recipient_id,item_id,price_snapshot,idempotency_key) select $1,$1,stable_id,0,'self' from catalog_items limit 1",[A]);
});
test('Google grant + finish job is atomic, replay cannot credit or queue twice',async()=>{
 const token='private-google-token',credential=createHash('sha256').update(token).digest('hex');
 const args={p_user_id:A,p_store:'google',p_environment:'production',p_credential:credential,p_product_id:'burrow.coin.200',p_quantity:1,p_refunded:0,p_signed_at:new Date().toISOString(),p_allow_sandbox_room:false};
 assert.equal((await rpc('credit_google_coin_v3',[args,token,true])).delta,200);
 assert.equal((await rpc('credit_google_coin_v3',[args,token,true])).delta,0);
 assert.equal((await q('select count(*)::int n from store_finish_jobs'))[0].n,1);
 const job=(await q('select * from claim_store_finish_jobs_v1(1)'))[0];assert.ok(job.lease_id);
 assert.equal((await q('select * from claim_store_finish_jobs_v1(1)')).length,0);
 await rpc('complete_store_finish_job_v1',[job.key,randomUUID(),true]);assert.equal((await q('select finished_at from store_finish_jobs'))[0].finished_at,null);
 await rpc('complete_store_finish_job_v1',[job.key,job.lease_id,false]);
 assert.equal((await q('select attempts from store_finish_jobs'))[0].attempts,1);
 await q('update store_finish_jobs set next_attempt=now()-interval \'1 second\'');
 const retried=(await q('select * from claim_store_finish_jobs_v1(1)'))[0];
 await rpc('complete_store_finish_job_v1',[retried.key,retried.lease_id,true]);
 assert.equal((await q('select purchase_token from store_finish_jobs'))[0].purchase_token,null);
});
test('account deletion preserves receipt tombstone; another identity can never restore it',async()=>{
 await sub();await q('delete from auth.users where id=$1',[A]);
 assert.equal((await q('select user_id from store_credential_bindings'))[0].user_id,null);
 assert.equal((await sub(B)).error,'purchase_account_conflict');
});
test('deletion requires a live matching session, bounded proof attempts and expiry',async()=>{
 const session=randomUUID(),challenge=randomUUID(),proof='a'.repeat(64);
 await q('insert into auth.sessions(id,user_id) values($1,$2)',[session,A]);
 await rpc('security_delete_challenge_v1',[A,session,challenge,'create',proof]);
 assert.equal((await rpc('security_delete_challenge_v1',[B,session,challenge,'status'])).error,'session_revoked');
 for(let i=0;i<5;i++)assert.equal((await rpc('security_delete_challenge_v1',[A,session,challenge,'verify','b'.repeat(64)])).error,'invalid_confirmation');
 assert.equal((await rpc('security_delete_challenge_v1',[A,session,challenge,'verify',proof])).error,'too_many_attempts');
 await rpc('security_delete_challenge_v1',[A,session,challenge,'create',proof]);
 assert.equal((await rpc('security_delete_challenge_v1',[A,session,challenge,'verify',proof])).success,true);
 await q('delete from auth.sessions where id=$1',[session]);
 assert.equal((await rpc('security_delete_challenge_v1',[A,session,challenge,'status'])).error,'session_revoked');
});
test('client roles have no grants to choose domain, create receipts or confirm deletion',async()=>{
 for(const role of ['anon','authenticated'])for(const sig of ['reconcile_store_subscription_v3(uuid,jsonb)','admit_store_economic_domain_v1(uuid,text)',
 'security_delete_challenge_v1(uuid,uuid,uuid,text,text)','credit_google_coin_v3(jsonb,text,boolean)',
 'economic_timezone_v1(uuid)','economic_calendar_v1(uuid)',
 'apply_burrow_coin_purchase_pre_domain_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean)'])
  assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,sig]))[0].allowed,false,sig);
 assert.equal((await q("select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects' and cmd='INSERT'"))[0].n,0);
});

test('fixed economic date survives profile timezone hopping; Plus bonus grants exactly once',async()=>{
 await sub();
 await q("update profiles set timezone_name='Pacific/Pago_Pago' where id=$1",[A]);
 const calendar=await rpc('economic_calendar_v1',[A]);assert.equal(calendar.timezone,'Pacific/Pago_Pago');
 const first=await rpc('claim_daily_plus_bonus_v1',[A,calendar.localDate]);assert.equal(first.reward,50);
 for(const zone of ['Pacific/Kiritimati','Asia/Shanghai','America/New_York','UTC','not-a-timezone']){
  await q('update profiles set timezone_name=$2 where id=$1',[A,zone]);
  assert.deepEqual(await rpc('economic_calendar_v1',[A]),calendar);
  assert.equal(new Date(await rpc('burrow_record_date_v1',[A])).toISOString().slice(0,10),calendar.localDate);
  const state=await rpc('daily_plus_bonus_state_v1',[A]);assert.equal(state.claimed,true);assert.equal(state.localDate,calendar.localDate);
  assert.equal((await rpc('claim_daily_plus_bonus_v1',[A,calendar.localDate])).reward,0);
  const usage=(await rpc('burrow_affection_state_v1',[A,B])).affectionUsage;assert.equal(usage.localDate,calendar.localDate);
 }
 assert.equal((await q("select count(*)::int n from currency_ledger where user_id=$1 and reason='plus_daily_login'",[A]))[0].n,1);
 const other=(await q("select (now() at time zone 'Pacific/Kiritimati')::date::text as local_day"))[0].local_day;
 assert.notEqual(other,calendar.localDate);
 assert.equal((await rpc('claim_daily_plus_bonus_v1',[A,other])).error,'day_changed');
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,1050);
});

test('new calendar pins once, invalid initial zone safely becomes UTC; clients cannot alter it',async()=>{
 await q("update profiles set timezone_name='invalid' where id=$1",[A]);
 assert.equal(await rpc('economic_timezone_v1',[A]),'UTC');
 await q("update profiles set timezone_name='Asia/Shanghai' where id=$1",[A]);
 assert.equal(await rpc('economic_timezone_v1',[A]),'UTC');
 assert.equal((await q('select count(*)::int n from account_economic_calendars where user_id=$1',[A]))[0].n,1);
 for(const role of ['anon','authenticated'])for(const action of ['SELECT','INSERT','UPDATE','DELETE'])
  assert.equal((await q("select has_table_privilege($1,'account_economic_calendars',$2) allowed",[role,action]))[0].allowed,false);
});

test('deployment pins existing accounts without changing profiles; unrelated functions/ACLs stay byte-identical',async()=>{
 assert.equal(await rpc('economic_timezone_v1',[C]),'Asia/Shanghai');
 await q("update profiles set timezone_name='America/Los_Angeles' where id=$1",[C]);
 assert.equal(await rpc('economic_timezone_v1',[C]),'Asia/Shanghai');
 assert.equal((await q('select timezone_name from profiles where id=$1',[C]))[0].timezone_name,'America/Los_Angeles');
 assert.deepEqual(h.calendarUntouched.after,h.calendarUntouched.before);
});
