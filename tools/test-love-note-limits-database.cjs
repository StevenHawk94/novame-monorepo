const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=name=>fs.readFileSync(`supabase/migrations/${name}.sql`,'utf8');
let db;
const query=async(text,args=[]) => (await db.query(text,args)).rows;
const send=async(key,{user=A,body='💌 A letter',entry=null}={})=>(await query('select save_memory_room_entry_v1($1,$2,$3,null,$4) result',[user,entry,body,key]))[0].result;
const counter=async(user=A)=>(await query('select *,cardinality(minute_sends) minute_count from love_note_send_limits where user_id=$1',[user]))[0];
const expireMinute=()=>query("update love_note_send_limits set minute_sends='{}'");
const reject=async(run,code)=>assert.rejects(run,error=>{
 assert.equal(error.code,'P0001');assert.equal(error.message,code);
 assert.ok(JSON.parse(error.detail).retryAfterSeconds>=1);return true;
});
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,timezone_name text default 'UTC');
 create table pairings(user_id uuid primary key,partner_user_id uuid);
 create table memory_prompts(stable_id text,status text);
 create table memory_room_entries(id uuid primary key default gen_random_uuid(),pair_low uuid not null,pair_high uuid not null,
   author_id uuid not null references profiles(id),local_date date,prompt_id text,body text not null,
   created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
 create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,
   event_type text,reference_type text,reference_id text,idempotency_key text unique);
 create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,primary key(actor_id,command_key));
 create function lock_burrow_inventory(uuid,uuid) returns void language plpgsql as $$begin return;end$$;`);
 const foundation=sql('20260920000116_app_major_update_foundation');
 await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),foundation.indexOf('revoke all on function public.lock_burrow_pair')));
 const memory=sql('20260920000122_burrow_records_memories_and_special_quests');
 await db.exec(memory.slice(memory.indexOf('create or replace function public.save_memory_room_entry_v1'),memory.indexOf('revoke all on function public.register_adventure_record_v1')));
 await db.exec(sql('20261018000245_love_note_send_limits'));
});
beforeEach(async()=>{
 await db.exec('truncate profiles,memory_room_entries,love_note_send_limits,pairings,moment_events,burrow_command_receipts cascade');
 await query('insert into profiles(id)values($1),($2),($3)',[A,B,C]);
 await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
});
after(()=>db.close());
test('five sends succeed; sixth rolls back note, Moments, receipt and counter',async()=>{
 for(let i=0;i<5;i++)assert.equal((await send(`note-${i}`)).applied,true);
 await reject(()=>send('sixth'),'love_note_minute_limit');
 assert.equal((await counter()).daily_count,5);assert.equal((await counter()).minute_count,5);
 for(const table of ['memory_room_entries','moment_events','burrow_command_receipts'])assert.equal((await query(`select count(*)::int n from ${table}`))[0].n,5);
});
test('receipt retries still succeed at quota; changed same-key payload conflicts without consuming allowance',async()=>{
 const first=await send('same');for(let i=1;i<5;i++)await send(`note-${i}`);
 const replay=await send('same');assert.equal(replay.applied,false);assert.equal(replay.entryId,first.entryId);
 assert.equal((await send('same',{body:'💌 Changed'})).error,'idempotency_conflict');
 assert.equal((await counter()).daily_count,5);
});
test('rolling 60 seconds expires each send separately, not at a wall-clock minute boundary',async()=>{
 for(let i=0;i<5;i++)await send(`note-${i}`);
 await query("update love_note_send_limits set minute_sends=array[clock_timestamp()-interval '61 seconds',clock_timestamp()-interval '59 seconds',clock_timestamp()-interval '40 seconds',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '10 seconds']");
 await send('one-slot');await reject(()=>send('no-second-slot'),'love_note_minute_limit');
 assert.equal((await counter()).daily_count,6);assert.equal((await counter()).minute_count,5);
});
test('100 daily sends allowed; 101 denied, including across minute windows; retry not charged twice',async()=>{
 for(let i=0;i<100;i++){if(i%5===0)await expireMinute();await send(`day-${i}`);}
 await expireMinute();await reject(()=>send('101'),'love_note_daily_limit');
 assert.equal((await counter()).daily_count,100);
 assert.equal((await send('day-0')).applied,false);assert.equal((await counter()).daily_count,100);
});
test('sender allowances are independent and timezone changes do not immediately refill the day',async()=>{
 for(let i=0;i<5;i++)await send(`a-${i}`);
 assert.equal((await send('b-one',{user:B})).applied,true);assert.equal((await counter(B)).daily_count,1);
 const previous=await counter();
 await query("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[A]);
 await reject(()=>send('tz-bypass'),'love_note_minute_limit');
 await expireMinute();await send('next');const next=await counter();
 assert.equal(+next.day_start,+previous.day_start);assert.equal(+next.day_end,+previous.day_end);assert.equal(next.daily_count,6);
});
test('local midnight refills daily count without refilling rolling-minute allowance',async()=>{
 await query("update profiles set timezone_name='America/Los_Angeles' where id=$1",[A]);
 for(let i=0;i<5;i++)await send(`night-${i}`);
 await query("update love_note_send_limits set day_start=clock_timestamp()-interval '25 hours',day_end=clock_timestamp()-interval '1 hour',daily_count=100");
 await reject(()=>send('midnight-burst'),'love_note_minute_limit');
 await expireMinute();await send('new-day');const c=await counter();assert.equal(c.daily_count,1);
 const expected=(await query("select (clock_timestamp() at time zone 'America/Los_Angeles')::date::timestamp at time zone 'America/Los_Angeles' start,((clock_timestamp() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles' finish"))[0];
 assert.equal(+c.day_start,+expected.start);assert.equal(+c.day_end,+expected.finish);
});
test('natural-day windows follow DST: spring is 23 hours, autumn is 25, not a fixed 24-hour reset',async()=>{
 const original=(await query("select pg_get_functiondef('enforce_love_note_send_limits_v1()'::regprocedure) definition"))[0].definition;
 try{
  await query("update profiles set timezone_name='America/Los_Angeles' where id=$1",[A]);
  for(const [stamp,hours] of [['2026-03-08T12:00:00Z',23],['2026-11-01T12:00:00Z',25]]){
   // Test-only deterministic server clock; no client timestamp is accepted by
   // the production function or API. Restore its exact definition afterward.
   await db.exec(original.replace('clock_timestamp()',`'${stamp}'::timestamptz`));
   await query('delete from love_note_send_limits');await send(`dst-${hours}`);
   const c=await counter();assert.equal((+c.day_end-+c.day_start)/3600000,hours);assert.equal(c.daily_count,1);
  }
 }finally{await db.exec(original);}
});
test('exactly sixty seconds later the oldest send leaves the rolling window',async()=>{
 const original=(await query("select pg_get_functiondef('enforce_love_note_send_limits_v1()'::regprocedure) definition"))[0].definition;
 const stamp=new Date().toISOString();
 try{
  await db.exec(original.replace('clock_timestamp()',`'${stamp}'::timestamptz`));
  for(let i=0;i<5;i++)await send(`exact-${i}`);
  const later=new Date(Date.parse(stamp)+60000).toISOString();
  await db.exec(original.replace('clock_timestamp()',`'${later}'::timestamptz`));
  assert.equal((await send('exactly-60')).applied,true);assert.equal((await counter()).minute_count,1);
 }finally{await db.exec(original);}
});
test('deleted letters do not refund and changing partners does not give a new allowance',async()=>{
 for(let i=0;i<5;i++){const sent=await send(`delete-${i}`);await query('select delete_memory_room_entry_v1($1,$2)',[A,sent.entryId]);}
 await reject(()=>send('deleted-bypass'),'love_note_minute_limit');
 await query('delete from pairings');assert.equal((await send('unpaired')).error,'not_paired');
 await query('insert into pairings values($1,$2),($2,$1)',[A,C]);
 await reject(()=>send('new-pair'),'love_note_minute_limit');assert.equal((await counter()).daily_count,5);
});
test('first use counts existing same-day soft-deleted letters without modifying history',async()=>{
 await query("alter table memory_room_entries disable trigger enforce_love_note_send_limits");
 try{await query(`insert into memory_room_entries(pair_low,pair_high,author_id,body,created_at,deleted_at)
  select $1::uuid,$2::uuid,$1::uuid,'💌 Historical',clock_timestamp(),clock_timestamp() from generate_series(1,100)`,[A,B]);}
 finally{await query('alter table memory_room_entries enable trigger enforce_love_note_send_limits');}
 await reject(()=>send('historical-cap'),'love_note_daily_limit');
 assert.equal((await query('select count(*)::int n from memory_room_entries'))[0].n,100);
 assert.equal((await query('select count(*)::int n from burrow_command_receipts'))[0].n,0);
});
test('first use counts pre-migration sends in the rolling minute, but not journals or solo notes',async()=>{
 await query('alter table memory_room_entries disable trigger enforce_love_note_send_limits');
 try{await query(`insert into memory_room_entries(pair_low,pair_high,author_id,body)
  select $1::uuid,$2::uuid,$1::uuid,'💌 Existing' from generate_series(1,5)`,[A,B]);}
 finally{await query('alter table memory_room_entries enable trigger enforce_love_note_send_limits');}
 await reject(()=>send('recent-upgrade'),'love_note_minute_limit');
 for(let i=0;i<7;i++)await send(`journal-${i}`,{body:'A private journal'});
 await query("insert into memory_room_entries(pair_low,pair_high,author_id,body) select $1::uuid,$1::uuid,$1::uuid,'💌 Solo' from generate_series(1,7)",[C]);
 assert.equal(await counter(C),undefined);
});
test('editing a journal into a letter cannot bypass limits; metadata-only updates never count',async()=>{
 const journal=await send('journal',{body:'A journal'});
 for(let i=0;i<5;i++)await send(`fill-${i}`);
 await reject(()=>send('convert',{entry:journal.entryId,body:'💌 Converted'}),'love_note_minute_limit');
 assert.equal((await query('select body from memory_room_entries where id=$1',[journal.entryId]))[0].body,'A journal');
 await query('update memory_room_entries set updated_at=now()');assert.equal((await counter()).daily_count,5);
});
test('a failure after the quota trigger rolls back quota too, allowing a safe retry',async()=>{
 await send('seed');const before=await counter();
 await db.exec(`create function fail_test_moment() returns trigger language plpgsql as $$begin raise exception 'test failure';end$$;
 create trigger test_failure before insert on moment_events for each row execute function fail_test_moment();`);
 try{await assert.rejects(()=>send('will-retry'),/test failure/);assert.equal((await counter()).daily_count,before.daily_count);}
 finally{await db.exec('drop trigger test_failure on moment_events;drop function fail_test_moment()');}
 assert.equal((await send('will-retry')).applied,true);assert.equal((await counter()).daily_count,2);
});
test('concurrent device sends cannot exceed five successful transactions',async()=>{
 const responses=await Promise.allSettled(Array.from({length:12},(_,i)=>send(`device-${i}`)));
 assert.equal(responses.filter(r=>r.status==='fulfilled').length,5);
 for(const r of responses.filter(r=>r.status==='rejected'))assert.equal(r.reason.message,'love_note_minute_limit');
 assert.equal((await counter()).daily_count,5);
});
test('counter and trigger are inaccessible to ordinary clients; account deletion cascades quota',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await query('select has_table_privilege($1,\'love_note_send_limits\',\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role]))[0].allowed,false);
  assert.equal((await query('select has_function_privilege($1,\'enforce_love_note_send_limits_v1()\',\'EXECUTE\') allowed',[role]))[0].allowed,false);
 }
 await send('one');await query('delete from memory_room_entries');await query('delete from profiles where id=$1',[A]);
 assert.equal(await counter(),undefined);
});
