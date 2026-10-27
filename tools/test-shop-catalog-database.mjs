// Isolated PostgreSQL regression. Never connects to a production database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {seedLegacyRoomPhotos} from './test-burrow-room-photo-cleanup-database.mjs';
if(!process.env.BURROW_PGLITE_PATH)throw Error('Set BURROW_PGLITE_PATH to an isolated PGlite runtime');
const {PGlite}=await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href),db=new PGlite();
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,args)=> (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const migration=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
const clone=x=>JSON.parse(JSON.stringify(x)),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let assertions=0;const check=(v,m)=>{assert.ok(v,m);assertions++;};
try{
 const legacy=fs.readFileSync('tools/test-burrow-game-room.mjs','utf8');
 await db.exec(legacy.match(/await db.exec\(`\n([\s\S]*?)`\);/)[1]);
 for(const [,suffix]of legacy.match(/for\(const suffix of (\[[\s\S]*?\])\)/)[1].matchAll(/'([^']+)'/g)){
  if(suffix.startsWith('130_'))await seedLegacyRoomPhotos({db,rpc});
  await db.exec(migration('20260920000'+suffix));
 }
 for(const name of ['20261001000149_burrow_shop_room_checkout','20261004000155_burrow_named_art_and_wallpapers',
  '20261008000203_burrow_shop_pricing','20261008000205_burrow_per_toy_photos',
  '20261009000212_burrow_partner_room_care','20261010000213_adventure_encounter_foundation',
  '20261010000214_adventure_friends_content','20261010000215_adventure_encounter_runtime',
  '20261010000216_burrow_kettle_shop','20261011000218_adventure_treasure_furniture',
  '20261011000219_adventure_unified_settlement','20261015000240_adventure_arrival_display',
  '20261021000255_adventure_treasure_coins'])await db.exec(migration(name));
 const untouched=await query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in('purchase_catalog_item_v1','change_carrot_balance_v1','adventure_command_v2','prepare_adventure_friend_gifts_v2') order by proname");
 await db.exec(migration('20261022000259_bundled_shop_catalog'));
 assert.deepEqual(await query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in('purchase_catalog_item_v1','change_carrot_balance_v1','adventure_command_v2','prepare_adventure_friend_gifts_v2') order by proname"),untouched);
 check(true,'financial, claim and friend writers unchanged');
 check(await rpc('burrow_shop_item_supported_v1',['anything',null]),'migration alone changes no eligibility');
 const release=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
 const id=release.products.find(p=>p.category==='lamps'&&p.status==='active'&&p.seed.price>0).id;
 await query('update catalog_items set price=777,plus_only=true where stable_id=$1',[id]);
 await query('insert into profiles(id) values($1),($2)',[A,B]);
 await query("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,id]);
 await query("insert into adventure_encounter_plans(user_id,status,snapshot) values($1,'reserved','{\"treasureReserved\":true,\"treasureCoins\":50,\"giftSnapshot\":{\"id\":\"friend\"}}')",[A]);
 const applied=await rpc('publish_burrow_shop_catalog_v1',[release]);check(applied.applied,'baseline atomically published');
 check(!(await rpc('publish_burrow_shop_catalog_v1',[release])).applied,'publication replay idempotent');
 const item=(await query('select * from catalog_items where stable_id=$1',[id]))[0];
 check(item.price===777&&item.plus_only,'Admin prices/Plus retained');
 check((await query('select count(*) n from user_inventory where item_id=$1',[id]))[0].n===1,'owned inventory retained');
 const plan=(await query('select snapshot from adventure_encounter_plans where user_id=$1',[A]))[0].snapshot;
 check(!plan.treasureReserved&&plan.giftSnapshot.id==='friend','refresh only unstarted chest, not friend');
 await assert.rejects(()=>query('delete from catalog_items where stable_id=$1',[id]),/Retire products/);assertions++;
 await assert.rejects(()=>query("update catalog_items set category='tables' where stable_id=$1",[id]),/identity cannot change/);assertions++;
 const bad=clone(release);bad.release='a'.repeat(64);bad.clients[bad.release]=release.clients[release.release];bad.products=bad.products.filter(p=>p.id!==id);
 await assert.rejects(()=>rpc('publish_burrow_shop_catalog_v1',[bad]),/Missing permanent product/);assertions++;
 const reused=clone(release);reused.release='b'.repeat(64);reused.clients[reused.release]=release.clients[release.release];reused.products.find(p=>p.id===id).category='tables';
 await assert.rejects(()=>rpc('publish_burrow_shop_catalog_v1',[reused]),/identity reused/);assertions++;
 const next=clone(release);next.release='c'.repeat(64);next.products.find(p=>p.id===id).status='retired';
 const toy=next.products.find(p=>p.category==='couple_dolls'&&p.status==='active'&&!p.metadata.starter);toy.status='retired';
 const fresh=clone(next.products.find(p=>p.id===id));fresh.id='test:permanent-new-lamp';fresh.status='active';fresh.seed.plusOnly=false;fresh.seed.price=100;
 next.products.push(fresh);next.clients[next.release]=[...release.clients[release.release],fresh.id];
 await rpc('publish_burrow_shop_catalog_v1',[next]);
 check(!(await rpc('burrow_shop_item_supported_v1',[fresh.id,null])),'old/no-header client excludes new prize');
 check(!(await rpc('burrow_shop_item_supported_v1',[fresh.id,'unknown'])),'unknown client fails to legacy');
 check(await rpc('burrow_shop_item_supported_v1',[fresh.id,next.release]),'new supported bundle includes new prize');
 check((await query('select status from catalog_items where stable_id=$1',[id]))[0].status==='retired','retirement published');
 check(!(await rpc('solo_burrow_loadout_v1',[A,{lamp:id}])).error,'owned retired placement still works');
 check((await rpc('solo_burrow_loadout_v1',[B,{lamp:id}])).error==='item_not_owned','retirement never bypasses ownership');
 check((await rpc('solo_burrow_purchase_v1',[B,id,'retired-purchase'])).error,'retired cannot be purchased');
 await query("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,toy.id]);
 check(await rpc('burrow_toy_photo_target_allowed_v1',[A,A,toy.id,null]),'owned retired Plushie still accepts a face');
 check(!(await rpc('burrow_toy_photo_target_allowed_v1',[B,B,toy.id,null])),'retired Plushie photo never bypasses ownership');
 await query("update app_config set value='true' where key in('app_major_update_enabled','adventure_friends_v2_enabled')");
 await query("insert into user_inventory(owner_id,item_id,source) select $1,stable_id,'adventure' from catalog_items where 'adventure_v2_gift'=any(tags) on conflict do nothing",[A]);
 await query("update catalog_items set plus_only=true where item_type='decor' and stable_id<>$1",[fresh.id]);
 await query("delete from adventure_encounter_plans where user_id=$1",[A]);
 const adventure=(await query("insert into adventures(user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key) values($1,$1,current_date-100,'in_progress',now(),now()+interval '1 hour',3600,(select value from app_config where key='app_major_update_content_revision'),'frozen') returning id",[A]))[0].id;
 await query("insert into adventure_encounter_plans(user_id,adventure_id,status,snapshot) values($1,$2,'bound','{\"encounterV2\":true,\"treasureVersion\":4}')",[A,adventure]);
 await rpc('prepare_adventure_encounters_v2',[A]);
 check((await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[adventure]))[0].snapshot.treasureCoins===100,'real legacy selector falls back to 100 coins, not unsupported art');
 let seenNew=false;
 for(let i=0;i<25&&!seenNew;i++){
  await query("update adventure_encounter_plans set snapshot=(snapshot-'treasureReserved'-'treasureSnapshot'-'treasureCoins')||jsonb_build_object('catalogRelease',$2::text) where adventure_id=$1",[adventure,next.release]);
  await rpc('prepare_adventure_encounters_v2',[A]);
  seenNew=(await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[adventure]))[0].snapshot.treasureSnapshot?.stable_id===fresh.id;
 }
 check(seenNew,'real current-bundle selector can award new furniture');
 const frozen=(await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[adventure]))[0].snapshot;
 await rpc('rollback_burrow_shop_catalog_v1',[release.release]);
 check((await query('select status from catalog_items where stable_id=$1',[fresh.id]))[0].status==='retired','rollback retires rather than destroys new identities');
 assert.deepEqual((await query('select snapshot from adventure_encounter_plans where adventure_id=$1',[adventure]))[0].snapshot,frozen);assertions++;
 check((await query('select price,plus_only from catalog_items where stable_id=$1',[id]))[0].price===777,'rollback preserves live Admin pricing');
 for(const role of ['anon','authenticated'])check(!(await query("select has_function_privilege($1,'public.publish_burrow_shop_catalog_v1(jsonb)','execute') allowed",[role]))[0].allowed,'publication inaccessible to '+role);
 const corrupt=clone(next);corrupt.release='d'.repeat(64);corrupt.products[0].title='SHOULD ROLLBACK';corrupt.clients[corrupt.release]=['does-not-exist'];
 await assert.rejects(()=>rpc('publish_burrow_shop_catalog_v1',[corrupt]),/Unknown supported product/);assertions++;
 check(!(await query("select 1 from catalog_items where title='SHOULD ROLLBACK'")).length,'late failure rolls back all catalog edits');
 console.log(JSON.stringify({assertions,isolated:true,productionWrites:false}));
}catch(error){console.error('Catalog database regression failed after '+assertions+': '+error.stack);process.exitCode=1;}
finally{await db.close();}
