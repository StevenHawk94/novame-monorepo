/** Offline PostgreSQL integration tests. Never opens a network/database connection.
 * BURROW_PGLITE_PATH may point to an existing isolated install of @electric-sql/pglite.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testAdventureContent } from './test-burrow-adventure-database.mjs';
import { testCharacterState } from './test-burrow-character-database.mjs';
import { testMemoryPhotos } from './test-burrow-memory-photos-database.mjs';
import { testMemorySync } from './test-burrow-sync-database.mjs';
import { testRoomPhotoCleanup, seedLegacyRoomPhotos } from './test-burrow-room-photo-cleanup-database.mjs';
import { testHistory } from './test-burrow-history-database.mjs';
import { testContentEditor } from './test-burrow-content-database.mjs';
import { testPhase9Lifecycle } from './test-burrow-phase9-database.mjs';
import { testCoins } from './test-burrow-coins-database.mjs';

const runtime = process.env.BURROW_PGLITE_PATH;
if (!runtime) throw new Error('Set BURROW_PGLITE_PATH to the installed PGlite dist/index.js path.');
const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
const db = new PGlite();
const a='00000000-0000-0000-0000-000000000001';
const b='00000000-0000-0000-0000-000000000002';
const c='00000000-0000-0000-0000-000000000003';
let tests=0;
const check=(condition,message)=>{assert.ok(condition,message);tests++;};
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
async function rpc(name,args) {
  const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
  return (await query(`select public.${name}(${placeholders}) as result`,args))[0].result;
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create schema realtime;
    create table public.test_broadcasts(payload jsonb,event text,topic text,private boolean);
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as
      $$ insert into public.test_broadcasts values(payload,event,topic,private) $$;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic',true) $$;
    create table realtime.messages(id int);
    alter table realtime.messages enable row level security;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create table public.profiles(id uuid primary key,subscription_tier text default 'free',timezone_name text default 'UTC',display_name text,avatar_url text);
    create table public.pairings(user_id uuid primary key references profiles,partner_user_id uuid references profiles);
    create table public.app_config(key text primary key,value text,updated_by text,updated_at timestamptz default now());
    create table public.reflects(id uuid primary key,user_id uuid references profiles,journal_kind text,body text default '',local_date date default current_date);
    create table public.reflect_drafts(id uuid primary key default gen_random_uuid(),user_id uuid references profiles,finalized_reflect_id uuid references reflects);
    create table public.items(id text primary key,category text not null);
    create table public.reflect_items(reflect_id uuid references reflects,user_id uuid references profiles,item_id text references items);
    create table public.kit_completions(id uuid primary key default gen_random_uuid(),user_id uuid references profiles,
      kit text,period_key text,payload jsonb default '{}',local_date date,created_at timestamptz default now(),unique(user_id,kit,period_key));
    create table public.monster_battle_progress(user_id uuid references profiles,monster_id text,points bigint default 0,
      milestones_paid int default 0,updated_at timestamptz default now(),primary key(user_id,monster_id));
  `);
  for(const suffix of [
    '116_app_major_update_foundation','117_app_major_update_interactions',
    '118_app_major_update_placeholder_content','119_app_major_update_commands',
    '120_app_major_update_rewards_and_shop',
    '121_burrow_interactive_screens',
    '122_burrow_records_memories_and_special_quests',
    '123_burrow_room_activity',
    '124_burrow_rage_rewards',
    '125_burrow_personalization',
    '126_burrow_adventure_content',
    '127_burrow_character_state',
    '128_burrow_memory_photos',
    '129_burrow_sync_and_memory_outbox',
    '130_burrow_room_photo_cleanup',
    '132_burrow_history',
    '133_burrow_content_editor',
    '134_burrow_accessible_affection',
    '135_burrow_photo_pair_binding',
    '136_burrow_pair_adventure_lifecycle',
    '137_burrow_pair_generation',
    '139_burrow_coin_purchases',
  ]) {
    if(suffix.startsWith('130_'))await seedLegacyRoomPhotos({db,rpc});
    await db.exec(readFileSync(resolve(`supabase/migrations/20260920000${suffix}.sql`),'utf8'));
  }
  await db.query('insert into profiles(id) values($1),($2),($3)',[a,b,c]);
  await db.query('insert into pairings values($1,$2),($2,$1)',[a,b]);
  const first=await rpc('change_carrot_balance_v1',[a,500,'fixture',null,null,'seed']);
  check(first.balance===500,'credits new wallet');
  const replay=await rpc('change_carrot_balance_v1',[a,500,'fixture',null,null,'seed']);
  check(replay.delta===0 && replay.applied===false,'replay pays zero');
  check((await rpc('change_carrot_balance_v1',[a,800,'fixture',null,null,'seed'])).error==='idempotency_conflict','rejects key reuse with different amount');
  const bought=await rpc('purchase_catalog_item_v1',[a,a,'placeholder_windows_02','purchase-1']);
  check(bought.balance===380,'atomic purchase debits server price');
  check((await rpc('purchase_catalog_item_v1',[a,a,'placeholder_windows_02','purchase-2'])).error==='already_owned','second key cannot double buy');
  check((await rpc('purchase_catalog_item_v1',[a,c,'placeholder_windows_02','wrong-partner'])).error==='not_paired','cannot gift unrelated user');
  const gift=await rpc('purchase_catalog_item_v1',[a,b,'placeholder_windows_02','gift-1']);
  check(Boolean(gift.giftId),'creates pending gift');
  check((await rpc('claim_gift_v1',[c,gift.giftId])).error==='not_paired','recipient scope enforced');
  check((await rpc('claim_gift_v1',[b,gift.giftId])).applied===true,'gift can be claimed');
  check((await rpc('claim_gift_v1',[b,gift.giftId])).applied===false,'gift claim is idempotent');
  check((await rpc('complete_affection_v1',[a,'hug',{},'hug-empty'])).error==='invalid_request','incomplete gesture rejected');
  const love=await rpc('complete_affection_v1',[a,'hug',{durationMs:3000},'hug-1']);
  check(love.reward===10,'first affection grants 10');
  check((await rpc('complete_affection_v1',[a,'kiss',{scale:1.5},'kiss-1'])).error==='cooldown_active','six types share cooldown');
  await db.query("update profiles set subscription_tier='plus' where id=$1",[b]);
  const secondLove=await rpc('complete_affection_v1',[a,'kiss',{scale:1.5},'kiss-1']);
  check(secondLove.reward===0 && secondLove.applied===true,'shared Plus bypasses cooldown without duplicate daily reward');
  await db.query("insert into room_needs(owner_id,water_updated_at) values($1,now()-interval '10 minutes')",[b]);
  const water=await rpc('interact_room_need_v1',[a,b,'water','water-1']);
  check(water.previousValue===98 && water.reward===5,'timestamp decay and first partner water reward');
  await db.query("update room_needs set water_updated_at=now()-interval '10 minutes' where owner_id=$1",[b]);
  check((await rpc('interact_room_need_v1',[a,b,'water','water-1'])).applied===false,'old retry cannot refill again');
  check((await rpc('interact_room_need_v1',[a,b,'water','water-2'])).reward===0,'second refill does not pay daily reward twice');
  check((await rpc('start_adventure_v1',[a,null,'adventure-1'])).error==='record_required','cannot adventure without a finalized own record');
  const record='10000000-0000-0000-0000-000000000001';
  await db.query("insert into reflects(id,user_id,journal_kind) values($1,$2,'write_freely')",[record,a]);
  await db.query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[a,record]);
  const adventure=await rpc('start_adventure_v1',[a,record,'adventure-1']);
  check(adventure.durationSeconds===7200,'shared Plus starts a two-hour adventure');
  check((await rpc('start_adventure_v1',[a,record,'adventure-1'])).applied===false,'adventure start replays');
  check((await rpc('start_adventure_v1',[a,record,'adventure-2'])).error==='daily_adventure_used','daily limit enforced');
  check((await rpc('settle_adventure_v1',[a,adventure.adventureId])).error==='not_ready','device cannot prematurely settle');
  await db.query("update adventures set ends_at=now()-interval '1 second' where id=$1",[adventure.adventureId]);
  const reward=await rpc('settle_adventure_v1',[a,adventure.adventureId]);
  check(Boolean(reward.resultId),'expired adventure creates durable result');
  check((await rpc('settle_adventure_v1',[a,adventure.adventureId])).resultId===reward.resultId,'retry cannot reroll result');
  const quests=await rpc('assign_daily_quests_v1',[a]);
  check(quests.quests.length===3,'assigns three quests');
  check(!quests.quests.some(q=>q.questId==='play_game'),'unavailable game excluded');
  const q=quests.quests.find(q=>!q.completedAt);
  check((await rpc('claim_daily_quest_v1',[a,q.assignmentId])).error==='not_completed','cannot claim incomplete quest');
  await rpc('advance_daily_quest_v1',[a,q.questId,1]);
  check((await rpc('claim_daily_quest_v1',[a,q.assignmentId])).reward===10,'completed daily pays ten');
  check((await rpc('claim_daily_quest_v1',[a,q.assignmentId])).applied===false,'daily reward replays');
  const ledger=await query('select sum(delta)::int total from currency_ledger where user_id=$1',[a]);
  const wallet=await query('select carrot_balance from wallets where user_id=$1',[a]);
  check(ledger[0].total===wallet[0].carrot_balance,'wallet reconciles with immutable ledger');
  // Force the combined item+friend branch independently of random UUID seeds.
  await db.query(`update adventure_results set friend_id='friend_mr_mole_v1', metadata=metadata||jsonb_build_object('friendContent',
    (select to_jsonb(c) from friend_content c where friend_id='friend_mr_mole_v1' and content_type='question' order by position limit 1)) where adventure_id=$1`,[adventure.adventureId]);
  reward.friendId='friend_mr_mole_v1';
  const claimed=await rpc('claim_adventure_result_v1',[a,adventure.adventureId]);
  check(!claimed.error && claimed.applied===true,'durable adventure reward can be claimed');
  if(reward.friendId){
    check((await rpc('complete_friend_interaction_v1',[a,adventure.adventureId,{choiceId:'forged'}])).error==='invalid_response','unknown friend answer rejected');
    const choices=await query("select choices from friend_content where friend_id=$1 and content_type='question' order by position limit 1",[reward.friendId]);
    check((await rpc('complete_friend_interaction_v1',[a,adventure.adventureId,{choiceId:choices[0].choices[0].id}])).applied===true,'mandatory friend response completes adventure');
  }
  check((await rpc('claim_adventure_result_v1',[a,adventure.adventureId])).applied===false,'reward replay grants no second item');
  check((await rpc('burrow_bootstrap_v1',[a])).error==='feature_disabled','rollout fails closed before initialization');
  await db.exec("update app_config set value='true' where key='app_major_update_enabled'");
  const snapshot=await rpc('burrow_bootstrap_v1',[a]);
  check(snapshot.partner.id===b && snapshot.catalog.length>30,'paired bootstrap returns scoped catalog snapshot');
  check(snapshot.inventory.some(i=>i.item_id==='placeholder_frames_01'),'starter decoration initialized');
  check((await rpc('burrow_bootstrap_v1',[c])).error==='not_paired','unpaired bootstrap cannot read rooms');
  check((await rpc('save_room_loadout_v1',[a,'home',{window:'placeholder_windows_02'}])).applied===true,'owned fixed slot can be saved');
  check((await rpc('save_room_loadout_v1',[a,'home',{lamp:'placeholder_windows_02'}])).error==='invalid_loadout','wrong slot is rejected');
  check((await rpc('save_room_loadout_v1',[a,'home',{lamp:'placeholder_lamps_02'}])).error==='item_not_owned','unowned preview cannot be saved');
  check((await rpc('save_room_loadout_v1',[a,'home',{}])).applied===true,'reset can save an empty loadout');
  const memory=await rpc('save_memory_room_entry_v1',[a,null,'We walked home in the rain.','memory_prompt_01','memory-1']);
  check(Boolean(memory.entryId),'creates a private paired memory');
  check((await rpc('save_memory_room_entry_v1',[a,null,'We walked home in the rain.','memory_prompt_01','memory-1'])).applied===false,'memory create retries are idempotent');
  check((await rpc('save_memory_room_entry_v1',[b,memory.entryId,'Changed by partner',null,'edit-1'])).error==='not_found','partner cannot edit author memory');
  check((await rpc('delete_memory_room_entry_v1',[b,memory.entryId])).error==='not_found','partner cannot delete author memory');
  check((await rpc('delete_memory_room_entry_v1',[a,memory.entryId])).applied===true,'author can delete memory');
  check(!(await rpc('burrow_bootstrap_v1',[a])).memoryEntries.some(e=>e.id===memory.entryId),'deleted memory disappears from shared feed');
  await db.query("update profiles set subscription_tier='free' where id=$1",[b]);
  check((await rpc('set_room_sleep_v1',[a,true,'sleep-1'])).applied===true,'Free member can put their bunny to sleep');
  check((await rpc('set_room_sleep_v1',[b,true,'sleep-b'])).applied===true,'partner can independently sleep');
  let shared=await rpc('burrow_bootstrap_v1',[a]);
  check(shared.sharedRoom.mySleeping && shared.sharedRoom.partnerSleeping,'both sleep states persist in paired snapshot');
  check((await rpc('set_room_sleep_v1',[a,false,'wake-1'])).applied===true,'bed toggles awake without disturbing partner');
  check((await rpc('set_room_sleep_v1',[a,true,'sleep-1'])).applied===false,'delayed sleep replay cannot undo later wake');
  shared=await rpc('burrow_bootstrap_v1',[a]);
  check(!shared.sharedRoom.mySleeping && shared.sharedRoom.partnerSleeping,'late retry preserved latest state');
  check((await rpc('set_room_sleep_v1',[a,false,'sleep-1'])).error==='idempotency_conflict','sleep key rejects changed payload');
  check((await rpc('set_room_sleep_v1',[c,true,'sleep-c'])).error==='not_paired','unpaired member cannot update sleep');
  check((await rpc('save_room_loadout_v1',[a,'our',{}])).error==='plus_required','Free sleep does not bypass Plus decoration');
  const visit=shared.friendVisit;
  check(!!visit && visit.friend_id==='friend_mr_mole_v1','only a completed discovered friend can visit');
  await db.query("update profiles set timezone_name='Pacific/Auckland' where id=$1",[b]);
  check((await rpc('burrow_bootstrap_v1',[b])).friendVisit.id===visit.id,'different partner timezone shares the same daily visit');
  await db.query("update profiles set timezone_name='UTC' where id=$1",[b]);
  check((await rpc('respond_friend_visit_v1',[c,visit.id,{acknowledged:true}])).error==='not_paired','unrelated actor cannot claim visitor');
  const question={content_type:'question',prompt:'Keep a little story?',choices:[{id:'keep',label:'Keep it'}],feedback:{keep:'A bright little memory.'}};
  await db.query('update friend_visits set content_snapshot=$1 where id=$2',[question,visit.id]);
  check((await rpc('respond_friend_visit_v1',[a,visit.id,{choiceId:'forged'}])).error==='invalid_response','visit rejects forged choices');
  const beforeVisit=(await query('select carrot_balance from wallets where user_id=$1',[a]))[0].carrot_balance;
  const visitReward=await rpc('respond_friend_visit_v1',[a,visit.id,{choiceId:'keep'}]);
  check(!!visitReward.itemId && visitReward.feedback==='A bright little memory.','valid visit grants tagged item and snapshot feedback');
  check((await query('select source from user_inventory where owner_id=$1 and item_id=$2',[a,visitReward.itemId]))[0].source==='friend_visit','NPC gift enters recipient collection');
  check((await query('select carrot_balance from wallets where user_id=$1',[a]))[0].carrot_balance===beforeVisit,'NPC visit grants no currency');
  check((await rpc('respond_friend_visit_v1',[b,visit.id,{choiceId:'keep'}])).applied===false,'partner cannot double claim shared visit');
  // Simulate a previous day without sleeping the test process. A recent friend
  // is excluded; the same friend becomes eligible after seven elapsed days.
  await db.query("update friend_visits set visit_date=current_date-1,completed_at=now()-interval '1 day' where id=$1",[visit.id]);
  check((await rpc('ensure_friend_visit_v1',[a])).visit===null,'same friend cannot revisit within seven days');
  await db.query("update friend_visits set created_at=now()-interval '8 days' where id=$1",[visit.id]);
  const returnVisit=(await rpc('ensure_friend_visit_v1',[a])).visit;
  check(!!returnVisit && returnVisit.id!==visit.id,'same friend can return after seven days');
  const help={content_type:'emotional_help',prompt:'Help?',choices:[{id:'yes',label:'Yes'},{id:'not_now',label:'Not now'}],feedback:{},rage_monster_id:'overthinking'};
  await db.query('update friend_visits set content_snapshot=$1 where id=$2',[help,returnVisit.id]);
  check((await rpc('respond_friend_visit_v1',[a,returnVisit.id,{choiceId:'yes'}])).battleRequired===true,'Yes requests matching Rage battle before any gift');
  check((await rpc('respond_friend_visit_v1',[a,returnVisit.id,{choiceId:'yes'}])).error==='battle_required','no gift from client-only battle claim');
  check((await rpc('submit_burrow_rage_v1',[a,'overthinking',1,['overthinking-final-original-1'],'rage-1'])).error==='invalid_request','incomplete battle cannot settle');
  const rage=await rpc('submit_burrow_rage_v1',[a,'overthinking',20,['overthinking-final-original-1'],'rage-1']);
  check(rage.carrotsAwarded===5 && rage.xp_awarded===0 && rage.milestoneBonus===0,'first Rage awards only five carrots, no legacy currency');
  check((await rpc('submit_burrow_rage_v1',[a,'overthinking',20,['overthinking-final-original-1'],'rage-1'])).carrotsAwarded===0,'Rage retry pays no second reward');
  check((await rpc('respond_friend_visit_v1',[b,returnVisit.id,{choiceId:'yes'}])).applied===true,'either partner can collect after verified matching battle');
  check((await rpc('submit_burrow_rage_v1',[a,'the_hollow',20,['the_hollow-final-original-4'],'rage-2'])).carrotsAwarded===0,'fourth reply is valid; second daily Rage grants no carrots');
  check((await rpc('submit_burrow_rage_v1',[a,'the_fog',20,['the_fog-final-original-1'],'rage-3'])).error==='daily_limit_reached','existing two-battle daily limit preserved');
  check((await query('select points from monster_battle_progress where user_id=$1 and monster_id=$2',[a,'overthinking']))[0].points===50,'Rage replay never doubles history points');
  // A visitor never rerolls its copy when a content editor replaces the library.
  const frozen=(await rpc('burrow_bootstrap_v1',[a])).friendVisit.content_snapshot.prompt;
  await db.query("update friend_content set prompt='Replacement story' where friend_id=$1",[returnVisit.friend_id]);
  check((await rpc('burrow_bootstrap_v1',[a])).friendVisit.content_snapshot.prompt===frozen,'existing visit keeps its saved content snapshot');
  await db.query("update friend_visits set visit_date=current_date-2,created_at=now()-interval '8 days',completed_at=now()-interval '2 days' where id=$1",[returnVisit.id]);
  const declinedVisit=(await rpc('ensure_friend_visit_v1',[a])).visit;
  await db.query('update friend_visits set visit_date=current_date-9 where id=$1',[visit.id]);
  await db.query("update friend_visits set content_snapshot=$1,visit_date=current_date-1 where id=$2",[help,declinedVisit.id]);
  check((await rpc('ensure_friend_visit_v1',[b])).visit.id===declinedVisit.id,'unanswered visitor persists across midnight rather than being replaced');
  const beforeDecline=(await query('select count(*) n from user_inventory'))[0].n;
  check((await rpc('respond_friend_visit_v1',[a,declinedVisit.id,{choiceId:'not_now'}])).declined===true,'No ends an emotional visit without starting a battle');
  check((await query('select count(*) n from user_inventory'))[0].n===beforeDecline,'declining gives no item');
  check((await rpc('respond_friend_visit_v1',[b,declinedVisit.id,{choiceId:'yes'}])).applied===false,'declined shared visit cannot be claimed by the partner');
  check((await rpc('ensure_friend_visit_v1',[a])).visit.id===declinedVisit.id,'ending yesterday’s pending visit consumes today’s shared visit');
  await db.query("update profiles set subscription_tier='plus' where id=$1",[b]);
  check((await rpc('claim_special_quest_v1',[a,'friends_met',1])).error==='not_completed','special reward requires actual progress');
  check((await rpc('register_adventure_record_v1',[a,record])).reward===10,'first finalized record grants carrots');
  check((await rpc('register_adventure_record_v1',[a,record])).reward===0,'record registration replay pays zero');
  await db.query("insert into user_inventory(owner_id,item_id,source) select users.id,c.stable_id,'fixture' from catalog_items c cross join (values($1::uuid),($2::uuid)) users(id) on conflict(owner_id,item_id) do nothing",[a,b]);
  check((await rpc('claim_special_quest_v1',[a,'items_collected',1])).reward===15,'special stage pays exactly fifteen');
  check((await rpc('claim_special_quest_v1',[a,'items_collected',1])).applied===false,'same special stage cannot be collected twice');
  const quietId=(await query("select md5(n::text)::uuid id from generate_series(1,30)n where get_byte(decode(md5(md5(n::text)::uuid::text),'hex'),0)%4<>0 limit 1"))[0].id;
  await db.query("insert into adventures(id,user_id,partner_id,local_date,status,started_at,ends_at,content_revision,idempotency_key) values($1,$2,$3,current_date-1,'in_progress',now()-interval '9 hours',now()-interval '1 hour','burrow-v1-placeholder','quiet-fixture')",[quietId,a,b]);
  check((await rpc('settle_adventure_v1',[a,quietId])).resultType==='quiet','exhausted pair catalog produces a finishable quiet result');
  check((await rpc('claim_adventure_result_v1',[a,quietId])).applied===true,'exhausted catalog never strands a pending adventure');
  const personalized=await rpc('burrow_bootstrap_v1',[a]);
  check(personalized.musicTrackId===null && personalized.roomPhotos.length===0,'music starts at None and photos start empty');
  check(personalized.catalog.filter(i=>i.item_type==='our_room'&&i.metadata.starter).length===5,'shared room has five independent default slots');
  check(personalized.inventory.some(i=>i.owner_id===a&&i.item_id==='placeholder_music_calm'),'free placeholder tune is seeded');
  await db.query("delete from user_inventory where owner_id=$1 and item_id='placeholder_music_dream'",[a]);
  check((await rpc('select_room_music_v1',[a,'placeholder_music_dream'])).error==='item_not_owned','unowned music cannot play');
  check((await rpc('select_room_music_v1',[a,'placeholder_windows_02'])).error==='item_not_owned','a decor item is not a music track');
  check((await rpc('select_room_music_v1',[a,'placeholder_music_calm'])).applied===true,'owned track selection persists');
  check((await rpc('burrow_bootstrap_v1',[b])).musicTrackId===null,'partner background music is independent');
  check((await rpc('select_room_music_v1',[a,null])).applied===true,'None clears the persisted track');
  check((await rpc('purchase_catalog_item_v1',[a,b,'placeholder_music_dream','music-gift'])).error==='not_tradable','tracks cannot be gifted');
  await rpc('change_carrot_balance_v1',[a,100,'fixture',null,null,'music-funds']);
  const musicBalance=(await query('select carrot_balance n from wallets where user_id=$1',[a]))[0].n;
  check((await rpc('purchase_catalog_item_v1',[a,a,'placeholder_music_dream','music-buy'])).balance===musicBalance-80,'music purchase uses authoritative wallet');
  check((await rpc('select_room_music_v1',[a,'placeholder_music_dream'])).applied===true,'purchased tune can be selected');
  const ourSlots=Object.fromEntries(personalized.catalog.filter(i=>i.item_type==='our_room'&&i.metadata.starter).map(i=>[i.metadata.slot,i.stable_id]));
  check((await rpc('save_room_loadout_v1',[a,'our',ourSlots])).applied===true,'five independent shared slots save with shared Plus');
  check((await rpc('save_room_loadout_v1',[a,'home',ourSlots])).error==='invalid_loadout','shared decor cannot contaminate home slots');
  const key=n=>`55555555-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const digest='a'.repeat(64);
  check((await rpc('prepare_room_photo_v1',[a,b,'frame',key(1),digest])).error==='invalid_request','partner cannot replace a frame');
  check((await rpc('prepare_room_photo_v1',[a,c,'doll',key(2),digest])).error==='invalid_request','unrelated room photo write rejected');
  check((await rpc('prepare_room_photo_v1',[a,a,'frame',key(1),'not-a-sha'])).error==='invalid_request','photo digest must be bounded SHA256');
  const frame=await rpc('prepare_room_photo_v1',[a,a,'frame',key(1),digest]);
  check(frame.path.startsWith(a+'/') && frame.committed===false,'authorized upload gets immutable actor-scoped path');
  check((await rpc('prepare_room_photo_v1',[a,a,'frame',key(1),digest])).ticketId===frame.ticketId,'retry reuses ticket and path');
  check((await rpc('prepare_room_photo_v1',[a,a,'frame',key(1),'b'.repeat(64)])).error==='idempotency_conflict','same request key cannot replace bytes');
  check((await rpc('complete_room_photo_v1',[b,frame.ticketId])).error==='not_found','other actor cannot complete upload ticket');
  check((await rpc('complete_room_photo_v1',[a,frame.ticketId])).applied===true,'frame commit publishes the room photo');
  const frame2=await rpc('prepare_room_photo_v1',[a,a,'frame',key(3),digest]);
  await rpc('complete_room_photo_v1',[a,frame2.ticketId]);
  check((await rpc('complete_room_photo_v1',[a,frame.ticketId])).applied===false,'late retry cannot overwrite a newer photo');
  const photo=(await rpc('burrow_bootstrap_v1',[b])).roomPhotos[0];
  check(!('private_path' in photo)&&!('path' in photo),'bootstrap contains metadata only, never a private path');
  check((await rpc('read_room_photo_v1',[b,photo.id])).path===frame2.path,'current partner can view latest frame');
  check((await rpc('read_room_photo_v1',[c,photo.id])).error==='not_paired','unrelated user cannot obtain photo path');
  const doll=await rpc('prepare_room_photo_v1',[a,b,'doll',key(4),digest]);
  const pendingDoll=await rpc('prepare_room_photo_v1',[a,a,'doll',key(5),digest]);
  check((await rpc('complete_room_photo_v1',[a,doll.ticketId])).applied===true,'actor can replace partner room doll');
  check((await rpc('complete_room_photo_v1',[a,pendingDoll.ticketId])).error==='daily_limit_reached','preexisting ticket cannot bypass daily cap in other room');
  check((await rpc('prepare_room_photo_v1',[a,a,'doll',key(6),digest])).error==='daily_limit_reached','new key cannot bypass doll cap');
  check((await rpc('prepare_room_photo_v1',[a,b,'doll',key(4),digest])).committed===true,'successful retry remains successful even after cap');
  check((await rpc('burrow_bootstrap_v1',[a])).dollChangeUsed===true,'bootstrap reports actor daily cap');
  const partnerDoll=await rpc('prepare_room_photo_v1',[b,a,'doll',key(7),digest]);
  check((await rpc('complete_room_photo_v1',[b,partnerDoll.ticketId])).applied===true,'partner has their own daily doll allowance');
  await db.query("update room_photo_uploads set committed_date=current_date-1 where actor_id=$1 and kind='doll'",[a]);
  check((await rpc('complete_room_photo_v1',[a,pendingDoll.ticketId])).applied===true,'next server local day permits one new saved doll');
  check((await query("select count(*)::int n from moment_events where actor_id=$1 and event_type='room_media_updated'",[a]))[0].n===4,'photo retries never duplicate Moments');
  await testAdventureContent({ db, query, rpc, check });
  await testCharacterState({ db, query, rpc, check });
  await testMemoryPhotos({ db, query, rpc, check });
  await testMemorySync({ db, query, rpc, check });
  await testRoomPhotoCleanup({ db, query, rpc, check });
  await testHistory({ db, query, rpc, check });
  await testContentEditor({ db, query, rpc, check });
  await testPhase9Lifecycle({ db, query, rpc, check });
  await testCoins({ db, query, rpc, check });
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',c]);
  await db.exec('set role authenticated');
  check((await query('select * from wallets')).length===0,'RLS hides other wallets');
  check((await query('select * from user_inventory')).length===0,'RLS hides unrelated inventories');
  check((await query('select * from shared_room_state')).length===0,'RLS hides unrelated shared sleep');
  check((await query('select * from friend_visits')).length===0,'RLS hides unrelated visits');
  check((await query('select id from room_photos')).length===0,'RLS hides unrelated photo metadata');
  await db.exec('reset role');
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',a]);
  await db.exec('set role authenticated');
  check((await query('select * from moment_events')).length>0,'paired member reads moments');
  check((await query('select id from room_photos')).length===3,'paired member reads both rooms’ photo metadata');
  check(!(await query("select has_column_privilege('authenticated','room_photos','private_path','select') allowed"))[0].allowed,'private storage paths cannot be read directly');
  await db.exec('reset role; delete from pairings');
  await db.exec('set role authenticated');
  check((await query('select * from moment_events')).length===0,'unpair revokes shared moments');
  check((await query('select * from shared_room_state')).length===0,'unpair revokes shared sleep');
  check((await query('select * from friend_visits')).length===0,'unpair revokes shared visits');
  check((await query('select id from room_photos')).length===0,'unpair revokes all pair photo metadata');
  await db.exec('reset role');
  check((await rpc('read_room_photo_v1',[a,photo.id])).error==='not_paired','unpair prevents issuing new signed photo URLs');
  check((await rpc('complete_room_photo_v1',[a,frame.ticketId])).error==='not_paired','unpair blocks upload completion including replay');
  console.log(`Burrow PostgreSQL integration: ${tests} assertions passed.`);
} catch (error) {
  console.error(`Burrow database test failed after ${tests} assertions: ${error.message}`);
  process.exitCode=1;
} finally { await db.close(); }
