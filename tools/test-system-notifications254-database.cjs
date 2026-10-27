const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readFileSync}=require('node:fs'),{randomUUID}=require('node:crypto');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let db;const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,args=[]) => (await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;
const affection=async(type='hug',at='2026-10-20T15:00:00Z',sender=A,recipient=B)=>{
 const id=randomUUID();await q('insert into affection_events(id,sender_id,recipient_id,affection_type,completed_at) values($1,$2,$3,$4,$5)',[id,sender,recipient,type,at]);return id;};
const messages=()=>q('select * from notification_outbox where event_type in(\'affection_received\',\'surprise_received\',\'adventure_reminder\') order by created_at,id');
const context=row=>rpc('system_notification_context_v1',[row.recipient_user_id,row.event_type,row.payload]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,display_name text,timezone_name text);
 create table pairings(user_id uuid,partner_user_id uuid,created_at timestamptz default '2000-01-01',version text default 'pair1');
 create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql stable as $$select version from pairings where user_id=a and partner_user_id=b$$;
 create table device_push_tokens(id uuid default gen_random_uuid(),user_id uuid,enabled boolean default true);
 create table notification_outbox(id uuid default gen_random_uuid(),recipient_user_id uuid,event_key text,event_type text,payload jsonb default '{}',status text default 'pending',locked_at timestamptz,last_error text,created_at timestamptz default now(),unique(recipient_user_id,event_key));
 create table affection_events(id uuid primary key,sender_id uuid,recipient_id uuid,affection_type text,completed_at timestamptz default now(),read_at timestamptz,reward_granted integer default 0);
 create table burrow_surprises(id uuid primary key,sender_id uuid,recipient_id uuid,pair_version text default 'pair1',sent_at timestamptz,expired_at timestamptz,opened_at timestamptz);
 create table adventures(id uuid default gen_random_uuid(),user_id uuid,local_date date,started_at timestamptz,status text);
 create table burrow_game_sessions(id uuid primary key,pair_low uuid,pair_high uuid,pair_version text);
 insert into profiles values('${A}','Alex','UTC'),('${B}','Sam','UTC');insert into pairings(user_id,partner_user_id) values('${A}','${B}'),('${B}','${A}');
 insert into notification_outbox(recipient_user_id,event_key,event_type) values('${B}','legacy','partner_reflect'),('${B}','court','court_ready'),('${B}','game','game_ready');`);
 await db.exec(readFileSync('supabase/migrations/20261020000254_system_notification_policy.sql','utf8'));
});
beforeEach(async()=>{await db.exec('begin');await db.exec("update system_notification_policy set activated_at='2000-01-01'");});afterEach(()=>db.exec('rollback'));after(()=>db.close());
test('migration retires only queued legacy notifications and keeps game/history intact',async()=>{
 const rows=await q('select event_type,status from notification_outbox order by event_type');
 assert.deepEqual(rows,[{event_type:'court_ready',status:'failed'},{event_type:'game_ready',status:'pending'},{event_type:'partner_reflect',status:'failed'}]);
});
test('all Affection types share first-daily cap, with stable source ID and no reward mutation',async()=>{
 const first=await affection();await affection('kiss','2026-10-20T16:00:00Z');await rpc('enqueue_affection_push_v1',[first]);
 const rows=await messages();assert.equal(rows.length,1);assert.equal(rows[0].payload.eventId,first);
 assert.equal((await q('select sum(reward_granted)::int n from affection_events'))[0].n,0);
 assert.equal((await q('select count(*)::int n from affection_events'))[0].n,2);
});
test('cap uses receiving timezone, not sending timezone or gesture reward date',async()=>{
 await q("update profiles set timezone_name='Asia/Tokyo' where id=$1",[B]);
 await affection('hug','2026-10-20T14:59:00Z');await affection('kiss','2026-10-20T15:01:00Z');
 assert.deepEqual((await messages()).map(r=>r.payload.localDate).sort(),['2026-10-20','2026-10-21']);
});
test('first historical pre-policy affection is not replayed by a later gesture today',async()=>{
 await db.exec("update system_notification_policy set activated_at='2026-10-20T16:00:00Z'");await affection('hug','2026-10-20T15:00:00Z');await affection('kiss','2026-10-20T17:00:00Z');
 assert.equal((await messages()).length,0);
});
test('unpair/re-pair invalidates old queued notification, and read affection is not resurfaced',async()=>{
 const id=await affection(),row=(await messages())[0];assert.equal((await context(row)).allowed,true);
 await q('update affection_events set read_at=now() where id=$1',[id]);assert.equal((await context(row)).allowed,false);
 await q('update affection_events set read_at=null where id=$1',[id]);await db.exec("update pairings set version='pair2'");assert.equal((await context(row)).allowed,false);
});
test('Surprise queues only on committed sent_at, once per independent send; opening suppresses stale delivery',async()=>{
 const id=randomUUID();await q('insert into burrow_surprises(id,sender_id,recipient_id) values($1,$2,$3)',[id,A,B]);assert.equal((await messages()).length,0);
 await q('update burrow_surprises set sent_at=now() where id=$1',[id]);await q('update burrow_surprises set sent_at=sent_at where id=$1',[id]);
 const row=(await messages())[0];assert.equal((await messages()).length,1);assert.equal((await context(row)).allowed,true);
 await q('update burrow_surprises set opened_at=now() where id=$1',[id]);assert.equal((await context(row)).allowed,false);
});
test('notification sidecar failure never rolls back completed Affection; repair restores queue once',async()=>{
 await db.exec('alter table notification_outbox rename to unavailable_outbox');const id=await affection('hug',new Date().toISOString());
 assert.equal((await q('select count(*)::int n from affection_events where id=$1',[id]))[0].n,1);
 await db.exec('alter table unavailable_outbox rename to notification_outbox');await rpc('prepare_system_notifications_v1');await rpc('prepare_system_notifications_v1');
 assert.equal((await messages()).length,1);
});
test('notification failure does not undo successful Surprise sent_at; repair does not resend twice',async()=>{
 const id=randomUUID();await q('insert into burrow_surprises(id,sender_id,recipient_id) values($1,$2,$3)',[id,A,B]);
 await db.exec('alter table notification_outbox rename to unavailable_outbox');await q('update burrow_surprises set sent_at=now() where id=$1',[id]);
 await db.exec('alter table unavailable_outbox rename to notification_outbox');await rpc('prepare_system_notifications_v1');await rpc('prepare_system_notifications_v1');
 assert.equal((await messages()).length,1);
});
test('8pm eligibility distinguishes saved record from actual start, respects active previous-day journey and short expiry',async()=>{
 const eligible=at=>rpc('adventure_reminder_eligible_v1',[A,'2026-10-20',at]);
 assert.equal(await eligible('2026-10-20T19:59:00Z'),false);assert.equal(await eligible('2026-10-20T20:00:00Z'),true);assert.equal(await eligible('2026-10-20T20:15:00Z'),false);
 await q("insert into adventures(user_id,local_date,status) values($1,'2026-10-20','record_saved')",[A]);assert.equal(await eligible('2026-10-20T20:01:00Z'),true);
 await q("update adventures set started_at='2026-10-20T10:00:00Z',status='completed'");assert.equal(await eligible('2026-10-20T20:01:00Z'),false);
 await q("update adventures set local_date='2026-10-19',status='in_progress'");assert.equal(await eligible('2026-10-20T20:01:00Z'),false);
});
test('invalid timezone safely falls back to UTC, without changing profile setting',async()=>{
 await q("update profiles set timezone_name='not-a-timezone' where id=$1",[A]);assert.equal(await rpc('notification_timezone_v1',[A]),'UTC');
 assert.equal((await q('select timezone_name from profiles where id=$1',[A]))[0].timezone_name,'not-a-timezone');
});
test('notification functions and source receipts are not client-readable or executable',async()=>{
 assert.equal((await q("select has_table_privilege('authenticated','system_notification_sources','select') allowed"))[0].allowed,false);
 await db.exec('set local role authenticated');await assert.rejects(()=>rpc('prepare_system_notifications_v1'),/permission denied/);
});
test('daily scheduler requires new-client per-device opt-in, queues once and expires at local 20:15',async()=>{
 // The actual clock-window predicate is exercised above. Override just that
 // predicate here to exercise scheduling independently of test execution time.
 await db.exec('create or replace function adventure_reminder_eligible_v1(p_user uuid,p_day date,p_now timestamptz default now()) returns boolean language sql as $$select true$$');
 await q('insert into device_push_tokens(user_id,notification_version,adventure_reminder_enabled) values($1,1,true),($2,2,false)',[A,B]);
 await rpc('prepare_system_notifications_v1');assert.equal((await messages()).length,0);
 await q('update device_push_tokens set notification_version=2 where user_id=$1',[A]);await rpc('prepare_system_notifications_v1');await rpc('prepare_system_notifications_v1');
 const rows=await messages();assert.equal(rows.length,1);assert.equal(rows[0].recipient_user_id,A);assert.match(new Date(rows[0].expires_at).toISOString(),/20:15:00/);
});
test('emergency API rollback quarantines old and new OS pushes without blocking business completion',async()=>{
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text);insert into supabase_migrations.schema_migrations values('20261020000254')");
 // Keep this fixture's enclosing transaction; the production script owns its transaction.
 const sql=readFileSync('tools/rollback-system-notifications-254.sql','utf8').replace(/^begin;$/gm,'').replace(/^commit;$/gm,'');
 await db.exec(sql);
 const id=await affection();assert.equal((await q('select count(*)::int n from affection_events where id=$1',[id]))[0].n,1);
 assert.equal((await messages())[0].status,'failed');
 assert.equal((await q("select count(*)::int n from notification_outbox where status in('pending','retry','sending')"))[0].n,0);
 await q("insert into notification_outbox(recipient_user_id,event_key,event_type) values($1,'old-client','partner_reflect')",[B]);
 assert.equal((await q("select status from notification_outbox where event_key='old-client'"))[0].status,'failed');
});
