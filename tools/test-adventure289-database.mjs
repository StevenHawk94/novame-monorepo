// Synthetic accounts and real SQL only. No production connection or payments.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,afterEach,test} from 'node:test';import assert from 'node:assert/strict';
import {securityTestDb} from './security-test-db.mjs';
const A='36b75655-a89b-45dd-b232-a35db4efe502',B='4d95e1b8-09e9-4904-aaaa-5e564dabb603',C=randomUUID(),D=randomUUID();
const src=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
function definition(sql,name){const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);
 if(!start)throw Error(name);const tail=sql.slice(start.index),d=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(d[1],d.index+d[0].length);return tail.slice(0,end+d[1].length)+';';}
let h,db,q,rpc;
const pair=(a=A,b=B)=>rpc('pair_immediately',[a,b,'Partner',null]);
async function start(user=A){
 const record=randomUUID();await q("insert into reflects(id,user_id,local_date,journal_kind) values($1,$2,(now() at time zone economic_timezone_v1($2))::date,'tap_your_day')",[record,user]);
 await q('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[user,record]);
 const partner=(await q('select partner_user_id from pairings where user_id=$1',[user]))[0]?.partner_user_id??null;
 return rpc('start_adventure_v5',[user,record,randomUUID(),h.release.release,partner,partner?await rpc('burrow_pair_version_v1',[user,partner]):null]);
}
async function due(trip,status='in_progress',days=1){
 await q("update adventures set local_date=(now() at time zone economic_timezone_v1(user_id))::date-$2::int,ends_at=now()-interval '1 minute',status=$3 where id=$1",[trip.adventureId,days,status]);
 await q("update adventure_parties set ends_at=now()-interval '1 minute' where id=$1",[trip.team.id]);
}
const status=async()=>(await rpc('adventure_team_snapshot_v1',[A])).nudgeStatus;
async function settle(user,trip,finish=false){
 for(const action of ['settle','treasure']){
  const r=await rpc('adventure_command_v2',[user,trip.adventureId,action,{}]);assert.equal(r.error,null,JSON.stringify(r));
 }
 const plan=(await q('select snapshot from adventure_encounter_plans where adventure_id=$1',[trip.adventureId]))[0].snapshot;
 const choice=plan.dialogue?.choices?.[0]?.id;
 if(choice){const r=await rpc('adventure_command_v2',[user,trip.adventureId,'respond',{choiceId:choice}]);assert.equal(r.error,null,JSON.stringify(r));}
 if(finish){const r=await rpc('adventure_command_v2',[user,trip.adventureId,'claim',{}]);assert.equal(r.error,null,JSON.stringify(r));}
}
async function rows(){const out={};for(const t of ['adventures','adventure_parties','reflects','reflect_drafts','adventure_encounter_plans','wallets','currency_ledger','user_inventory','pairings','account_economic_domains','room_photos','burrow_command_receipts','notification_outbox'])
 out[t]=await q(`select to_jsonb(x) row from ${t} x order by to_jsonb(x)::text`);return out;}
before(async()=>{
 h=await securityTestDb();({db,query:q,rpc}=h);
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
 alter table pairings add column relationship text;alter table pairings add column relationship_since date;
 create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;`);
 await db.exec(src('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(src('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(src('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 for(const n of ['20261021000257_adventure_production_duration','20261025000273_bunny_identity','20261025000274_cooperative_adventure','20261025000275_bind_unpaired_adventure'])await db.exec(src(n));
 for(const id of [A,B,C,D]){await q('insert into auth.users(id) values($1)',[id]);await q('insert into profiles(id) values($1)',[id]);await q('insert into wallets(user_id,carrot_balance) values($1,10000)',[id]);}
 await pair();await pair(C,D);await q("update app_config set value='true' where key='adventure_friends_v2_enabled'");
 const temp=src('20261028000285_temporary_paired_testing');
 await db.exec(temp.slice(temp.indexOf('create table'),temp.indexOf('insert into public.burrow_temporary_test_pair')));
 for(const name of ['burrow_test_pair_allowed_v1','burrow_pair_economy_allowed_v1'])await db.exec(definition(temp,name));
 for(const name of ['burrow_has_plus_v1','sync_pair_plus_entitlements','burrow_service_offer_v1','adventure_nudge_eligible_v1','adventure_team_snapshot_v1','start_adventure_v5','bind_unpaired_adventures_v1']){
  const f=(await q("select pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]))[0];
  await db.exec(f.body.replaceAll('same_economic_domain_v1(','burrow_pair_economy_allowed_v1('));
 }
 await db.exec(src('20261029000288_adventure_upgrade_and_owned_games'));
 const old=await start(D);await due(old);const leader=await start(C);
 assert.equal(await rpc('adventure_nudge_eligible_v1',[C,leader.team.id]),false,'reproduce previous-day pending-claim invitation rejection');
 const catalogBefore=await q('select to_jsonb(c) row from catalog_items c order by stable_id');
 const supportBefore=await q('select release,product_id from burrow_shop_release_support order by release,product_id');
 const before=await rows(),functions=await q("select oid::text,pg_get_functiondef(oid) body,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in('adventure_nudge_eligible_v1','adventure_team_snapshot_v1') order by oid");
 const candidate=src('20261029000289_adventure_nudge_availability');
 await db.exec('begin;alter function public.adventure_team_snapshot_before288_v1(uuid) rename to qa_missing_timing288');
 await assert.rejects(db.exec(candidate),/288 must be installed first/);await db.exec('rollback');
 assert.equal((await q("select to_regprocedure('public.adventure_nudge_status_v1(uuid,uuid)') f"))[0].f,null,'failed prerequisite cannot partially install availability');
 assert.deepEqual(await rows(),before);
 await db.exec(candidate);
 assert.deepEqual(await rows(),before,'289 deployment changes no user rows or timers');
 for(const f of functions)assert.deepEqual((await q('select oid::text,pg_get_functiondef(oid) body,proacl::text acl from pg_proc where oid=$1',[f.oid]))[0],f,'unrelated function and grants preserved');
 assert.equal(await rpc('adventure_nudge_eligible_v1',[C,leader.team.id]),true);
 assert.deepEqual(await q('select to_jsonb(c) row from catalog_items c order by stable_id'),catalogBefore,'289 preserves all product fields including original names');
 assert.deepEqual(await q('select release,product_id from burrow_shop_release_support order by release,product_id'),supportBefore,'289 preserves all client support sets');
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('previous-day due, result-ready and interaction-required claims allow Nudge but never bypass unfinished settlement',async()=>{
 for(const phase of ['in_progress','result_ready','interaction_required']){
  await db.exec('savepoint phase');const old=await start(B);assert.equal(old.error,null);await due(old);
  if(phase==='result_ready')assert.equal((await rpc('adventure_command_v2',[B,old.adventureId,'settle',{}])).error,null);
  if(phase==='interaction_required')await settle(B,old);
  const a=await start();assert.equal(a.error,null);
  const s=await rpc('adventure_team_snapshot_v1',[A]);assert.equal(s.nudgeAvailable,true);assert.equal(s.nudgeStatus.reason,'available');
  const key=randomUUID(),n=await rpc('nudge_adventure_v1',[A,a.team.id,key]);assert.equal(n.alreadySent,false);assert.deepEqual(await rpc('nudge_adventure_v1',[A,a.team.id,key]),n);
  const payload=(await q("select payload from notification_outbox where event_key=$1",['adventure-nudge:'+a.team.id]))[0].payload;
  assert.equal((await rpc('system_notification_context_v1',[B,'adventure_invite',payload])).allowed,true,'delivery uses same eligibility');
  const next=await start(B);assert.ok(next.error,'Start still blocked by original incomplete claim');
  await settle(B,old,true);
  const joined=await start(B);assert.equal(joined.error,null);assert.equal(joined.joined,true);assert.equal(joined.team.id,a.team.id);
  assert.notEqual(joined.adventureId,a.adventureId);await db.exec('rollback to savepoint phase');
 }
});
test('today completed/due trips remain used; a previous-day trip actually still running is not available',async()=>{
 const b=await start(B);await due(b,'in_progress',0);const a=await start();
 assert.equal((await status()).reason,'partner_finished');assert.equal((await rpc('adventure_team_snapshot_v1',[A])).nudgeAvailable,false);
 assert.equal((await rpc('nudge_adventure_v1',[A,a.team.id,randomUUID()])).error,'adventure_invite_unavailable');
 await q("update adventures set local_date=local_date-1,ends_at=now()+interval '9 minutes' where id=$1",[b.adventureId]);
 assert.equal((await status()).reason,'partner_finishing');
 await q("update adventures set ends_at=now()+interval '20 minutes' where id=$1",[b.adventureId]);
 assert.equal((await status()).reason,'partner_adventuring');
});
test('fixed recipient economic day, not changed profile/display timezone or 24-hour age, determines Nudge',async()=>{
 const b=await start(B);await due(b);const a=await start();
 const actual=(await rpc('economic_calendar_v1',[B])).timezone;
 await q("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[B]);
 assert.equal((await rpc('economic_calendar_v1',[B])).timezone,actual);
 assert.equal((await status()).reason,'available');
 await q("update adventures set local_date=(now() at time zone economic_timezone_v1($2))::date where id=$1",[b.adventureId,B]);
 assert.equal((await status()).reason,'partner_finished');
});
test('two pre-pair already-started Solos remain distinct; finishing and finished are truthful states',async()=>{
 await q('delete from pairings where user_id in($1,$2)',[A,B]);const a=await start(),b=await start(B);await pair();
 const p=await rpc('adventure_team_snapshot_v1',[A]);assert.equal(p.team.id,a.team.id);assert.equal(p.team.followerId,null);assert.equal(p.nudgeStatus.reason,'partner_adventuring');
 assert.equal((await rpc('adventure_team_snapshot_v1',[B])).team.id,b.team.id);
 for(const seconds of [601,600,1,0]){
  await q('update adventures set ends_at=now()+make_interval(secs=>$2) where id=$1',[b.adventureId,seconds]);
  assert.equal((await status()).reason,seconds>600?'partner_adventuring':seconds>0?'partner_finishing':'partner_finished');
 }
});
test('own inclusive 600-second cutoff wins even after Nudge; stale relationship and ordinary cross-domain remain denied',async()=>{
 const a=await start();await q("update adventure_parties set ends_at=now()+interval '10 minutes' where id=$1",[a.team.id]);
 assert.equal((await status()).reason,'own_finishing');assert.equal(await rpc('adventure_nudge_eligible_v1',[A,a.team.id]),false);
 await q("update adventure_parties set ends_at=now()+interval '20 minutes' where id=$1",[a.team.id]);
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);assert.equal((await status()).reason,'economy_restricted');
 await q("insert into burrow_temporary_test_pair(pair_low,pair_high,pair_version) values($1,$2,$3)",[A,B,await rpc('burrow_pair_version_v1',[A,B])]);
 assert.equal((await status()).reason,'available');await q('update burrow_temporary_test_pair set enabled=false');assert.equal((await status()).reason,'economy_restricted');
 await q('delete from pairings where user_id in($1,$2)',[A,B]);await pair();assert.equal((await status()).reason,'relationship_unavailable');
});
test('Plus timing repair remains wrapped and once-only; new metadata never returns partner journals or rewards',async()=>{
 const a=await start(),snap={store:'apple',environment:'production',credential:randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()};
 const first=+new Date(a.endsAt);await rpc('reconcile_store_subscription_v3',[A,snap]);const one=await rpc('adventure_team_snapshot_v1',[A]),two=await rpc('adventure_team_snapshot_v1',[A]);
 assert.equal(one.team.plus,true);assert.ok(+new Date(one.team.endsAt)<first);assert.equal(one.team.endsAt,two.team.endsAt);
 assert.deepEqual(Object.keys(one.nudgeStatus),['reason']);
 for(const role of ['anon','authenticated'])for(const fn of ['adventure_team_snapshot_v1(uuid)','adventure_nudge_status_v1(uuid,uuid)','adventure_team_snapshot_before289_v1(uuid)'])
  assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn]))[0].allowed,false);
 assert.equal((await q("select has_function_privilege('service_role','adventure_team_snapshot_before289_v1(uuid)','execute') allowed"))[0].allowed,false);
});
test('withdrawn rename is absent from the real catalog and no unshipped support version remains',async()=>{
 assert.equal((await q("select title from catalog_items where stable_id='burrow_kettle_01_07'"))[0].title,'Rabbit Carrots');
 assert.equal(h.release.release,'5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4');
 assert.equal((await q('select count(*)::int n from burrow_shop_release_support where release=$1',[h.release.release]))[0].n,496);
 assert.equal((await q("select count(*)::int n from burrow_shop_release_support where release='68b83c9113fa987a24a94414cdf34dc9a2f1e9e0c6ec1923ed807c28e1050f91'"))[0].n,0);
 assert.equal(fs.existsSync('supabase/migrations/20261029000290_reviewed_copy_client_support.sql'),false);
});
