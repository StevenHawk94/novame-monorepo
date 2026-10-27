// Execute real photo migrations in isolated PostgreSQL/WASM; no production access.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const digest='a'.repeat(64),sql=name=>readFileSync(`supabase/migrations/${name}`,'utf8');
let db,legacyId;
const query=async(s,args=[]) => (await db.query(s,args)).rows;
const rpc=async(name,args=[]) => (await query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const prepare=(toy='toy-B',key=randomUUID(),owner=A,partner=null,user=A)=>rpc('prepare_toy_photo_v1',[user,owner,toy,partner,key,digest]);
const complete=(ticket,user=A)=>rpc('complete_toy_photo_v1',[user,ticket.ticketId]);
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key,timezone_name text default 'UTC');
    create table pairings(user_id uuid primary key,partner_user_id uuid);
    create table content_revisions(id text primary key,status text);
    create table catalog_items(stable_id text primary key,revision_id text,item_type text,category text,status text default 'active',metadata jsonb);
    create table user_inventory(owner_id uuid,item_id text);
    create table room_loadouts(room_type text,owner_id uuid,pair_low uuid,pair_high uuid,slot text,item_id text);
    create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,payload jsonb,idempotency_key text,created_at timestamptz default now());
    create function can_read_burrow_pair(uuid,uuid) returns boolean language sql as $$select false$$;
    create function burrow_bootstrap_v1(p_user uuid) returns jsonb language sql as $$select jsonb_build_object(
      'partner',jsonb_build_object('id',(select partner_user_id from pairings where user_id=p_user)),
      'localDate',current_date::text)$$;
    insert into profiles(id) values('${A}'),('${B}');
    insert into content_revisions values('live','published');
    insert into catalog_items(stable_id,revision_id,item_type,category,metadata) values
      ('toy-A','live','decor','couple_dolls','{"slot":"couple_doll","starter":true}'),
      ('toy-B','live','decor','couple_dolls','{"slot":"couple_doll"}'),
      ('toy-C','live','decor','couple_dolls','{"slot":"couple_doll"}'),
      ('toy-unowned','live','decor','couple_dolls','{"slot":"couple_doll"}'),
      ('lamp','live','decor','lamps','{"slot":"lamp"}');
    insert into user_inventory values('${A}','toy-B'),('${A}','toy-C'),('${B}','toy-B');
    insert into room_loadouts values('home','${A}',null,null,'couple_doll','toy-A');`);
  const foundation=sql('20260920000116_app_major_update_foundation.sql');
  await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),foundation.indexOf('create table public.burrow_command_receipts')));
  const photos=sql('20260920000125_burrow_personalization.sql');
  await db.exec(photos.slice(photos.indexOf('create table public.room_photos'),photos.indexOf('create function public.select_room_music_v1')));
  await db.exec(sql('20260920000130_burrow_room_photo_cleanup.sql'));
  await db.exec(sql('20260920000149_burrow_solo_photos.sql'));
  const ticket=await rpc('solo_burrow_prepare_photo_v1',[A,A,'doll',randomUUID(),digest]);
  legacyId=(await rpc('solo_burrow_complete_photo_v1',[A,ticket.ticketId])).photoId;
  await query("update room_photo_uploads set committed_date=current_date-1 where actor_id=$1",[A]);
  const migration=sql('20261008000205_burrow_per_toy_photos.sql');
  await db.exec(migration);await db.exec(migration);
  const partnerRoom=sql('20261009000212_burrow_partner_room_care.sql');
  await db.exec(partnerRoom);await db.exec(partnerRoom);
});
beforeEach(async()=>db.exec('begin'));
afterEach(async()=>db.exec('rollback'));
after(async()=>db?.close());

test('migration binds legacy face to equipped toy only, retaining photo ID, path and version',async()=>{
  const rows=await query('select * from room_photos where owner_id=$1',[A]);
  assert.equal(rows.length,1);assert.equal(rows[0].id,legacyId);assert.equal(rows[0].toy_id,'toy-A');
  assert.equal((await query('select * from room_photos where toy_id=$1',['toy-B'])).length,0);
  const snapshot=await rpc('burrow_bootstrap_v1',[A]);
  assert.equal(snapshot.roomPhotos[0].toyId,'toy-A');assert.deepEqual(snapshot.dollPhotoChangesUsed,[]);
});
test('partner can replace only the equipped toy; both rooms retain independent photos and daily quotas',async()=>{
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  await query("insert into room_loadouts values('our',$1,$1,$2,'couple_doll','toy-B')",[A,B]);
  const mine=await prepare('toy-B',randomUUID(),A,B,A);
  const theirs=await prepare('toy-B',randomUUID(),B,B,A);
  assert.equal((await complete(mine)).applied,true);
  assert.equal((await complete(theirs)).applied,true);
  const rows=await query("select * from room_photos where toy_id='toy-B' order by owner_id");
  assert.equal(rows.length,2);assert.notEqual(rows[0].private_path,rows[1].private_path);
  assert.equal(rows[1].updated_by,A);
  assert.equal((await prepare('toy-B',randomUUID(),B,B,A)).error,'daily_limit_reached');
  assert.equal((await prepare('toy-C',randomUUID(),B,B,A)).error,'item_not_owned');
  assert.equal((await prepare('lamp',randomUUID(),B,B,A)).error,'item_not_owned');
  const snapshot=await rpc('burrow_bootstrap_v1',[A]);
  assert.deepEqual(snapshot.dollPhotoChangesUsed,['toy-B']);
  assert.equal(snapshot.dollPhotoChangeTargetsUsed.filter(row=>row.toyId==='toy-B').length,2);
  const event=(await query("select * from moment_events where reference_id=$1",[(await complete(theirs)).photoId||rows[1].id]))[0];
  assert.equal(event.actor_id,A);assert.equal(event.target_id,B);
});
test('partner upload is revoked on unpair, a changed equipped toy, or stolen ticket ownership',async()=>{
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  await query("insert into room_loadouts values('our',$1,$1,$2,'couple_doll','toy-B')",[A,B]);
  const ticket=await prepare('toy-B',randomUUID(),B,B,A);
  assert.equal((await complete(ticket,B)).error,'not_found');
  await query("update room_loadouts set item_id='toy-A' where room_type='our'");
  assert.equal((await complete(ticket)).error,'item_not_owned');
  await query('delete from pairings');
  assert.equal((await complete(ticket)).error,'pair_changed');
  assert.equal((await prepare('toy-A',randomUUID(),B,B,A)).error,'pair_changed');
  assert.equal((await query("select * from room_photos where owner_id=$1",[B])).length,0);
});
test('partner cooldown metadata survives a bounded feed and exposes no unrelated room',async()=>{
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  await query("insert into moment_events(actor_id,target_id,event_type,payload) values($1,$2,'room_need_refilled','{\"need\":\"food\"}')",[A,B]);
  assert.ok((await rpc('burrow_bootstrap_v1',[A])).partnerLastCareAt.food);
  await query('delete from pairings');
  assert.equal((await rpc('burrow_bootstrap_v1',[A])).partnerLastCareAt.food,null);
  const privilege=(await query("select has_function_privilege('authenticated','public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text)','execute') can_prepare,has_function_privilege('authenticated','public.complete_toy_photo_v1(uuid,uuid)','execute') can_complete"))[0];
  assert.equal(privilege.can_prepare,false);assert.equal(privilege.can_complete,false);
});
test('A and B keep separate faces; new B and C can each upload on the same day; replay never duplicates',async()=>{
  const before=(await query('select * from room_photos where id=$1',[legacyId]))[0];
  const b=await prepare(),c=await prepare('toy-C');
  assert.equal((await complete(b)).applied,true);assert.equal((await complete(c)).applied,true);
  assert.equal((await complete(b)).applied,false);
  const after=(await query('select * from room_photos where id=$1',[legacyId]))[0];
  assert.equal(after.private_path,before.private_path);assert.equal(after.updated_at.getTime(),before.updated_at.getTime());
  assert.equal((await query('select * from room_photos where owner_id=$1',[A])).length,3);
  assert.equal((await prepare()).error,'daily_limit_reached');
  assert.equal((await query('select * from moment_events')).length,3); // legacy A + B + C
  const snapshot=await rpc('burrow_bootstrap_v1',[A]);
  assert.deepEqual(snapshot.dollPhotoChangesUsed.sort(),['toy-B','toy-C']);
});
test('ownership, target, pairing and immutable retry checks prevent a crop being retargeted',async()=>{
  for(const toy of ['toy-unowned','lamp','missing'])assert.equal((await prepare(toy)).error,'item_not_owned');
  assert.equal((await prepare('toy-B',randomUUID(),B)).error,'invalid_request');
  assert.equal((await prepare('toy-B',randomUUID(),A,B)).error,'pair_changed');
  const key=randomUUID(),first=await prepare('toy-B',key);
  assert.equal((await prepare('toy-C',key)).error,'idempotency_conflict');
  assert.equal((await prepare('toy-B',key)).ticketId,first.ticketId);
  assert.equal((await rpc('prepare_toy_photo_v1',[A,A,'toy-B',null,key,'b'.repeat(64)])).error,'idempotency_conflict');
  assert.equal((await complete(first,B)).error,'not_found');
  await query('delete from user_inventory where owner_id=$1 and item_id=$2',[A,'toy-B']);
  assert.equal((await complete(first)).error,'item_not_owned');
});
test('concurrent prepared tickets cannot bypass one change per toy/day, and expired uploads cannot attach',async()=>{
  const one=await prepare(),two=await prepare();
  assert.equal((await complete(one)).applied,true);assert.equal((await complete(two)).error,'daily_limit_reached');
  const c=await prepare('toy-C');
  await query("update room_photo_uploads set created_at=now()-interval '25 hours' where id=$1",[c.ticketId]);
  assert.equal((await complete(c)).error,'upload_expired');
  await rpc('collect_room_photo_garbage_v1');
  assert.ok((await query('select expired_at from room_photo_uploads where id=$1',[c.ticketId]))[0].expired_at);
});
test('paired users retain independent faces, and unpairing cancels an unfinished upload',async()=>{
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  const mine=await prepare('toy-B',randomUUID(),A,B,A),theirs=await prepare('toy-B',randomUUID(),B,A,B);
  await complete(mine);await complete(theirs,B);
  const rows=await query("select * from room_photos where toy_id='toy-B'");
  assert.equal(rows.length,2);assert.notEqual(rows[0].private_path,rows[1].private_path);
  const snapshot=await rpc('burrow_bootstrap_v1',[A]);
  assert.equal(snapshot.roomPhotos.filter(p=>p.toyId==='toy-B').length,2);
  const pending=await prepare('toy-C',randomUUID(),A,B,A);
  await db.exec('delete from pairings');
  assert.equal((await complete(pending)).error,'pair_changed');
  assert.equal((await rpc('read_room_photo_v1',[B,rows.find(r=>r.owner_id===A).id])).error,'not_paired');
});
test('replacement retires only that toy’s old bytes; legacy frame writes and cleanup still work',async()=>{
  const b=await prepare();await complete(b);
  await query("update room_photo_uploads set committed_date=current_date-1 where actor_id=$1 and toy_id='toy-B'",[A]);
  const replacement=await prepare();await complete(replacement);
  assert.equal((await query('select * from room_photo_garbage where private_path=$1',[b.path])).length,1);
  const a=(await query('select * from room_photos where id=$1',[legacyId]))[0];
  assert.equal((await query('select * from room_photo_garbage where private_path=$1',[a.private_path])).length,0);
  for(let n=0;n<2;n++){
    const frame=await rpc('solo_burrow_prepare_photo_v1',[A,A,'frame',randomUUID(),digest]);
    assert.equal((await rpc('solo_burrow_complete_photo_v1',[A,frame.ticketId])).applied,true);
  }
  assert.equal((await query("select * from room_photos where kind='frame'")).length,1);
  await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
  for(let n=0;n<2;n++){
    const frame=await rpc('prepare_room_photo_v1',[A,A,'frame',randomUUID(),digest]);
    assert.equal((await rpc('complete_room_photo_v1',[A,frame.ticketId])).applied,true);
  }
  for(const signature of ['prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text)','complete_toy_photo_v1(uuid,uuid)']){
    assert.equal((await query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature]))[0].allowed,false);
    assert.equal((await query("select has_function_privilege('service_role',$1,'execute') allowed",[signature]))[0].allowed,true);
  }
  assert.equal((await query("select has_column_privilege('authenticated','room_photos','private_path','select') allowed"))[0].allowed,false);
});
