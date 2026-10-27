const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const KEY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',VERSION='a'.repeat(32);let db;
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const rpc=async(name,args=[]) => (await query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const prepare=(patch={})=>{const p={user:A,partner:B,version:VERSION,key:KEY,frame:'santa',duration:12000,digest:'b'.repeat(64),...patch};return rpc('prepare_burrow_surprise_v1',Object.values(p));};
const complete=id=>rpc('complete_burrow_surprise_v1',[A,id]);
const list=(user=A,id=null,open=false)=>rpc('read_burrow_surprises_v1',[user,id,open]);
const balance=async()=>(await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance;
async function upload(item,both=true){await query(`insert into storage.objects(bucket_id,name) values('burrow-surprises',$1)`,[item.photoPath]);if(both)await query(`insert into storage.objects(bucket_id,name) values('burrow-surprises',$1)`,[item.audioPath]);}
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,created_at timestamptz default now(),unique(bucket_id,name));
    create table profiles(id uuid primary key);insert into profiles values('${A}'),('${B}'),('${C}');
    create table pairings(user_id uuid primary key,partner_user_id uuid);insert into pairings values('${A}','${B}'),('${B}','${A}');
    create table versions(version text);insert into versions values('${VERSION}');
    create function lock_burrow_pair(uuid) returns uuid language sql as $$select p.partner_user_id from pairings p join pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id where p.user_id=$1$$;
    create function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select version from versions$$;
    create table wallets(user_id uuid primary key,carrot_balance integer,version integer default 0,updated_at timestamptz default now());
    insert into wallets(user_id,carrot_balance) values('${A}',1000),('${B}',1000);
    create table currency_ledger(user_id uuid,requested_delta integer,delta integer,balance_after integer,reason text,reference_type text,reference_id text,idempotency_key text,unique(user_id,idempotency_key));`);
  const wallet=readFileSync('supabase/migrations/20260920000139_burrow_coin_purchases.sql','utf8');
  const fn=wallet.slice(wallet.indexOf('create or replace function public.change_carrot_balance_v1'));
  await db.exec(fn.slice(0,fn.indexOf('end;\n$$;')+9));
  await db.exec(readFileSync('supabase/migrations/20261008000204_burrow_surprise_room.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009000206_burrow_surprise_frames_history.sql','utf8'));
  await db.exec(`create schema realtime;create table realtime.notifications(payload jsonb,event text,topic text,private boolean);
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$insert into realtime.notifications values($1,$2,$3,$4)$$;`);
  await db.exec(readFileSync('supabase/migrations/20261017000243_surprise_delivery_recovery.sql','utf8'));
  await db.exec(`create table catalog_items(stable_id text primary key,title text,category text);
    create table moment_events(id uuid primary key default gen_random_uuid(),pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,pair_version text,
      event_type text,reference_type text,reference_id text,payload jsonb not null default '{}',idempotency_key text,created_at timestamptz default now(),unique(actor_id,idempotency_key));`);
  const moments=readFileSync('supabase/migrations/20261020000251_moments_gifts_and_surprises.sql','utf8');
  await db.exec(moments);await db.exec(moments);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('prepare never charges; incomplete media never charges',async()=>{const item=await prepare();assert.equal(await balance(),1000);await upload(item,false);assert.equal((await complete(item.id)).error,'media_incomplete');assert.equal(await balance(),1000);});
test('Surprise moment commits with the first successful send; uploads, opens and receipt retries cannot duplicate it',async()=>{
 const item=await prepare();assert.equal((await query('select * from moment_events')).length,0);
 await upload(item,false);assert.equal((await complete(item.id)).error,'media_incomplete');
 assert.equal((await query('select * from moment_events')).length,0);
 await query("insert into storage.objects(bucket_id,name) values('burrow-surprises',$1)",[item.audioPath]);
 await complete(item.id);await complete(item.id);await list(B,item.id,true);await complete(item.id);
 const rows=await query('select * from moment_events');assert.equal(rows.length,1);
 assert.equal(rows[0].event_type,'surprise_sent');assert.equal(rows[0].actor_id,A);assert.equal(rows[0].target_id,B);
 assert.equal(rows[0].reference_id,item.id);assert.equal(rows[0].pair_version,VERSION);assert.deepEqual(rows[0].payload,{});
 assert.equal(await balance(),700);
});
test('a failed Moment insert rolls back Surprise completion and spending together',async()=>{
 const item=await prepare();await upload(item);
 await db.exec(`create function reject_moment() returns trigger language plpgsql as $$begin raise exception 'test moment failure';end$$;
   create trigger reject_moment before insert on moment_events for each row execute function reject_moment();savepoint failing_moment;`);
 await assert.rejects(complete(item.id),/test moment failure/);await db.exec('rollback to savepoint failing_moment');
 assert.equal(await balance(),1000);assert.equal((await query('select sent_at from burrow_surprises where id=$1',[item.id]))[0].sent_at,null);
});
test('gift moments snapshot product labels and retain their original identity across retries and catalogue changes',async()=>{
 await db.exec("insert into catalog_items values('wallpaper','Green Sage','wallpapers')");
 const insert=()=>query(`insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,payload,idempotency_key)
  values($1,$2,$1,$2,'gift_sent','{"itemId":"wallpaper"}','gift-one') on conflict(actor_id,idempotency_key) do nothing`,[A,B]);
 await insert();await db.exec("update catalog_items set title='Renamed'");await insert();
 const rows=await query('select * from moment_events');assert.equal(rows.length,1);
 assert.equal(rows[0].payload.productName,'Green Sage');assert.equal(rows[0].payload.productCategory,'wallpapers');
 for(const name of ['burrow_gift_moment_labels_v1()','burrow_surprise_sent_moment_v1()'])for(const role of ['anon','authenticated'])
  assert.equal((await query('select has_function_privilege($1,$2,\'execute\') allowed',[role,name]))[0].allowed,false);
});
test('receipt recovery is scoped, private, side-effect-free and cannot repeat spending',async()=>{
 const args=[A,KEY,B,VERSION];assert.equal((await rpc('burrow_surprise_send_status_v1',args)).committed,false);
 const item=await prepare();assert.equal((await rpc('burrow_surprise_send_status_v1',args)).committed,false);
 await upload(item);await complete(item.id);
 for(let i=0;i<3;i++){const status=await rpc('burrow_surprise_send_status_v1',args);assert.equal(status.id,item.id);assert.equal(status.committed,true);for(const key of ['photoPath','audioPath','digest'])assert.equal(status[key],undefined);}
 assert.equal(await balance(),700);assert.equal((await query('select * from currency_ledger')).length,1);
 assert.equal((await rpc('burrow_surprise_send_status_v1',[C,KEY,A,VERSION])).error,'not_paired');
 await db.exec(`update versions set version=repeat('c',32)`);assert.equal((await rpc('burrow_surprise_send_status_v1',args)).error,'pair_changed');
 for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'burrow_surprise_send_status_v1(uuid,uuid,uuid,text)','execute') allowed",[role]))[0].allowed,false);
});
test('only committed delivery and first open notify BOTH users, with empty private payloads',async()=>{
 const item=await prepare();assert.equal((await query('select * from realtime.notifications')).length,0);
 await upload(item);await complete(item.id);let events=await query('select * from realtime.notifications');assert.equal(events.length,2);
 assert.deepEqual(events.map(x=>x.topic).sort(),[`burrow:${A}`,`burrow:${B}`]);assert.ok(events.every(x=>x.private&&x.event==='surprise_changed'&&Object.keys(x.payload).length===0));
 await complete(item.id);assert.equal((await query('select * from realtime.notifications')).length,2);
 await list(B,item.id,true);await list(B,item.id,true);assert.equal((await query('select * from realtime.notifications')).length,4);
});
test('two consecutive messages use independent keys; retries charge only their original message',async()=>{
 const one=await prepare();await upload(one);await complete(one.id);
 const two=await prepare({key:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});await upload(two);await complete(two.id);await complete(two.id);await complete(one.id);
 assert.notEqual(one.id,two.id);assert.equal(await balance(),400);assert.equal((await query('select * from currency_ledger')).length,2);
});
test('notification transport failure never rolls back a valid atomic paid send',async()=>{
 await db.exec("create or replace function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $$begin raise exception 'transport unavailable';end$$;");
 const item=await prepare();await upload(item);assert.equal((await complete(item.id)).applied,true);assert.equal(await balance(),700);
 assert.equal((await rpc('burrow_surprise_send_status_v1',[A,KEY,B,VERSION])).committed,true);
});
test('send charges exactly 300 once, with immutable idempotent receipt',async()=>{const item=await prepare();await upload(item);assert.equal((await complete(item.id)).spent,300);assert.equal(await balance(),700);assert.equal((await complete(item.id)).applied,false);assert.equal((await prepare()).committed,true);assert.equal(await balance(),700);assert.equal((await query('select * from currency_ledger')).length,1);});
test('retries may not swap a photo digest, frame, duration or recipient',async()=>{await prepare();for(const patch of [{digest:'c'.repeat(64)},{frame:'star'},{duration:15000}])assert.equal((await prepare(patch)).error,'idempotency_conflict');assert.equal((await prepare({partner:C})).error,'pair_changed');assert.equal(await balance(),1000);});
test('balance rechecked at commit; no send if other spending consumed carrots',async()=>{const item=await prepare();await upload(item);await query('update wallets set carrot_balance=100 where user_id=$1',[A]);assert.equal((await complete(item.id)).error,'insufficient_balance');assert.equal((await list(B)).items.length,0);assert.equal(await balance(),100);});
test('old pairing generation cannot send or read even if same people reconnect',async()=>{const item=await prepare();await upload(item);await complete(item.id);await db.exec(`update versions set version='${'c'.repeat(32)}'`);assert.equal((await list(B)).items.length,0);assert.equal((await list(B,item.id)).error,'not_found');assert.equal((await complete(item.id)).error,'pair_changed');assert.equal((await prepare()).error,'pair_changed');});
test('unpairing hides both inbox and replay, strangers get no media',async()=>{const item=await prepare();await upload(item);await complete(item.id);assert.equal((await list(C,item.id)).photoPath,undefined);await db.exec('delete from pairings');assert.equal((await list(B)).items.length,0);assert.equal((await list(B,item.id)).photoPath,undefined);});
test('only recipient can mark read; listing contains no storage paths or digests',async()=>{const item=await prepare();await upload(item);await complete(item.id);const first=(await list(B)).items[0];for(const key of ['photo_path','audio_path','digest','idempotency_key','pair_version'])assert.equal(first[key],undefined);await list(A,item.id,true);assert.equal((await list(B)).items[0].opened_at,null);await list(B,item.id,true);assert.ok((await list(B)).items[0].opened_at);assert.equal(await balance(),700);});
test('invalid frames and duration are rejected; authenticated cannot call mutation RPC',async()=>{for(const patch of [{frame:'custom'},{duration:999},{duration:60001}])assert.equal((await prepare(patch)).error,'invalid_request');const privileges=await query(`select has_function_privilege('authenticated','prepare_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text)','execute') allowed`);assert.equal(privileges[0].allowed,false);});
test('garbage collection retires only abandoned uploads, never paid messages',async()=>{const item=await prepare();await upload(item);await db.exec(`update burrow_surprises set created_at=now()-interval '8 days';update storage.objects set created_at=now()-interval '8 days'`);const paths=await rpc('collect_surprise_garbage_v1');assert.equal(paths.length,2);assert.equal((await complete(item.id)).error,'draft_expired');assert.equal((await prepare()).error,'draft_expired');assert.equal(await balance(),1000);});
test('paid media is retained for replay even after a long time',async()=>{const item=await prepare();await upload(item);await complete(item.id);await db.exec(`update burrow_surprises set created_at=now()-interval '90 days';update storage.objects set created_at=now()-interval '90 days'`);assert.equal((await rpc('collect_surprise_garbage_v1')).length,0);assert.ok((await list(B,item.id)).audioPath);});

test('historical migration 206 retains its original 20 frames plus older identifiers',async()=>{
 // Historical migrations are immutable, independently of today's app assets.
 const migration=readFileSync('supabase/migrations/20261009000206_burrow_surprise_frames_history.sql','utf8');
 const frames=[...migration.match(/check\(frame in\(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 assert.equal(frames.length,23);
 for(const [index,frame] of frames.entries()){
  const key=`${String(index).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const item=await prepare({key,frame});assert.ok(item.id,`${frame}: ${JSON.stringify(item)}`);
 }
});
test('future current-only generation accepts all new frames without invalidating stored historical media',async()=>{
 const item=await prepare({frame:'halloween'});await upload(item);await complete(item.id);
 const {frameStorageConstraintSql}=require('./build-surprise-frames.cjs');
 const current=Object.keys(require('../apps/mobile/src/lib/surprise-frame-geometry.json'));
 await db.exec(frameStorageConstraintSql(current));
 for(const frame of current)await query(`insert into burrow_surprises(sender_id,recipient_id,pair_version,frame,duration_ms,digest,idempotency_key,photo_path,audio_path)
 values($1,$2,$3,$4,12000,repeat('b',64),gen_random_uuid(),'test-face','test-voice')`,[A,B,VERSION,frame]);
 assert.ok((await list(B,item.id,true)).audioPath);assert.ok((await list(B)).items[0].opened_at);
 assert.equal(await balance(),700,'schema refresh must not spend coins or erase receipts');
});
test('received/sent history keyset pagination handles timestamp ties with no duplicates or leaked paths',async()=>{
 await query(`insert into burrow_surprises(sender_id,recipient_id,pair_version,frame,duration_ms,digest,idempotency_key,photo_path,audio_path,sent_at)
  select $1,$2,$3,'santa',12000,repeat('b',64),gen_random_uuid(),'face-'||n,'voice-'||n,'2026-10-08T12:00:00Z' from generate_series(1,45) n`,[A,B,VERSION]);
 const first=await rpc('burrow_surprise_history_v1',[B,'received']);assert.equal(first.items.length,20);assert.ok(first.nextCursor);
 const second=await rpc('burrow_surprise_history_v1',[B,'received',first.nextCursor.sentAt,first.nextCursor.id]);assert.equal(second.items.length,20);
 const third=await rpc('burrow_surprise_history_v1',[B,'received',second.nextCursor.sentAt,second.nextCursor.id]);assert.equal(third.items.length,5);assert.equal(third.nextCursor,null);
 const all=[...first.items,...second.items,...third.items];assert.equal(new Set(all.map(item=>item.id)).size,45);
 for(const item of all)for(const field of ['photo_path','audio_path','pair_version','digest','idempotency_key'])assert.equal(item[field],undefined);
 assert.equal((await rpc('burrow_surprise_history_v1',[A,'received'])).items.length,0);
 assert.equal((await rpc('burrow_surprise_history_v1',[A,'sent'])).items.length,20);
 assert.equal((await rpc('burrow_surprise_history_v1',[C,'received'])).items.length,0);
 await db.exec(`update versions set version='${'c'.repeat(32)}'`);assert.equal((await rpc('burrow_surprise_history_v1',[B,'received'])).items.length,0);
});
test('history validates direction and cursor, and is inaccessible to anonymous/authenticated RPC callers',async()=>{
 assert.equal((await rpc('burrow_surprise_history_v1',[A,'all'])).error,'invalid_request');
 assert.equal((await rpc('burrow_surprise_history_v1',[A,'sent','2026-10-08T12:00:00Z',null])).error,'invalid_request');
 for(const role of ['anon','authenticated'])assert.equal((await query(`select has_function_privilege($1,'burrow_surprise_history_v1(uuid,text,timestamptz,uuid)','execute') allowed`,[role]))[0].allowed,false);
});
