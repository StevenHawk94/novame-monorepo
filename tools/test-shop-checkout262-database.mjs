// Offline PostgreSQL only; never signs in as or modifies a production user.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {seedLegacyRoomPhotos} from './test-burrow-room-photo-cleanup-database.mjs';
const {PGlite}=await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href),db=new PGlite();
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,args)=> (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const migration=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
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
  '20261021000255_adventure_treasure_coins','20261022000259_bundled_shop_catalog'])await db.exec(migration(name));
 // Minimal wallet read dependencies; real purchase/ledger writers above remain intact.
 await db.exec(`alter table wallets add column if not exists version bigint not null default 0;
  alter table currency_ledger add column if not exists requested_delta integer;
  create table burrow_surprises(sender_id uuid,idempotency_key uuid,paid_at timestamptz,refunded_at timestamptz,sent_at timestamptz);`);
 await db.exec('alter table pairings add column created_at timestamptz default now()');
 await db.exec(migration('20261014000233_burrow_repair_history_isolation').split('-- Preserve every existing bootstrap feature')[0]+'\ncommit;');
 await db.exec(migration('20261022000262_shop_checkout_repair'));
 const release=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
 await rpc('publish_burrow_shop_catalog_v1',[release]);
 await query('insert into profiles(id) values($1),($2)',[A,B]);
 await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 await query("insert into wallets(user_id,carrot_balance) values($1,5000),($2,5000) on conflict(user_id) do update set carrot_balance=5000",[A,B]);
 const version=await rpc('burrow_pair_version_v1',[A,B]);
 const find=cat=>release.products.find(p=>p.category===cat&&p.status==='active'&&p.seed.price>0&&!p.seed.plusOnly&&!p.metadata.starter);
 const wall=find('wallpapers'),lamp=find('lamps'),vase=find('vases'),dress=find('outfits');
 const balance=async()=>Number((await query('select carrot_balance n from wallets where user_id=$1',[A]))[0].n);
 const buy=(changes,prices,total,key,scope=version)=>rpc('purchase_room_changes_v1',[A,B,scope,changes,prices,total,key,release.release]);
 // Production regression: legacy hidden default slots must not affect a delta.
 const legacyItem=(await query("select stable_id from catalog_items where metadata->>'slot'='decor' limit 1"))[0];
 if(legacyItem)await query("insert into room_loadouts(room_type,pair_low,pair_high,slot,item_id,updated_by) values('our',$1,$2,'decor',$3,$1)",[A,B,legacyItem.stable_id]);
 const start=await balance(),first=await buy({wallpaper:wall.id},{[wall.id]:wall.seed.price},wall.seed.price,'first');
 check(!first.error&&first.checkoutId==='first'&&first.total===wall.seed.price,'wallpaper checkout with obsolete defaults succeeds');
 check(await balance()===start-wall.seed.price,'exactly one debit');
 const replay=await buy({wallpaper:wall.id},{[wall.id]:wall.seed.price},wall.seed.price,'first');
 check(!replay.error&&!replay.applied&&await balance()===start-wall.seed.price,'lost receipt replay never charges twice');
 check((await buy({lamp:lamp.id},{[lamp.id]:lamp.seed.price},lamp.seed.price,'first')).error==='idempotency_conflict','same key cannot change payload');
 const partnerBuy=await rpc('purchase_room_changes_v1',[B,A,version,{lamp:lamp.id},{[lamp.id]:lamp.seed.price},lamp.seed.price,'partner',release.release]);
 check(!partnerBuy.error,'partner decorates separately');
 await buy({vase:vase.id},{[vase.id]:vase.seed.price},vase.seed.price,'vase');
 check((await query("select item_id from room_loadouts where room_type='our' and slot='lamp'"))[0].item_id===lamp.id,'delta preserves partner latest other slot');
 await buy({wallpaper:wall.id},{[wall.id]:wall.seed.price},wall.seed.price,'first');
 check((await query("select item_id from room_loadouts where room_type='our' and slot='vase'"))[0].item_id===vase.id,'replay never overwrites newer slots');
 const before=await balance();
 check((await buy({outfit:dress.id},{[dress.id]:dress.seed.price+1},dress.seed.price+1,'wrong-price')).error==='price_changed','price must match');
 check((await buy({outfit:dress.id},{[dress.id]:dress.seed.price},0,'not-approved')).error==='price_changed','never exceeds approved total');
 check((await buy({outfit:dress.id},{[dress.id]:dress.seed.price},dress.seed.price,'old-pair','0'.repeat(32))).error==='pair_changed','pair fence');
 check(await balance()===before,'rejected commands never debit');
 // First sub-purchase succeeds, second fails: whole command must roll back.
 const rollbackItems=release.products.filter(p=>p.status==='active'&&p.seed.price>0&&!p.seed.plusOnly&&!p.metadata.starter&&p.category==='lamps').slice(1,3);
 const lamp2=rollbackItems[0],outfit=release.products.filter(p=>p.category==='outfits'&&p.status==='active'&&p.seed.price>0&&!p.seed.plusOnly&&!p.metadata.starter)[1];
 await query('update catalog_items set plus_only=true where stable_id=$1',[outfit.id]);
 const failed=await buy({lamp:lamp2.id,outfit:outfit.id},{[lamp2.id]:lamp2.seed.price,[outfit.id]:outfit.seed.price},lamp2.seed.price+outfit.seed.price,'late-failure');
 check(failed.error==='plus_required','late purchase rejection returned as actionable error');
 check(await balance()===before,'late failure rolls back earlier debit');
 check(!(await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[A,lamp2.id])).length,'late failure rolls back earlier inventory');
 const itemReceipt=await rpc('purchase_catalog_item_scoped_v1',[A,B,version,A,dress.id,dress.seed.price,'self-buy',release.release]);
 check(!itemReceipt.error&&itemReceipt.purchaseId,'scoped self purchase');
 const giftItem=release.products.filter(p=>p.category==='lamps'&&p.status==='active'&&p.seed.price>0&&!p.seed.plusOnly&&!p.metadata.starter&&p.seed.tradable)[3];
 const gift=await rpc('purchase_catalog_item_scoped_v1',[A,B,version,B,giftItem.id,giftItem.seed.price,'gift-buy',release.release]);
 check(!gift.error&&gift.giftId,'scoped partner gift');
 const state=await rpc('burrow_reward_wallet_state_v1',[A]);
 check(state.spends.includes('shop-room:first')&&state.spends.includes('shop-item:self-buy')&&state.spends.includes('shop-item:gift-buy'),'wallet acknowledges pending spend reservations');
 await query("update catalog_items set status='retired' where stable_id=$1",[wall.id]);
 check((await rpc('save_room_loadout_v1',[A,'home',{wallpaper:wall.id}])).error==='invalid_loadout','retired placement compatibility removed');
 check((await buy({wallpaper:wall.id},{[wall.id]:wall.seed.price},0,'retired')).error==='invalid_loadout','retired delta rejected');
 check(!(await buy({wallpaper:wall.id},{[wall.id]:wall.seed.price},wall.seed.price,'first')).error,'committed receipt replays even after availability changes');
 for(const role of ['anon','authenticated'])for(const fn of ['public.purchase_room_changes_v1(uuid,uuid,text,jsonb,jsonb,integer,text,text)','public.purchase_catalog_item_scoped_v1(uuid,uuid,text,uuid,text,integer,text,text)'])
  check(!(await query('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn]))[0].allowed,'RPC service only');
 const C='33333333-3333-4333-8333-333333333333';
 await query('insert into profiles(id) values($1)',[C]);await query('insert into wallets(user_id,carrot_balance) values($1,5000)',[C]);
 const solo=await rpc('purchase_room_changes_v1',[C,null,null,{vase:vase.id},{[vase.id]:vase.seed.price},vase.seed.price,'solo',release.release]);
 check(!solo.error&&solo.total===vase.seed.price,'unpaired purchase and placement work without a fabricated partner');
 check((await query("select item_id from room_loadouts where owner_id=$1 and room_type='home' and slot='vase'",[C]))[0].item_id===vase.id,'solo loadout owner is self');
 await query('update wallets set carrot_balance=0 where user_id=$1',[C]);
 const poor=await rpc('purchase_room_changes_v1',[C,null,null,{outfit:dress.id},{[dress.id]:dress.seed.price},dress.seed.price,'poor',release.release]);
 check(poor.error==='insufficient_balance','insufficient wallet explicitly rejects');
 check(!(await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[C,dress.id])).length,'insufficient wallet never grants ownership');
 await query('delete from pairings where user_id in($1,$2)',[A,B]);
 await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
 check((await buy({vase:vase.id},{[vase.id]:vase.seed.price},0,'old-generation')).error==='pair_changed','re-pair with same person invalidates pending writes');
 const repeated=await rpc('purchase_catalog_item_scoped_v1',[A,B,version,B,giftItem.id,giftItem.seed.price,'gift-buy','unknown-new-client-release']);
 check(!repeated.error&&!repeated.applied&&repeated.purchaseId===gift.purchaseId,'committed gift replay survives re-pair and bundle update without re-sending');
 console.log(JSON.stringify({assertions,isolated:true,productionWrites:false}));
}catch(error){console.error('Checkout 262 regression failed after '+assertions+': '+error.stack,JSON.stringify({position:error.position,internalPosition:error.internalPosition,internalQuery:error.internalQuery,where:error.where}));process.exitCode=1;}
finally{await db.close();}
