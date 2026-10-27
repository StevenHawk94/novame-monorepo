const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE);
test('263: Free 1 / Plus 6, cross-device serialization, receipt replay, timezone day, no reward or historical data changes',async()=>{
 const db=new PGlite(),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
 const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const send=async(key,user=A)=>(await rows("select complete_affection_v1($1,'hug','{\"durationMs\":3000}',$2) result",[user,key]))[0].result;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table profiles(id uuid primary key,timezone_name text default 'America/Los_Angeles',subscription_tier text default 'free');
   create table pairings(user_id uuid,partner_user_id uuid);
   create function lock_burrow_pair(uuid) returns uuid language sql as $$select partner_user_id from pairings where user_id=$1$$;
   create table affection_events(id uuid primary key default gen_random_uuid(),sender_id uuid,recipient_id uuid,affection_type text,gesture_metrics jsonb,
    idempotency_key text,reward_granted int,completed_at timestamptz default now(),received_at timestamptz,read_at timestamptz,unique(sender_id,idempotency_key));
   create table rewards(actor uuid,key text,unique(actor,key));
   create function change_carrot_balance_v1(uuid,int,text,text,text,text) returns jsonb language plpgsql as $$begin
    insert into rewards values($1,$6) on conflict do nothing;return jsonb_build_object('delta',case when found then 10 else 0 end);end$$;
   create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,payload jsonb,idempotency_key text,unique(actor_id,idempotency_key));
   create function burrow_bootstrap_v1(uuid) returns jsonb language sql as $$select jsonb_build_object('profile',jsonb_build_object('id',$1),'partner',jsonb_build_object('id',lock_burrow_pair($1)),'unread',jsonb_build_object('affection',123),'affectionInbox','[]'::jsonb,'untouched','yes')$$;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261001000150_temporarily_unlimit_affection.sql','utf8'));
  await rows('insert into profiles(id) values($1),($2)',[A,B]);await rows('insert into pairings values($1,$2),($2,$1)',[A,B]);
  const oid=(await rows("select 'complete_affection_v1(uuid,text,jsonb,text)'::regprocedure::oid oid"))[0].oid;
  const migration=fs.readFileSync('supabase/migrations/20261023000263_affection_daily_limits.sql','utf8');await db.exec(migration);await db.exec(migration);
  assert.equal((await rows("select 'complete_affection_v1(uuid,text,jsonb,text)'::regprocedure::oid oid"))[0].oid,oid);
  assert.equal((await send('free')).applied,true);assert.equal((await send('free')).applied,false);
  assert.equal((await send('over-free')).error,'daily_limit_reached');
  await rows("update profiles set subscription_tier='plus' where id=$1",[B]);
  for(let n=2;n<=6;n++){const r=await send('plus-'+n);assert.equal(r.applied,true);assert.equal(r.affectionUsage.used,n);assert.equal(r.affectionUsage.limit,6);}
  assert.equal((await send('seventh')).error,'daily_limit_reached');assert.equal((await send('free')).applied,false);
  assert.equal((await rows('select count(*)::int n from affection_events where sender_id=$1',[A]))[0].n,6);
  assert.equal((await rows('select count(*)::int n from rewards where actor=$1',[A]))[0].n,1);
  assert.equal((await rows('select count(*)::int n from moment_events where actor_id=$1',[A]))[0].n,6);
  // Yesterday does not consume today; the service chooses the owner's day.
  await rows("update affection_events set completed_at=((now() at time zone 'America/Los_Angeles')::date::timestamp at time zone 'America/Los_Angeles')-interval '1 second' where sender_id=$1",[A]);
  assert.equal((await send('new-day')).applied,true);
  // Historic backlog >100 is one group with exact event membership, not a cap.
  await rows("insert into affection_events(sender_id,recipient_id,affection_type,idempotency_key) select $1,$2,'cuddle','old-'||n from generate_series(1,130) n",[B,A]);
  const snapshot=(await rows('select burrow_bootstrap_v1($1) result',[A]))[0].result;
  assert.equal(snapshot.untouched,'yes');assert.equal(snapshot.unread.affection,123);
  assert.equal(snapshot.affectionInboxGroups.length,1);assert.equal(snapshot.affectionInboxGroups[0].ids.length,130);
  assert.equal(snapshot.affectionUsage.used,1);assert.equal(snapshot.affectionUsage.keys[0],'new-day');
  for(const role of ['anon','authenticated'])for(const fn of ['complete_affection_v1(uuid,text,jsonb,text)','burrow_affection_state_v1(uuid,uuid)','burrow_bootstrap_v1(uuid)'])
   assert.equal((await rows('select has_function_privilege($1,$2,\'execute\') ok',[role,fn]))[0].ok,false);
 }finally{await db.close();}
});
