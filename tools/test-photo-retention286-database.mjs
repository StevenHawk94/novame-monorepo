// Real isolated PostgreSQL/WASM migrations and transactions; no live accounts.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
const migration=sql('20261028000286_photo_replacement_retention');
let h,db,q,rpc,toy,other,oldId,latestId,oldPath,protectedBefore,functionsBefore,aclBefore,broadcastsBefore;
const untouchedFunctions=()=>q("select oid::text,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in('complete_toy_photo_v1','complete_personal_toy_photo_v1','burrow_photo_quota_v1','burrow_photo_usage_v1','collect_room_photo_garbage_v1') order by oid");
const acls=()=>q("select oid::text,relacl::text,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by oid");
async function protectedRows(){
 const tables=await q("select tablename from pg_tables where schemaname='public' and tablename not in('room_photos','room_photo_garbage','test_broadcasts') order by tablename");
 const rows={};for(const {tablename}of tables){const records=await q(`select * from "${tablename}" order by to_jsonb("${tablename}")::text`);rows[tablename]={count:records.length,sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex')};}return rows;
}
const path=owner=>`${owner}/${randomUUID()}.jpg`;
async function attachFrame(owner,age,{pair=null,current=true}={}){
 const p=path(owner),id=randomUUID(),partner=pair??owner;
 if(current)await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,private_path,updated_by) values($1,least($2::uuid,$3::uuid),greatest($2::uuid,$3::uuid),$2,'frame',$4,$2) on conflict(pair_low,pair_high,owner_id,kind,toy_id) do update set private_path=excluded.private_path,updated_at=clock_timestamp()",[id,owner,partner,p]);
 await q("insert into burrow_frame_photo_history(owner_id,private_path,created_at) values($1,$2,now()-$3::int*interval '1 day')",[owner,p,age]);return p;
}
async function upload({user=A,owner=A,item=toy,partner=B,key=randomUUID(),digest='a'.repeat(64)}={}){
 const t=await rpc('prepare_personal_toy_photo_v1',[user,owner,item,partner,key,digest]);
 assert.ok(t.ticketId,JSON.stringify(t));return {ticket:t,key,commit:()=>rpc('complete_personal_toy_photo_v1',[user,t.ticketId])};
}
before(async()=>{
 h=await personalRoomTestDb();({db,query:q}=h);rpc=(name,args=[])=>h.rpc(name,args);
 // Use the real pre-photo entitlement function in this small fixture. Store
 // receipt/economic-domain behavior is unchanged and covered by security tests.
 const permissions=sql('20261013000227_burrow_service_catalog_permissions');
 await db.exec(permissions.slice(permissions.indexOf('create function public.burrow_has_plus_v1'),permissions.indexOf('create function public.burrow_service_offer_v1')));
 await db.exec(sql('20261013000228_burrow_photo_entitlements_history'));
 await h.migrate();await db.exec(sql('20261027000281_personal_plushie_photo_visibility'));
 await q('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 const calendar=sql('20261024000272_fixed_economic_calendar');
 await db.exec(calendar.split('-- Replace only audited')[0]+'commit;');
 const targets=['burrow_photo_quota_v1','burrow_photo_usage_v1','prepare_toy_photo_v1','complete_toy_photo_v1','prepare_personal_toy_photo_v1','complete_personal_toy_photo_v1','solo_burrow_prepare_photo_v1','solo_burrow_complete_photo_v1','prepare_room_photo_before_expiry_v1','complete_room_photo_before_expiry_v1'];
 await db.exec(calendar.slice(calendar.indexOf('do $migration$')).replace(/for spec in select \* from \(values[\s\S]*?\) s\(name,actor\) loop/,
  'for spec in select * from (values '+targets.map(name=>`('${name}','${name==='burrow_photo_quota_v1'?'p_actor':name==='burrow_photo_usage_v1'?'p_user':'p_user_id'}')`).join(',')+') s(name,actor) loop'));
 toy=h.release.products.find(p=>p.category==='couple_dolls'&&p.metadata.starter).id;
 other=h.release.products.find(p=>p.category==='couple_dolls'&&!p.metadata.starter&&p.status==='active').id;
 await q("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,other]);
 oldId=randomUUID();latestId=randomUUID();oldPath=path(A);
 await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by,updated_at) values($1,$3,$4,$3,'doll',$5,$6,$3,now()-interval '2 minutes'),($2,$3,$3,$3,'doll',$5,$7,$3,now()-interval '1 minute')",[oldId,latestId,A,B,toy,oldPath,path(A)]);
 protectedBefore=await protectedRows();functionsBefore=await untouchedFunctions();aclBefore=await acls();broadcastsBefore=await q('select * from test_broadcasts');
 await db.exec(migration);await db.exec(migration);
});
after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('migration deduplicates by owner/toy, queues obsolete bytes for one hour and preserves all other rows/RLS/grants/functions',async()=>{
 assert.deepEqual((await q("select id from room_photos where owner_id=$1 and kind='doll'",[A])).map(p=>p.id),[latestId]);
 const [g]=await q("select extract(epoch from not_before-now())::int delay from room_photo_garbage where private_path=$1",[oldPath]);
 assert.ok(g.delay>3500&&g.delay<=3600);assert.deepEqual(await protectedRows(),protectedBefore);
 const broadcasts=await q('select * from test_broadcasts');assert.deepEqual(broadcasts.slice(0,broadcastsBefore.length),broadcastsBefore);
 assert.equal(broadcasts.length-broadcastsBefore.length,2,'the deleted paired photo emits one readiness signal to each of its two owners');
 for(const b of broadcasts.slice(broadcastsBefore.length)){assert.equal(b.event,'burrow_changed');assert.deepEqual(b.payload,{});assert.equal(b.private,true);assert.ok([`burrow:${A}`,`burrow:${B}`].includes(b.topic));}
 assert.deepEqual(await untouchedFunctions(),functionsBefore);assert.deepEqual(await acls(),aclBefore);
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'collect_room_photo_garbage_v1()','execute') ok",[role]))[0].ok,false);
});
test('Free and Plus have no daily Plushie cap, but each toy has exactly one current face and receipts remain immutable',async()=>{
 for(const tier of ['free','plus']){
  await q('update profiles set subscription_tier=$1 where id=$2',[tier,A]);
  const uploads=[];for(let n=0;n<4;n++){const u=await upload();assert.equal((await u.commit()).applied,true);uploads.push(u);}
  const current=await q("select * from room_photos where owner_id=$1 and kind='doll' and toy_id=$2",[A,toy]);
  assert.equal(current.length,1);assert.equal(current[0].id,latestId);assert.equal(current[0].private_path,uploads.at(-1).ticket.path);
  assert.equal((await uploads[0].commit()).applied,false);assert.equal((await q('select private_path from room_photos where id=$1',[latestId]))[0].private_path,current[0].private_path);
  for(const u of uploads.slice(0,-1))assert.ok((await q('select * from room_photo_garbage where private_path=$1',[u.ticket.path])).length);
  const usage=await rpc('burrow_photo_usage_v1',[A]);assert.equal(usage.doll.unlimited,true);assert.equal(usage.doll.limit,2147483647);
  assert.ok(usage.doll.targets.every(t=>t.used<usage.doll.limit),'legacy numeric comparisons cannot falsely block the new unlimited policy');
 }
 const second=await upload({item:other});await second.commit();assert.equal((await q("select count(*)::int n from room_photos where owner_id=$1 and kind='doll'",[A]))[0].n,2);
});
test('re-pair replacement updates the same face ID without retaining an old relationship copy or granting old-partner reads',async()=>{
 await q('delete from pairings');const solo=await upload({partner:null});await solo.commit();
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,C]);
 const next=await upload({partner:C});await next.commit();
 assert.equal((await q("select count(*)::int n from room_photos where owner_id=$1 and toy_id=$2",[A,toy]))[0].n,1);
 assert.equal((await rpc('read_room_photo_v1',[A,latestId])).path,next.ticket.path);
 assert.equal((await rpc('read_room_photo_v1',[C,latestId])).path,next.ticket.path);
 assert.equal((await rpc('read_room_photo_v1',[B,latestId])).error,'not_found');
});
test('removing quota does not remove target ownership, pairing, expiry, actor or immutable-intent guards',async()=>{
 const u=await upload();assert.equal((await rpc('complete_personal_toy_photo_v1',[C,u.ticket.ticketId])).error,'not_found');
 assert.equal((await rpc('prepare_personal_toy_photo_v1',[A,A,other,B,u.key,'a'.repeat(64)])).error,'idempotency_conflict');
 const v=await upload();await q("update room_photo_uploads set created_at=now()-interval '25 hours' where id=$1",[v.ticket.ticketId]);
 assert.equal((await v.commit()).error,'upload_expired');
 const notOwned=h.release.products.find(p=>p.category==='couple_dolls'&&!p.metadata.starter&&![toy,other].includes(p.id)).id;
 assert.equal((await rpc('prepare_personal_toy_photo_v1',[A,A,notOwned,B,randomUUID(),'b'.repeat(64)])).error,'item_not_owned');
 await q('delete from pairings');assert.equal((await u.commit()).error,'pair_changed');
});
test('Free frame cleanup retains only its current >30-day photo; 7-day history visibility and newer history remain unchanged',async()=>{
 const old=await attachFrame(A,45,{current:false}),recent=await attachFrame(A,12,{current:false}),current=await attachFrame(A,40,{pair:B});
 const due=await rpc('collect_room_photo_garbage_v1');assert.ok(due.includes(old));assert.ok(!due.includes(current));assert.ok(!due.includes(recent));
 assert.ok((await q('select * from room_photos where private_path=$1',[current])).length);
 assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,0,'the Free history remains 7 days');
 const replacement=await attachFrame(A,0,{pair:B});assert.ok((await rpc('collect_room_photo_garbage_v1')).includes(current),'once replaced the old >30-day photo is no longer exempt');
 assert.ok((await q('select * from room_photos where private_path=$1',[replacement])).length);
});
test('Plus keeps old history; downgrade immediately uses original photo ages, preserving current; upgrade never restores retired rows',async()=>{
 await q("update profiles set subscription_tier='plus' where id=$1",[A]);
 const old=await attachFrame(A,100,{current:false}),current=await attachFrame(A,80,{pair:B});
 assert.ok(!(await rpc('collect_room_photo_garbage_v1')).includes(old));assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,2);
 await q("update profiles set subscription_tier='free' where id=$1",[A]);
 const due=await rpc('collect_room_photo_garbage_v1');assert.ok(due.includes(old));assert.ok(!due.includes(current));
 await q("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.deepEqual((await rpc('read_burrow_frame_history_v1',[A])).items.map(p=>p.private_path),[current]);
});
test('frame daily Free 1 / Plus 2 quotas, actor economic day and committed retry accounting stay unchanged',async()=>{
 const f=await rpc('prepare_room_photo_v1',[A,A,'frame',randomUUID(),'b'.repeat(64)]);assert.ok(f.ticketId);
 assert.equal((await rpc('complete_room_photo_v1',[A,f.ticketId])).applied,true);
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).frame.remaining,0);
 assert.equal((await rpc('complete_room_photo_v1',[A,f.ticketId])).applied,false);
 await q("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).frame.remaining,1);
 await q("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[A]);
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).localDate,(await rpc('economic_calendar_v1',[A])).localDate);
});
test('current faces and valid unfinished uploads are never deleted; one-hour grace and one bounded batch remain enforced',async()=>{
 const a=await upload();await a.commit();const b=await upload();await b.commit();const pending=await upload();
 await q("insert into room_photo_garbage(private_path,not_before) values($1,now()-interval '1 second'),($2,now()-interval '1 second') on conflict do nothing",[b.ticket.path,pending.ticket.path]);
 assert.deepEqual(await rpc('collect_room_photo_garbage_v1'),[]);
 await q("update room_photo_garbage set not_before=now()-interval '1 second' where private_path=$1",[a.ticket.path]);
 assert.ok((await rpc('collect_room_photo_garbage_v1')).includes(a.ticket.path));
 assert.ok(!(await rpc('collect_room_photo_garbage_v1')).includes(b.ticket.path));
});
