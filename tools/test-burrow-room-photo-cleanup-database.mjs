const a='00000000-0000-0000-0000-000000000091',b='00000000-0000-0000-0000-000000000092';
const key=n=>`81000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const digest='a'.repeat(64);
export async function seedLegacyRoomPhotos({db,rpc}) {
  await db.query('insert into profiles(id) values($1),($2)',[a,b]);
  await db.query('insert into pairings values($1,$2),($2,$1)',[a,b]);
  for(const n of [1,2]) {
    const ticket=await rpc('prepare_room_photo_v1',[a,a,'frame',key(n),digest]);
    await rpc('complete_room_photo_v1',[a,ticket.ticketId]);
  }
}
export async function testRoomPhotoCleanup({db,query,rpc,check}) {
  await db.exec('begin');
  const tickets=await query('select * from room_photo_uploads where actor_id=$1 order by command_key',[a]);
  const [old,current]=tickets;
  const queued=await query('select * from room_photo_garbage where private_path=$1',[old.private_path]);
  check(queued.length===1,'migration backfills superseded committed room photo');
  check((await query('select * from room_photo_garbage where private_path=$1',[current.private_path])).length===0,'migration does not retire current frame');
  const prepare=n=>rpc('prepare_room_photo_v1',[a,a,'frame',key(n),digest]);
  const pending=await prepare(3);
  await db.query("update room_photo_uploads set created_at=now()-interval '25 hours' where id=$1",[pending.ticketId]);
  check((await prepare(3)).error==='upload_expired','stale ticket cannot be reused for upload');
  check((await rpc('complete_room_photo_v1',[a,pending.ticketId])).error==='upload_expired','stale ticket cannot attach before sweep');
  await rpc('collect_room_photo_garbage_v1',[]);
  check((await query('select expired_at from room_photo_uploads where id=$1',[pending.ticketId]))[0].expired_at!=null,'sweep permanently expires ticket');
  check(!(await rpc('collect_room_photo_garbage_v1',[])).includes(pending.path),'grace period protects uploads in flight');
  await db.query("update room_photo_garbage set not_before=now()-interval '1 second' where private_path in($1,$2)",[pending.path,old.private_path]);
  let due=await rpc('collect_room_photo_garbage_v1',[]);
  check(due.includes(old.private_path)&&due.includes(pending.path),'due obsolete and failed objects are selected');
  check(!due.includes(current.private_path),'current frame never selected');
  check((await rpc('complete_room_photo_v1',[a,old.id])).applied===false,'old committed receipt cannot restore retired bytes');
  check((await rpc('prepare_room_photo_v1',[a,a,'frame',key(1),digest])).committed===true,'old committed retry avoids uploading deleted object');
  await db.query('delete from room_photo_garbage where private_path=$1',[pending.path]);
  check((await prepare(3)).error==='upload_expired','acknowledged cleanup does not revive expired ticket');
  const fresh=await prepare(4);
  check((await rpc('complete_room_photo_v1',[a,fresh.ticketId])).applied===true,'new key permits fresh upload after expiry');
  check((await query('select * from room_photo_garbage where private_path=$1',[current.private_path])).length===1,'replacement queues previous current path');
  check((await query('select private_path from room_photos where owner_id=$1',[a]))[0].private_path===fresh.path,'replacement stays current');
  const doll=await rpc('prepare_room_photo_v1',[a,b,'doll',key(5),digest]);
  await rpc('complete_room_photo_v1',[a,doll.ticketId]);
  await db.query('delete from room_photos where owner_id=$1 and kind=$2',[b,'doll']);
  check((await query('select * from room_photo_garbage where private_path=$1',[doll.path])).length===1,'deleted doll path is queued');
  check((await rpc('prepare_room_photo_v1',[a,a,'doll',key(6),digest])).error==='daily_limit_reached','cleanup does not erase daily doll accounting');
  const inFlight=await prepare(7);
  await db.query("insert into room_photo_garbage(private_path,not_before) values($1,now()-interval '1 second'),($2,now()-interval '1 second') on conflict do nothing",[fresh.path,inFlight.path]);
  due=await rpc('collect_room_photo_garbage_v1',[]);
  check(!due.includes(fresh.path)&&!due.includes(inFlight.path),'defensive sweep excludes referenced and valid pending paths');
  check((await query("select has_table_privilege('authenticated','room_photo_garbage','select') allowed"))[0].allowed===false,'private cleanup paths inaccessible to clients');
  check((await query("select has_function_privilege('authenticated','collect_room_photo_garbage_v1()','execute') allowed"))[0].allowed===false,'collector service only');
  check((await query("select has_function_privilege('service_role','complete_room_photo_before_expiry_v1(uuid,uuid)','execute') allowed"))[0].allowed===false,'legacy helper cannot bypass expiry through service RPC');
  await db.query('delete from pairings where user_id in($1,$2)',[a,b]);
  await db.query('delete from profiles where id=$1',[a]);
  check((await query('select * from room_photo_garbage where private_path=$1',[inFlight.path])).length===1,'account cascade retains unfinished upload cleanup');
  check((await query('select * from room_photo_garbage where private_path=$1',[fresh.path])).length===1,'account cascade retains current photo cleanup');
  await db.exec("update room_photo_garbage set not_before=now()-interval '1 second'");
  due=await rpc('collect_room_photo_garbage_v1',[]);
  check(due.includes(inFlight.path)&&due.includes(fresh.path),'deleted-account paths become eligible independently of profile');
  check(due.length<=100,'collector bounds storage operations');
  await db.query(`insert into room_photo_garbage(private_path,not_before)
    select $1||'/91000000-0000-0000-0000-'||lpad(n::text,12,'0')||'.jpg',now()-interval '2 hours'
    from generate_series(1,150) n on conflict do nothing`,[a]);
  check((await rpc('collect_room_photo_garbage_v1',[])).length===100,'large garbage queue returns exactly one bounded batch');
  await db.exec('rollback');
}
