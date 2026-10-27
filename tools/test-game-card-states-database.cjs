const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');let db;
const query=async(s,args=[]) => (await db.query(s,args)).rows;
const rpc=async(name,args=[]) => (await query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const questions=Array.from({length:6},(_,i)=>({self:'Me '+i,partner:'Them '+i,options:['A','B','C','D']})),answers=Array(6).fill(0);
async function start(game='daily_quirks_01'){return (await rpc('burrow_game_start_v1',[A,game,questions])).sessionId;}
async function finish(id){await rpc('burrow_game_submit_v1',[A,id,answers,answers]);await rpc('burrow_game_submit_v1',[B,id,answers,answers]);}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key);create table pairings(user_id uuid primary key,partner_user_id uuid);
 create table notification_outbox(recipient_user_id uuid,event_key text,event_type text,payload jsonb,unique(recipient_user_id,event_key));
 create function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select 'v1'::text$$;
 create function change_carrot_balance_v1(uuid,integer,text,text,text,text) returns jsonb language sql as $$select '{"applied":true,"balance":1000}'::jsonb$$;
 create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,payload jsonb,idempotency_key text,unique(actor_id,idempotency_key));
 `);
 const base=sql('20260920000116_app_major_update_foundation.sql');
 await db.exec(base.slice(base.indexOf('create or replace function public.lock_burrow_pair'),base.indexOf('create table public.burrow_command_receipts')));
 await db.exec(sql('20260920000142_burrow_game_room.sql'));
 await db.exec(sql('20261012000223_game_room_silent_delivery.sql'));
 await db.exec(sql('20261013000230_game_room_card_states.sql'));
 await db.exec(sql('20261019000249_game_room_ready_receipt.sql'));
 await query('insert into profiles values($1),($2),($3)',[A,B,C]);await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 await query('insert into burrow_game_unlocks(owner_id,game_id) values($1,$2)',[A,'daily_quirks_01']);
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());
test('249 atomic receipt preserves seals, canonical questions, idempotency and pair permissions',async()=>{
 const id=await start();
 const submit=(user,game='daily_quirks_01',qs=questions,own=answers)=>rpc('burrow_game_submit_ready_v1',[user,id,game,qs,own,answers]);
 assert.equal((await submit(A,'daily_quirks_02')).error,'game_content_update_required');
 assert.equal((await submit(A,'daily_quirks_01',questions.slice(1))).error,'game_content_update_required');
 assert.equal((await rpc('burrow_game_state_v1',[A,id])).ownAnswers.length,0);
 const first=await submit(A);assert.equal(first.session.partnerOwnAnswers,null);assert.equal(first.session.completedAt,null);
 const done=await submit(B);assert.ok(done.session.completedAt);assert.deepEqual(done.session.partnerOwnAnswers,answers);
 const replay=await submit(B);assert.equal(replay.replayed,true);assert.deepEqual(replay.session,done.session);
 assert.equal((await query("select count(*)::int n from notification_outbox where event_type='game_ready'"))[0].n,1);
 assert.equal((await submit(C)).error,'not_paired');
 for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'public.burrow_game_submit_ready_v1(uuid,uuid,text,jsonb,jsonb,jsonb)','EXECUTE') ok",[role]))[0].ok,false);
 await db.exec("create or replace function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select 'v2'::text$$");
 assert.equal((await submit(A)).error,'pair_changed');
});
test('result viewing is per participant, idempotent, guarded and never changes scores or coins',async()=>{
 const id=await start();assert.equal((await rpc('burrow_game_view_result_v1',[A,id])).error,'not_ready');
 await finish(id);const first=await rpc('burrow_game_view_result_v1',[A,id]);assert.ok(first.viewedAt);
 assert.equal((await rpc('burrow_game_view_result_v1',[A,id])).viewedAt,first.viewedAt);
 const mine=await rpc('burrow_game_state_v1',[A,id]),them=await rpc('burrow_game_state_v1',[B,id]);
 assert.equal(mine.resultViewedAt,first.viewedAt);assert.equal(them.resultViewedAt,null);assert.deepEqual(mine.ownAnswers,answers);
 assert.equal((await rpc('burrow_game_overview_v1',[A])).sessions[0].resultViewedAt,first.viewedAt);
 assert.equal((await rpc('burrow_game_overview_v1',[B])).sessions[0].resultViewedAt,null);
 assert.equal((await rpc('burrow_game_view_result_v1',[C,id])).error,'not_paired');
 await db.exec("create or replace function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select 'v2'::text$$");
 assert.equal((await rpc('burrow_game_view_result_v1',[A,id])).error,'pair_changed');
 assert.equal((await rpc('burrow_game_overview_v1',[A])).sessions.length,0);
});
test('partial sender drafts remain private; invite and completion counts follow full submission',async()=>{
 const id=await start();assert.equal((await rpc('burrow_game_overview_v1',[B])).sessions.length,0);
 await rpc('burrow_game_submit_v1',[A,id,answers,answers]);
 const receiver=(await rpc('burrow_game_overview_v1',[B])).sessions[0];
 assert.equal(receiver.ownCount,0);assert.equal(receiver.partnerOwnCount,6);assert.equal(receiver.partnerGuessCount,6);
 assert.equal((await rpc('burrow_game_state_v1',[B,id])).partnerOwnAnswers,null);
 await rpc('burrow_game_submit_v1',[B,id,answers,answers]);assert.ok((await rpc('burrow_game_overview_v1',[A])).sessions[0].completedAt);
});
test('catalogue retains each latest result and every unseen result beyond the previous 40-round cap',async()=>{
 const old=await start();await finish(old);await rpc('burrow_game_view_result_v1',[A,old]);
 await query('update burrow_game_sessions set created_at=$2 where id=$1',[old,'2020-01-01']);
 // Fifty newer finished rounds for another game must not hide the old game.
 for(let i=0;i<50;i++){
  const id=(await query('insert into burrow_game_sessions(pair_low,pair_high,pair_version,game_id,questions,started_by,created_at,completed_at) values($1,$2,$3,$4,$5,$1,$6,now()) returning id',[A,B,'v1','daily_quirks_02',JSON.stringify(questions),new Date(Date.UTC(2026,0,i+1)).toISOString()]))[0].id;
  await query('insert into burrow_game_progress(session_id,user_id,own_answers,guesses,result_viewed_at) values($1,$2,$4,$4,now()),($1,$3,$4,$4,now())',[id,A,B,JSON.stringify(answers)]);
 }
 let rows=(await rpc('burrow_game_overview_v1',[A])).sessions;assert.equal(rows.length,2);assert.ok(rows.some(row=>row.id===old));
 await db.exec('update burrow_game_progress set result_viewed_at=null');
 rows=(await rpc('burrow_game_overview_v1',[A])).sessions;assert.equal(rows.length,51,'unread results cannot disappear due to an arbitrary global limit');
 const replay=await start();assert.notEqual(replay,old);
 rows=(await rpc('burrow_game_overview_v1',[A])).sessions;assert.ok(rows.some(row=>row.id===old));assert.ok(rows.some(row=>row.id===replay&&!row.completedAt));
 assert.equal((await query('select count(*)::int n from burrow_game_unlocks'))[0].n,1,'replay never creates a new payment/unlock');
});
test('view-result RPC is service-only and former pair results cannot be acknowledged',async()=>{
 for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'public.burrow_game_view_result_v1(uuid,uuid)','EXECUTE') ok",[role]))[0].ok,false);
 assert.equal((await query("select has_function_privilege('service_role','public.burrow_game_view_result_v1(uuid,uuid)','EXECUTE') ok"))[0].ok,true);
 const id=await start();await finish(id);
 await db.exec('delete from pairings');await query('insert into pairings values($1,$2),($2,$1)',[A,C]);
 assert.equal((await rpc('burrow_game_view_result_v1',[A,id])).error,'pair_changed');
});
