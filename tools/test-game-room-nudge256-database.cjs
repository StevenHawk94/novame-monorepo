const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',S='44444444-4444-4444-8444-444444444444';
let db;const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const rpc=async(name,args)=>(await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;
const nudge=(user=A)=>rpc('burrow_game_nudge_v1',[user,S]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table pairings(user_id uuid primary key,partner_user_id uuid,version text default 'v1');
 create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql stable as $$select version from pairings where user_id=a and partner_user_id=b$$;
 create function lock_burrow_pair(a uuid) returns uuid language sql as $$select partner_user_id from pairings p where user_id=a and exists(select 1 from pairings b where b.user_id=p.partner_user_id and b.partner_user_id=a) for update$$;
 create function notification_timezone_v1(a uuid) returns text language sql as $$select 'America/Los_Angeles'::text$$;
 create table burrow_game_sessions(id uuid primary key,pair_low uuid,pair_high uuid,pair_version text,completed_at timestamptz);
 create table burrow_game_progress(session_id uuid,user_id uuid,own_answers jsonb,guesses jsonb,primary key(session_id,user_id));
 create table notification_outbox(recipient_user_id uuid,event_key text,event_type text,payload jsonb,expires_at timestamptz,unique(recipient_user_id,event_key));`);
 await db.exec(readFileSync('supabase/migrations/20261021000256_game_room_nudge.sql','utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate pairings,burrow_game_sessions,burrow_game_progress,notification_outbox');
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 await q("insert into burrow_game_sessions values($1,$2,$3,'v1',null)",[S,A,B]);
 await q("insert into burrow_game_progress values($1,$2,'[0,0,0,0,0,0]','[0,0,0,0,0,0]'),($1,$3,'[]','[]')",[S,A,B]);
});
test('one queued reminder per round per recipient-local day, including simultaneous retries',async()=>{
 const results=await Promise.all([nudge(),nudge(),nudge()]);
 assert.equal(results.filter(r=>!r.alreadySent).length,1);
 const rows=await q('select * from notification_outbox');assert.equal(rows.length,1);
 assert.equal(rows[0].recipient_user_id,B);assert.equal(rows[0].event_type,'game_invite');
 assert.deepEqual(rows[0].payload,{sessionId:S,nudge:true});
 const day=(await q("select (now() at time zone 'America/Los_Angeles')::date::text as local_day"))[0].local_day;
 assert.equal(rows[0].event_key,`game-nudge:${S}:${day}`);assert.ok(Date.parse(rows[0].expires_at)>Date.now());
});
test('a previous-day reminder does not consume today’s reminder',async()=>{
 await nudge();await q("update notification_outbox set event_key='game-nudge:'||$1||':yesterday'",[S]);
 assert.equal((await nudge()).alreadySent,false);assert.equal((await q('select * from notification_outbox')).length,2);
});
test('only a fully submitted sender may remind an unfinished partner',async()=>{
 assert.equal((await nudge(B)).error,'not_ready');
 await q("update burrow_game_progress set guesses='[0,0]' where user_id=$1",[A]);assert.equal((await nudge()).error,'not_ready');
 assert.equal((await q('select * from notification_outbox')).length,0);
});
test('delivery rechecks progress, completion and pair incarnation; old queue cannot notify new pair',async()=>{
 await nudge();assert.equal(await rpc('burrow_game_nudge_eligible_v1',[B,S]),true);
 await q("update burrow_game_progress set own_answers='[0,0,0,0,0,0]',guesses='[0,0,0,0,0,0]' where user_id=$1",[B]);
 assert.equal(await rpc('burrow_game_nudge_eligible_v1',[B,S]),false);assert.equal((await nudge()).finished,true);
 await q("update burrow_game_progress set guesses='[]' where user_id=$1",[B]);
 await db.exec('update burrow_game_sessions set completed_at=now()');assert.equal((await nudge()).finished,true);
 await db.exec("update burrow_game_sessions set completed_at=null; update pairings set version='v2'");
 assert.equal((await nudge()).error,'pair_changed');assert.equal(await rpc('burrow_game_nudge_eligible_v1',[B,S]),false);
});
test('unpaired, foreign-user and broken reciprocal-pair requests cannot send',async()=>{
 assert.equal((await nudge(C)).error,'not_paired');
 await q('update pairings set partner_user_id=$1 where user_id=$2',[C,B]);
 assert.equal((await nudge()).error,'not_paired');assert.equal(await rpc('burrow_game_nudge_eligible_v1',[B,S]),false);
 assert.equal((await q('select * from notification_outbox')).length,0);
});
test('nudge RPC is service-role-only, never a direct authenticated write',async()=>{
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'burrow_game_nudge_v1(uuid,uuid)','EXECUTE') allowed",[role]))[0].allowed,false);
 assert.equal((await q("select has_function_privilege('service_role','burrow_game_nudge_v1(uuid,uuid)','EXECUTE') allowed"))[0].allowed,true);
});
test('emergency stop preserves saved games and queued keys while disabling manual dispatch',async()=>{
 await nudge();const games=await q('select * from burrow_game_sessions'),queue=await q('select * from notification_outbox');
 await db.exec(readFileSync('tools/rollback-game-room-nudge-256.sql','utf8'));
 assert.equal((await nudge()).error,'feature_disabled');assert.equal(await rpc('burrow_game_nudge_eligible_v1',[B,S]),false);
 assert.deepEqual(await q('select * from burrow_game_sessions'),games);assert.deepEqual(await q('select * from notification_outbox'),queue);
});
