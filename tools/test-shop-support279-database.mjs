// Actual SQL checkout sweep in isolated PostgreSQL. Never purchases for real users.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
import {shop279Transaction} from './release-shop-support279.mjs';
const {db,query,rpc,release,migrate}=await personalRoomTestDb();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const migration=fs.readFileSync('supabase/migrations/20261027000279_shop_client_capability.sql','utf8');
let checks=0;const check=(v,message)=>{assert.ok(v,message);checks++;};
const snapshot=async()=>JSON.stringify(await query("select c.stable_id,to_jsonb(c) value from catalog_items c order by c.stable_id"));
try{
 await query("insert into profiles(id,subscription_tier) values($1,'plus'),($2,'free')",[A,B]);
 await query('insert into wallets(user_id,carrot_balance) values($1,1000000),($2,1000000)',[A,B]);
 await migrate();
 await query('delete from burrow_shop_release_support where release=$1',[release.release]);
 const quotes=new Map((await query('select stable_id,price,plus_only from catalog_items')).map(p=>[p.stable_id,p]));
 const priced=p=>({...p,quote:quotes.get(p.id).price??0,plusOnly:quotes.get(p.id).plus_only});
 const cocoa=priced(release.products.find(p=>p.title==='Cocoa Gingham'));
 const buy=(owner,p,key)=>rpc('purchase_personal_room_changes_v1',[owner,{[p.metadata.slot]:p.id},{[p.id]:p.quote},p.quote,key,release.release]);
 check((await buy(A,cocoa,'before')).error==='client_upgrade_required','reproduces real Cocoa Gingham failure');
 check((await query('select carrot_balance n from wallets where user_id=$1',[A]))[0].n===1000000,'rejected request never charged');
 const old=JSON.stringify(await query('select * from burrow_shop_release_support order by release,product_id')),catalog=await snapshot();
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
 await db.exec(shop279Transaction());await db.exec(migration);
 check(await snapshot()===catalog,'all catalog fields/prices are unchanged');
 check(JSON.stringify(await query('select * from burrow_shop_release_support where release<>$1 order by release,product_id',[release.release]))===old,'all prior client capabilities unchanged');
 const active=release.products.filter(p=>p.status==='active').map(priced);check(active.length===496,'all current products are covered');
 for(const p of active)check(await rpc('burrow_shop_item_supported_v1',[p.id,release.release]),'supported: '+p.title);
 const services=fs.readFileSync('supabase/migrations/20261013000227_burrow_service_catalog_permissions.sql','utf8');
 await db.exec(services.slice(services.indexOf('create function public.burrow_has_plus_v1'),services.indexOf('-- Fail closed')));
 await db.exec(services.slice(services.indexOf('alter table public.burrow_game_unlocks drop'),services.indexOf('-- Gate new rounds')));
 const counts={room:0,paidGames:0,freeGames:0,surpriseOffers:0};let paired=false;
 for(const [index,p]of active.entries()){
  const balance=Number((await query('select carrot_balance n from wallets where user_id=$1',[A]))[0].n);
  const key='all-products-'+index;
  if(p.metadata.slot){
   const result=await buy(A,p,key);check(!result.error,'room purchase '+p.title+': '+JSON.stringify(result));
   check((await query("select item_id from room_loadouts where owner_id=$1 and room_type='home' and slot=$2",[A,p.metadata.slot]))[0]?.item_id===p.id,'equipped: '+p.title);
   check((await buy(A,p,key)).applied===false,'idempotent room replay: '+p.title);counts.room++;
  }else if(p.type==='game'&&p.quote>0){
   if(!paired){await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);paired=true;}
   const args=[A,p.metadata.gameId,randomUUID(),p.quote];
   const result=await rpc('burrow_game_unlock_v2',args);check(!result.error&&result.charged,'game purchase '+p.title+': '+JSON.stringify(result));
   check((await rpc('burrow_game_unlock_v2',args)).charged===false,'idempotent game replay: '+p.title);
   check((await query('select 1 from burrow_game_unlocks where owner_id=$1 and game_id=$2',[A,p.metadata.gameId])).length===1,'game unlock: '+p.title);counts.paidGames++;
  }else if(p.type==='surprise'){
   const offer=await rpc('burrow_service_offer_v1',[A,p.id,'surprise']);check(!offer.error&&offer.price===p.quote,'real Surprise offer: '+p.title);counts.surpriseOffers++;continue;
  }else{check(p.type==='game'&&p.quote===0,'non-room free product is a game');counts.freeGames++;continue;}
  if(p.metadata.slot)check((await query('select 1 from user_inventory where owner_id=$1 and item_id=$2',[A,p.id])).length===(p.metadata.starter?0:1),'ownership/default: '+p.title);
  check(Number((await query('select carrot_balance n from wallets where user_id=$1',[A]))[0].n)===balance-(p.metadata.starter?0:p.quote),'exact debit including replay: '+p.title);
  if(p.metadata.slot&&p.quote>0){
   await db.exec('begin');await query('delete from pairings');
   const denied=await buy(B,p,'free-'+index);
   check(p.plusOnly?denied.error==='plus_required':!denied.error,'Free eligibility retained: '+p.title);await db.exec('rollback');
  }
 }
 // Missing/unknown old clients remain baseline-limited, not silently upgraded.
 check(!(await rpc('burrow_shop_item_supported_v1',[cocoa.id,'unknown'])),'unknown client does not gain new products');
 await query('delete from burrow_shop_release_support where release=$1 and product_id=$2',[release.release,cocoa.id]);
 await assert.rejects(db.exec(migration),/Published client capabilities cannot change/);await db.exec('rollback');checks++;
 const report={checks,products:active.length,counts,isolated:true,productionWrites:false};
 if(process.env.BURROW_SHOP279_REPORT)fs.writeFileSync(process.env.BURROW_SHOP279_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await db.close();}
