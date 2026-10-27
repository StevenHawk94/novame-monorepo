const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('actual batch SQL preserves counts and receipts, separates re-pairs and allows only my own toy',async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key,timezone_name text);
    create table pairings(user_id uuid primary key,partner_user_id uuid,created_at timestamptz default now());
    create table burrow_pair_versions(user_id uuid primary key,version uuid);
    create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,primary key(actor_id,command_key));
    create table moment_events(id serial primary key,pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,
      reference_type text,reference_id text,payload jsonb,idempotency_key text,pair_version text,created_at timestamptz default now(),unique(actor_id,idempotency_key));
    create function lock_burrow_pair(id uuid) returns uuid language sql as $$select partner_user_id from pairings where user_id=id$$;
    create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql as $$
      select md5(string_agg(user_id::text||':'||version::text,',' order by user_id)) from burrow_pair_versions where user_id in(a,b) having count(*)=2$$;`);
  const relation=fs.readFileSync('supabase/migrations/20261014000233_burrow_repair_history_isolation.sql','utf8');
  await db.exec(relation.slice(relation.indexOf('create function public.burrow_relation_started_at_v1'),relation.indexOf('do $$ declare tab')));
  await db.exec('create trigger stamp before insert on moment_events for each row execute function stamp_burrow_relation_row_v1();');
  await db.exec(fs.readFileSync('supabase/migrations/20261014000234_burrow_toy_interaction_batches.sql','utf8'));
  const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
  await db.query('insert into profiles values($1,$3),($2,$3)',[A,B,'UTC']);
  await db.query('insert into burrow_pair_versions values($1,$3),($2,$4)',[A,B,A,B]);
  await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
  const day=(await db.query('select current_date::text as local_day')).rows[0].local_day;
  let version=(await db.query('select burrow_pair_version_v1($1,$2) v',[A,B])).rows[0].v;
  const send=async(count,key,owner=A,partner=B,v=version,date=day)=>(await db.query('select interact_burrow_toy_batch_v1($1,$2,$3,$4,$5,$6,$7) result',[A,owner,partner,v,date,count,key])).rows[0].result;
  assert.equal((await send(12,'first')).count,12);assert.equal((await send(12,'first')).applied,false);
  assert.equal((await send(13,'first')).error,'idempotency_conflict');assert.equal((await send(8,'second')).count,20);
  assert.equal((await send(1,'foreign',B)).error,'own_toy_only');assert.equal((await send(51,'large')).error,'invalid_request');
  const old=version;
  await db.query('update burrow_pair_versions set version=$2 where user_id=$1',[A,'33333333-3333-4333-8333-333333333333']);
  version=(await db.query('select burrow_pair_version_v1($1,$2) v',[A,B])).rows[0].v;
  assert.equal((await send(12,'first',A,B,old)).error,'pair_changed');assert.equal((await send(2,'new')).count,2);
  const paired=(await db.query("select (payload->>'count')::int n from moment_events order by id")).rows.map(r=>r.n);
  assert.deepEqual(paired,[20,2]);
  await db.exec('delete from pairings');assert.equal((await send(2,'old-pair')).error,'pair_changed');
  assert.equal((await send(4,'solo',A,null,null)).count,4);assert.equal((await send(4,'solo',A,null,null)).applied,false);
  assert.equal((await db.query('select count(*)::int n from moment_events')).rows[0].n,3);await db.close();
});
