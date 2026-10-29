// Actual scoped migration + production checkout SQL, isolated PostgreSQL only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
import {shop283Transaction} from './release-shop-pricing283.mjs';
const approval=JSON.parse(fs.readFileSync('catalog/approvals/pricing-2026-10-28.json'));
const release=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
const {db,query,rpc,migrate}=await personalRoomTestDb();
const migration=fs.readFileSync('supabase/migrations/20261028000283_approved_shop_pricing.sql','utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let assertions=0;const check=(v,m)=>{assert.ok(v,m);assertions++;};
const sql=name=>fs.readFileSync('supabase/migrations/'+name+'.sql','utf8');
const balance=async id=>Number((await query('select carrot_balance n from wallets where user_id=$1',[id]))[0].n);
try{
 // Reconstruct the reviewed pre-update fixture before enabling the real audit.
 const triggers=await query("select tgname,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='catalog_items'::regclass and not tgisinternal");
 for(const t of triggers)await db.exec(`alter table catalog_items disable trigger "${t.tgname}"`);
 for(const p of approval.before)await query('update catalog_items set price=$2,plus_only=$3,shop_price_version=$4 where stable_id=$1',[p.stable_id,p.price,p.plus_only,p.shop_price_version]);
 for(const t of triggers)await db.exec(`alter table catalog_items enable trigger "${t.tgname}"`);
 await db.exec(sql('20261012000224_burrow_shop_plus_toggle'));
 const services=sql('20261013000227_burrow_service_catalog_permissions');
 await db.exec(services.slice(services.indexOf('create function public.burrow_has_plus_v1'),services.indexOf('-- Fail closed')));
 await db.exec(services.slice(services.indexOf('alter table public.burrow_game_unlocks drop'),services.indexOf('-- Gate new rounds')));
 await db.exec(sql('20261015000238_burrow_free_games'));
 await migrate();
 await query("insert into profiles(id,subscription_tier) values($1,'plus'),($2,'free')",[A,B]);
 await query('insert into wallets(user_id,carrot_balance) values($1,1000000),($2,1000000)',[A,B]);
 await query('delete from burrow_shop_release_support where release=$1',[release.release]);
 await query('delete from burrow_shop_price_audit');
 const catalogSnapshot=()=>query("select stable_id,price,plus_only,shop_price_version from catalog_items order by stable_id");
 const baseline=await catalogSnapshot();
 const target=approval.before.find(p=>p.price>0);
 await query('update catalog_items set price=price+1 where stable_id=$1',[target.stable_id]);
 await assert.rejects(db.exec(migration),/Concurrent pricing change/);await db.exec('rollback');assertions++;
 check((await query('select count(*) n from burrow_shop_price_audit'))[0].n===1,'conflicting batch makes no partial edits');
 // Restore that independently simulated Admin edit, then replay the real batch.
 await query('alter table catalog_items disable trigger burrow_shop_price_audit_trigger');
 await query('update catalog_items set price=$2,shop_price_version=$3 where stable_id=$1',[target.stable_id,target.price,target.shop_price_version]);
 await query('alter table catalog_items enable trigger burrow_shop_price_audit_trigger');
 await query('delete from burrow_shop_price_audit');
 check(JSON.stringify(await catalogSnapshot())===JSON.stringify(baseline),'fixture restores exact baseline');
 const adventure=(await query("insert into adventures(user_id,partner_id,local_date,status,started_at,ends_at,duration_seconds,content_revision,idempotency_key) values($1,$1,current_date-100,'in_progress',now(),now()+interval '1 hour',3600,(select value from app_config where key='app_major_update_content_revision'),'pricing-frozen') returning id",[A]))[0].id;
 await query("insert into adventure_encounter_plans(user_id,adventure_id,status,snapshot) values($1,$2,'bound','{\"encounterV2\":true,\"treasureVersion\":4}')",[A,adventure]);
 const frozen=JSON.stringify(await query('select * from adventure_encounter_plans'));
 await db.exec(shop283Transaction({recordMigration:false}));
 check(JSON.stringify(await query('select * from adventure_encounter_plans'))===frozen,'frozen Adventure plans preserved');
 for(const p of approval.records){
  const row=(await query('select price,plus_only,shop_price_version from catalog_items where stable_id=$1',[p.id]))[0];
  const old=approval.before.find(x=>x.stable_id===p.id);
  check(row.price===p.price&&row.plus_only===p.plusOnly,'exact approved settings '+p.id);
  check(row.shop_price_version===old.shop_price_version+Number(old.price!==p.price||old.plus_only!==p.plusOnly),'single CAS increment '+p.id);
  check(await rpc('burrow_shop_item_supported_v1',[p.id,release.release]),'new client supported '+p.id);
 }
 const audit=JSON.stringify(await query('select * from burrow_shop_price_audit order by id'));
 await db.exec(migration);check(JSON.stringify(await query('select * from burrow_shop_price_audit order by id'))===audit,'migration replay never duplicates audit');
 const counts={room:0,games:0,surprises:0};
 for(const [i,p]of release.products.filter(p=>p.status==='active').entries()){
  const n=approval.records.find(r=>r.id===p.id),key='approved-'+i,start=await balance(A);
  if(p.metadata.slot){
   const buy=(user,price,k)=>rpc('purchase_personal_room_changes_v1',[user,{[p.metadata.slot]:p.id},{[p.id]:price},price,k,release.release]);
   if(!p.metadata.starter){
    const stale=await buy(A,n.price+1,key+'stale');check(stale.error==='price_changed','stale quote rejected '+p.id);
    check(await balance(A)===start,'stale quote never debits '+p.id);
   }
   const receipt=await buy(A,n.price,key);check(!receipt.error,'purchased '+p.id+': '+JSON.stringify(receipt));
   check((await buy(A,n.price,key)).applied===false,'idempotent '+p.id);
   check(await balance(A)===start-(p.metadata.starter?0:n.price),'exact debit '+p.id);
   check((await query("select item_id from room_loadouts where owner_id=$1 and room_type='home' and slot=$2",[A,p.metadata.slot]))[0]?.item_id===p.id,'equipped '+p.id);
   if(!p.metadata.starter){
    const denied=await buy(B,n.price,'free-'+i);
    check(n.plusOnly?denied.error==='plus_required':!denied.error,'Free eligibility '+p.id);
    await db.exec('begin');await query("update profiles set subscription_tier='free' where id=$1",[A]);
    check(!(await buy(A,0,'owned-'+i)).error,'owned item remains usable after Plus expires '+p.id);await db.exec('rollback');
   }
   counts.room++;
  }else if(p.type==='game'){
   await query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1) on conflict(user_id) do update set partner_user_id=excluded.partner_user_id',[A,B]);
   const args=[A,p.metadata.gameId,randomUUID(),n.price];
   check((await rpc('burrow_game_unlock_v2',[A,p.metadata.gameId,randomUUID(),n.price+1])).error==='price_changed','stale game quote '+p.id);
   const result=await rpc('burrow_game_unlock_v2',args);check(!result.error,'game purchase '+p.id+JSON.stringify(result));
   check((await rpc('burrow_game_unlock_v2',args)).charged===false,'game never double charges '+p.id);
   check(await balance(A)===start-n.price,'exact game debit '+p.id);
   await db.exec('begin');await query("update profiles set subscription_tier='free' where id=$1",[A]);
   check(!(await rpc('burrow_game_unlock_v2',args)).error,'owned game remains unlocked '+p.id);await db.exec('rollback');
   await query('delete from pairings');counts.games++;
  }else{
   const offer=await rpc('burrow_service_offer_v1',[A,p.id,'surprise']);
   check(!offer.error&&offer.price===n.price&&offer.plus_only===n.plusOnly,'Surprise authoritative offer '+p.id);
   const free=await rpc('burrow_service_offer_v1',[B,p.id,'surprise']);
   check(n.plusOnly?free.error==='plus_required':free.price===n.price,'Surprise Free gate '+p.id);counts.surprises++;
  }
 }
 const report={assertions,counts,products:496,changed:approval.release.changed,isolated:true,productionWrites:false};
 fs.mkdirSync('tools/reports',{recursive:true});fs.writeFileSync('tools/reports/shop-pricing283-database.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(error){console.error('Pricing 283 failed after '+assertions+': '+error.stack,JSON.stringify({where:error.where}));process.exitCode=1;}
finally{await db.close();}
