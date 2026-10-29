// Real PostgreSQL functions; synthetic records only, no production messages.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,afterEach,test} from 'node:test';import assert from 'node:assert/strict';
import {securityTestDb} from './security-test-db.mjs';
import {touch280Pair,touch280Transaction} from './release-touch-note280.mjs';
import {plushieReleaseTransaction} from './release-personal-plushie281282.mjs';
const [A,B]=touch280Pair,C='d14b8f6f-11e6-493a-9515-687a1de113e9',D=randomUUID();
let db,q,rpc,toy,photos={},migrated;
const src=n=>fs.readFileSync(`supabase/migrations/${n}.sql`,'utf8');
function definition(sql,name){const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql),tail=sql.slice(start.index),d=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(d[1],d.index+d[0].length);return tail.slice(0,end+d[1].length)+';';}
const clip=()=>({version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]});
const pv=(a=A,b=B)=>rpc('burrow_pair_version_v1',[a,b]);
async function args(a=A,b=B,patch={}){return Object.values({user:a,partner:b,pair:await pv(a,b),day:(await rpc('economic_calendar_v1',[a])).localDate,key:randomUUID(),toy,photo:photos[a],clip:clip(),...patch});}
const state=(a=A,b=B)=>pv(a,b).then(v=>rpc('plushie_touch_state_v2',[a,v]));
async function sqlDenial(sql,values,pattern){await db.exec('savepoint denied');await assert.rejects(q(sql,values),pattern);await db.exec('rollback to savepoint denied');}
before(async()=>{
 ({db,query:q,rpc}=await securityTestDb());
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
 alter table pairings add column relationship text;alter table pairings add column relationship_since date;
 create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;`);
 await db.exec(src('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(src('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(src('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 await db.exec(src('20261025000276_plushie_touch'));await db.exec(src('20261026000277_touch_note_v2'));
 await db.exec(definition(src('20261022000258_plushie_moment_windows'),'interact_burrow_toy_batch_v1'));
 await db.exec(definition(src('20261022000258_plushie_moment_windows'),'interact_burrow_toy_v1'));
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations(version) values('20261026000277');");
 for(const id of [A,B,C,D]){await q('insert into auth.users(id) values($1)',[id]);await q('insert into profiles(id) values($1)',[id]);await q('insert into wallets(user_id,carrot_balance) values($1,500)',[id]);}
 await rpc('pair_immediately',[A,B,'Partner',null]);await rpc('pair_immediately',[C,D,'Partner',null]);
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);await rpc('admit_store_economic_domain_v1',[D,'sandbox']);
 toy=(await q("select stable_id from catalog_items where category='couple_dolls' and status='active' order by stable_id limit 1"))[0].stable_id;
 for(const [user,partner]of [[A,B],[B,A],[C,D]]){
  await q("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase') on conflict do nothing",[user,toy]);photos[user]=randomUUID();
  await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by) values($1,least($2::uuid,$3::uuid),greatest($2::uuid,$3::uuid),$2,'doll',$4,'private/synthetic.jpg',$2)",[photos[user],user,partner,toy]);
 }
 const transaction=touch280Transaction();
 await assert.rejects(db.exec(transaction.replace('create temporary table touch280_after',"update wallets set carrot_balance=999;create temporary table touch280_after")),/Protected rows changed/);
 await db.exec('rollback');assert.equal((await q("select to_regclass('plushie_touch_test_pair') id"))[0].id,null);
 await assert.rejects(db.exec(transaction.replace('create temporary table touch280_after',()=>"create or replace function public.same_economic_domain_v1(p_a uuid,p_b uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select true$$;create temporary table touch280_after")),/Unrelated function changed/);
 await db.exec('rollback');
 migrated=(await db.exec(transaction)).find(r=>r.rows?.some(v=>v.verified))?.rows.find(v=>v.verified).verified;
 assert.ok(migrated?.protectedRowsUnchanged);assert.ok(migrated.existingPermissionsUnchanged);
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));

test('280 guards all pre-existing rows/functions/security; only exact current pair gets transport permission',async()=>{
 assert.equal(migrated.exceptionPairs,1);assert.ok(migrated.protectedSets>30);
 assert.equal(await rpc('same_economic_domain_v1',[A,B]),false);
 for(const [a,b]of [[A,B],[B,A]]){
  assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[a,b,await pv()]),true);
  const s=await state(a,b);assert.equal(s.sameDomain,false);assert.equal(s.sendAllowed,true);assert.equal(s.sendHasPlus,false);assert.equal(s.hasPlus,false);assert.equal(s.remaining,1);
 }
 for(const [a,b]of [[A,C],[B,C],[C,D],[A,A],[null,B]])assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[a,b,await pv()]),false);
 assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[A,B,'0'.repeat(32)]),false);
 assert.equal((await state(C,D)).sendAllowed,false);
 assert.equal((await rpc('send_plushie_touch_v1',await args(C,D))).error,'economic_domain_conflict');
});
test('real round-trip both directions supports unread/preparation/photo/seen/push without wallets, inventory or Plus mutation',async()=>{
 const before=await q('select * from wallets order by user_id');
 const domains=await q('select * from account_economic_domains order by user_id'),inventory=await q('select * from user_inventory order by owner_id,item_id');
 for(const [a,b]of [[A,B],[B,A]]){
  const input=await args(a,b),sent=await rpc('send_plushie_touch_v1',input);assert.equal(sent.success,true);
  assert.deepEqual(await rpc('send_plushie_touch_v1',input),sent);
  const inbox=await state(b,a);assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].id,sent.messageId);assert.equal(inbox.items[0].read_at,null);
  const detail=await rpc('read_plushie_touch_v2',[b,await pv(),sent.messageId,false]);assert.deepEqual(detail.message.clip,clip());assert.equal(detail.message.photo.ownerId,a);
  assert.equal((await rpc('read_plushie_touch_photo_v1',[b,photos[a]])).path,'private/synthetic.jpg');
  const payload=(await q("select payload from notification_outbox where event_key=$1",['plushie-touch:'+sent.messageId]))[0].payload;
  assert.equal((await rpc('system_notification_context_v1',[b,'plushie_touch',payload])).allowed,true);
  assert.equal((await rpc('system_notification_context_v1',[b,'plushie_touch',payload])).touchVersion,2);
  await rpc('read_plushie_touch_v2',[b,await pv(),sent.messageId,true]);assert.equal((await rpc('system_notification_context_v1',[b,'plushie_touch',payload])).allowed,false);
  assert.equal((await state(a,b)).remaining,0);assert.equal((await rpc('send_plushie_touch_v1',await args(a,b))).error,'touch_quota_used');
  assert.equal((await rpc('read_plushie_touch_v2',[C,await pv(),sent.messageId,false])).error,'pair_changed');
 }
 assert.deepEqual(await q('select * from wallets order by user_id'),before);
 assert.deepEqual(await q('select * from account_economic_domains order by user_id'),domains);assert.deepEqual(await q('select * from user_inventory order by owner_id,item_id'),inventory);
 assert.equal((await q('select count(*)::int n from currency_ledger'))[0].n,0);
});
test('approved pair still rejects stale dates, foreign photos, invalid clips and altered idempotency payloads',async()=>{
 assert.equal((await rpc('send_plushie_touch_v1',await args(A,B,{day:'2000-01-01'}))).error,'touch_period_expired');
 assert.equal((await rpc('send_plushie_touch_v1',await args(A,B,{photo:photos[B]}))).error,'touch_toy_unavailable');
 assert.equal((await rpc('send_plushie_touch_v1',await args(A,B,{clip:{...clip(),touches:99}}))).error,'invalid_request');
 const input=await args(),r=await rpc('send_plushie_touch_v1',input);assert.equal(r.success,true);
 assert.equal((await rpc('send_plushie_touch_v1',[...input.slice(0,7),{...clip(),events:[[0,5,0,0,0]]}])).error,'idempotency_conflict');
});
test('own verified Plus retains daily send allowance but is never shared across domains; history remains non-shared',async()=>{
 const snapshot={store:'apple',environment:'sandbox',credential:'isolated-'+randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000*10).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()};
 assert.equal((await rpc('reconcile_store_subscription_v3',[B,snapshot])).success,true);
 assert.equal(await rpc('burrow_has_plus_v1',[B]),true);assert.equal(await rpc('burrow_has_plus_v1',[A]),false);
 assert.equal((await state(B,A)).sendHasPlus,true);assert.equal((await state(B,A)).hasPlus,false);assert.equal((await state(A,B)).sendHasPlus,false);
 assert.equal((await rpc('send_plushie_touch_v1',await args(B,A))).success,true);
 assert.equal((await state(B,A)).remaining,0);
 await q('update plushie_touch_sends set local_date=current_date-1 where user_id=$1',[B]);
 assert.equal((await state(B,A)).remaining,1);assert.equal((await rpc('send_plushie_touch_v1',await args(B,A))).success,true);
 assert.equal((await state(A,B)).items.length,1);assert.equal((await state(B,A)).items.length,0);
});
test('same-day Free send then own Plus upgrade cannot add a send',async()=>{
 assert.equal((await rpc('send_plushie_touch_v1',await args(B,A))).success,true);
 await rpc('reconcile_store_subscription_v3',[B,{store:'apple',environment:'sandbox',credential:randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000*10).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()}]);
 assert.equal((await state(B,A)).remaining,0);assert.equal((await rpc('send_plushie_touch_v1',await args(B,A))).error,'touch_quota_used');
});
test('normal same-domain non-test users still send normally, with the original v1-compatible committed receipt',async()=>{
 await rpc('admit_store_economic_domain_v1',[C,'sandbox']);
 assert.equal(await rpc('same_economic_domain_v1',[C,D]),true);assert.equal((await state(C,D)).sendAllowed,true);
 assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[C,D,await pv(C,D)]),false);
 const input=await args(C,D),sent=await rpc('send_plushie_touch_v1',input);
 assert.equal(sent.success,true);assert.equal(sent.version,1);assert.deepEqual(await rpc('send_plushie_touch_v1',input),sent);
 assert.equal((await rpc('read_plushie_touch_v2',[D,await pv(C,D),sent.messageId,false])).message.clip.version,2);
});
test('282 latest incoming-only contract preserves 280 transport permission and true economic domains',async()=>{
 const before=await q('select * from account_economic_domains order by user_id');
 await db.exec(src('20261027000282_received_touch_history_and_personal_photo_moments').replace(/^begin;/m,'').replace(/^commit;/m,''));
 for(const [a,b]of [[A,B],[B,A]]){const s=await state(a,b);assert.equal(s.sendAllowed,true);assert.equal(s.sameDomain,false);assert.equal(s.hasPlus,false);assert.equal(s.sendHasPlus,false);}
 const sent=await rpc('send_plushie_touch_v1',await args());assert.equal(sent.success,true);
 assert.equal((await state()).items.length,0);assert.equal((await state(B,A)).items[0].id,sent.messageId);
 assert.equal((await rpc('read_plushie_touch_v2',[A,await pv(),sent.messageId,false])).error,'not_found');
 assert.equal((await rpc('read_plushie_touch_v2',[B,await pv(),sent.messageId,false])).message.id,sent.messageId);
 assert.deepEqual(await q('select * from account_economic_domains order by user_id'),before);
});
test('Surprise remains cross-domain forbidden and economic identity is never rewritten',async()=>{
 await sqlDenial('insert into burrow_surprises(sender_id,recipient_id) values($1,$2)',[A,B],/economic_domain_mismatch/);
 assert.equal(await rpc('same_economic_domain_v1',[A,B]),false);
 assert.equal(await rpc('economic_domain_v1',[A]),'production');assert.equal(await rpc('economic_domain_v1',[B]),'sandbox');
});
test('server disable and relationship rotation revoke exception; no third party or new relationship inherits it',async()=>{
 await q('update plushie_touch_test_pair set enabled=false');assert.equal((await state()).sendAllowed,false);assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'economic_domain_conflict');
 await q('update plushie_touch_test_pair set enabled=true');const old=await pv();
 await q('delete from pairings where user_id in($1,$2)',[A,B]);assert.equal(await rpc('plushie_touch_test_pair_allowed_v1',[A,B,old]),false);
 await rpc('pair_immediately',[A,B,'Partner',null]);assert.notEqual(await pv(),old);assert.equal((await state()).sendAllowed,false);
 assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'economic_domain_conflict');
});
test('new config and helper are not client writable/readable/callable; alternate account insertion violates exact-pair constraint',async()=>{
 for(const role of ['anon','authenticated']){
  for(const action of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('select has_table_privilege($1,$2,$3) yes',[role,'plushie_touch_test_pair',action]))[0].yes,false);
  assert.equal((await q("select has_function_privilege($1,'plushie_touch_test_pair_allowed_v1(uuid,uuid,text)','EXECUTE') yes",[role]))[0].yes,false);
 }
 assert.equal((await q("select has_table_privilege('service_role','plushie_touch_test_pair','UPDATE') yes"))[0].yes,false);
 await sqlDenial('insert into plushie_touch_test_pair(pair_low,pair_high,pair_version) values($1,$2,$3)',[C,B,await pv()],/check constraint/);
});
test('exact 281/282 release transaction rejects protected-data corruption and commits only reviewed functions',async()=>{
 await db.exec('rollback'); // The release owns its repeatable-read transaction.
 const sql=plushieReleaseTransaction(),wallets=await q('select * from wallets order by user_id');
 await assert.rejects(db.exec(sql.replace('create temporary table plushie_release_after','update wallets set carrot_balance=999;create temporary table plushie_release_after')),/Protected rows changed/);
 await db.exec('rollback');assert.deepEqual(await q('select * from wallets order by user_id'),wallets);
 assert.equal((await q("select count(*)::int n from supabase_migrations.schema_migrations where version in('20261027000281','20261027000282')"))[0].n,0);
 const result=(await db.exec(sql)).find(r=>r.rows?.some(v=>v.verified))?.rows.find(v=>v.verified).verified;
 assert.ok(result.protectedRowsUnchanged);assert.ok(result.unrelatedFunctionsUnchanged);assert.ok(result.existingPermissionsUnchanged);
 assert.equal((await q("select count(*)::int n from supabase_migrations.schema_migrations where version in('20261027000281','20261027000282')"))[0].n,2);
 assert.equal((await state()).sendAllowed,true);assert.equal((await state()).sameDomain,false);
});
