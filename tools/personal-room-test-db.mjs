import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {seedLegacyRoomPhotos} from './test-burrow-room-photo-cleanup-database.mjs';
export async function personalRoomTestDb(){
 const {PGlite}=await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href),db=new PGlite();
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const rpc=async(name,args)=>(await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
 const migration=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
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
 await db.exec(`alter table wallets add column if not exists version bigint not null default 0;
  alter table currency_ledger add column if not exists requested_delta integer;
  create table burrow_surprises(sender_id uuid,idempotency_key uuid,paid_at timestamptz,refunded_at timestamptz,sent_at timestamptz);
  alter table pairings add column created_at timestamptz default now();`);
 await db.exec(migration('20261014000233_burrow_repair_history_isolation').split('-- Preserve every existing bootstrap feature')[0]+'\ncommit;');
 await db.exec(migration('20261019000250_shop_gift_claim'));
 await db.exec(migration('20261022000262_shop_checkout_repair'));
 const release=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
 await rpc('publish_burrow_shop_catalog_v1',[release]);
 return {db,query,rpc,release,migrate:()=>db.exec(migration('20261023000267_personal_room_isolation'))};
}
