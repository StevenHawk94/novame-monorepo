const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333';
let db;const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const context=async(type)=>(await q('select system_notification_context_v1($1,$2,$3) value',[B,type,JSON.stringify({sessionId:S})]))[0].value;
const migration=fs.readFileSync('supabase/migrations/20261023000264_game_notification_readiness.sql','utf8');
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,display_name text);
 create table pairings(user_id uuid primary key,partner_user_id uuid,version text default 'v1');
 create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql stable as $$select version from pairings where user_id=a and partner_user_id=b$$;
 create function adventure_reminder_eligible_v1(uuid,date) returns boolean language sql as $$select false$$;
 create table burrow_game_sessions(id uuid primary key,pair_low uuid,pair_high uuid,pair_version text,completed_at timestamptz);
 create table burrow_game_progress(session_id uuid,user_id uuid,own_answers jsonb default '[]',guesses jsonb default '[]',result_viewed_at timestamptz);
 insert into profiles values('${A}','Alex'),('${B}','Sam');
 insert into pairings(user_id,partner_user_id) values('${A}','${B}'),('${B}','${A}');
 insert into burrow_game_sessions values('${S}','${A}','${B}','v1',null);
 insert into burrow_game_progress(session_id,user_id) values('${S}','${A}'),('${S}','${B}');`);
 const original=fs.readFileSync('supabase/migrations/20261020000254_system_notification_policy.sql','utf8');
 await db.exec(original.slice(original.indexOf('create function public.system_notification_context_v1'),original.indexOf('\nrevoke all on function public.notification_timezone_v1')));
 await db.exec('revoke all on function system_notification_context_v1(uuid,text,jsonb) from public,anon,authenticated;grant execute on function system_notification_context_v1(uuid,text,jsonb) to service_role;');
 await db.exec(migration);
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());
const fill=async(user,own=6,guess=6)=>q('update burrow_game_progress set own_answers=$2,guesses=$3 where user_id=$1',[user,JSON.stringify(Array(own).fill(0)),JSON.stringify(Array(guess).fill(0))]);
test('start, partial own, own-only and eleven choices can never authorize an invitation',async()=>{
 for(const [own,guess] of [[0,0],[3,0],[6,0],[6,5]]){await fill(A,own,guess);assert.equal((await context('game_invite')).allowed,false);}
 await fill(A);assert.equal((await context('game_invite')).allowed,true);
});
test('invite expires when recipient finishes; ready requires both complete and committed result',async()=>{
 await fill(A);await fill(B);assert.equal((await context('game_invite')).allowed,false);assert.equal((await context('game_ready')).allowed,false);
 await q('update burrow_game_sessions set completed_at=now()');assert.equal((await context('game_invite')).allowed,false);assert.equal((await context('game_ready')).allowed,true);
 await q('update burrow_game_progress set result_viewed_at=now() where user_id=$1',[B]);assert.equal((await context('game_ready')).allowed,false);
});
test('former relationship and incomplete results are rejected without changing answer state',async()=>{
 await fill(A);await q("update pairings set version='v2'");assert.equal((await context('game_invite')).allowed,false);
 await db.exec("update pairings set version='v1';update burrow_game_sessions set completed_at=now()");assert.equal((await context('game_ready')).allowed,false);
 assert.equal((await q('select jsonb_array_length(own_answers) n from burrow_game_progress where user_id=$1',[A]))[0].n,6);
});
test('migration is repeatable, preserves function identity/grants, touches no business writers',async()=>{
 const meta=()=>q("select oid,proacl::text grants from pg_proc where oid='system_notification_context_v1(uuid,text,jsonb)'::regprocedure");
 const before=await meta();await db.exec(migration);assert.deepEqual(await meta(),before);
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'system_notification_context_v1(uuid,text,jsonb)','execute') ok",[role]))[0].ok,false);
 assert.equal((await q("select has_function_privilege('service_role','system_notification_context_v1(uuid,text,jsonb)','execute') ok"))[0].ok,true);
 assert.doesNotMatch(migration,/(?:insert into|update|delete from)\s+(?:public\.)?(?:wallets|burrow_game_sessions|burrow_game_progress|notification_outbox|moment_events)/i);
});
