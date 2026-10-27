// Apply the real migration chain against an offline PostgreSQL fixture, then
// exercise the actual nested Home bootstrap and private invalidation broadcast.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {seedLegacyRoomPhotos} from './test-burrow-room-photo-cleanup-database.mjs';
const {PGlite}=await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href);
const db=new PGlite();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const rpc=async(name,args)=>(await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const sql=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
try{
 const base=fs.readFileSync('tools/test-burrow-game-room.mjs','utf8');
 await db.exec(base.match(/await db.exec\(`\n([\s\S]*?)`\);/)[1]);
 // The production pairings table already has created_at; the old fixture does not.
 await db.exec('alter table pairings add column created_at timestamptz default now()');
 const list=base.match(/for\(const suffix of (\[[\s\S]*?\])\)/)[1];
 for(const [,suffix] of list.matchAll(/'([^']+)'/g)){
   if(suffix.startsWith('130_'))await seedLegacyRoomPhotos({db,rpc});
   await db.exec(sql('20260920000'+suffix));
 }
 for(const n of ['20261010000213_adventure_encounter_foundation','20261010000214_adventure_friends_content',
   '20261010000215_adventure_encounter_runtime','20261011000218_adventure_treasure_furniture',
   '20261011000219_adventure_unified_settlement','20261014000233_burrow_repair_history_isolation',
   '20261014000235_friend_visit_couple_runtime','20261014000236_friend_visit_workbook_content',
   '20261018000244_friend_visit_prepared_dialogue'])await db.exec(sql(n));
 const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
 await q("insert into profiles(id,display_name) values($1,'Alex'),($2,'Sam')",[A,B]);
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 await db.exec("update app_config set value='true' where key in('app_major_update_enabled','adventure_friends_v2_enabled')");
 assert.equal((await rpc('burrow_bootstrap_v1',[A])).friendVisit,null,'no Adventure unlock means no visitor');
 const adv=(await q("insert into adventures(user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key) values($1,$2,current_date,'completed',now(),now(),60,'burrow-v1-placeholder','unlock-visit') returning id",[A,B]))[0].id;
 await q("insert into user_friend_discoveries(user_id,friend_id,source_adventure_id,interaction_completed_at) values($1,'adventure_friend_mm',$2,now())",[A,adv]);
 assert.equal((await rpc('burrow_bootstrap_v1',[A])).coupleFriendVisit,null,'first Adventure meeting cannot immediately create a visitor');
 await q("update user_friend_discoveries set first_seen_at=now()-interval '2 days' where user_id=$1",[A]);
 const rawA=await rpc('burrow_bootstrap_v1',[A]),rawB=await rpc('burrow_bootstrap_v1',[B]);
 assert.equal(rawA.friendVisit,null,'legacy client projection cannot crash during rollout');
 const a={...rawA,friendVisit:rawA.coupleFriendVisit},b={...rawB,friendVisit:rawB.coupleFriendVisit};
 assert.equal(a.friendVisitsVersion,2);assert.ok(a.friendVisit);assert.equal(a.friendVisit.id,b.friendVisit.id);
 assert.equal(a.friendVisit.pairVersion,a.pairVersion);assert.ok(!JSON.stringify(a.friendVisit).includes('content_snapshot'));
 assert.equal(b.discoveries.filter(d=>d.user_id===B).length,0,'partner only sees collection unlocked after answer');
 const session=await rpc('prepare_friend_visit_v3',[B,b.friendVisit.id,b.pairVersion]);
 const result=await rpc('respond_friend_visit_v3',[B,b.friendVisit.id,session.sessionId,b.pairVersion,session.choices[0].id]);assert.ok(result.applied);
 assert.deepEqual(result.feedback,session.choices[0].feedback);assert.equal(result.reward,session.choices[0].reward);
 const rawRefreshed=await rpc('burrow_bootstrap_v1',[B]);const refreshed={...rawRefreshed,friendVisit:rawRefreshed.coupleFriendVisit};assert.ok(refreshed.discoveries.some(d=>d.user_id===B&&d.friend_id==='adventure_friend_mm'&&d.interaction_completed_at));
 assert.match(refreshed.friendVisit.waitingCopy,/Alex/);assert.equal(refreshed.friendVisit.myCompleted,true);
 await db.exec("update friend_definitions set status='retired' where stable_id<>'adventure_friend_mm'");
 await rpc('prepare_adventure_encounters_v2',[B]);
 const reserved=(await q('select * from adventure_encounter_plans where user_id=$1 order by id limit 1',[B]))[0];
 assert.equal(reserved.dialogue_id,'MM-02','actual wrapped selector skips Stranger after a room unlock');
 assert.equal(reserved.snapshot.treasureReserved,true,'chest reservation wrapper stays intact');
 const broadcasts=await q("select * from test_broadcasts where event='burrow_changed'");
 assert.ok(broadcasts.some(x=>x.topic==='burrow:'+A));assert.ok(broadcasts.some(x=>x.topic==='burrow:'+B));
 assert.ok(broadcasts.every(x=>JSON.stringify(x.payload)==='{}'),'invalidation never broadcasts answers');
 await q('delete from pairings where user_id in($1,$2)',[A,B]);
 await q('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 const rawRepaired=await rpc('burrow_bootstrap_v1',[A]);const repaired={...rawRepaired,friendVisit:rawRepaired.coupleFriendVisit};
 assert.notEqual(repaired.friendVisit.id,a.friendVisit.id);assert.notEqual(repaired.pairVersion,a.pairVersion);
 assert.equal((await rpc('respond_friend_visit_v2',[B,b.friendVisit.id,session.sessionId,b.pairVersion,session.choices[0].id])).error,'pair_changed');
 console.log('Friend visits: actual migration chain, nested Home bootstrap, Collection unlock, private broadcast and re-pair integration passed.');
}catch(error){console.error('Friend visit integration: '+error.message);process.exitCode=1;}finally{await db.close();}
