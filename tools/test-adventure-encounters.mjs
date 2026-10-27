// Real PostgreSQL SQL execution, entirely offline; reuse the established legacy schema fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { seedLegacyRoomPhotos } from './test-burrow-room-photo-cleanup-database.mjs';
const { PGlite } = await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href);
const db = new PGlite();
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const rpc = async (name,args) => (await query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const migration = name => fs.readFileSync(`supabase/migrations/${name}.sql`,'utf8');
let assertions=0;
const check=(value,message)=>{assert.ok(value,message);assertions++;};
try {
  const legacy=fs.readFileSync('tools/test-burrow-game-room.mjs','utf8');
  await db.exec(legacy.match(/await db.exec\(`\n([\s\S]*?)`\);/)[1]);
  const list=legacy.match(/for\(const suffix of (\[[\s\S]*?\])\)/)[1];
  for(const [_,suffix] of list.matchAll(/'([^']+)'/g)) {
    if(suffix.startsWith('130_'))await seedLegacyRoomPhotos({db,rpc});
    await db.exec(migration(`20260920000${suffix}`));
  }
  for(const name of ['20261001000149_burrow_shop_room_checkout','20261004000155_burrow_named_art_and_wallpapers','20261008000203_burrow_shop_pricing',
    '20261010000213_adventure_encounter_foundation','20261010000214_adventure_friends_content',
    '20261010000215_adventure_encounter_runtime','20261010000216_burrow_kettle_shop',
    '20261011000218_adventure_treasure_furniture'])await db.exec(migration(name));
  check((await query('select count(*)::int n from adventure_dialogues_v2'))[0].n===450,'all 450 workbook dialogues seeded');
  check((await query("select count(*)::int n from catalog_items where 'adventure_v2_gift'=any(tags)"))[0].n===483,'all 483 gift IDs seeded');
  check((await query("select count(*)::int n from catalog_items where stable_id like 'burrow_kettle_%' and price=200"))[0].n===42,'42 purchasable kettles at 200');
  await query('insert into profiles(id) values($1),($2)',[A,B]);
  check((await rpc('prepare_adventure_encounters_v2',[A])).error==='feature_disabled','rollout fails closed before activation');
  await db.exec("update app_config set value='true' where key in('app_major_update_enabled','adventure_friends_v2_enabled')");
  // Reproduce the actual app path, not only the explicitly-called dispatcher.
  await db.exec('begin');
  const D='44444444-4444-4444-8444-444444444444', E='55555555-5555-4555-8555-555555555555';
  await query('insert into profiles(id) values($1),($2)',[D,E]);
  await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[D,E]);
  const homeRecord=randomUUID();
  await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[homeRecord,D]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[D,homeRecord]);
  const homeJourney=await rpc('start_adventure_v3',[D,homeRecord,'home-path']);
  const frozen=(await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[homeJourney.adventureId]))[0].snapshot;
  await query("update adventures set ends_at=now()-interval '1 second' where id=$1",[homeJourney.adventureId]);
  await db.exec('update burrow_adventure_rules set friend_probability=0');
  const brokenHome=await rpc('burrow_bootstrap_v1',[D]);
  check(!brokenHome.adventureResult.metadata.encounterV2,'migration 218 reproduces Home incorrectly writing a legacy reward');
  check((await rpc('adventure_command_v2',[D,homeJourney.adventureId,'claim',{}])).error==='interaction_required','reproduces screenshot claim error against a planned journey');
  const inventoryBefore=(await query('select count(*)::int n from user_inventory where owner_id=$1',[D]))[0].n;
  await db.exec(migration('20261011000219_adventure_unified_settlement'));
  await db.exec(migration('20261015000240_adventure_arrival_display'));
  await rpc('adventure_command_v2',[D,homeJourney.adventureId,'settle',{}]);
  const repaired=(await query('select metadata from adventure_results where adventure_id=$1',[homeJourney.adventureId]))[0].metadata;
  check(JSON.stringify(repaired)===JSON.stringify(frozen),'recovery uses the exact preselected furniture, friend, dialogue and gift, with no reroll');
  check((await query('select count(*)::int n from user_inventory where owner_id=$1',[D]))[0].n===inventoryBefore,'recovery does not grant or claw back inventory');
  check((await rpc('adventure_command_v2',[D,homeJourney.adventureId,'treasure',{}])).applied,'recovered chest is claimable');
  await rpc('adventure_command_v2',[D,homeJourney.adventureId,'respond',{choiceId:frozen.dialogue.choices[0].id}]);
  check((await rpc('adventure_command_v2',[D,homeJourney.adventureId,'claim',{}])).applied,'recovered dialogue and gift complete normally');
  await rpc('prepare_adventure_encounters_v2',[D]);
  const homePlan=(await query("select * from adventure_encounter_plans where user_id=$1 and status='reserved' order by id limit 1",[D]))[0];
  const nextHome=randomUUID();
  await query(`insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key)
    values($1,$2,$3,current_date-1,'in_progress',now()-interval '1 hour',now()-interval '1 second',3600,
    (select value from app_config where key='app_major_update_content_revision'),'new-home-path')`,[nextHome,D,E]);
  await query("update adventure_encounter_plans set status='bound',adventure_id=$1 where id=$2",[nextHome,homePlan.id]);
  const correctHome=await rpc('burrow_bootstrap_v1',[D]);
  check(correctHome.adventureResult.metadata.encounterV2===true,'real paired Home bootstrap now settles the frozen plan');
  check(JSON.stringify(correctHome.adventureResult.metadata.treasureSnapshot)===JSON.stringify(homePlan.snapshot.treasureSnapshot),'Home shows actual shop furniture, not Forest Letter');
  await db.exec('rollback');
  await db.exec(migration('20261011000219_adventure_unified_settlement'));
  await db.exec(migration('20261015000240_adventure_arrival_display'));
  // Existing pre-V2 paired journeys must still claim through the new dispatcher.
  await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
  const legacyAdventure=randomUUID();
  await query(`insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key)
    values($1,$2,$3,current_date-1000,'result_ready',now()-interval '1 hour',now()-interval '1 second',3600,'burrow-v1-placeholder','legacy-claim-test')`,[legacyAdventure,A,B]);
  await query(`insert into adventure_results(adventure_id,result_type,item_id,claim_status,metadata)
    values($1,'item','adventure_forest_letter_01','pending','{}')`,[legacyAdventure]);
  check((await rpc('adventure_command_v2',[A,legacyAdventure,'claim',{}])).applied,'legacy paired Forest Letter remains claimable');
  check((await rpc('adventure_command_v2',[A,legacyAdventure,'claim',{}])).applied===false,'legacy claim retry is idempotent');
  await query('delete from pairings where user_id in($1,$2)',[A,B]);
  // Installed V2 clients do not understand the new chest and must keep working.
  await query('insert into profiles(id) values($1)',[C]);
  const oldRecord=randomUUID();
  await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[oldRecord,C]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[C,oldRecord]);
  const oldStart=await rpc('start_adventure_v2',[C,oldRecord,'installed-v2']);
  check(oldStart.applied,'installed V2 start is compatible');
  await query("update adventures set ends_at=now()-interval '1 second' where id=$1",[oldStart.adventureId]);
  check(!(await rpc('adventure_command_v2',[C,oldStart.adventureId,'settle',{}])).error,'installed V2 can settle');
  const oldResult=(await query('select * from adventure_results where adventure_id=$1',[oldStart.adventureId]))[0];
  check(!oldResult.metadata.treasureReserved,'installed V2 never receives an unsupported treasure requirement');
  await rpc('adventure_command_v2',[C,oldStart.adventureId,'respond',{choiceId:oldResult.metadata.dialogue.choices[0].id}]);
  check((await rpc('adventure_command_v2',[C,oldStart.adventureId,'claim',{}])).applied,'installed V2 can claim without a furniture step');
  check((await rpc('adventure_command_v2',[C,oldStart.adventureId,'claim',{}])).applied===false,'installed V2 retry cannot duplicate gifts');
  const first=await rpc('prepare_adventure_encounters_v2',[A]);
  check(first.gifts.length===2,'prefetch reserves only two gifts');
  check(JSON.stringify((await rpc('prepare_adventure_encounters_v2',[A])).gifts)===JSON.stringify(first.gifts),'entry retry cannot reroll');
  check((await query('select friend_id from adventure_encounter_plans where user_id=$1 order by id',[A]))[0].friend_id!==
    (await query('select friend_id from adventure_encounter_plans where user_id=$1 order by id',[A]))[1].friend_id,'adjacent friends differ');
  check((await rpc('select_adventure_gift_v2',[B,first.gifts[0].id])).error==='item_not_owned','foreign gift cannot be selected');
  const record=randomUUID();
  await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[record,A]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[A,record]);
  const started=await rpc('start_adventure_v3',[A,record,'v3-start']);
  check(!started.error&&started.applied,'solo finalized record starts V3 atomically');
  check((await rpc('start_adventure_v3',[A,record,'v3-start'])).applied===false,'lost start response replay binds no second plan');
  const preview=await rpc('adventure_display_v1',[A,started.adventureId]);
  check(preview.activeAdventure.status==='in_progress'&&preview.adventureResult===null,'future preview does not create a result or finish early');
  check(preview.adventurePlan.result.metadata.treasureReserved&&preview.adventurePlan.result.metadata.dialogue.choices.length>0,'future plan includes chest, friend, dialogue and frozen choices');
  check(preview.adventurePlan.result.metadata.giftSnapshot.stable_id!=null,'future plan includes the separate friend gift');
  check((await rpc('adventure_display_v1',[B,started.adventureId])).error==='not_found','foreign display plans are private');
  check((await rpc('adventure_command_v2',[A,started.adventureId,'treasure',{}])).error==='not_ready','a cached plan cannot claim before the server deadline');
  check((await query('select count(*)::int n from adventure_results where adventure_id=$1',[started.adventureId]))[0].n===0,'future claim does not create a result');
  const again=await rpc('adventure_display_v1',[A,started.adventureId]);
  check(preview.adventurePlan.version===again.adventurePlan.version,'read/restart cannot reroll a frozen plan');
  check((await query("select has_function_privilege('authenticated','adventure_display_v1(uuid,uuid)','EXECUTE') ok"))[0].ok===false,'display reads are service-only');
  let previous=null;
  const completed=new Map();
  async function finish(id,index) {
    await query("update adventures set ends_at=now()-interval '1 second' where id=$1",[id]);
    if(index===0) {
      // An impatient user can reach their choice before the background settle.
      check((await rpc('adventure_command_v2',[A,id,'respond',{choiceId:'forged'}])).error==='treasure_required','immediate answer atomically settles, then still enforces the chest');
    } else check(!(await rpc('adventure_command_v2',[A,id,'settle',{}])).error,'planned journey settles');
    const result=(await query('select * from adventure_results where adventure_id=$1',[id]))[0];
    check((await rpc('adventure_command_v2',[B,id,'claim',{}])).error==='not_found','cross-user claim denied');
    check(result.metadata.treasureReserved===true,'chest reservation is durable even when furniture is exhausted');
    check((await rpc('adventure_command_v2',[A,id,'claim',{}])).error==='treasure_required','chest must be claimed before the final gift');
    const furniture=result.metadata.treasureSnapshot;
    if(furniture) {
      check(furniture.item_type==='decor'&&!furniture.plus_only&&furniture.price>0&&!furniture.metadata.starter,'only Free-accessible shop furniture, not Plus/starting items');
      check(!(await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[A,furniture.stable_id])).length,'reserved chest furniture is not already owned');
    }
    check((await rpc('adventure_command_v2',[B,id,'treasure',{}])).error==='not_found','foreign chest receipt denied');
    const chest=await rpc('adventure_command_v2',[A,id,'treasure',{}]);
    check(chest.applied&&chest.interactionRequired&&chest.treasureClaimed,'chest claim advances without ending the journey');
    check((await rpc('adventure_command_v2',[A,id,'treasure',{}])).applied===false,'chest replay cannot duplicate inventory');
    check(!(await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[A,result.metadata.giftSnapshot.stable_id])).length,'chest cannot grant the separate friend gift');
    if(result.result_type==='friend') {
      check(previous!==result.friend_id,'no consecutive encounter with the same friend');
      previous=result.friend_id;
      const dialogue=result.metadata.dialogue;
      const seq=completed.get(result.friend_id)??0;
      check(seq<10 ? dialogue.phase==='Intro'&&dialogue.seq===seq+1 : dialogue.phase==='Pool','Intro is ordered; Pool starts only after Intro');
      completed.set(result.friend_id,seq+1);
      check((await rpc('adventure_command_v2',[A,id,'claim',{}])).error==='interaction_required','gift cannot be claimed before dialogue');
      check((await rpc('adventure_command_v2',[A,id,'respond',{choiceId:'forged'}])).error==='invalid_response','only frozen choices accepted');
      const choice=dialogue.choices[0];
      const answered=await rpc('adventure_command_v2',[A,id,'respond',{choiceId:choice.id}]);
      check(JSON.stringify(answered.reaction)===JSON.stringify(choice.reaction),'reply uses frozen reaction');
      check(!(await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[A,result.metadata.giftSnapshot.stable_id])).length,'reply alone does not award gift');
      check((await rpc('adventure_command_v2',[A,id,'respond',{choiceId:'forged'}])).applied===false,'retry cannot change accepted answer');
    } else previous=null;
    check((await rpc('adventure_command_v2',[A,id,'claim',{}])).applied,'claim completes and grants gift');
    check((await rpc('adventure_command_v2',[A,id,'claim',{}])).applied===false,'claim replay never awards twice');
    if(index===0) {
      check(!(await rpc('select_adventure_gift_v2',[A,result.metadata.giftSnapshot.stable_id])).error,'owned gift can be displayed');
      check((await rpc('adventure_collection_v2',[B])).displays.length===0,'unpaired stranger cannot read display');
    }
  }
  await finish(started.adventureId,0);
  check((await rpc('adventure_display_v1',[A,started.adventureId])).activeAdventure===null,'a completed adventure cannot be revived by a display read');
  // Simulate calendar days without editing the server clock or bypassing production RPC checks.
  for(let day=1;day<483;day++) {
    await rpc('prepare_adventure_encounters_v2',[A]);
    const plan=(await query("select * from adventure_encounter_plans where user_id=$1 and status='reserved' order by id limit 1",[A]))[0];
    check(!!plan,'an uncollected gift remains available');
    const id=randomUUID();
    await query(`insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key)
      values($1,$2,$2,current_date-$3::int,'in_progress',now()-interval '1 hour',now()-interval '1 second',3600,
      (select value from app_config where key='app_major_update_content_revision'),$4)`,[id,A,day,`day-${day}`]);
    await query("update adventure_encounter_plans set status='bound',adventure_id=$1 where id=$2",[id,plan.id]);
    await finish(id,day);
  }
  check((await query('select count(*)::int n from adventure_dialogue_completions where user_id=$1',[A]))[0].n===450,'all 450 unique dialogues completed exactly once');
  check((await query("select count(*)::int n from user_inventory where owner_id=$1 and item_id like 'adventure_gift_%'",[A]))[0].n===483,'all 483 gifts collected exactly once');
  check((await query(`select count(*)::int n from user_inventory i join catalog_items c on c.stable_id=i.item_id
    where i.owner_id=$1 and c.plus_only and c.item_type='decor'`,[A]))[0].n===0,'Plus-only furniture never appears in chest inventory');
  check((await rpc('prepare_adventure_encounters_v2',[A])).gifts.length===0,'fully exhausted catalogue does not invent duplicates');
  check((await query("select has_function_privilege('authenticated','adventure_command_v2(uuid,uuid,text,jsonb)','EXECUTE') ok"))[0].ok===false,'commands restricted to authenticated API service');
  console.log(`Adventure V2 PostgreSQL integration: ${assertions} assertions passed across 483 journeys.`);
} catch(error) {
  console.error(`Adventure V2 failed after ${assertions} assertions: ${error.message}`);
  if(error.detail)console.error(error.detail);
  if(error.where)console.error(error.where);
  process.exitCode=1;
} finally {await db.close();}
