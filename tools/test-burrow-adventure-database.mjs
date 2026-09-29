// Invoked by the offline PGlite suite; transaction rollback isolates each case.
export async function testAdventureContent({ db, query, rpc, check }) {
  const me='00000000-0000-0000-0000-000000000004',partner='00000000-0000-0000-0000-000000000005';
  const record='20000000-0000-0000-0000-000000000004';
  const friend='friend_mr_mole_v1';
  async function setup(kind='question') {
    await db.exec('begin');
    await db.query('insert into profiles(id) values($1),($2)',[me,partner]);
    await db.query('insert into pairings values($1,$2),($2,$1)',[me,partner]);
    await db.exec("update burrow_adventure_rules set friend_probability=1; update catalog_items set drop_weight=0;");
    await db.query("update friend_definitions set status='retired' where stable_id<>$1",[friend]);
    await db.query("update friend_content set trigger_scene=case when content_type=$1 then 'adventure' else 'visit' end",[kind]);
    await db.query("insert into reflects(id,user_id,journal_kind) values($1,$2,'tap_your_day')",[record,me]);
    await db.query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[me,record]);
    await db.exec("insert into items values('fixture-nature','Nature & Outdoors');");
    await db.query("insert into reflect_items values($1,$2,'fixture-nature')",[record,me]);
    const start=await rpc('start_adventure_v1',[me,record,'fourth-batch-start']);
    check(!start.error,'new adventure starts against finalized record');
    await db.query("update adventures set ends_at=now()-interval '1 second' where id=$1",[start.adventureId]);
    return start.adventureId;
  }
  async function row(id) {return (await query('select * from adventure_results where adventure_id=$1',[id]))[0];}
  async function finish(id,response) {return rpc('complete_friend_interaction_v1',[me,id,response]);}
  let id=await setup();
  const started=(await query('select source_tags,rules_snapshot from adventures where id=$1',[id]))[0];
  check(started.source_tags.includes('flower')&&started.source_tags.includes('forest'),'record categories map to frozen tags');
  await db.exec("update burrow_adventure_rules set friend_probability=0; update burrow_record_category_tags set tags=array['changed'];");
  await rpc('settle_adventure_v1',[me,id]);
  let result=await row(id), content=result.metadata.friendContent;
  check(result.friend_id===friend && content.content_type==='question','start rules survive later config edits; scene filters select question');
  check(result.metadata.sourceTags.includes('flower'),'settlement retains start tags');
  await db.exec("update friend_content set prompt='Replacement copy',choices='[{\"id\":\"new1\",\"label\":\"New 1\"},{\"id\":\"new2\",\"label\":\"New 2\"}]',feedback='{\"new1\":\"New feedback\",\"new2\":\"New feedback\"}' where content_type='question';");
  await rpc('claim_adventure_result_v1',[me,id]);
  check((await rpc('burrow_bootstrap_v1',[me])).friendContent[0].prompt===content.prompt,'bootstrap serves frozen dialogue, not edited content library');
  check((await finish(id,{choiceId:'new1'})).error==='invalid_response','new live choice cannot answer old snapshot');
  const answer=await finish(id,{choiceId:content.choices[0].id});
  check(answer.feedback===content.feedback[content.choices[0].id],'question returns frozen feedback');
  check((await finish(id,{choiceId:'forged'})).feedback===answer.feedback,'lost response replay returns original feedback without rerunning interaction');
  check((await query("select count(*)::int n from moment_events where actor_id=$1 and event_type='friend_discovered'",[me]))[0].n===1,'friend completion emits one event');
  await db.exec('rollback');

  id=await setup('insight');
  await rpc('settle_adventure_v1',[me,id]); await rpc('claim_adventure_result_v1',[me,id]);
  check((await finish(id,{acknowledged:'true'})).error==='invalid_response','insight requires boolean acknowledgement');
  check((await finish(id,{acknowledged:true})).applied===true,'insight acknowledgement completes adventure');
  await db.exec('rollback');

  id=await setup('emotional_help');
  await rpc('settle_adventure_v1',[me,id]); await rpc('claim_adventure_result_v1',[me,id]);
  result=await row(id); const monster=result.metadata.friendContent.rage_monster_id;
  await db.query("insert into kit_completions(user_id,kit,period_key,payload,created_at) values($1,'tame_enemy','earlier',$2,now()-interval '1 day')",[me,{monster_id:monster}]);
  check((await finish(id,{choiceId:'yes'})).battleRequired===true,'acceptance saves durable battle requirement');
  check((await finish(id,{choiceId:'yes'})).error==='battle_required','historical battle cannot finish new request');
  await db.query("insert into kit_completions(user_id,kit,period_key,payload) values($1,'tame_enemy','wrong',$2)",[me,{monster_id:'wrong-monster'}]);
  check((await finish(id,{choiceId:'yes'})).error==='battle_required','wrong monster rejected');
  await db.query("insert into kit_completions(user_id,kit,period_key,payload) values($1,'tame_enemy','matching',$2)",[partner,{monster_id:monster}]);
  check((await finish(id,{choiceId:'yes'})).applied===true,'current partner matching battle after acceptance completes request');
  check((await query('select * from currency_ledger where user_id=$1',[me])).length===0,'friend interaction grants no currency');
  await db.exec('rollback');

  id=await setup('emotional_help');
  await rpc('settle_adventure_v1',[me,id]); await rpc('claim_adventure_result_v1',[me,id]);
  check((await finish(id,{choiceId:'not_now'})).declined===true,'declining finishes encounter without battle');
  check((await query('select interaction_completed_at from user_friend_discoveries where user_id=$1',[me]))[0].interaction_completed_at!=null,'declining still unlocks friend for later visits');
  check((await query('select * from gifts where sender_id=$1 or recipient_id=$1',[me])).length===0,'declining generates no gift');
  await db.exec('rollback');

  id=await setup();
  await db.query("update adventures set rules_snapshot=rules_snapshot||'{\"friend_probability\":0}'::jsonb where id=$1",[id]);
  // Every forbidden candidate has a high weight; only explicit eligible rug remains.
  await db.exec(`update catalog_items set drop_weight=999 where stable_id in('placeholder_windows_02','adventure_moon_pebble_01','adventure_fossil_lamp_01');
    update catalog_items set tags=tags||array['adventure_obtainable'],price=9999 where stable_id='placeholder_windows_02';
    update catalog_items set plus_only=true where stable_id='adventure_fossil_lamp_01';
    update catalog_items set drop_weight=6 where stable_id='adventure_our_rug_01';`);
  await db.query("insert into user_inventory(owner_id,item_id,source) values($1,'adventure_moon_pebble_01','adventure')",[me]);
  let settled=await rpc('settle_adventure_v1',[me,id]);
  check(settled.itemId==='adventure_our_rug_01','excludes high price, Plus, own souvenir; allows explicitly tagged Our Room');
  const title=(await row(id)).metadata.itemSnapshot.title;
  await db.exec("update catalog_items set title='Changed title' where stable_id='adventure_our_rug_01'");
  check((await row(id)).metadata.itemSnapshot.title===title,'item title snapshot survives content replacement');
  await rpc('claim_adventure_result_v1',[me,id]);
  check((await query("select item_id from user_inventory where owner_id=$1 and item_id='adventure_our_rug_01'",[me])).length===1,'Free can collect shared-room drop without bypassing Plus decor gate');
  await db.exec('rollback');

  id=await setup();
  await db.query("update adventures set rules_snapshot=rules_snapshot||'{\"friend_probability\":0}'::jsonb where id=$1",[id]);
  await db.exec("update catalog_items set drop_weight=10 where stable_id='adventure_fossil_lamp_01'");
  await db.query("insert into user_inventory(owner_id,item_id,source) values($1,'adventure_fossil_lamp_01','adventure')",[me]);
  settled=await rpc('settle_adventure_v1',[me,id]);
  check(settled.itemId==='adventure_fossil_lamp_01','tradable own duplicate remains eligible when partner lacks it');
  check(!!(await rpc('claim_adventure_result_v1',[me,id])).giftId,'eligible duplicate is gifted to current partner');
  await db.exec('rollback');

  id=await setup();
  await db.query("update adventures set rules_snapshot=rules_snapshot||'{\"friend_probability\":0}'::jsonb where id=$1",[id]);
  await db.exec("update catalog_items set drop_weight=999,tags=array['forest'] where stable_id='adventure_fossil_lamp_01'");
  check((await rpc('settle_adventure_v1',[me,id])).resultType==='quiet','matching theme and weight cannot bypass acquisition tag');
  await db.exec('rollback');

  id=await setup();
  await db.query("insert into user_inventory(owner_id,item_id,source) values($1,'adventure_moon_pebble_01','adventure')",[me]);
  // Simulate a pre-upgrade pending souvenir reward that was already owned.
  await db.query(`insert into adventure_results(adventure_id,result_type,item_id,claim_status,metadata)
    select $1,'item',stable_id,'pending',jsonb_build_object('itemSnapshot',to_jsonb(c)) from catalog_items c where stable_id='adventure_moon_pebble_01'`,[id]);
  await db.query("update adventures set status='result_ready' where id=$1",[id]);
  const depleted=await rpc('claim_adventure_result_v1',[me,id]);
  check(depleted.resultType==='quiet'&&!depleted.giftId,'legacy pending souvenir duplicate finishes quietly instead of gifting');
  check((await rpc('claim_adventure_result_v1',[me,id])).applied===false,'legacy duplicate handling is replay safe');
  const valid=(await query("select to_jsonb(c) p from friend_content c where content_type='question' limit 1"))[0].p;
  check(await rpc('valid_burrow_friend_content',[valid]),'published question satisfies shared content validation');
  check(!(await rpc('valid_burrow_friend_content',[{...valid,feedback:{}}])),'missing question feedback is rejected');
  check(!(await rpc('valid_burrow_friend_content',[{...valid,choices:[valid.choices[0],valid.choices[0]]}])),'duplicate choice IDs are rejected');
  const help=(await query("select to_jsonb(c) p from friend_content c where content_type='emotional_help' limit 1"))[0].p;
  check(!(await rpc('valid_burrow_friend_content',[{...help,rage_monster_id:'fictional-monster'}])),'nonexistent Rage monster cannot be published');
  await db.exec('rollback');

  // Exercise actual selection repeatedly with fixed IDs, equal base weights,
  // then the same IDs with matching tags. No statistical/flaky random UUIDs.
  id=await setup();
  await db.query('delete from adventures where id=$1',[id]);
  await db.exec("update burrow_adventure_rules set friend_probability=0; update catalog_items set drop_weight=10 where stable_id in('adventure_fossil_lamp_01','adventure_flower_seed_01')");
  const counts=[];
  for (const [tags,weight] of [[[],10],[['flower','growth','gratitude'],10],[[],1000]]) {
    await db.query("update catalog_items set drop_weight=$1 where stable_id='adventure_flower_seed_01'",[weight]);
    let selected=0;
    for(let n=1;n<=60;n++) {
      const fixed=`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
      await db.query(`insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,plus_snapshot,content_revision,idempotency_key)
        values($1::uuid,$2,$3,current_date,'in_progress',now()-interval '9 hours',now()-interval '1 hour',28800,false,'burrow-v1-placeholder',$1::text)`,[fixed,me,partner]);
      await db.query('update adventures set source_tags=$2 where id=$1',[fixed,tags]);
      const pick=await rpc('settle_adventure_v1',[me,fixed]);
      if(pick.itemId==='adventure_flower_seed_01') selected++;
      await db.query('delete from adventures where id=$1',[fixed]);
    }
    counts.push(selected);
  }
  check(counts[1]>counts[0]&&counts[1]>40,'frozen record tags measurably increase matching item weight over deterministic sample');
  check(counts[2]>counts[0]&&counts[2]>55,'base drop_weight changes selection, not just sorting or metadata');
  check(!(await rpc('settle_adventure_v1',[partner,id])).applied,'other user cannot settle missing/private adventure');
  await db.exec('rollback');
}
