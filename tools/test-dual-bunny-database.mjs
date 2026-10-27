import fs from 'node:fs';
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {securityTestDb} from './security-test-db.mjs';
let h,db,q,rpc;const A=randomUUID(),B=randomUUID(),C=randomUUID();
const source=name=>fs.readFileSync('supabase/migrations/'+name+'.sql','utf8');
function definition(sql,name){const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);
 const tail=sql.slice(start.index),delimiter=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(delimiter[1],delimiter.index+delimiter[0].length);return tail.slice(0,end+delimiter[1].length)+';';}
before(async()=>{
 h=await securityTestDb();({db,query:q,rpc}=h);
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,
  relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
  alter table pairings add column relationship text;alter table pairings add column relationship_since date;
  create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;`);
 await db.exec(source('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(source('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(source('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 await db.exec(source('20261021000257_adventure_production_duration'));
 // Execute the real migration against a PRE-EXISTING historical relationship,
 // not just a pair created after the new wrapper is installed.
 const oldActor=randomUUID(),oldPartner=randomUUID();
 await q('insert into auth.users(id) values($1),($2)',[oldActor,oldPartner]);
 await q('insert into profiles(id) values($1),($2)',[oldActor,oldPartner]);
 await rpc('pair_immediately',[oldActor,oldPartner,'Partner',null]);
 await db.exec(source('20261025000273_bunny_identity'));
 assert.equal((await rpc('bunny_identity_v1',[oldActor,false])).variant,'biscuit','real legacy backfill actor');
 assert.equal((await rpc('bunny_identity_v1',[oldPartner,false])).variant,'pinky','real legacy backfill partner');
 await q('delete from pairings where user_id in($1,$2)',[oldActor,oldPartner]);
 await q('delete from friendships where user_a in($1,$2) or user_b in($1,$2)',[oldActor,oldPartner]);
 await q('delete from profiles where id in($1,$2)',[oldActor,oldPartner]);
 await q('delete from auth.users where id in($1,$2)',[oldActor,oldPartner]);
 await db.exec(source('20261025000274_cooperative_adventure'));
 // Existing pair-before-patch: run the real recovery migration and ensure it
 // changes ONLY empty party relationship metadata, never the personal trip.
 const legacyA=randomUUID(),legacyB=randomUUID();
 await q('insert into auth.users(id) values($1),($2)',[legacyA,legacyB]);
 await q('insert into profiles(id) values($1),($2)',[legacyA,legacyB]);
 await q('insert into wallets(user_id,carrot_balance) values($1,500),($2,500)',[legacyA,legacyB]);
 await q("update app_config set value='true' where key='adventure_friends_v2_enabled'");
 const legacy=await start(legacyA);assert.equal(legacy.receipt.error,null);
 await pair(legacyA,legacyB);
 assert.equal((await q('select partner_id from adventure_parties where id=$1',[legacy.receipt.team.id]))[0].partner_id,null);
 await assert.rejects(rpc('adventure_team_snapshot_v1',[legacyA]),/pair_version.*ambiguous/,'v274 paired snapshot regression');
 const before=(await q('select * from adventures where id=$1',[legacy.receipt.adventureId]))[0];
 // Rehearse the EXACT production transaction and its protected-data/ACL
 // guards. Schema-only placeholders cover unrelated domains absent from this
 // small fixture; their sentinel rows must remain byte-for-byte unchanged.
 const deploy=JSON.parse(execFileSync(process.execPath,['tools/release-adventure275.mjs','sql','/private/tmp/burrow-adventure275-release.isolated'],{encoding:'utf8'}));
 for(const table of deploy.tables){if(!(await q('select to_regclass($1) id',[table]))[0].id){
  await db.exec(`create table public.${table}(guard_marker int);insert into public.${table} values(275);`);
 }}
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
 const balances=await q('select * from wallets order by user_id');
 await assert.rejects(db.exec(deploy.sql.replace('create temporary table guard_rows_after',
  'update wallets set carrot_balance=carrot_balance+1;create temporary table guard_rows_after')),/Protected user rows changed/);
 await db.exec('rollback');
 assert.deepEqual(await q('select * from wallets order by user_id'),balances,'guard rejection rolls back injected wallet corruption');
 assert.equal((await q('select to_regclass($1) id',['adventure_unbound_leader']))[0].id,null,'failed deployment rolls back migration DDL too');
 const deployed=await db.exec(deploy.sql);
 assert.ok(deployed.some(r=>r.rows?.some(v=>v.verified?.protectedRowsUnchanged===true)),'atomic deployment guard ran');
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,1);
 const recovered=await rpc('adventure_team_snapshot_v1',[legacyA]);
 assert.equal(recovered.team.partnerId,legacyB);assert.equal(recovered.nudgeAvailable,true);
 assert.equal(recovered.team.pairVersion,await rpc('burrow_pair_version_v1',[legacyA,legacyB]));
 assert.deepEqual((await q('select * from adventures where id=$1',[legacy.receipt.adventureId]))[0],before);
 await q('delete from adventure_parties where leader_id=$1',[legacyA]);
 await q('delete from adventures where user_id=$1',[legacyA]);
 await q('delete from reflect_drafts where user_id=$1',[legacyA]);await q('delete from reflects where user_id=$1',[legacyA]);
 await q('delete from pairings where user_id in($1,$2)',[legacyA,legacyB]);
 await q('delete from friendships where user_a in($1,$2) or user_b in($1,$2)',[legacyA,legacyB]);
 await q('delete from profiles where id in($1,$2)',[legacyA,legacyB]);await q('delete from auth.users where id in($1,$2)',[legacyA,legacyB]);
});
after(()=>db?.close());
beforeEach(async()=>{
 await db.exec('begin');await q('insert into auth.users(id) values($1),($2),($3)',[A,B,C]);
 await q("update app_config set value='true' where key='adventure_friends_v2_enabled'");
 await q('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
 await q('insert into wallets(user_id,carrot_balance) values($1,500),($2,500),($3,500)',[A,B,C]);
});
afterEach(()=>db.exec('rollback'));
const select=(user,variant,key=randomUUID())=>rpc('select_bunny_v1',[user,variant,key]);
const identity=user=>rpc('bunny_identity_v1',[user,false]);
const pair=(actor=A,partner=B)=>rpc('pair_immediately',[actor,partner,'Partner',null]);
async function start(user=A,key=randomUUID(),record){
 if(!record){record=randomUUID();await q("insert into reflects(id,user_id,local_date,journal_kind) values($1,$2,(now() at time zone economic_timezone_v1($2))::date,'tap_your_day')",[record,user]);
  await q('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[user,record]);}
 const partner=(await q('select partner_user_id from pairings where user_id=$1',[user]))[0]?.partner_user_id??null;
 const version=partner?await rpc('burrow_pair_version_v1',[user,partner]):null;
 const args=[user,record,key,h.release.release,partner,version];
 const receipt=await rpc('start_adventure_v5',args);return {receipt,key,record,args};
}
async function age(party,elapsedSeconds,remainingSeconds){
 const total=elapsedSeconds+remainingSeconds;
 await q("update adventure_parties set started_at=now()-make_interval(secs=>$2),progress_at=now(),progress_fraction=$3,ends_at=now()+make_interval(secs=>$4) where id=$1",[party,elapsedSeconds,elapsedSeconds/total,remainingSeconds]);
 await q("update adventures set started_at=now()-make_interval(secs=>$2),ends_at=now()+make_interval(secs=>$3) where party_id=$1",[party,elapsedSeconds,remainingSeconds]);
}
test('same-colour choices resolve atomically to CODE ENTERER, immutable finalized rematches retain both colours',async()=>{
 await select(A,'pinky');await select(B,'pinky');assert.equal((await pair()).error,null);
 assert.equal((await identity(A)).variant,'pinky');assert.equal((await identity(B)).variant,'biscuit');
 assert.equal((await select(B,'pinky')).error,'bunny_finalized');
 const own=(await identity(A));await q('delete from pairings where user_id in($1,$2)',[A,B]);
 await select(C,'pinky');await rpc('bunny_identity_v1',[C,true]);await pair(A,C);
 assert.equal((await identity(A)).variant,own.variant);assert.equal((await identity(C)).variant,'pinky');
});
test('opposite choices preserved; solo finalize does not reset Pinky; same key different choice conflicts',async()=>{
 const key=randomUUID();await select(A,'pinky',key);assert.equal((await select(A,'biscuit',key)).error,'idempotency_conflict');
 assert.equal((await rpc('bunny_identity_v1',[A,true])).variant,'pinky');await select(B,'biscuit');await pair(B,A);
 assert.equal((await identity(A)).variant,'pinky');assert.equal((await identity(B)).variant,'biscuit');
 assert.deepEqual((await q('select carrot_balance from wallets order by user_id')).map(r=>r.carrot_balance),[500,500,500]);
});
test('legacy pair actor gets Biscuit without rerunning onboarding; failed pairing assigns nothing',async()=>{
 await pair();assert.equal((await identity(A)).variant,'biscuit');assert.equal((await identity(B)).variant,'pinky');
 assert.equal((await pair(C,B)).error,'target_already_paired');assert.equal((await identity(C)).variant,null);
});
test('Free 6h, Plus 3h are authoritative for new protocol, with independent personal records',async()=>{
 await pair();let a=await start(A);assert.equal(a.receipt.durationSeconds,21600);
 assert.equal(a.receipt.team.plus,false);assert.equal(a.receipt.joined,false);
 await rpc('reconcile_store_subscription_v3',[C,{store:'apple',environment:'production',credential:'bunny-plus',transactionId:'bunny-tx',productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()}]);
 const c=await start(C);assert.equal(c.receipt.durationSeconds,10800);assert.equal(c.receipt.team.plus,true);
});
test('unpaired A starts first, pairing binds only progress scope, then B joins without resetting A or sharing rewards',async()=>{
 const a=await start(A);await age(a.receipt.team.id,7200,14400);
 const before=(await q('select * from adventures where id=$1',[a.receipt.adventureId]))[0];
 assert.equal((await rpc('adventure_team_snapshot_v1',[A])).nudgeAvailable,false);
 await pair();
 const snapshot=await rpc('adventure_team_snapshot_v1',[A]),version=await rpc('burrow_pair_version_v1',[A,B]);
 assert.equal(snapshot.team.partnerId,B);assert.equal(snapshot.team.pairVersion,version);assert.equal(snapshot.nudgeAvailable,true);
 assert.equal((await rpc('adventure_team_snapshot_v1',[B])).joinable.id,a.receipt.team.id);
 assert.deepEqual((await q('select * from adventures where id=$1',[a.receipt.adventureId]))[0],before,'pairing cannot rewrite dates, plus, record, plan or reward');
 const b=await start(B);assert.equal(b.receipt.joined,true);assert.equal(b.receipt.team.id,a.receipt.team.id);
 assert.equal((await q('select extract(epoch from(ends_at-now()))::int seconds from adventure_parties where id=$1',[a.receipt.team.id]))[0].seconds,9600);
 assert.equal((await q('select count(distinct record_id)::int n from adventures'))[0].n,2);
 assert.equal((await q('select count(*)::int n from currency_ledger'))[0].n,0);
});
test('pair-after-start keeps the inclusive 600-second boundary',async()=>{
 const a=await start(A);await age(a.receipt.team.id,21000,600);await pair();
 const b=await start(B);assert.equal(b.receipt.joined,false);
 assert.notEqual(b.receipt.team.id,a.receipt.team.id);
});
test('pairing two already-started solo trips binds scope without merging, rerating or spending another quota',async()=>{
 const a=await start(A),b=await start(B);
 const before=await q('select * from adventures order by id');await pair();
 assert.deepEqual(await q('select * from adventures order by id'),before);
 assert.notEqual(a.receipt.team.id,b.receipt.team.id);
 for(const user of [A,B]){
  const s=await rpc('adventure_team_snapshot_v1',[user]);assert.equal(s.team.followerId,null);assert.equal(s.nudgeAvailable,false);
  assert.equal((await start(user)).receipt.error,'daily_adventure_used');
 }
 const parties=await q('select * from adventure_parties order by id');
 await q("update pairings set relationship='Partner' where user_id in($1,$2)",[A,B]);
 assert.deepEqual(await q('select * from adventure_parties order by id'),parties,'metadata update cannot bind or signal again');
});
test('one-sided and failed pairing cannot bind an unpaired journey',async()=>{
 const a=await start(A);await pair(B,C);assert.equal((await pair(A,B)).error,'target_already_paired');
 await q('insert into pairings(user_id,partner_user_id) values($1,$2)',[A,B]);
 const row=(await q('select partner_id,pair_version,revision from adventure_parties where id=$1',[a.receipt.team.id]))[0];
 assert.deepEqual(row,{partner_id:null,pair_version:null,revision:1});
});
test('pair-after-start at 601 seconds permits joining',async()=>{
 const a=await start(A);await age(a.receipt.team.id,20999,601);await pair();
 assert.equal((await start(B)).receipt.joined,true);
});
test('a bound former-pair trip cannot be rebound after unpairing and cross-domain solo cannot bind',async()=>{
 const a=await start(A);await pair();
 const original=(await q('select partner_id,pair_version from adventure_parties where id=$1',[a.receipt.team.id]))[0];
 await q('delete from pairings where user_id in($1,$2)',[A,B]);await pair(A,C);
 assert.deepEqual((await q('select partner_id,pair_version from adventure_parties where id=$1',[a.receipt.team.id]))[0],original);
 assert.equal((await start(C)).receipt.joined,false);
});
test('cross-domain pair-after-start cannot bind progress or send a Nudge',async()=>{
 const a=await start(A);await rpc('admit_store_economic_domain_v1',[B,'sandbox']);await pair();
 const s=await rpc('adventure_team_snapshot_v1',[A]);assert.equal(s.nudgeAvailable,false);assert.equal(s.team.partnerId,null);
 assert.equal((await start(B)).receipt.joined,false);
});
test('join accelerates ONLY remaining 4h / 1.5, same finish; personal reward plans are not shared',async()=>{
 await pair();const a=await start();assert.equal(a.receipt.error,null);await age(a.receipt.team.id,7200,14400);
 const b=await start(B);assert.equal(b.receipt.error,null);assert.equal(b.receipt.joined,true);
 assert.equal(b.receipt.team.id,a.receipt.team.id);assert.ok(Math.abs(b.receipt.team.progressFraction-1/3)<.001);
 const rows=await q('select id,user_id,ends_at,record_id from adventures order by user_id');assert.equal(rows.length,2);
 assert.equal(+new Date(rows[0].ends_at),+new Date(rows[1].ends_at));
 const left=(await q('select extract(epoch from(ends_at-now()))::int seconds from adventure_parties where id=$1',[a.receipt.team.id]))[0].seconds;
 assert.equal(left,9600);
 const plans=await q('select adventure_id,user_id from adventure_encounter_plans where status=\'bound\'');
 assert.equal(plans.length,2);assert.notEqual(plans[0].adventure_id,plans[1].adventure_id);assert.notEqual(plans[0].user_id,plans[1].user_id);
 assert.equal((await q('select count(*)::int n from currency_ledger'))[0].n,0);
 const oldEnd=b.receipt.endsAt;assert.deepEqual((await rpc('start_adventure_v5',b.args)).team,b.receipt.team);
 assert.equal((await rpc('start_adventure_v5',b.args)).endsAt,oldEnd);
 assert.equal((await start(B)).receipt.error,'daily_adventure_used');
});
test('600 seconds inclusive rejects joining; no duplicate same-key member',async()=>{
 await pair();const a=await start();await age(a.receipt.team.id,21000,600);
 const b=await start(B);assert.equal(b.receipt.joined,false);assert.notEqual(b.receipt.team.id,a.receipt.team.id);
 assert.equal((await rpc('start_adventure_v5',b.args)).adventureId,b.receipt.adventureId);
 assert.equal((await q('select count(*)::int n from adventures'))[0].n,2);
});
test('601 seconds joins, preserving the boundary rather than rounding down to ten minutes',async()=>{
 await pair();const a=await start();await age(a.receipt.team.id,20999,601);
 const b=await start(B);assert.equal(b.receipt.joined,true);
 assert.equal(b.receipt.team.id,a.receipt.team.id);
 assert.ok(b.receipt.durationSeconds>=400&&b.receipt.durationSeconds<=401);
});
test('two near-simultaneous starts converge to one party, each with their own record and quota',async()=>{
 await pair();const [a,b]=await Promise.all([start(A),start(B)]);
 assert.equal(a.receipt.error,null);assert.equal(b.receipt.error,null);
 assert.equal(a.receipt.team.id,b.receipt.team.id);
 assert.equal((await q('select count(*)::int n from adventure_parties'))[0].n,1);
 assert.equal((await q('select count(distinct record_id)::int n from adventures'))[0].n,2);
 assert.equal((await start(A)).receipt.error,'daily_adventure_used');
 // PGlite serializes statements: this tests convergence, not independent PG lock scheduling.
});
test('old relationship requests cannot start in a new pair; same key different record is rejected',async()=>{
 await pair();const a=await start();const other=randomUUID();
 assert.equal((await rpc('start_adventure_v5',[A,other,a.key,h.release.release,a.args[4],a.args[5]])).error,'idempotency_conflict');
 await q('delete from pairings where user_id in($1,$2)',[A,B]);await pair(A,C);
 assert.equal((await rpc('start_adventure_v5',a.args)).error,'pair_changed');
 assert.equal((await q('select count(*)::int n from adventures'))[0].n,1);
});
test('new solo timing is also 3h for legacy protocol; v5 upgrade cannot shorten a frozen journey',async()=>{
 await pair();const a=await start();const before=a.receipt.endsAt;
 await rpc('reconcile_store_subscription_v3',[A,{store:'apple',environment:'production',credential:'upgrade',transactionId:'upgrade-tx',productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()}]);
 const result=await rpc('accelerate_adventure_for_plus_v1',[A,a.receipt.adventureId]);
 assert.equal(result.speedLocked,true);assert.equal(+new Date(result.endsAt),+new Date(before));
 const c=await start(C);await q('delete from adventure_parties where leader_id=$1',[C]);await q('delete from adventures where user_id=$1',[C]);
 await rpc('reconcile_store_subscription_v3',[C,{store:'apple',environment:'production',credential:'legacy-plus',transactionId:'legacy-tx',productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()}]);
 const legacy=await rpc('solo_burrow_start_adventure_v1',[C,c.record,randomUUID()]);
 assert.equal(legacy.durationSeconds,10800);
});
test('join at 11 minutes permits quick completion but no new quota, rejected foreign claim and no duplicate ledger',async()=>{
 await pair();const a=await start();await age(a.receipt.team.id,20940,660);const b=await start(B);
 assert.equal(b.receipt.joined,true);
 assert.equal((await q('select extract(epoch from(ends_at-now()))::int seconds from adventure_parties where id=$1',[a.receipt.team.id]))[0].seconds,440);
 assert.equal((await rpc('adventure_command_v2',[C,b.receipt.adventureId,'treasure',{}])).error,'not_found');
 await q("update adventures set ends_at=now()-interval '1 second' where party_id=$1",[a.receipt.team.id]);
 for(const [user,receipt] of [[A,a.receipt],[B,b.receipt]]){
  assert.equal((await rpc('adventure_command_v2',[user,receipt.adventureId,'settle',{}])).error,null);
  const result=await rpc('adventure_command_v2',[user,receipt.adventureId,'treasure',{}]);assert.equal(result.error,null);
  const balance=(await q('select carrot_balance from wallets where user_id=$1',[user]))[0].carrot_balance;
  await rpc('adventure_command_v2',[user,receipt.adventureId,'treasure',{}]);
  assert.equal((await q('select carrot_balance from wallets where user_id=$1',[user]))[0].carrot_balance,balance);
 }
});
test('Nudge once, transactional outbox, send-time eligibility expires on join',async()=>{
 await pair();const a=await start();
 const key=randomUUID();assert.equal((await rpc('nudge_adventure_v1',[A,a.receipt.team.id,key])).alreadySent,false);
 assert.equal((await rpc('nudge_adventure_v1',[A,a.receipt.team.id,key])).alreadySent,false,'replay returns original receipt');
 assert.equal((await rpc('nudge_adventure_v1',[A,randomUUID(),key])).error,'idempotency_conflict');
 assert.equal((await rpc('nudge_adventure_v1',[A,a.receipt.team.id,randomUUID()])).alreadySent,true);
 const row=(await q("select * from notification_outbox where event_type='adventure_invite'"))[0];
 assert.equal((await rpc('system_notification_context_v1',[B,'adventure_invite',row.payload])).allowed,true);
 await start(B);assert.equal((await rpc('system_notification_context_v1',[B,'adventure_invite',row.payload])).allowed,false);
 assert.equal((await q("select count(*)::int n from notification_outbox where event_type='adventure_invite'"))[0].n,1);
});
test('cross-economic-domain cannot share progression, current valid relationship required; no client write grants',async()=>{
 await pair();await rpc('admit_store_economic_domain_v1',[B,'sandbox']);const a=await start();const b=await start(B);
 assert.equal(b.receipt.joined,false);assert.notEqual(a.receipt.team.id,b.receipt.team.id);
 assert.equal((await rpc('adventure_team_snapshot_v1',[C])).team,null);
 for(const role of ['anon','authenticated']){
  for(const table of ['bunny_identities','adventure_parties'])for(const action of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('select has_table_privilege($1,$2,$3) allowed',[role,table,action]))[0].allowed,false);
  for(const sig of ['start_adventure_v5(uuid,uuid,text,text,uuid,text)','select_bunny_v1(uuid,text,uuid)','adventure_team_json_v1(uuid)',
   'adventure_team_snapshot_v1(uuid)','bind_unpaired_adventures_v1(uuid)','bind_adventure_after_pair_v1()'])assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,sig]))[0].allowed,false);
 }
});
