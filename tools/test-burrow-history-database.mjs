export async function testHistory({db,rpc,query,check}) {
  await db.exec('begin');
  try {
    const a='00000000-0000-0000-0000-000000000071',b='00000000-0000-0000-0000-000000000072',c='00000000-0000-0000-0000-000000000073';
    await db.query('insert into profiles(id) values($1),($2),($3)',[a,b,c]);
    await db.query('insert into pairings values($1,$2),($2,$1)',[a,b]);
    await db.exec("update app_config set value='true' where key='app_major_update_enabled'");
    await db.query(`insert into moment_events(pair_low,pair_high,actor_id,event_type,created_at,payload,idempotency_key)
      select $1,$2,$1,'room_media_updated','2026-09-20T01:00:00Z','{}','history-'||n from generate_series(1,75) n`,[a,b]);
    const first=await rpc('burrow_history_v1',[a,b,'moments',null,null,null]);
    check(first.rows.length===30&&first.hasMore,'history page bound');
    const second=await rpc('burrow_history_v1',[a,b,'moments',first.next.at,first.next.id,null]);
    const third=await rpc('burrow_history_v1',[a,b,'moments',second.next.at,second.next.id,null]);
    check(third.rows.length===15&&!third.hasMore&&third.next===null,'history reaches end');
    check(new Set([...first.rows,...second.rows,...third.rows].map(r=>r.id)).size===75,'equal timestamp keyset has no gaps or duplicates');
    await db.query("update moment_events set visibility='actor_only' where id=$1",[first.rows[0].id]);
    check((await rpc('burrow_history_v1',[b,a,'moments',null,null,null])).rows.every(r=>r.id!==first.rows[0].id),'private partner moment hidden');
    await db.query("update profiles set timezone_name='America/Los_Angeles' where id=$1",[a]);
    check((await rpc('burrow_history_v1',[a,b,'moments',null,null,'2026-09-20'])).rows.length===0,'date filter uses profile timezone');
    check((await rpc('burrow_history_v1',[a,b,'moments',null,null,'2026-09-19'])).rows[0].localDate==='2026-09-19','profile date included');
    check((await rpc('burrow_history_v1',[a,c,'moments',null,null,null])).error==='pair_changed','cursor recipient bound');
    check((await rpc('burrow_history_v1',[c,a,'moments',null,null,null])).error==='not_paired','stranger denied');
    const [e]=await query("insert into memory_room_entries(pair_low,pair_high,author_id,local_date,body) values($1,$2,$1,current_date,'A memory') returning id",[a,b]);
    await db.query("insert into memory_entry_photos(id,entry_id,slot,private_path) values(gen_random_uuid(),$1,0,'private-only')",[e.id]);
    const memories=await rpc('burrow_history_v1',[a,b,'memories',null,null,null]);
    check(memories.rows[0].photos.length===1&&!JSON.stringify(memories).includes('private-only'),'history includes photo metadata but never paths');
    await db.query('update memory_room_entries set deleted_at=now() where id=$1',[e.id]);
    check((await rpc('burrow_history_v1',[a,b,'memories',null,null,null])).rows.length===0,'deleted memories omitted');
    await db.query('delete from pairings where user_id=$1',[b]);
    check((await rpc('burrow_history_v1',[a,b,'moments',first.next.at,first.next.id,null])).error==='not_paired','later page revalidates reciprocal pair');
    check(!(await query("select has_function_privilege('authenticated','burrow_history_v1(uuid,uuid,text,timestamptz,uuid,date)','EXECUTE') ok"))[0].ok,'history RPC service only');
  } finally { await db.exec('rollback'); }
}
