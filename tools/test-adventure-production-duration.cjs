const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
test('approved v5 preview is six hours Free and three hours Plus; migration 257 remains historical',()=>{
 const duration=load('apps/mobile/src/lib/adventure-duration.ts');assert.equal(duration.adventureDurationMs(false),21600000);assert.equal(duration.adventureDurationMs(true),10800000);
});
test('migration 257 restores both real writers, matching receipts, old journeys and idempotent replay',async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE),db=new PGlite();
 const migration=fs.readFileSync('supabase/migrations/20261021000257_adventure_production_duration.sql','utf8');
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table profiles(id uuid primary key,timezone_name text default 'UTC',subscription_tier text default 'free');
   create table pairings(user_id uuid primary key,partner_user_id uuid);
   create function lock_burrow_pair(p uuid) returns uuid language sql as $$select partner_user_id from pairings where user_id=p$$;
   create table reflects(id uuid primary key,user_id uuid,local_date date default current_date,journal_kind text default 'tap_your_day');
   create table reflect_drafts(user_id uuid,finalized_reflect_id uuid);
   create table app_config(key text,value text);insert into app_config values('app_major_update_content_revision','live');
   create table content_revisions(id text,status text);insert into content_revisions values('live','published');
   create table adventures(id uuid primary key default gen_random_uuid(),user_id uuid,partner_id uuid,local_date date,record_id uuid,status text,started_at timestamptz,ends_at timestamptz,duration_seconds int,plus_snapshot boolean,content_revision text,idempotency_key text);
   create function untouched_reward() returns int language sql as $$select 100$$;`);
  for(const [file,name]of [['20260920000119_app_major_update_commands','start_adventure_v1'],['20260920000148_burrow_solo_adventure','solo_burrow_start_adventure_v1']]){
   const source=fs.readFileSync(`supabase/migrations/${file}.sql`,'utf8'),start=source.indexOf(`create or replace function public.${name}(`),end=source.indexOf('$$;',source.indexOf('as $$',start))+3;
   await db.exec(source.slice(start,end));await db.exec(`revoke all on function ${name}(uuid,uuid,text) from public,anon,authenticated;grant execute on function ${name}(uuid,uuid,text) to service_role;`);
  }
  const oldTrigger=fs.readFileSync('supabase/migrations/20261001000153_care_cooldown_and_test_adventure.sql','utf8');await db.exec(oldTrigger.slice(oldTrigger.indexOf('create or replace function public.burrow_test_adventure_duration_v1()')));
  await db.exec("insert into adventures(user_id,status,started_at,ends_at,duration_seconds) values(gen_random_uuid(),'in_progress',now(),now()+interval '6 hours',21600)");
  const before=(await db.query('select to_jsonb(a) value from adventures a')).rows[0].value;assert.equal(before.duration_seconds,60);
  const identity=()=>db.query("select oid,proacl,prosecdef,proconfig from pg_proc where proname in('start_adventure_v1','solo_burrow_start_adventure_v1','untouched_reward') order by proname");
  const functions=(await identity()).rows;await db.exec(migration);assert.deepEqual((await identity()).rows,functions);
  assert.deepEqual((await db.query('select to_jsonb(a) value from adventures a')).rows[0].value,before);
  for(const paired of [false,true])for(const plus of [false,true]){
   const user=randomUUID(),partner=randomUUID(),record=randomUUID();
   await db.query('insert into profiles(id,subscription_tier) values($1,$2),($3,$4)',[user,paired?'free':plus?'plus':'free',partner,paired&&plus?'plus':'free']);
   if(paired)await db.query('insert into pairings values($1,$2),($2,$1)',[user,partner]);
   await db.query('insert into reflects(id,user_id) values($1,$2)',[record,user]);await db.query('insert into reflect_drafts values($1,$2)',[user,record]);
   const name=paired?'start_adventure_v1':'solo_burrow_start_adventure_v1';
   const run=async()=> (await db.query(`select ${name}($1,$2,'same-start') value`,[user,record])).rows[0].value;
   const receipt=await run();assert.equal(receipt.error,null);assert.equal(receipt.durationSeconds,plus?7200:21600);
   const journey=(await db.query('select *,extract(epoch from(ends_at-started_at)) seconds from adventures where id=$1',[receipt.adventureId])).rows[0];
   assert.equal(Number(journey.seconds),plus?7200:21600);assert.equal(journey.duration_seconds,receipt.durationSeconds);assert.equal(journey.plus_snapshot,plus);
   const replay=await run();assert.equal(replay.applied,false);assert.equal(replay.endsAt,receipt.endsAt);
   const denied=(await db.query(`select ${name}($1,$2,'second-start') value`,[user,record])).rows[0].value;assert.equal(denied.error,'daily_adventure_used');
  }
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='burrow_test_adventure_duration'")).rows[0].n,0);
  await db.exec(migration);assert.deepEqual((await db.query('select to_jsonb(a) value from adventures a where id=$1',[before.id])).rows[0].value,before);
 }finally{await db.close();}
});
