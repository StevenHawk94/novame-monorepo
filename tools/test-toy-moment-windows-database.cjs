const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const PHOTO='33333333-3333-4333-8333-333333333333',KEY='44444444-4444-4444-8444-444444444444';
test('actual 258 SQL: anchored hours, all photographed toys, midnight tasks, private eligibility, legacy compatibility and receipts',async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
  try{
    await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;
      create table profiles(id uuid primary key,timezone_name text);
      create table pairings(user_id uuid primary key,partner_user_id uuid,created_at timestamptz default now()-interval '2 days');
      create table burrow_pair_versions(user_id uuid primary key,version uuid);
      create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,primary key(actor_id,command_key));
      create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,
        reference_type text,reference_id text,payload jsonb,idempotency_key text,pair_version text,created_at timestamptz default now(),unique(actor_id,idempotency_key));
      create table room_photos(id uuid primary key,owner_id uuid,pair_low uuid,pair_high uuid,kind text,toy_id text);
      create table room_photo_uploads(actor_id uuid,owner_id uuid,partner_id uuid,kind text,toy_id text,command_key uuid,committed_at timestamptz,expired_at timestamptz);
      create table daily_quest_assignments(id uuid primary key default gen_random_uuid(),user_id uuid,local_date date,quest_id text,target int,unique(user_id,local_date,quest_id));
      create table quest_progress_vnext(assignment_id uuid primary key,progress int default 0,completed_at timestamptz,claimed_at timestamptz,updated_at timestamptz default now());
      create function lock_burrow_pair(id uuid) returns uuid language sql as $$select partner_user_id from pairings where user_id=id$$;
      create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql as $$
        select md5(string_agg(user_id::text||':'||version::text,',' order by user_id)) from burrow_pair_versions where user_id in(a,b) having count(*)=2$$;
      create function current_burrow_toy_v1(a uuid,b uuid) returns text language sql as $$select 'toy-a'::text$$;
      create function advance_daily_quest_v1(a uuid,b text,c int) returns jsonb language plpgsql as $$begin raise exception 'New toy events must bypass old insert-only quest trigger';end$$;`);
    await db.query("insert into moment_events(actor_id,event_type,reference_id,payload,idempotency_key) values($1,'toy_interacted','legacy-day','{\"count\":123}','legacy-daily')",[A]);
    const relation=fs.readFileSync('supabase/migrations/20261014000233_burrow_repair_history_isolation.sql','utf8');
    await db.exec(relation.slice(relation.indexOf('create function public.burrow_relation_started_at_v1'),relation.indexOf('do $$ declare tab')));
    await db.exec('create trigger stamp before insert on moment_events for each row execute function stamp_burrow_relation_row_v1();');
    const daily=fs.readFileSync('supabase/migrations/20260920000144_burrow_release_quests.sql','utf8');
    const assignStart=daily.indexOf('create or replace function public.assign_daily_quests_v1');
    await db.exec(daily.slice(assignStart,daily.indexOf('end $$;',assignStart)+7));
    const quest=fs.readFileSync('supabase/migrations/20261013000229_burrow_partner_care_quests.sql','utf8');
    await db.exec(quest.slice(quest.indexOf('create or replace function public.burrow_moment_quest_progress'),quest.indexOf('-- The underlying')));
    await db.exec('create trigger quest_progress after insert on moment_events for each row execute function burrow_moment_quest_progress();');
    await db.exec(fs.readFileSync('supabase/migrations/20261014000234_burrow_toy_interaction_batches.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261022000258_plushie_moment_windows.sql','utf8'));
    await db.query('insert into profiles values($1,$3),($2,$3)',[A,B,'UTC']);
    await db.query('insert into burrow_pair_versions values($1,$3),($2,$4)',[A,B,A,B]);
    await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
    await db.query("insert into room_photos values($1,$2,$2,$3,'doll','toy-a')",[PHOTO,A,B]);
    let version=(await db.query('select burrow_pair_version_v1($1,$2) v',[A,B])).rows[0].v;
    const times=(await db.query(`select (now()-interval '3 hours')::text base,current_date::text as "day",(current_date-1)::text yesterday,
      (current_date-1+time '23:50')::timestamptz::text midnight_start,(current_date+time '00:10')::timestamptz::text midnight_later`)).rows[0];
    const iso=x=>new Date(x).toISOString(),plus=(t,ms)=>iso(Date.parse(t)+ms);
    const first=iso(times.base),day=first.slice(0,10);
    const send=async(key,count=1,patch={})=>{
      const s={actor:A,partner:B,version,toy:'toy-a',photo:PHOTO,start:first,at:first,last:first,date:day,...patch};
      return(await db.query('select record_burrow_toy_window_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r',
        [s.actor,s.partner,s.version,s.toy,s.photo,s.start,s.at,s.last,s.date,count,key])).rows[0].r;
    };
    await db.query("insert into daily_quest_assignments(user_id,local_date,quest_id,target) values($1,$2,'interact_with_toy',1)",[A,day]);
    assert.equal((await send('blank-first',1,{toy:'toy-empty'})).skipped,'photo_required');
    assert.equal((await db.query('select count(*)::int n from quest_progress_vnext')).rows[0].n,0);
    assert.equal((await send('first',3)).count,3);assert.equal((await send('first',3)).applied,false);
    assert.equal((await send('first',4)).error,'idempotency_conflict');
    assert.equal((await send('empty',5,{toy:'toy-empty'})).skipped,'photo_required');
    await db.query("insert into room_photos values($1,$2,$2,$3,'doll','toy-b')",[KEY,A,B]);
    assert.equal((await send('other-toy',2,{toy:'toy-b',photo:KEY,at:plus(first,59*60000),last:plus(first,59*60000)})).count,5);
    assert.equal((await db.query('select count(*)::int n from moment_events where toy_window_started_at is not null')).rows[0].n,1);
    assert.equal((await send('next-hour',1,{start:plus(first,3600000),at:plus(first,3600000),last:plus(first,3600000)})).count,1);
    const localPhoto='local-plushie-'+KEY;
    assert.equal((await send('pending',2,{photo:localPhoto})).error,'photo_sync_pending');
    await db.query("insert into room_photo_uploads values($1,$1,$2,'doll','toy-a',$3,now(),null)",[A,B,KEY]);
    assert.equal((await send('pending',2,{photo:localPhoto})).count,7);assert.equal((await send('pending',2,{photo:localPhoto})).applied,false);
    assert.equal((await send('foreign-photo',9,{actor:B,partner:A,photo:PHOTO})).skipped,'photo_required');
    assert.equal((await send('future',1,{start:plus(new Date().toISOString(),3600000),at:plus(new Date().toISOString(),3600000),last:plus(new Date().toISOString(),3600000)})).error,'invalid_request');

    // Start an independent scenario, rather than replaying times backwards
    // into whichever hour the execution host happens to be in.
    await db.exec('delete from moment_events where toy_window_started_at is not null');
    // Midnight: same Moment, but both existing day assignments complete.
    await db.query("insert into daily_quest_assignments(user_id,local_date,quest_id,target) values($1,$2,'interact_with_toy',1),($1,$3,'interact_with_toy',1) on conflict do nothing",[A,times.yesterday,times.day]);
    const start=iso(times.midnight_start),later=iso(times.midnight_later);
    const beforeMidnight=await send('midnight-before',1,{start,at:start,last:start,date:times.yesterday});
    assert.equal(beforeMidnight.count,1,JSON.stringify({beforeMidnight,start,later,times}));
    const midnight=await send('midnight-after',2,{start,at:later,last:later,date:times.day});assert.equal(midnight.count,3);
    const progress=(await db.query('select q.local_date::text as "day",p.progress from daily_quest_assignments q join quest_progress_vnext p on p.assignment_id=q.id where q.user_id=$1 and q.quest_id=\'interact_with_toy\' order by q.local_date',[A])).rows;
    assert.ok(progress.some(p=>p.day===times.day&&p.progress===1));assert.ok(progress.some(p=>p.day===times.yesterday&&p.progress===1));
    assert.equal((await send('wrong-day',1,{start,at:later,last:later,date:times.yesterday})).error,'invalid_request');

    // Blank toys cannot grant even an assigned task through legacy commands.
    await db.query('delete from room_photos where owner_id=$1',[A]);
    const legacy=(await db.query('select interact_burrow_toy_batch_v1($1,$1,$2,$3,$4,8,$5) r',[A,B,version,times.day,'legacy-empty'])).rows[0].r;
    assert.equal(legacy.skipped,'photo_required');
    await db.query("insert into room_photos values($1,$2,$2,$3,'doll','toy-a')",[PHOTO,A,B]);
    const legacySend=async key=>(await db.query('select interact_burrow_toy_batch_v1($1,$1,$2,$3,$4,8,$5) r',[A,B,version,times.day,key])).rows[0].r;
    assert.equal((await legacySend('legacy-photo')).count,8);assert.equal((await legacySend('legacy-photo')).applied,false);
    const oldVersion=version;
    await db.query('update burrow_pair_versions set version=$2 where user_id=$1',[A,KEY]);
    version=(await db.query('select burrow_pair_version_v1($1,$2) v',[A,B])).rows[0].v;
    assert.equal((await send('old-scope',1,{version:oldVersion})).error,'pair_changed');
    assert.equal((await send('new-scope',1)).count,1);
    assert.equal((await db.query("select (payload->>'count')::int n from moment_events where idempotency_key='legacy-daily'")).rows[0].n,123);
    await db.exec('delete from pairings');
    const soloPhoto='55555555-5555-4555-8555-555555555555';
    await db.query("insert into room_photos values($1,$2,$2,$2,'doll','toy-a')",[soloPhoto,A]);
    assert.equal((await send('solo',4,{partner:null,version:null,photo:soloPhoto})).count,4);
    assert.equal((await send('solo',4,{partner:null,version:null,photo:soloPhoto})).applied,false);
    // Reproduce the production failure: retained owner photo was uploaded in
    // Solo/a former relationship. New interaction has the CURRENT pair scope.
    await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
    await db.exec('delete from moment_events where toy_window_started_at is not null');
    await db.query('update room_photos set pair_low=owner_id,pair_high=owner_id where id=$1',[PHOTO]);
    assert.equal((await send('old-photo-before282',3)).skipped,'photo_required');
    const rowsBefore=(await db.query('select * from room_photos order by id')).rows;
    const migration=fs.readFileSync('supabase/migrations/20261027000282_received_touch_history_and_personal_photo_moments.sql','utf8');
    await db.exec(migration.slice(migration.indexOf('do $moments$'),migration.indexOf('end $moments$;')+'end $moments$;'.length));
    assert.deepEqual((await db.query('select * from room_photos order by id')).rows,rowsBefore);
    assert.equal((await send('old-photo-before282',3)).skipped,'photo_required','immutable old receipt is not rewritten');
    assert.equal((await send('retained-photo-new',3)).count,3);assert.equal((await send('retained-photo-new',3)).applied,false);
    assert.equal((await send('retained-photo-next',2,{at:plus(first,59*60000),last:plus(first,59*60000)})).count,5);
    assert.equal((await db.query('select count(*)::int n from moment_events where toy_window_started_at is not null')).rows[0].n,1);
    assert.equal((await send('retained-photo-new-hour',1,{start:plus(first,3600000),at:plus(first,3600000),last:plus(first,3600000)})).count,1);
    assert.equal((await send('retained-wrong-owner',8,{actor:B,partner:A})).skipped,'photo_required');
    assert.equal((await send('retained-wrong-toy',8,{toy:'other-toy'})).skipped,'photo_required');
    assert.equal((await send('retained-missing-photo',8,{photo:KEY+'-missing'})).skipped,'photo_required');
    assert.equal((await send('retained-stale-pair',8,{version:oldVersion})).error,'pair_changed');
    const legacyRetained=(await db.query('select interact_burrow_toy_batch_v1($1,$1,$2,$3,$4,2,$5) r',[A,B,version,times.day,'legacy-retained282'])).rows[0].r;
    assert.equal(legacyRetained.applied,true);assert.equal(legacyRetained.count,2);
    assert.equal((await db.query("select has_function_privilege('authenticated','record_burrow_toy_window_v1(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,date,integer,text,text)','execute') allowed")).rows[0].allowed,false);
  }catch(error){console.error({query:error.query,position:error.position,internalPosition:error.internalPosition,internalQuery:error.internalQuery,where:error.where});throw error;}finally{await db.close();}
});
