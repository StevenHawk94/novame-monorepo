// Actual care, quest, claim and history routines in isolated PostgreSQL/WASM.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');let db;
const query=async(s,args=[]) => (await db.query(s,args)).rows;
const rpc=async(name,args=[]) => (await query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const care=(owner,need,key=randomUUID())=>rpc('interact_room_need_with_cooldown_v1',[A,owner,need,key]);
const progress=async(owner,quest)=>(await query('select q.*,p.progress,p.completed_at,p.claimed_at from daily_quest_assignments q join quest_progress_vnext p on p.assignment_id=q.id where q.user_id=$1 and q.quest_id=$2 order by q.local_date desc',[owner,quest]))[0];
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,timezone_name text default 'UTC');
 create table pairings(user_id uuid primary key,partner_user_id uuid);
 create table app_config(key text primary key,value text);insert into app_config values('app_major_update_enabled','true');
 create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,primary key(actor_id,command_key));
 create table room_needs(owner_id uuid primary key,food_value smallint default 100,water_value smallint default 100,food_updated_at timestamptz default now(),water_updated_at timestamptz default now());
 create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,
 reference_id text,reference_type text,payload jsonb,visibility text default 'pair',created_at timestamptz default now(),idempotency_key text,unique(actor_id,idempotency_key));
 create table memory_room_entries(id uuid,author_id uuid,body text,prompt_id text,created_at timestamptz,updated_at timestamptz,pair_low uuid,pair_high uuid,deleted_at timestamptz);
 create table memory_entry_photos(id uuid,entry_id uuid,slot integer,updated_at timestamptz);
 create table adventures(started_at timestamptz,ends_at timestamptz,duration_seconds integer);
 create function burrow_shared_record_v1(uuid,text,uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 `);
 await db.exec(sql('20261018000247_burrow_initial_care_needs.sql'));
 const foundation=sql('20260920000116_app_major_update_foundation.sql');
 await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),foundation.indexOf('create table public.burrow_command_receipts')));
 await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.wallets'),foundation.indexOf('create table if not exists public.user_inventory')));
 const interactions=sql('20260920000117_app_major_update_interactions.sql');
 await db.exec(interactions.slice(interactions.indexOf('create table if not exists public.daily_quest_assignments'),interactions.indexOf('alter table public.daily_quest_assignments')));
 const commands=sql('20260920000119_app_major_update_commands.sql');
 await db.exec(commands.slice(commands.indexOf('create or replace function public.change_carrot_balance_v1'),commands.indexOf('create or replace function public.complete_affection_v1')));
 await db.exec(commands.slice(commands.indexOf('create or replace function public.assign_daily_quests_v1'),commands.indexOf('create or replace function public.claim_special_quest_v1')));
 const release=sql('20260920000144_burrow_release_quests.sql');
 await db.exec(release.slice(release.indexOf('create or replace function public.assign_daily_quests_v1'),release.indexOf('create or replace function public.burrow_moment_quest_progress')));
 const moments=sql('20261001000154_moments_timeline_events.sql');
 await db.exec(moments.slice(moments.indexOf('create or replace function public.interact_burrow_toy_v1'),moments.indexOf('create or replace function public.solo_burrow_toy_v1')));
 await db.exec(sql('20261001000153_care_cooldown_and_test_adventure.sql'));
 await db.exec(sql('20260920000132_burrow_history.sql'));
 const solo=sql('20261005000201_burrow_solo_history.sql');await db.exec(solo.slice(0,solo.indexOf('-- Record an answer')));
 await db.exec(sql('20261013000229_burrow_partner_care_quests.sql'));
 await db.exec('create trigger moment_quests after insert on moment_events for each row execute function burrow_moment_quest_progress()');
 await query('insert into profiles(id) values($1),($2),($3)',[A,B,C]);await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 await db.exec(`insert into daily_quest_assignments(user_id,local_date,quest_id,target)
 select p.id,(now() at time zone p.timezone_name)::date,q,1 from profiles p cross join unnest(array['feed_partner_bunny','water_partner_flower','interact_with_toy']) q;
 insert into quest_progress_vnext(assignment_id) select id from daily_quest_assignments;`);
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db?.close());
for(const [need,quest] of [['food','feed_partner_bunny'],['water','water_partner_flower']])test(`${need}: helper care completes owner's task; owner alone can Claim once`,async()=>{
 const key=randomUUID();assert.equal((await care(B,need,key)).applied,true);
 const actor=await progress(A,quest),recipient=await progress(B,quest);
 assert.equal(actor.progress,1);assert.equal(recipient.progress,1);assert.ok(recipient.completed_at);assert.equal(recipient.claimed_at,null);
 assert.equal((await query('select * from currency_ledger where user_id=$1',[B])).length,0,'helper never auto-claims recipient coins');
 assert.equal((await care(B,need,key)).applied,false);assert.equal((await care(B,need)).error,'care_cooldown');
 assert.equal((await query("select * from moment_events where event_type='room_need_refilled'")).length,1);
 const event=(await query('select * from moment_events'))[0];assert.equal(event.actor_id,A);assert.equal(event.target_id,B);
 assert.equal((await rpc('claim_daily_quest_v1',[A,recipient.id])).error,'not_found');
 assert.equal((await rpc('claim_daily_quest_v1',[B,recipient.id])).reward,10);
 assert.equal((await rpc('claim_daily_quest_v1',[B,recipient.id])).applied,false);
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance,10);
 for(const [viewer,partner] of [[A,B],[B,A]]){
  const history=await rpc('burrow_history_v1',[viewer,partner,'moments']);assert.equal(history.rows[0].target_id,B);assert.equal(history.rows[0].actor_id,A);
 }
});
test('own care completes only own quest, and an unrelated target cannot be cared for',async()=>{
 assert.equal((await care(A,'food')).applied,true);assert.equal((await progress(A,'feed_partner_bunny')).progress,1);
 assert.equal((await progress(B,'feed_partner_bunny')).progress,0);
 assert.equal((await care(C,'water')).error,'not_paired');assert.equal((await progress(C,'water_partner_flower')).progress,0);
});
test('help does not add an extra care quest when the recipient was assigned another activity',async()=>{
 await query('delete from daily_quest_assignments where user_id=$1',[B]);
 const assigned=await rpc('assign_daily_quests_v1',[B]);
 const need=assigned.quests.some(q=>q.questId==='feed_partner_bunny')?'water':'food';
 const quest=need==='food'?'feed_partner_bunny':'water_partner_flower';
 assert.equal(await progress(B,quest),undefined);assert.equal((await care(B,need)).applied,true);
 assert.equal(await progress(B,quest),undefined);
});
test('partner task uses recipient timezone and does not invent unassigned care tasks',async()=>{
 await query("update profiles set timezone_name=case when id=$1 then 'Etc/GMT-14' else 'Etc/GMT+12' end where id in($1,$2)",[A,B]);
 await db.exec('delete from daily_quest_assignments');
 await db.exec(`insert into daily_quest_assignments(user_id,local_date,quest_id,target)
 select id,(now() at time zone timezone_name)::date,'feed_partner_bunny',1 from profiles where id in('${A}','${B}');
 insert into quest_progress_vnext(assignment_id) select id from daily_quest_assignments;`);
 await care(B,'food');const actor=await progress(A,'feed_partner_bunny'),owner=await progress(B,'feed_partner_bunny');
 assert.notEqual(String(actor.local_date),String(owner.local_date));assert.equal(owner.progress,1);
 await query('delete from pairings');assert.equal((await care(B,'water')).error,'not_paired');
});
test('toy owner spoofing is rejected; own touch retains counters, retry and actor-only quest semantics',async()=>{
 assert.equal((await rpc('interact_burrow_toy_v2',[A,B,'forged'])).error,'own_toy_only');
 assert.equal((await query('select * from moment_events')).length,0);
 assert.equal((await rpc('interact_burrow_toy_v2',[A,A,'touch'])).count,1);
 assert.equal((await rpc('interact_burrow_toy_v2',[A,A,'touch'])).applied,false);
 assert.equal((await rpc('interact_burrow_toy_v2',[A,A,'next'])).count,2);
 const event=(await query("select * from moment_events where event_type='toy_interacted'"))[0];assert.equal(event.target_id,A);
 assert.equal((await progress(A,'interact_with_toy')).progress,1);assert.equal((await progress(B,'interact_with_toy')).progress,0);
 assert.equal((await query("select has_function_privilege('authenticated','interact_burrow_toy_v2(uuid,uuid,text)','execute') ok"))[0].ok,false);
});
