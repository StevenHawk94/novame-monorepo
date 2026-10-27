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

  await db.exec(migration('20261011000219_adventure_unified_settlement'));
  await db.exec(migration('20261015000240_adventure_arrival_display'));
  // All actual legacy settlement and wallet writers are present in this fixture.
  await query('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
  await db.exec("update app_config set value='true' where key in('app_major_update_enabled','adventure_friends_v2_enabled')");
  const definitions=(await query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in('prepare_adventure_friend_gifts_v2','adventure_command_friend_gift_v2','change_carrot_balance_v1') order by proname"));
  const oldToy=(await query("select to_jsonb(c) item from catalog_items c where category='couple_dolls' limit 1"))[0].item;
  await query("insert into adventure_encounter_plans(user_id,status,snapshot) values($1,'reserved',jsonb_build_object('treasureReserved',true,'treasureSnapshot',$2::jsonb,'giftSnapshot',jsonb_build_object('stable_id','keep-friend-gift')))",[B,JSON.stringify(oldToy)]);
  const frozenId=randomUUID(),frozen={encounterV2:true,treasureVersion:3,treasureReserved:true,treasureSnapshot:oldToy};
  await query("insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key) values($1::uuid,$2::uuid,$2::uuid,current_date-2000,'in_progress',now(),now()+interval '1 hour',3600,'burrow-v1-placeholder','frozen-v3')",[frozenId,C]);
  await query("insert into adventure_encounter_plans(user_id,adventure_id,status,snapshot) values($1,$2,'bound',$3)",[C,frozenId,JSON.stringify(frozen)]);
  await db.exec(migration('20261021000255_adventure_treasure_coins'));
  assert.deepEqual(await query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in('prepare_adventure_friend_gifts_v2','adventure_command_friend_gift_v2','change_carrot_balance_v1') order by proname"),definitions);
  check(true,'friend selection, friend reward receipts and wallet writer definitions unchanged');
  const refreshed=(await query("select snapshot from adventure_encounter_plans where user_id=$1",[B]))[0].snapshot;
  check(!refreshed.treasureReserved&&refreshed.giftSnapshot.stable_id==='keep-friend-gift','migration refreshes unstarted Plushie reservation without touching the friend gift');
  await query('delete from adventure_encounter_plans where user_id=$1',[B]);
  assert.deepEqual((await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[frozenId]))[0].snapshot,frozen);check(true,'migration preserves the exact bound/revealed legacy Plushie snapshot');
  await query("insert into user_inventory(owner_id,item_id,source) select $1,stable_id,'adventure' from catalog_items where 'adventure_v2_gift'=any(tags)",[A]);
  const candidate=(await query("select stable_id from catalog_items where item_type='decor' and category='lamps' and price>0 and metadata->>'starter' is distinct from 'true' and status='active' limit 1"))[0].stable_id;
  await db.exec("update catalog_items set plus_only=true where item_type='decor'");
  let seq=0;
  async function journey(user=A,version=4){
    const id=randomUUID();seq++;
    await query("update adventures set status='completed' where user_id=$1 and status in('in_progress','result_ready','interaction_required')",[user]);
    await query("insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key) values($1::uuid,$2::uuid,$2::uuid,current_date-$3::int,'in_progress',now()-interval '1 hour',now()-interval '1 second',3600,(select value from app_config where key='app_major_update_content_revision'),$1::text)",[id,user,seq]);
    await query("insert into adventure_encounter_plans(user_id,adventure_id,status,snapshot) values($1,$2,'bound',jsonb_build_object('encounterV2',true,'treasureVersion',$3::int))",[user,id,version]);
    await rpc('prepare_adventure_encounters_v2',[user]);return id;
  }
  const metadata=async id=>(await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[id]))[0].snapshot;
  const balance=async user=>(await query('select carrot_balance from wallets where user_id=$1',[user]))[0]?.carrot_balance??0;
  const due=await journey();
  check((await metadata(due)).treasureCoins===100,'empty furniture pool and fully exhausted friend gifts still reserve 100 coins');
  const receipt=await rpc('adventure_command_v2',[A,due,'treasure',{}]);
  check(receipt.coins===100&&receipt.itemId===null&&receipt.applied,'coin chest grants only money on explicit Claim');
  check(await balance(A)===100,'confirmed wallet increases by 100');
  const replay=await rpc('adventure_command_v2',[A,due,'treasure',{}]);
  check(!replay.applied&&replay.reward===0&&replay.coins===100,'ambiguous retry returns same award but no repeat monetary/visual reward');
  check(await balance(A)===100,'replay does not credit twice');
  check((await rpc('adventure_command_v2',[A,due,'claim',{}])).applied,'no-friend chest completes normally');
  check((await rpc('adventure_command_v2',[A,due,'treasure',{}])).reward===0,'post-completion treasure replay remains inert');
  const future=await journey();
  await query("update adventures set ends_at=now()+interval '1 hour' where id=$1",[future]);
  check((await rpc('adventure_command_v2',[A,future,'treasure',{}])).error==='not_ready','early Claim does not bypass duration');
  check(await balance(A)===100,'early Claim cannot grant money');
  check((await rpc('adventure_command_v2',[B,future,'treasure',{}])).error==='not_found','another user cannot claim chest');
  await query("update adventures set status='cancelled' where id=$1",[future]);
  check((await rpc('adventure_command_v2',[A,future,'treasure',{}])).error==='adventure_cancelled','cancelled journey never pays');
  // Locked/paid-only categories cannot enter even if every other product is gone.
  await db.exec("update catalog_items set plus_only=false where category in('outfits','wallpapers','couple_dolls')");
  const blocked=await journey();check((await metadata(blocked)).treasureCoins===100,'outfits/wallpapers/Plushies never enter the pool');
  // Exactly one item + two coin tickets; exercise the actual selector repeatedly.
  await query('update catalog_items set plus_only=false where stable_id=$1',[candidate]);
  const drawing=await journey(),tally={item:0,50:0,100:0};
  await db.exec('select setseed(0.251)');
  for(let i=0;i<450;i++){
    await query("update adventure_encounter_plans set snapshot=snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins' where adventure_id=$1",[drawing]);
    await rpc('prepare_adventure_encounters_v2',[A]);const m=await metadata(drawing);
    tally[m.treasureSnapshot?'item':m.treasureCoins]++;
  }
  check(Object.values(tally).every(n=>n>105&&n<195),'N=1 yields three equally weighted tickets, not a 50% coin category');
  // Freeze a real item, then obtain it elsewhere while Adventure is running.
  await query("update adventure_encounter_plans set snapshot=snapshot||jsonb_build_object('treasureSnapshot',(select to_jsonb(c) from catalog_items c where stable_id=$2),'treasureCoins',0) where adventure_id=$1",[drawing,candidate]);
  await query("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,candidate]);
  const duplicate=await rpc('adventure_command_v2',[A,drawing,'treasure',{}]);
  check(duplicate.coins===100&&duplicate.itemId===null,'item acquired after reservation converts to 100 coins instead of a no-op inventory grant');
  check(await balance(A)===200,'duplicate compensation credits exactly 100');
  await rpc('adventure_command_v2',[A,drawing,'treasure',{}]);check(await balance(A)===200,'compensation retry idempotent');
  const coin50=await journey();
  await query("update adventure_encounter_plans set snapshot=snapshot||'{\"treasureSnapshot\":null,\"treasureCoins\":50}'::jsonb where adventure_id=$1",[coin50]);
  check((await rpc('adventure_command_v2',[A,coin50,'treasure',{}])).coins===50,'50-coin ticket grants exactly 50');
  // An internal wallet refusal must abort the entire statement, not consume Claim.
  const failing=await journey();
  await db.exec('alter function change_carrot_balance_v1(uuid,integer,text,text,text,text) rename to real_wallet_255');
  await db.exec("create function change_carrot_balance_v1(uuid,integer,text,text,text,text) returns jsonb language sql as $$select '{\"error\":\"test_failure\"}'::jsonb$$");
  await assert.rejects(()=>rpc('adventure_command_v2',[A,failing,'treasure',{}]),/treasure_wallet_failed/);
  check((await query('select count(*)::int n from adventure_results where adventure_id=$1',[failing]))[0].n===0,'failed wallet rolls back settlement and claim marker atomically');
  await db.exec('drop function change_carrot_balance_v1(uuid,integer,text,text,text,text);alter function real_wallet_255(uuid,integer,text,text,text,text) rename to change_carrot_balance_v1');
  check((await rpc('adventure_command_v2',[A,failing,'treasure',{}])).coins===100,'safe retry succeeds after transient wallet failure');
  // V3 chests never receive coin metadata; they retain legacy presentation.
  const old=await journey(A,3);check((await metadata(old)).treasureCoins===0,'old-client chest never receives unsupported coin reward');
  const oldReceipt=await rpc('adventure_command_v2',[A,old,'treasure',{}]);check(oldReceipt.applied&&oldReceipt.coins===undefined,'legacy V3 claim remains supported');
  // Actual start path: no friend gifts left does not block a V4 coin chest.
  const record=randomUUID();await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[record,A]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[A,record]);
  await query("update adventures set status='completed' where user_id=$1 and status in('in_progress','interaction_required','result_ready')",[A]);
  const start=await rpc('start_adventure_v4',[A,record,'start-v4']);
  check(start.applied,'real V4 start works after friend gift exhaustion');
  const startPlan=await metadata(start.adventureId);check(startPlan.treasureVersion===4&&startPlan.treasureCoins===100&&!startPlan.friendSnapshot,'coin-only chest prepared without inventing a friend encounter');
  const again=await rpc('start_adventure_v4',[A,record,'start-v4']);check(again.applied===false&&JSON.stringify(await metadata(start.adventureId))===JSON.stringify(startPlan),'start retry never rerolls frozen outcome');
  // Paired flow still owns an independent friend conversation and collection gift.
  await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[B,C]);
  const pairedRecord=randomUUID();await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[pairedRecord,B]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[B,pairedRecord]);
  const paired=await rpc('start_adventure_v4',[B,pairedRecord,'paired-v4']);check(paired.applied,'paired V4 starts normally');
  const friend=await metadata(paired.adventureId);check(!!friend.friendSnapshot&&!!friend.giftSnapshot&&!!friend.dialogue,'existing friend selection supplies the same separate dialogue and gift');
  await query("update adventures set ends_at=now()-interval '1 second' where id=$1",[paired.adventureId]);
  await query("update adventure_encounter_plans set snapshot=snapshot||'{\"treasureSnapshot\":null,\"treasureCoins\":50}'::jsonb where adventure_id=$1",[paired.adventureId]);
  check((await rpc('adventure_command_v2',[B,paired.adventureId,'claim',{}])).error==='treasure_required','final gift cannot skip the chest stage');
  check((await rpc('adventure_command_v2',[B,paired.adventureId,'treasure',{}])).coins===50,'paired chest credits the selected coins');
  check((await rpc('adventure_command_v2',[B,paired.adventureId,'claim',{}])).error==='interaction_required','coin reward does not bypass required friend dialogue');
  await rpc('adventure_command_v2',[B,paired.adventureId,'respond',{choiceId:friend.dialogue.choices[0].id}]);
  check((await rpc('adventure_command_v2',[B,paired.adventureId,'claim',{}])).itemId===friend.giftSnapshot.stable_id,'friend still grants original collection gift after the dialogue');
  check(await balance(B)===50,'friend gift claim does not credit chest coins again');
  check((await query('select count(*)::int n from user_inventory where owner_id=$1 and item_id=$2',[B,friend.giftSnapshot.stable_id]))[0].n===1,'friend gift remains exactly once');
  // A newly published eligible item automatically restores physical rewards.
  await query('delete from user_inventory where owner_id=$1 and item_id=$2',[C,candidate]);
  const physical=await journey(C);
  await query("update adventure_encounter_plans set snapshot=snapshot||jsonb_build_object('treasureSnapshot',(select to_jsonb(c) from catalog_items c where stable_id=$2),'treasureCoins',0) where adventure_id=$1",[physical,candidate]);
  const physicalReceipt=await rpc('adventure_command_v2',[C,physical,'treasure',{}]);
  check(physicalReceipt.itemId===candidate&&physicalReceipt.coins===0,'unowned physical item grants inventory, not money');
  check(await balance(C)===0,'physical receipt does not invent coin reward');
  check((await query("select bool_and(not has_function_privilege('authenticated',oid,'execute')) ok from pg_proc where proname in('start_adventure_v4','adventure_command_v2','adventure_command_before_coins_v4')"))[0].ok,'new monetary functions are service-only');
  // Exercise the emergency pause itself: new starts become V3, frozen V4
  // receipts remain fully payable, and no balances/claims are rolled back.
  await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text);insert into supabase_migrations.schema_migrations values('20261021000255')");
  await db.exec(fs.readFileSync('tools/rollback-adventure-treasure-255.sql','utf8'));
  const D='44444444-4444-4444-8444-444444444444',rollbackRecord=randomUUID();
  await query('insert into profiles(id) values($1)',[D]);
  await query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[rollbackRecord,D]);
  await query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[D,rollbackRecord]);
  const paused=await rpc('start_adventure_v4',[D,rollbackRecord,'paused-new-start']);
  check(paused.applied&&(await metadata(paused.adventureId)).treasureVersion===3,'emergency pause sends only future starts to legacy-safe physical chests');
  await query("update adventures set ends_at=now()-interval '1 second' where id=$1",[start.adventureId]);
  check((await rpc('adventure_command_v2',[A,start.adventureId,'treasure',{}])).coins===100,'emergency pause preserves outstanding frozen coin claims');
  console.log(JSON.stringify({passed:true,assertions,tickets:tally}));
}finally{await db.close();}
