export async function testGameRoomSilent({db,query,rpc,check}){
  const a='00000000-0000-0000-0000-000000000a01',b='00000000-0000-0000-0000-000000000b01';
  const game='after_dark_01',key='00000000-0000-0000-0000-000000000d01';
  const questions=Array.from({length:6},(_,i)=>({self:'Self '+i,partner:'Partner '+i,options:['A','B','C','D']}));
  const own=[0,1,2,3,0,1],guess=[1,2,3,0,1,2];
  await db.exec('begin');
  try{
    await db.query('insert into profiles(id) values($1),($2)',[a,b]);
    await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[a,b]);
    await rpc('change_carrot_balance_v1',[a,200,'fixture',null,null,'silent-seed']);
    const unlocked=await rpc('burrow_game_unlock_v1',[a,game,key]);
    check(unlocked.charged===true&&unlocked.unlocked===true,'150 coin unlock preserves receipt');
    check((await query('select carrot_balance from wallets where user_id=$1',[a]))[0].carrot_balance===50,'unlock charges exactly 150 coins');
    check((await rpc('burrow_game_unlock_v1',[a,game,key])).charged===false,'unlock replay does not charge twice');
    const id=(await rpc('burrow_game_start_v1',[a,game,questions])).sessionId;
    check((await rpc('burrow_game_overview_v1',[b])).sessions.length===0,'unfinished sender draft is invisible to partner');
    check((await query('select * from notification_outbox')).length===0,'no partner notification before submission');
    check((await rpc('burrow_game_submit_v1',[a,id,[0],guess])).error==='invalid_request','partial batch rejected');
    check((await rpc('burrow_game_submit_v1',[a,id,own,[4,0,0,0,0,0]])).error==='invalid_request','invalid choice rejected atomically');
    check((await rpc('burrow_game_state_v1',[a,id])).ownAnswers.length===0,'invalid batches leave no partial choices');
    await rpc('burrow_game_answer_v1',[a,id,'own',0,0]);
    check((await rpc('burrow_game_submit_v1',[a,id,[1,1,2,3,0,1],guess])).error==='answer_conflict','legacy immutable prefix is protected');
    const broadcasts=(await query('select count(*)::int n from test_broadcasts'))[0].n;
    check(!(await rpc('burrow_game_submit_v1',[a,id,own,guess])).error,'complete matching batch is accepted');
    check((await query('select count(*)::int n from test_broadcasts'))[0].n===broadcasts+2,'complete batch emits one private invalidation to each device');
    check((await rpc('burrow_game_overview_v1',[b])).sessions[0].partnerOwnCount===6,'partner invite appears after all 12 are committed');
    check((await query("select * from notification_outbox where event_type='game_invite'")).length===1,'invitation queued once after sender finishes');
    check((await rpc('burrow_game_state_v1',[b,id])).partnerOwnAnswers===null,'receiver cannot see sender answers before finishing');
    check((await rpc('burrow_game_submit_v1',[a,id,own,guess])).replayed===true,'lost sender receipt safely replayed');
    check((await query('select count(*)::int n from test_broadcasts'))[0].n===broadcasts+2,'replayed batch never emits another invalidation');
    check((await query("select * from notification_outbox where event_type='game_invite'")).length===1,'batch retry never duplicates invitation');
    await rpc('burrow_game_submit_v1',[b,id,guess,own]);
    const final=await rpc('burrow_game_state_v1',[b,id]);
    check(final.completedAt&&final.partnerOwnAnswers.length===6,'receiver final receipt immediately contains revealed result inputs');
    check((await rpc('burrow_game_overview_v1',[a])).sessions[0].completedAt,'sender overview includes completed result entry');
    check((await query("select * from notification_outbox where event_type='game_ready' and recipient_user_id=$1",[a])).length===1,'sender result notification does not require history or opt-in flag');
    check((await rpc('burrow_game_submit_v1',[b,id,guess,own])).replayed===true,'completed receipt can be recovered without starting a new game');
    check((await rpc('burrow_game_submit_v1',[b,id,own,guess])).error==='already_done','completed answers cannot change');
    const next=(await rpc('burrow_game_start_v1',[a,game,questions])).sessionId;check(next!==id,'play again creates new round');
    await db.query('delete from pairings where user_id in($1,$2)',[a,b]);
    check((await rpc('burrow_game_submit_v1',[a,next,own,guess])).error==='not_paired','unpair prevents delayed draft delivery');
    check(!(await query("select has_function_privilege('authenticated','burrow_game_submit_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') ok"))[0].ok,'batch submission is service-only');
  }finally{await db.exec('rollback');}
}
