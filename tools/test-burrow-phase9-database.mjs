export async function testPhase9Lifecycle({db,query,rpc,check}) {
  await db.exec('begin');
  const a='00000000-0000-0000-0000-000000000981',b='00000000-0000-0000-0000-000000000982',c='00000000-0000-0000-0000-000000000983';
  try {
    await db.query('insert into profiles(id) values($1),($2),($3)',[a,b,c]);
    await db.query('insert into pairings values($1,$2),($2,$1)',[a,b]);
    const version=await rpc('burrow_pair_version_v1',[a,b]);
    check(typeof version==='string'&&version.length===32,'pair generation initialized');
    await db.exec("update app_config set value='true' where key='app_major_update_enabled'");
    for(const value of [2999,600001,'3000'])check((await rpc('complete_affection_v1',[a,'kiss',{assistedHoldMs:value},`bad-${value}`])).error==='invalid_request','assisted path rejects invalid duration');
    const love=await rpc('complete_affection_v1',[a,'kiss',{assistedHoldMs:3000},'assisted']);
    check(love.applied===true&&love.reward===10,'assisted path earns ordinary first reward');
    check((await rpc('complete_affection_v1',[a,'kiss',{assistedHoldMs:3000},'assisted'])).applied===false,'assisted retry does not pay twice');
    check((await rpc('complete_affection_v1',[a,'hug',{assistedHoldMs:3000},'next'])).error==='cooldown_active','assisted and gesture paths share cooldown');
    const target={kind:'frame',ownerId:a};const key='00000000-0000-0000-0000-000000000984';
    check((await rpc('prepare_burrow_photo_for_pair_v1',[a,c,target,key,'a'.repeat(64)])).error==='pair_changed','restored photo cannot target a new partner');
    const photo=await rpc('prepare_burrow_photo_for_pair_v1',[a,b,target,key,'a'.repeat(64)]);
    check(!!photo.ticketId,'same partner can prepare a restored photo');
    const record='00000000-0000-0000-0000-000000000985';
    await db.query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[record,a]);
    await db.query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[a,record]);
    const start=await rpc('start_adventure_v1',[a,record,'before-unpair']);
    check(!!start.adventureId,'adventure starts before unpair');
    await db.query("update adventures set ends_at=now()-interval '1 second' where id=$1",[start.adventureId]);
    const settled=await rpc('settle_adventure_v1',[a,start.adventureId]);
    check(!!settled.resultId,'pending result exists before unpair');
    const before=await query('select * from currency_ledger where user_id=$1',[a]);
    await db.query('delete from pairings where user_id=$1',[b]);
    check((await query('select status from adventures where id=$1',[start.adventureId]))[0].status==='cancelled','one-sided unpair cancels unfinished adventure');
    check((await query('select * from adventure_results where adventure_id=$1',[start.adventureId])).length===1,'cancel preserves result audit row');
    check((await query('select * from currency_ledger where user_id=$1',[a])).length===before.length,'unpair does not revoke existing credits');
    await db.query('insert into pairings values($1,$2)',[b,a]);
    const nextVersion=await rpc('burrow_pair_version_v1',[a,b]);
    check(nextVersion!==version,'re-pair rotates identity even for same two people');
    check((await rpc('save_memory_room_versioned_v1',[a,b,version,null,'Old queued words',null,'old-queue',null])).error==='pair_changed','server blocks old-generation memory replay');
    check((await rpc('save_memory_room_versioned_v1',[a,b,nextVersion,null,'Reviewed words',null,'reviewed-queue',null])).applied===true,'reviewed memory saves with current relationship');
    check((await rpc('burrow_bootstrap_v1',[a])).pairVersion===nextVersion,'bootstrap exposes current relationship generation');
    check((await rpc('claim_adventure_result_v1',[a,start.adventureId])).error==='adventure_cancelled','same-partner re-pair cannot claim cancelled result');
    check((await rpc('settle_adventure_v1',[a,start.adventureId])).error==='adventure_cancelled','same-partner re-pair cannot replay cancelled settlement');
    check((await rpc('start_adventure_v1',[a,record,'after-unpair'])).error==='daily_adventure_used','unpair does not refund daily adventure');
    check(!(await query("select has_function_privilege('authenticated','prepare_burrow_photo_for_pair_v1(uuid,uuid,jsonb,uuid,text)','EXECUTE') ok"))[0].ok,'bound photo RPC is service only');
  } finally {await db.exec('rollback');}
}
