export async function testGameRoom({ db, query, rpc, check }) {
  const a='00000000-0000-0000-0000-000000000a01';
  const b='00000000-0000-0000-0000-000000000b01';
  const stranger='00000000-0000-0000-0000-000000000c01';
  const game='after_dark_01';
  const key='00000000-0000-0000-0000-000000000d01';
  const questions=Array.from({length:6},(_,i)=>({self:`Self ${i}`,partner:`Partner ${i}`,options:['A','B','C','D']}));
  await db.exec('begin');
  try {
    await db.query('insert into profiles(id) values($1),($2),($3)',[a,b,stranger]);
    const unpaired=await rpc('burrow_game_overview_v1',[a]);
    check(unpaired.paired===false && unpaired.sessions.length===0,'unpaired player can browse an empty game overview');
    check((await rpc('burrow_game_unlock_v1',[a,game,key])).error==='not_paired','game unlock requires reciprocal pair');
    await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[a,b]);
    await rpc('change_carrot_balance_v1',[a,40,'fixture',null,null,'game-room-seed']);
    check((await rpc('burrow_game_unlock_v1',[a,game,key])).charged===true,'first unlock charges 20 carrots');
    check((await rpc('burrow_game_unlock_v1',[a,game,key])).charged===false,'unlock retry cannot charge again');
    const partnerOverview=await rpc('burrow_game_overview_v1',[b]);
    check(partnerOverview.paired===true && partnerOverview.availableIds.includes(game),'partner may play unlocked game');
    check((await query('select carrot_balance from wallets where user_id=$1',[a]))[0].carrot_balance===20,'wallet debited exactly once');
    check((await rpc('burrow_game_start_v1',[a,'daily_quirks_01',questions])).error==='game_locked','locked game cannot start');
    const started=await rpc('burrow_game_start_v1',[a,game,questions]);
    const id=started.sessionId;
    check(Boolean(id),'starts unlocked round');
    check((await rpc('burrow_game_start_v1',[b,game,questions])).sessionId===id,'partner joins same active round');
    check((await rpc('burrow_game_state_v1',[stranger,id])).error==='not_paired','stranger cannot read round');
    check((await rpc('burrow_game_answer_v1',[a,id,'guess',0,1])).error==='not_ready','guesses require own answers first');
    check((await rpc('burrow_game_answer_v1',[a,id,'own',1,0])).error==='answer_out_of_order','answers must be sequential');
    for(let i=0;i<6;i++) {
      check((await rpc('burrow_game_answer_v1',[a,id,'own',i,i%4])).count===i+1,'own answer saved');
      await rpc('burrow_game_answer_v1',[b,id,'own',i,(i+1)%4]);
    }
    check((await rpc('burrow_game_answer_v1',[a,id,'own',0,0])).replayed===true,'identical answer retry idempotent');
    check((await rpc('burrow_game_answer_v1',[a,id,'own',0,2])).error==='answer_conflict','changed answer retry rejected');
    for(let i=0;i<6;i++) await rpc('burrow_game_answer_v1',[a,id,'guess',i,(i+1)%4]);
    check((await rpc('burrow_game_state_v1',[a,id])).partnerOwnAnswers===null,'partner answers hidden before both finish');
    await rpc('burrow_game_notify_v1',[a,id,true]);
    for(let i=0;i<6;i++) await rpc('burrow_game_answer_v1',[b,id,'guess',i,i%4]);
    const result=await rpc('burrow_game_state_v1',[a,id]);
    check(result.completedAt && result.partnerOwnAnswers.length===6 && result.partnerGuesses.length===6,'both answers revealed after completion');
    check((await query('select count(*)::int n from notification_outbox where recipient_user_id=$1 and event_type=$2',[a,'game_ready']))[0].n===1,'opted-in first finisher notified once');
    check((await rpc('burrow_game_answer_v1',[b,id,'guess',5,1])).error==='already_done','completed round cannot mutate');
    check((await rpc('burrow_game_start_v1',[a,game,questions])).sessionId!==id,'play again starts a fresh round without paying again');
    await db.query('delete from pairings where user_id in($1,$2)',[a,b]);
    check((await rpc('burrow_game_state_v1',[a,id])).error==='not_paired','unpair revokes old result access');
    check((await rpc('burrow_game_overview_v1',[a])).ownedIds.includes(game),'account ownership survives unpairing');
    check(!(await query("select has_function_privilege('authenticated','burrow_game_answer_v1(uuid,uuid,text,integer,integer)','EXECUTE') ok"))[0].ok,'game RPC is service-only');
  } finally { await db.exec('rollback'); }
}
