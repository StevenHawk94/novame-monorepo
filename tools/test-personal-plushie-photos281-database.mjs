// Real isolated PostgreSQL migration + authorization regression. No live API.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const migration=fs.readFileSync('supabase/migrations/20261027000281_personal_plushie_photo_visibility.sql','utf8');
let h,db,q,rpc,toy,photoId,frameId,beforePhoto,beforeUsage,protectedBefore,unchangedFunctionsBefore,unchangedFunctionsAfter,tableAclBefore,tableAclAfter;
const protectedRows=()=>q("select * from (select 'wallets' as tab,to_jsonb(t) as row from wallets t union all select 'inventory',to_jsonb(t) from user_inventory t union all select 'uploads',to_jsonb(t) from room_photo_uploads t) protected order by tab,row::text");
const photoList=async user=>{const snapshot=await rpc('burrow_bootstrap_v2',[user]);assert.equal(snapshot.error??null,null,String(snapshot.error));return snapshot.roomPhotos;};
before(async()=>{
 h=await personalRoomTestDb();({db,query:q,rpc}=h);await h.migrate();
 await q("insert into app_config(key,value) values('app_major_update_enabled','true') on conflict(key) do update set value='true'");
 await q('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 toy=h.release.products.find(p=>p.category==='couple_dolls'&&p.metadata.starter).id;
 const ticket=await rpc('prepare_personal_toy_photo_v1',[A,A,toy,B,randomUUID(),'a'.repeat(64)]);
 assert.ok(ticket.ticketId);const saved=await rpc('complete_personal_toy_photo_v1',[A,ticket.ticketId]);assert.ok(saved.photoId);photoId=saved.photoId;
 frameId=randomUUID();await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,private_path,updated_by) values($1,$2,$3,$2,'frame','qa/frame.jpg',$2)",[frameId,A,B]);
 beforePhoto=await q('select * from room_photos order by id');beforeUsage=await q('select * from room_photo_uploads order by id');protectedBefore=await protectedRows();
 const untouched=()=>q("select oid::text,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in ('read_room_photo_v1','burrow_bootstrap_v2') order by oid");
 const acl=()=>q("select oid::text,relacl::text,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') order by oid");
 unchangedFunctionsBefore=await untouched();tableAclBefore=await acl();
 await db.exec(migration);await db.exec(migration);
 unchangedFunctionsAfter=await untouched();tableAclAfter=await acl();
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('migration preserves exact photos, paths, upload accounting, inventory and wallets',async()=>{
 assert.deepEqual(await q('select * from room_photos order by id'),beforePhoto);
 assert.deepEqual(await q('select * from room_photo_uploads order by id'),beforeUsage);
 assert.deepEqual(await protectedRows(),protectedBefore);
 assert.deepEqual(unchangedFunctionsAfter,unchangedFunctionsBefore,'unrelated RPC bodies and grants unchanged');
 assert.deepEqual(tableAclAfter,tableAclBefore,'table grants and RLS unchanged');
});
test('unpair retains owner face metadata and read access without returning former partner photos',async()=>{
 await q('delete from pairings');
 assert.equal((await rpc('burrow_bootstrap_v2',[A])).error,'not_paired','existing API solo fallback remains in control');
 assert.ok((await rpc('read_room_photo_v1',[A,photoId])).path);
 assert.equal((await rpc('read_room_photo_v1',[B,photoId])).error,'not_found');
 assert.equal((await rpc('burrow_bootstrap_v2',[B])).error,'not_paired');
});
test('re-pair restores same owner photo/version to owner and current mutual partner; old partner is denied',async()=>{
 await q('delete from pairings');await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,C]);
 for(const user of [A,C]){
  const photo=(await photoList(user)).find(p=>p.id===photoId);assert.ok(photo);assert.equal(photo.ownerId,A);assert.equal(photo.toyId,toy);
  assert.ok((await rpc('read_room_photo_v1',[user,photoId])).path);
 }
 assert.equal((await rpc('read_room_photo_v1',[B,photoId])).error,'not_found');
 assert.equal((await rpc('burrow_bootstrap_v2',[B])).error,'not_paired');
 assert.deepEqual(await q('select * from room_photos order by id'),beforePhoto);
 assert.deepEqual(await q('select * from room_photo_uploads order by id'),beforeUsage);
});
test('one-way/stale pairing grants no access, null and unknown IDs cannot read',async()=>{
 await q('delete from pairings');await q('insert into pairings(user_id,partner_user_id) values($1,$2)',[B,A]);
 assert.equal((await rpc('read_room_photo_v1',[B,photoId])).error,'not_found');
 assert.equal((await rpc('read_room_photo_v1',[null,photoId])).error,'not_found');
 assert.equal((await rpc('read_room_photo_v1',[A,randomUUID()])).error,'not_found');
});
test('frame relationship rules are unchanged; current doll visibility does not expose old relationship frames',async()=>{
 assert.ok((await rpc('read_room_photo_v1',[B,frameId])).path);
 await q('delete from pairings');await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,C]);
 assert.equal((await rpc('read_room_photo_v1',[C,frameId])).error,'not_found');
 assert.equal((await photoList(C)).some(p=>p.id===frameId),false);
});
test('photo reads do not reset per-toy quota; another toy can still upload; RPCs stay service-only',async()=>{
 await q('delete from pairings');
 assert.equal((await rpc('prepare_personal_toy_photo_v1',[A,A,toy,null,randomUUID(),'b'.repeat(64)])).error,'daily_limit_reached');
 const other=h.release.products.find(p=>p.category==='couple_dolls'&&p.id!==toy&&p.status==='active');
 await q("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,other.id]);
 assert.ok((await rpc('prepare_personal_toy_photo_v1',[A,A,other.id,null,randomUUID(),'c'.repeat(64)])).ticketId);
 for(const name of ['read_room_photo_v1(uuid,uuid)','burrow_bootstrap_v2(uuid)']){
  const [priv]=await q("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') b,has_function_privilege('service_role',$1,'execute') s",['public.'+name]);
  assert.equal(priv.a,false);assert.equal(priv.b,false);assert.equal(priv.s,true);
 }
});
