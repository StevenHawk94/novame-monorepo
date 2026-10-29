// Real PostgreSQL/WASM care, wallet, receipts and quest trigger; no production.
const{test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');let db,n=0,protectedBefore,protectedAfter;
const q=async(s,p=[])=> (await db.query(s,p)).rows;
const rpc=async(name,p=[])=>(await q(`select ${name}(${p.map((_,i)=>'$'+(i+1)).join(',')}) result`,p))[0].result;
const pair=()=>rpc('burrow_pair_version_v1',[A,B]);
async function protection(){
 const tables=await q("select tablename,rowsecurity from pg_tables where schemaname='public' and tablename<>'room_care_actions_v2' order by tablename");
 const rows={};for(const {tablename}of tables)rows[tablename]=await q(`select * from "${tablename}" order by to_jsonb("${tablename}")::text`);
 const functions=await q("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where pronamespace='public'::regnamespace and proname not in('burrow_moment_quest_progress','room_care_last_v2','room_care_state_v2','complete_room_care_v2') order by name");
 return{tables,rows,functions};
}
const day=async actor=>(await q('select (now() at time zone economic_timezone_v1($1))::date::text as local_day',[actor]))[0].local_day;
async function care(actor,owner,action,key='test-'+(++n),options={}){
 const partner=actor===A?B:actor===B?A:null;
 return rpc('complete_room_care_v2',[actor,owner,action,partner,partner?await pair():null,await day(actor),key,...[]].map((v,i)=>Object.hasOwn(options,i)?options[i]:v));
}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,timezone_name text default 'UTC');
 create table pairings(user_id uuid primary key,partner_user_id uuid);
 create table room_needs(owner_id uuid primary key,food_value smallint default 0,water_value smallint default 0,food_updated_at timestamptz default now(),water_updated_at timestamptz default now());
 create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,payload jsonb,created_at timestamptz default now(),idempotency_key text,unique(actor_id,idempotency_key));`);
 const foundation=sql('20260920000116_app_major_update_foundation');
 await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),foundation.indexOf('-- ---- Versioned')));
 await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.wallets'),foundation.indexOf('create table if not exists public.user_inventory')));
 const commands=sql('20260920000119_app_major_update_commands');
 await db.exec(commands.slice(commands.indexOf('create or replace function public.change_carrot_balance_v1'),commands.indexOf('create or replace function public.complete_affection_v1')));
 const interactions=sql('20260920000117_app_major_update_interactions');
 await db.exec(interactions.slice(interactions.indexOf('create table if not exists public.daily_quest_assignments'),interactions.indexOf('alter table public.daily_quest_assignments')));
 await db.exec(commands.slice(commands.indexOf('create or replace function public.assign_daily_quests_v1'),commands.indexOf('create or replace function public.claim_special_quest_v1')));
 const release=sql('20260920000144_burrow_release_quests');
 await db.exec(release.slice(release.indexOf('create or replace function public.assign_daily_quests_v1'),release.indexOf('create or replace function public.burrow_moment_quest_progress')));
 const trigger=sql('20261013000229_burrow_partner_care_quests');
 await db.exec(trigger.slice(trigger.indexOf('create or replace function public.burrow_moment_quest_progress'),trigger.indexOf('-- The underlying')));
 const toyGuard=sql('20261022000258_plushie_moment_windows');await db.exec(toyGuard.slice(toyGuard.indexOf('do $$'),toyGuard.indexOf('create function public.record_burrow_toy_window_v1')));
 await db.exec('create trigger care_quests after insert on moment_events for each row execute function burrow_moment_quest_progress()');
 await q('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
 await db.exec(sql('20260920000137_burrow_pair_generation').split('alter function public.burrow_bootstrap_v1')[0]);
 await q('insert into pairings values($1,$2),($2,$1)',[A,B]);
 await db.exec(sql('20261024000272_fixed_economic_calendar').split('-- Replace only audited')[0]+'commit;');
 const calendar=sql('20261024000272_fixed_economic_calendar');
 await db.exec(calendar.slice(calendar.indexOf('do $migration$')).replace(/for spec in select \* from \(values[\s\S]*?\) s\(name,actor\) loop/,
  "for spec in select * from (values ('advance_daily_quest_v1','p_user_id'),('assign_daily_quests_v1','p_user_id')) s(name,actor) loop"));
 await db.exec(`insert into daily_quest_assignments(user_id,local_date,quest_id,target)
 select p.id,current_date,k,1 from profiles p cross join unnest(array['feed_partner_bunny','water_partner_flower']) k;
 insert into quest_progress_vnext(assignment_id) select id from daily_quest_assignments;`);
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations(version) values('20261028000283');");
 const {care284Transaction}=await import('./release-garden-care284.mjs');
 const reviewed=await q("select oid::regprocedure::text signature,md5(prosrc) body from pg_proc where pronamespace='public'::regnamespace and proname='burrow_moment_quest_progress'");
 protectedBefore=await protection();await db.exec(care284Transaction(reviewed));protectedAfter=await protection();
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db?.close());
test('each actor can earn exactly four independent 5-coin care rewards; owners never receive helper coins',async()=>{
 for(const actor of [A,B])for(const [kind,owner]of [['carrot',actor],['water',actor],['leaf',actor===A?B:A],['fertilizer',actor===A?B:A]])assert.equal((await care(actor,owner,kind)).reward,5);
 assert.deepEqual((await q('select carrot_balance from wallets order by user_id')).map(r=>r.carrot_balance),[20,20]);
 assert.equal((await q('select * from currency_ledger')).length,8);
 assert.equal((await q('select * from room_care_actions_v2')).length,8);
});
test('own carrot/water cannot be performed by the partner; helper leaf/fertilizer cannot be self-performed or third-party',async()=>{
 for(const action of ['carrot','water'])assert.equal((await care(A,B,action)).error,'care_target_not_allowed');
 for(const action of ['leaf','fertilizer'])for(const owner of [A,C])assert.equal((await care(A,owner,action)).error,'care_target_not_allowed');
 assert.equal((await q('select * from currency_ledger')).length,0);assert.equal((await q('select * from moment_events')).length,0);
});
test('unpaired users retain carrot/water rewards but cannot help themselves or any other room',async()=>{
 assert.equal((await care(C,C,'carrot')).reward,5);assert.equal((await care(C,C,'water')).reward,5);
 assert.equal((await care(C,C,'leaf')).error,'care_target_not_allowed');assert.equal((await care(C,A,'fertilizer')).error,'care_target_not_allowed');
});
test('same-key replay is inert; altered action/owner/day with the same key conflicts',async()=>{
 const first=await care(A,A,'carrot','same');assert.equal(first.reward,5);
 assert.equal((await care(A,A,'carrot','same')).applied,false);assert.equal((await care(A,A,'water','same')).error,'idempotency_conflict');
 assert.equal((await care(A,B,'leaf','same')).error,'idempotency_conflict');
 assert.equal((await q('select * from currency_ledger')).length,1);assert.equal((await q('select * from moment_events')).length,1);
});
test('a committed immutable care receipt remains success after rematching; it never writes the old room or grants again',async()=>{
 const version=await pair(),today=await day(A);await care(A,B,'leaf','committed-before-rematch');
 await db.exec('delete from pairings');await q('insert into pairings values($1,$2),($2,$1)',[A,C]);
 const replay=await rpc('complete_room_care_v2',[A,B,'leaf',B,version,today,'committed-before-rematch']);
 assert.equal(replay.error,null);assert.equal(replay.applied,false);assert.equal(replay.reward,0);
 assert.equal((await q('select * from moment_events')).length,1);assert.equal((await q('select * from currency_ledger')).length,1);
 assert.equal((await q('select * from room_care_actions_v2')).length,1);
 assert.equal((await rpc('complete_room_care_v2',[A,B,'leaf',B,version,today,'new-stale-intent'])).error,'pair_changed');
});
test('12-hour cooldown is per owner and action, not a shared full meter',async()=>{
 assert.equal((await care(A,A,'carrot')).applied,true);assert.equal((await care(B,A,'leaf')).applied,true);
 assert.equal((await care(A,A,'carrot')).error,'care_cooldown');assert.equal((await care(B,A,'leaf')).error,'care_cooldown');
 assert.equal((await care(A,A,'water')).reward,5);assert.equal((await care(B,A,'fertilizer')).reward,5);
});
test('after 12 hours repeat care is allowed but the same economic day cannot grant another 5 coins',async()=>{
 await care(A,A,'carrot');await db.exec("update room_care_actions_v2 set completed_at=now()-interval '12 hours 1 second'");
 const next=await care(A,A,'carrot');assert.equal(next.applied,true);assert.equal(next.reward,0);
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,5);
});
test('only own carrot/water complete the actor quests; helpers do not progress either account quests',async()=>{
 await care(A,B,'leaf');await care(A,B,'fertilizer');
 assert.ok((await q('select progress from quest_progress_vnext')).every(r=>r.progress===0));
 await care(A,A,'carrot');await care(A,A,'water');
 assert.ok((await q('select p.progress from quest_progress_vnext p join daily_quest_assignments q on q.id=p.assignment_id where q.user_id=$1 and q.quest_id in($2,$3)',[A,'feed_partner_bunny','water_partner_flower'])).every(r=>r.progress===1));
 assert.ok((await q('select p.progress from quest_progress_vnext p join daily_quest_assignments q on q.id=p.assignment_id where q.user_id=$1',[B])).every(r=>r.progress===0));
});
test('changed pairing or frozen request date refuses atomically; profile timezone cannot reopen the fixed day',async()=>{
 assert.equal((await care(A,A,'water','old-day',{5:'2001-01-01'})).error,'day_changed');
 const version=await pair();await db.exec('delete from pairings');await q('insert into pairings values($1,$2),($2,$1)',[A,B]);
 assert.equal((await care(A,B,'leaf','stale',{4:version})).error,'pair_changed');
 const fixed=await day(A);await q("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[A]);assert.equal(await day(A),fixed);
 assert.equal((await q('select * from currency_ledger')).length,0);
});
test('legacy helper reward keys are shared, so an old pending retry and new greens cannot pay twice',async()=>{
 const d=await day(A);await rpc('change_carrot_balance_v1',[A,5,'partner_feed','room_need',B,`room-need-reward:food:${d}`]);
 assert.equal((await care(A,B,'leaf')).reward,0);assert.equal((await care(A,A,'carrot')).reward,5);
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,10);
});
test('state exposes only current rooms and four independent nextAt values; legacy own care does not block helper greens',async()=>{
 await q("insert into moment_events(actor_id,target_id,event_type,payload,created_at,idempotency_key) values($1,$1,'room_need_refilled','{\"need\":\"food\"}',now(),'legacy-own')",[A]);
 const state=await rpc('room_care_state_v2',[B]);assert.equal(state.version,2);assert.equal(state.partnerId,A);
 assert.ok(state.partner.carrot.nextAt);assert.equal(state.partner.leaf.nextAt,null);assert.equal((await care(B,A,'leaf')).reward,5);
 const solo=await rpc('room_care_state_v2',[C]);assert.equal(solo.partner,null);
});
test('authenticated/anon roles cannot write the table or invoke the monetary RPC',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await q("select has_function_privilege($1,'complete_room_care_v2(uuid,uuid,text,uuid,text,date,text)','execute') ok",[role]))[0].ok,false);
  assert.equal((await q("select has_table_privilege($1,'room_care_actions_v2','insert,update,delete') ok",[role]))[0].ok,false);
 }
});
test('migration preserves all fixture rows, old RLS flags, unrelated function bodies and ACLs; toy recording guard remains',async()=>{
 assert.deepEqual(protectedAfter,protectedBefore);
 const definition=(await q("select pg_get_functiondef('burrow_moment_quest_progress()'::regprocedure) definition"))[0].definition;
 assert.match(definition,/recordingVersion/);assert.match(definition,/target_id is distinct from new.actor_id/);
});
test('next economic day reopens only the daily credit, still requiring the independent 12-hour cooldown',async()=>{
 const today=await day(A),yesterday=(await q("select ($1::date-1)::text d",[today]))[0].d;
 await rpc('change_carrot_balance_v1',[A,5,'self_carrot','room_need',A,`room-care-reward:carrot:${yesterday}`]);
 await q("insert into room_care_actions_v2 values($1,'carrot',now()-interval '11 hours')",[A]);
 assert.equal((await care(A,A,'carrot')).error,'care_cooldown');
 await db.exec("update room_care_actions_v2 set completed_at=now()-interval '13 hours'");assert.equal((await care(A,A,'carrot')).reward,5);
});
test('wallet cap uses authoritative delta without breaking successful care or granting another daily credit',async()=>{
 await rpc('change_carrot_balance_v1',[A,99997,'fixture','fixture',A,'fixture']);const r=await care(A,A,'carrot');assert.equal(r.applied,true);assert.equal(r.reward,2);
 const next=await care(A,A,'water');assert.equal(next.applied,true);assert.equal(next.reward,0);
 assert.equal((await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,99999);
});
