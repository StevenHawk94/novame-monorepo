import {readFileSync} from 'node:fs';
export async function testRepairIsolation({db,query,rpc,check}){
  const a='00000000-0000-0000-0000-000000002331',b='00000000-0000-0000-0000-000000002332',c='00000000-0000-0000-0000-000000002333';
  await query('insert into profiles(id) values($1),($2),($3)',[a,b,c]);
  await query('insert into pairings(user_id,partner_user_id,created_at) values($1,$2,now()-interval \'1 day\'),($2,$1,now()-interval \'1 day\')',[a,b]);
  const active=await rpc('save_memory_room_entry_v1',[a,null,'💌 Active love note',null,'repair-active']);
  const activeEvent=(await query('select id from moment_events where reference_id=$1',[active.entryId]))[0].id;
  const archived=await rpc('save_memory_room_entry_v1',[a,null,'💌 Prior relationship',null,'repair-archived']);
  await query("update memory_room_entries set created_at=now()-interval '2 days' where id=$1",[archived.entryId]);
  await db.exec(readFileSync('supabase/migrations/20261014000233_burrow_repair_history_isolation.sql','utf8'));
  const current=await rpc('burrow_bootstrap_v1',[a]);
  check(current.memoryEntries.some(row=>row.id===active.entryId),'migration keeps active relationship notes');
  check(!current.memoryEntries.some(row=>row.id===archived.entryId),'migration does not adopt pre-relationship legacy notes');
  const initialVersion=await rpc('burrow_pair_version_v1',[a,b]);
  await rpc('set_room_sleep_v1',[b,true,'repair-old-sleep']);
  // now() is constant in this transaction: generation must distinguish epochs.
  await db.exec('begin');
  const old=await rpc('save_memory_room_entry_v1',[a,null,'💌 Old same-transaction note',null,'repair-tx-old']);
  const oldEvent=(await query('select id from moment_events where reference_id=$1',[old.entryId]))[0].id;
  const item=(await query("select stable_id from catalog_items where item_type='decor' and status='active' limit 1"))[0].stable_id;
  const gift=(await query('insert into gifts(sender_id,recipient_id,item_id,reason,reference_type,reference_id,idempotency_key) values($1,$2,$3,\'test\',\'test\',\'test\',\'repair-old\') returning id',[a,b,item]))[0].id;
  await query("insert into affection_events(sender_id,recipient_id,affection_type,idempotency_key,gesture_metrics,completed_at) values($1,$2,'hug','repair-old','{}',now())",[a,b]);
  await query('delete from pairings where user_id in($1,$2)',[a,b]);
  await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[a,b]);
  const nextVersion=await rpc('burrow_pair_version_v1',[a,b]);
  check(nextVersion!==initialVersion,'same-partner re-pair has a fresh generation');
  for(const viewer of [a,b]){
    const snapshot=await rpc('burrow_bootstrap_v1',[viewer]);
    check(snapshot.partner.id===(viewer===a?b:a),'both bootstraps restore the correct partner');
    check(snapshot.pairVersion===nextVersion,'both bootstraps expose the same new generation');
    check(!snapshot.memoryEntries.some(row=>[active.entryId,old.entryId,archived.entryId].includes(row.id)),'new relationship contains no former Love Notes');
    check(!snapshot.moments.some(row=>[activeEvent,oldEvent].includes(row.id)),'new relationship contains no former Moments');
    check(snapshot.gifts.length===0&&snapshot.affectionInbox.length===0,'old gifts and affection cannot resurrect');
    check(snapshot.unread.gifts===0&&snapshot.unread.affection===0,'old relationship cannot leave red-dot counts');
    check(!snapshot.sharedRoom.mySleeping&&!snapshot.sharedRoom.partnerSleeping,'old shared-room sleep state stays out of the new epoch');
    check((await rpc('burrow_history_v1',[viewer,viewer===a?b:a,'memories'])).rows.length===0,'pagination filters old epochs before limiting');
  }
  check((await rpc('burrow_moment_detail_v1',[a,oldEvent])).error==='not_found','old Moment deep link is denied');
  check((await rpc('save_memory_room_entry_v1',[a,old.entryId,'Resurrect old text',null,'repair-resurrect'])).error==='not_found','old memory cannot be edited into a new epoch');
  check((await rpc('claim_gift_v1',[b,gift])).error==='not_found','old gift UUID cannot be claimed after reconnecting');
  const fresh=await rpc('save_memory_room_entry_v1',[a,null,'💌 New relationship',null,'repair-fresh']);
  await rpc('set_room_sleep_v1',[a,true,'repair-new-sleep']);
  const sleeping=(await rpc('burrow_bootstrap_v1',[a])).sharedRoom;
  check(sleeping.mySleeping&&!sleeping.partnerSleeping,'first new-room sleep command cannot restore the former peer sleep state');
  check(fresh.applied===true,'paired functionality works after reconnecting');
  check((await rpc('burrow_history_v1',[b,a,'memories'])).rows.some(row=>row.id===fresh.entryId),'partner can read new relationship notes');
  await query('select set_config($1,$2,false)',['request.jwt.claim.sub',b]);await db.exec('set role authenticated');
  const visible=await query('select id from memory_room_entries');
  check(visible.some(row=>row.id===fresh.entryId)&&!visible.some(row=>row.id===old.entryId),'direct RLS reads obey the new generation');
  await db.exec('reset role');
  await query('delete from pairings where user_id in($1,$2)',[a,b]);
  await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[a,c]);
  const different=await rpc('burrow_bootstrap_v1',[a]);
  check(different.partner.id===c&&!different.memoryEntries.some(row=>row.id===fresh.entryId),'different partner cannot inherit former notes');
  check((await query('select id from memory_room_entries where id=$1',[old.entryId])).length===1,'historical rows are preserved, not deleted');
  await db.exec('commit');
}
