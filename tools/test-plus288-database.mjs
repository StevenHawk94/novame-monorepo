// Real SQL in disposable PostgreSQL; no live accounts, payments or writes.
import fs from 'node:fs';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {securityTestDb} from './security-test-db.mjs';
import {adventure288289Transaction} from './release-adventure288289.mjs';
const A='36b75655-a89b-45dd-b232-a35db4efe502',B='4d95e1b8-09e9-4904-aaaa-5e564dabb603',C=randomUUID(),D=randomUUID();
const src=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
function definition(sql,name){
 const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);
 if(!start)throw Error(name);
 const tail=sql.slice(start.index),d=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(d[1],d.index+d[0].length);
 return tail.slice(0,end+d[1].length)+';';
}
let h,db,q,rpc,game,questions,untouched,offerBefore;
const pair=()=>rpc('pair_immediately',[A,B,'Partner',null]);
const snapshot=()=>({store:'apple',environment:'production',credential:randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()});
async function start(user=A){
 const record=randomUUID();await q("insert into reflects(id,user_id,local_date,journal_kind) values($1,$2,current_date,'tap_your_day')",[record,user]);
 await q('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[user,record]);
 const partner=(await q('select partner_user_id from pairings where user_id=$1',[user]))[0]?.partner_user_id??null;
 const result=await rpc('start_adventure_v5',[user,record,randomUUID(),h.release.release,partner,partner?await rpc('burrow_pair_version_v1',[user,partner]):null]);
 assert.equal(result.error,null,JSON.stringify(result));return result;
}
async function age(party,remaining=14400){
 await q("update adventure_parties set started_at=clock_timestamp()-interval '2 hours',progress_at=clock_timestamp(),progress_fraction=1.0/3,ends_at=clock_timestamp()+make_interval(secs=>$2) where id=$1",[party,remaining]);
 await q("update adventures set started_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()+make_interval(secs=>$2) where party_id=$1",[party,remaining]);
}
const row=async id=>(await q('select * from adventures where id=$1',[id]))[0];
const partyRow=async id=>(await q('select * from adventure_parties where id=$1',[id]))[0];
const left=async id=>(await q('select extract(epoch from(ends_at-clock_timestamp()))::float8 n from adventures where id=$1',[id]))[0].n;
const protectedRows=()=>q(`select 'wallets' t,to_jsonb(x) v from wallets x union all select 'ledger',to_jsonb(x) from currency_ledger x
 union all select 'inventory',to_jsonb(x) from user_inventory x union all select 'plans',to_jsonb(x) from adventure_encounter_plans x
 union all select 'domains',to_jsonb(x) from account_economic_domains x order by t,v`);
before(async()=>{
 h=await securityTestDb();({db,query:q,rpc}=h);
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,
 relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
 alter table pairings add column relationship text;alter table pairings add column relationship_since date;
 create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;`);
 await db.exec(src('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(src('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(src('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 for(const n of ['20261021000257_adventure_production_duration','20261025000273_bunny_identity','20261025000274_cooperative_adventure','20261025000275_bind_unpaired_adventure'])await db.exec(src(n));
 for(const user of [A,B,C,D]){
  await q('insert into auth.users(id) values($1)',[user]);await q('insert into profiles(id) values($1)',[user]);
  await q('insert into wallets(user_id,carrot_balance) values($1,10000)',[user]);
 }
 await pair();await q("update app_config set value='true' where key='adventure_friends_v2_enabled'");
 // Install the real 285 authority/table and audited consumers needed here,
 // without its production-only pair activation or unrelated Touch machinery.
 const temp=src('20261028000285_temporary_paired_testing');
 await db.exec(temp.slice(temp.indexOf('create table'),temp.indexOf('insert into public.burrow_temporary_test_pair')));
 for(const name of ['burrow_test_pair_allowed_v1','burrow_pair_economy_allowed_v1'])await db.exec(definition(temp,name));
 for(const name of ['burrow_has_plus_v1','sync_pair_plus_entitlements','burrow_service_offer_v1','adventure_nudge_eligible_v1','adventure_team_snapshot_v1','start_adventure_v5','bind_unpaired_adventures_v1']){
  const f=(await q('select pg_get_functiondef(oid) body from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1',[name]))[0];
  await db.exec(f.body.replaceAll('same_economic_domain_v1(','burrow_pair_economy_allowed_v1('));
 }
 const services=src('20261013000227_burrow_service_catalog_permissions');
 await db.exec(services.slice(services.indexOf('alter table public.burrow_game_unlocks drop'),services.indexOf('create function public.burrow_game_unlock_v2')));
 await db.exec(services.slice(services.indexOf('-- Gate new rounds'),services.indexOf('alter table public.burrow_surprises')));
 const freeGames=src('20261015000238_burrow_free_games');
 await db.exec(freeGames.slice(freeGames.indexOf('alter table public.burrow_game_unlocks drop'),freeGames.indexOf('create or replace function public.set_burrow_shop_prices_v1')));
 await db.exec(definition(src('20261015000238_burrow_free_games'),'burrow_game_unlock_v2'));
 const catalog=JSON.parse(fs.readFileSync('apps/api/src/data/burrow-game-room-v1.json'));
 const product=h.release.products.find(p=>p.type==='game'&&p.seed.price>0&&p.seed.plusOnly);assert.ok(product);
 game={...product,price:product.seed.price};
 questions=catalog.games.find(g=>g.id===game.metadata.gameId).questions;
 // Capture failures before installing the candidate, not just successful mocks.
 const a=await start();await age(a.team.id);await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).speedLocked,true);
 const bought=await rpc('burrow_game_unlock_v2',[A,game.metadata.gameId,randomUUID(),game.price]);assert.equal(bought.error,null);
 await q("update store_subscription_states set snapshot=jsonb_set(snapshot,'{state}','\"expired\"')");
 assert.equal((await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions])).error,'plus_required');
 await q('delete from adventures');await q('delete from reflect_drafts');await q('delete from reflects');await q('delete from burrow_game_unlocks');await q('delete from burrow_game_purchase_receipts');
 await q('delete from store_subscription_states');await q('delete from subscriptions');await q('delete from duo_memberships');await rpc('refresh_economic_entitlements_v1',[A]);
 offerBefore=(await q("select pg_get_functiondef('burrow_service_offer_v1(uuid,text,text)'::regprocedure) body"))[0].body;
 const allowed=['accelerate_adventure_for_plus_v1','refresh_economic_entitlements_v1','adventure_team_snapshot_v1','burrow_service_offer_v1',...(process.env.BURROW_RELEASE288289_CANDIDATE?['adventure_nudge_eligible_v1']:[])];
 untouched=await q("select oid::text,pg_get_functiondef(oid) body,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and prokind='f' and not(proname=any($1)) order by oid",[allowed]);
 const sentinel=await start(D),oldJourney=await row(sentinel.adventureId),oldParty=await partyRow(sentinel.team.id),before=await protectedRows();
 const migration=src('20261029000288_adventure_upgrade_and_owned_games');
 // An unexpected deployed offer body must abort the WHOLE migration,
 // including added columns/renamed functions, leaving user state unchanged.
 await db.exec(offerBefore.replace("if item.plus_only and not burrow_has_plus_v1(p_user) then",'if false then'));
 await assert.rejects(db.exec(migration),/Unexpected service offer Plus gate/);await db.exec('rollback');
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='adventures' and column_name='plus_accelerated_at'"))[0].n,0);
 assert.equal((await q("select to_regprocedure('refresh_economic_entitlements_before288_v1(uuid)') name"))[0].name,null);
 assert.deepEqual(await protectedRows(),before);await db.exec(offerBefore);
 if(process.env.BURROW_RELEASE288289_CANDIDATE){
  await db.exec("create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations(version) values('20261028000287');");
  if(process.env.BURROW_ADVENTURE288289_INSPECTION){const live=JSON.parse(fs.readFileSync(process.env.BURROW_ADVENTURE288289_INSPECTION));for(const f of live.functions)await db.exec(f.definition);}
  const expected=await q("select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) digest from pg_proc where pronamespace='public'::regnamespace and proname=any($1)",[allowed]);
  const wrong=expected.map((f,i)=>i?f:{...f,digest:'00000000000000000000000000000000'});
  await assert.rejects(db.exec(adventure288289Transaction(wrong)),/Reviewed Adventure function changed/);await db.exec('rollback');
  const guarded=await db.exec(adventure288289Transaction(expected));assert.ok(guarded.some(r=>r.rows.some(row=>row.verified?.protectedDataUnchanged)));
  await assert.rejects(db.exec(adventure288289Transaction(expected)),/Unexpected Adventure migration baseline/);await db.exec('rollback');
 }else await db.exec(migration);
 const {plus_accelerated_at,...unchanged}=await row(sentinel.adventureId);assert.equal(plus_accelerated_at,null);
 assert.deepEqual(unchanged,oldJourney,'migration preserves existing journey dates, status and original snapshots');
 assert.deepEqual(await partyRow(sentinel.team.id),oldParty,'deployment itself never boosts a pre-existing party');
 assert.deepEqual(await protectedRows(),before,'migration does not rewrite user data');
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));

test('verified mid-trip upgrade halves the remaining segment once, preserving progress and reserved rewards',async()=>{
 const a=await start();await age(a.team.id);const frozen=await protectedRows(),before=await row(a.adventureId);
 const result=await rpc('reconcile_store_subscription_v3',[A,snapshot()]);assert.equal(result.success,true);
 assert.ok(Math.abs(await left(a.adventureId)-7200)<3);
 const p=await partyRow(a.team.id);assert.equal(p.plus_snapshot,true);assert.ok(Math.abs(p.progress_fraction-1/3)<.001);
 assert.equal((await row(a.adventureId)).plus_snapshot,before.plus_snapshot,'reward snapshot is not a timing flag');
 assert.deepEqual(await protectedRows(),frozen);
 const first=await row(a.adventureId);for(let n=0;n<3;n++){
  assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).applied,false);
  await rpc('refresh_economic_entitlements_v1',[B]);await rpc('adventure_team_snapshot_v1',[A]);
 }
 assert.deepEqual(await row(a.adventureId),first,'repeat, partner refresh and restore never speed up again');
 await q("update store_subscription_states set snapshot=jsonb_set(snapshot,'{state}','\"expired\"')");
 await rpc('refresh_economic_entitlements_v1',[A]);assert.deepEqual(await row(a.adventureId),first,'expiry never lengthens the trip');
});
test('couple upgrade updates both deadlines atomically; join and Plus each apply only their own factor',async()=>{
 const a=await start();await age(a.team.id);const b=await start(B);assert.equal(b.joined,true);
 assert.ok(Math.abs(await left(a.adventureId)-9600)<3);
 await rpc('reconcile_store_subscription_v3',[B,snapshot()]);
 const ra=await row(a.adventureId),rb=await row(b.adventureId);assert.equal(+ra.ends_at,+rb.ends_at);
 assert.ok(Math.abs(await left(a.adventureId)-4800)<3);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).applied,false);
 assert.equal((await rpc('adventure_team_snapshot_v1',[A])).team.plus,true);
});
test('upgrade before join composes with the same 1.5x remaining-only join, without granting another Plus boost',async()=>{
 const a=await start();await age(a.team.id);await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 const b=await start(B);assert.equal(b.joined,true);assert.ok(Math.abs(await left(a.adventureId)-4800)<3);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[B,b.adventureId])).applied,false);
});
test('Plus-at-start, finished and already-due journeys do not receive an additional boost',async()=>{
 await rpc('reconcile_store_subscription_v3',[A,snapshot()]);const a=await start();assert.equal(a.durationSeconds,10800);
 const first=await row(a.adventureId);assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).applied,false);assert.deepEqual(await row(a.adventureId),first);
 for(const status of ['in_progress','result_ready']){
  await q("update adventure_parties set plus_snapshot=false,ends_at=now()-interval '1 second' where id=$1",[a.team.id]);
  await q("update adventures set ends_at=now()-interval '1 second',status=$2 where id=$1",[a.adventureId,status]);
  const before=await row(a.adventureId);assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).applied,false);assert.deepEqual(await row(a.adventureId),before);
 }
});
test('legacy solo upgrade uses half remaining, not the retired fixed two-hour cap',async()=>{
 await q('delete from pairings');const a=await start(C);await q('delete from adventure_parties where id=$1',[a.team.id]);
 await q("update adventures set ends_at=now()+interval '1 hour' where id=$1",[a.adventureId]);
 await rpc('reconcile_store_subscription_v3',[C,snapshot()]);assert.ok(Math.abs(await left(a.adventureId)-1800)<3);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[C,a.adventureId])).applied,false);
});
test('no foreign journey, stale label or cross-domain shared Plus may accelerate an unauthorized trip',async()=>{
 const a=await start();await q("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).error,'plus_required');
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[C,a.adventureId])).error,'not_found');
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.equal(await rpc('burrow_has_plus_v1',[B]),false);
});
test('current snapshot repairs a previously verified unpaired upgrade once after a missed refresh or restart',async()=>{
 const a=await start(C);await age(a.team.id);
 // Model an old API's verified subscription receipt before its timing update:
 // same real reconciliation, then restore the pre-upgrade timing checkpoint.
 const before=await row(a.adventureId),p=await partyRow(a.team.id);
 await rpc('reconcile_store_subscription_v3',[C,snapshot()]);
 await q('update adventures set ends_at=$2,duration_seconds=$3,plus_accelerated_at=null where id=$1',[a.adventureId,before.ends_at,before.duration_seconds]);
 await q('update adventure_parties set plus_snapshot=false,ends_at=$2,progress_at=$3,progress_fraction=$4,revision=$5 where id=$1',[p.id,p.ends_at,p.progress_at,p.progress_fraction,p.revision]);
 const frozen=await protectedRows(),recovered=await rpc('adventure_team_snapshot_v1',[C]);assert.equal(recovered.team.plus,true);
 assert.ok(Math.abs(await left(a.adventureId)-7200)<3);const once=await row(a.adventureId);
 await rpc('adventure_team_snapshot_v1',[C]);assert.deepEqual(await row(a.adventureId),once);assert.deepEqual(await protectedRows(),frozen);
});
test('an ordinary cross-domain pair cannot accelerate its partner independent solo, even with a verified subscriber',async()=>{
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);const a=await start(),b=await start(B);
 assert.equal(b.joined,false);await age(a.team.id);await age(b.team.id);
 const before=await row(b.adventureId);await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.ok(Math.abs(await left(a.adventureId)-7200)<3);assert.deepEqual(await row(b.adventureId),before);
});
test('a partner with no current trip repairs an old verified upgrade before receiving a joinable preview',async()=>{
 const a=await start();await age(a.team.id);const before=await row(a.adventureId),p=await partyRow(a.team.id);
 await rpc('reconcile_store_subscription_v3',[B,snapshot()]);
 await q('update adventures set ends_at=$2,duration_seconds=$3,plus_accelerated_at=null where id=$1',[a.adventureId,before.ends_at,before.duration_seconds]);
 await q('update adventure_parties set plus_snapshot=false,ends_at=$2,progress_at=$3,progress_fraction=$4 where id=$1',[p.id,p.ends_at,p.progress_at,p.progress_fraction]);
 const preview=await rpc('adventure_team_snapshot_v1',[B]);assert.equal(preview.adventureId,null);assert.equal(preview.joinable.plus,true);
 assert.ok(Math.abs(await left(a.adventureId)-7200)<3);
});
test('only an existing unexpired temporary pair permission permits shared upgrade; closing it never undoes elapsed speed',async()=>{
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);
 await q('insert into burrow_temporary_test_pair(pair_low,pair_high,pair_version) values($1,$2,$3)',[A,B,await rpc('burrow_pair_version_v1',[A,B])]);
 const a=await start();await age(a.team.id);const b=await start(B);assert.equal(b.joined,true);
 await rpc('reconcile_store_subscription_v3',[A,snapshot()]);assert.equal(await rpc('burrow_has_plus_v1',[B]),true);
 assert.ok(Math.abs(await left(a.adventureId)-4800)<3);const before=await row(b.adventureId);
 await q('update burrow_temporary_test_pair set enabled=false');await rpc('refresh_economic_entitlements_v1',[B]);
 assert.equal(await rpc('burrow_has_plus_v1',[B]),false);assert.deepEqual(await row(b.adventureId),before);
});
test('paid Plus game really starts after expiry, for its owner and eligible current partner, without recharging',async()=>{
 await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.equal((await rpc('burrow_game_unlock_v2',[A,game.metadata.gameId,randomUUID(),game.price])).error,null);
 await q("update store_subscription_states set snapshot=jsonb_set(snapshot,'{state}','\"expired\"')");await rpc('refresh_economic_entitlements_v1',[A]);
 const frozen=await protectedRows();assert.equal(await rpc('burrow_has_plus_v1',[A]),false);
 const round=await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions]);assert.equal(round.error,null);
 assert.equal((await rpc('burrow_game_start_v1',[B,game.metadata.gameId,questions])).sessionId,round.sessionId);
 await q('update burrow_game_sessions set completed_at=now() where id=$1',[round.sessionId]);
 const next=await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions]);assert.equal(next.error,null);assert.notEqual(next.sessionId,round.sessionId);
 assert.deepEqual(await protectedRows(),frozen);
});
test('unowned Plus games and Surprise still require Plus; permanent unlock cannot bypass economic isolation',async()=>{
 assert.equal((await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions])).error,'plus_required');
 assert.equal((await rpc('burrow_game_unlock_v2',[A,game.metadata.gameId,randomUUID(),game.price])).error,'plus_required');
 const surprise=h.release.products.find(p=>p.type==='surprise'&&p.seed.plusOnly);assert.ok(surprise);
 assert.equal((await rpc('burrow_service_offer_v1',[A,surprise.id,'surprise'])).error,'plus_required');
 await q('insert into burrow_game_unlocks(owner_id,game_id,price_paid) values($1,$2,$3)',[A,game.metadata.gameId,game.price]);
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);
 assert.equal((await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions])).error,'economic_domain_mismatch');
 assert.equal((await rpc('burrow_game_start_v1',[B,game.metadata.gameId,questions])).error,'economic_domain_mismatch');
});
test('all 70 catalogue games keep a valid permanent unlock after expiry and start real rounds without a second debit',async()=>{
 await q('update wallets set carrot_balance=100000 where user_id=$1',[A]);
 await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 const games=h.release.products.filter(p=>p.type==='game'),catalog=JSON.parse(fs.readFileSync('apps/api/src/data/burrow-game-room-v1.json'));
 assert.equal(games.length,70);
 for(const product of games){
  const bought=await rpc('burrow_game_unlock_v2',[A,product.metadata.gameId,randomUUID(),product.seed.price]);
  assert.equal(bought.error,null,product.id+': '+JSON.stringify(bought));
 }
 await q("update store_subscription_states set snapshot=jsonb_set(snapshot,'{state}','\"expired\"')");await rpc('refresh_economic_entitlements_v1',[A]);
 const frozen=await protectedRows();
 for(const product of games){
  const round=await rpc('burrow_game_start_v1',[A,product.metadata.gameId,catalog.games.find(g=>g.id===product.metadata.gameId).questions]);
  assert.equal(round.error,null,product.id+': '+JSON.stringify(round));assert.ok(round.sessionId);
 }
 assert.deepEqual(await protectedRows(),frozen);
});
test('Plus upgrade refuses a former couple after relationship rotation; permanent game sharing does not transfer ownership',async()=>{
 const a=await start(),b=await start(B);assert.equal(b.joined,true);
 await q('delete from pairings');await rpc('pair_immediately',[A,C,'Partner',null]);
 const before=await row(b.adventureId);await rpc('reconcile_store_subscription_v3',[A,snapshot()]);
 assert.equal((await rpc('accelerate_adventure_for_plus_v1',[A,a.adventureId])).error,'pair_changed');
 assert.deepEqual(await row(b.adventureId),before);
 await q('insert into burrow_game_unlocks(owner_id,game_id,price_paid) values($1,$2,$3)',[B,game.metadata.gameId,game.price]);
 await q("update store_subscription_states set snapshot=jsonb_set(snapshot,'{state}','\"expired\"')");await rpc('refresh_economic_entitlements_v1',[A]);
 assert.equal((await rpc('burrow_game_start_v1',[A,game.metadata.gameId,questions])).error,'plus_required');
});
test('migration preserves unrelated SQL/ACL and all old offer checks; internal helpers cannot be called by clients',async()=>{
 const after=await q('select oid::text,pg_get_functiondef(oid) body,proacl::text acl from pg_proc where oid::text=any($1) order by oid',[untouched.map(v=>v.oid)]);
 assert.deepEqual(after,untouched);
 const offer=(await q("select pg_get_functiondef('burrow_service_offer_v1(uuid,text,text)'::regprocedure) body"))[0].body;
 assert.ok(offer.includes('economic_domain_mismatch'));assert.ok(offer.includes('not_for_sale'));
 const [prefix,suffix]=offerBefore.split('if item.plus_only and not burrow_has_plus_v1(p_user) then');
 assert.ok(offer.startsWith(prefix)&&offer.endsWith(suffix),'all bytes outside the Plus acquisition condition are unchanged');
 for(const role of ['anon','authenticated','service_role'])for(const name of ['apply_active_adventure_plus_v1','refresh_economic_entitlements_before288_v1','adventure_team_snapshot_before288_v1'])
  assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,name+'(uuid)']))[0].allowed,false);
});
