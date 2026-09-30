/** Verify personal Burrow mutations without creating a fake pairing. */
export async function testSoloBurrow({db,query,rpc,check}) {
  const me='00000000-0000-0000-0000-000000000e01';
  const record='00000000-0000-0000-0000-000000000e02';
  await db.exec('begin');
  try {
    await db.query('insert into profiles(id,timezone_name) values($1,$2)',[me,'UTC']);
    await db.query("update app_config set value='true' where key='app_major_update_enabled'");
    check((await rpc('solo_burrow_initialize_v1',[me])).initialized===true,'solo account initializes');
    check((await rpc('burrow_record_policy_v1',[me])).canRecord===true,
      'unpaired user can begin an adventure log');
    check((await query('select count(*)::int n from user_inventory where owner_id=$1',[me]))[0].n>0,'solo user receives starter decor');
    check((await rpc('solo_burrow_initialize_v1',[me])).initialized===true,'initialization is repeatable');
    await db.query("update room_needs set food_value=80,food_updated_at=now() where owner_id=$1",[me]);
    check((await rpc('solo_burrow_care_v1',[me,'food','solo-food-1'])).applied===true,'solo bunny can be fed');
    check((await rpc('solo_burrow_care_v1',[me,'food','solo-food-1'])).applied===false,'care retry is idempotent');
    check((await rpc('solo_burrow_toy_v1',[me,'toy-key-1'])).applied===true,'solo toy interaction records once');
    check((await rpc('solo_burrow_toy_v1',[me,'toy-key-2'])).applied===false,'toy cannot double count in one day');
    check((await query('select count(*)::int n from moment_events where pair_low=$1 and pair_high=$1',[me]))[0].n===2,
      'personal moments never use a former pair scope');
    await rpc('change_carrot_balance_v1',[me,200,'fixture',null,null,'solo-seed']);
    const item='burrow_art_windows_03';
    check((await rpc('solo_burrow_purchase_v1',[me,item,'purchase-1'])).applied===true,'solo user can purchase for self');
    check((await rpc('solo_burrow_purchase_v1',[me,item,'purchase-1'])).applied===false,'purchase retry is idempotent');
    check((await query('select carrot_balance from wallets where user_id=$1',[me]))[0].carrot_balance===50,
      'purchase debits only once');
    check((await rpc('solo_burrow_loadout_v1',[me,JSON.stringify({window:item})])).applied===true,
      'solo user can decorate with owned item');
    check((await query("select item_id from room_loadouts where owner_id=$1 and slot='window'",[me]))[0].item_id===item,
      'decoration is stored in personal room');
    const saved=await rpc('solo_burrow_memory_v1',[me,null,'A tiny lovely detail.',null,'memory-1']);
    check(saved.applied===true,'solo memory saves');
    check((await rpc('solo_burrow_memory_v1',[me,null,'A tiny lovely detail.',null,'memory-1'])).applied===false,
      'memory create retry is idempotent');
    const memoryUpload=await rpc('solo_burrow_prepare_memory_photo_v1',[me,saved.entryId,0,null,
      '00000000-0000-0000-0000-000000000e06','b'.repeat(64)]);
    check(memoryUpload.error===null,'solo memory photo upload gets ticket');
    check((await rpc('solo_burrow_complete_memory_photo_v1',[me,memoryUpload.ticketId])).applied===true,
      'solo memory photo commits');
    check((await rpc('solo_burrow_read_memory_photo_v1',[me,memoryUpload.ticketId])).path===memoryUpload.path,
      'solo memory photo can be read');
    check((await rpc('solo_burrow_delete_memory_photo_v1',[me,saved.entryId,memoryUpload.ticketId])).applied===true,
      'solo memory photo can be deleted');
    check((await rpc('solo_burrow_delete_memory_v1',[me,saved.entryId])).applied===true,'solo memory deletes');
    const photoKey='00000000-0000-0000-0000-000000000e03';
    const digest='a'.repeat(64);
    const prepared=await rpc('solo_burrow_prepare_photo_v1',[me,me,'frame',photoKey,digest]);
    check(prepared.error===null&&prepared.path.startsWith(`${me}/`),'solo frame upload gets owner-scoped ticket');
    check((await rpc('solo_burrow_prepare_photo_v1',[me,me,'frame',photoKey,digest])).ticketId===prepared.ticketId,
      'frame upload retry reuses the same ticket');
    const photo=await rpc('solo_burrow_complete_photo_v1',[me,prepared.ticketId]);
    check(photo.applied===true,'solo frame upload commits');
    check((await rpc('solo_burrow_read_photo_v1',[me,photo.photoId])).path===prepared.path,
      'solo user can read own photo only');
    const dollKey='00000000-0000-0000-0000-000000000e04';
    const doll=await rpc('solo_burrow_prepare_photo_v1',[me,me,'doll',dollKey,digest]);
    check((await rpc('solo_burrow_complete_photo_v1',[me,doll.ticketId])).applied===true,'solo doll portrait commits');
    check((await rpc('solo_burrow_prepare_photo_v1',[me,me,'doll','00000000-0000-0000-0000-000000000e05',digest])).error==='daily_limit_reached',
      'solo doll portrait still respects daily limit');
    const daily=await rpc('assign_daily_quests_v1',[me]);
    const careQuest=daily.quests.find(q=>q.questId==='feed_partner_bunny');
    if(careQuest) {
      check(careQuest.completedAt!==null,'personal care advances assigned daily quest');
      check((await rpc('claim_daily_quest_v1',[me,careQuest.assignmentId])).applied===true,'solo user claims reward');
    }
    await db.query('insert into reflects(id,user_id,journal_kind,local_date) values($1,$2,$3,current_date)',
      [record,me,'write_freely']);
    await db.query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[me,record]);
    check((await rpc('register_adventure_record_v1',[me,record])).error===null,'solo journal receives registration reward');
    const started=await rpc('solo_burrow_start_adventure_v1',[me,record,'adventure-1']);
    check(started.applied===true,'solo adventure starts');
    await db.query("update adventures set ends_at=now()-interval '1 second',rules_snapshot=rules_snapshot||'{\"friend_probability\":0}'::jsonb where id=$1",[started.adventureId]);
    check((await rpc('solo_burrow_settle_adventure_v1',[me,started.adventureId])).applied===true,'solo adventure settles');
    check((await rpc('solo_burrow_claim_adventure_v1',[me,started.adventureId])).applied===true,'solo result can be claimed');
    check((await query('select status from adventures where id=$1',[started.adventureId]))[0].status==='completed',
      'claimed solo adventure is complete');
    check((await rpc('solo_burrow_start_adventure_v1',[me,record,'adventure-2'])).error==='daily_adventure_used',
      'solo daily adventure limit is enforced');
  } finally { await db.exec('rollback'); }
}
