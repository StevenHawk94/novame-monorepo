import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const {PGlite}=createRequire(import.meta.url)(process.env.PGLITE_MODULE);
const source=fs.readFileSync('supabase/migrations/20261020000252_hazel_vinyl_gifts.sql','utf8');
const gifts=JSON.parse(fs.readFileSync('apps/api/src/data/adventure-friends/HZ.json')).gifts;
async function fixture(){
 const db=new PGlite();
 await db.exec(`create table catalog_items(stable_id text primary key,title text,asset jsonb,metadata jsonb,tags text[],updated_at timestamptz default now(),price int default 0,status text default 'active');
 create table adventure_encounter_plans(id int primary key,gift_id text,status text,snapshot jsonb);
 create table adventure_results(id int primary key,claim_status text,metadata jsonb);
 create table user_inventory(owner_id text,item_id text,acquired_at text);
 create table adventure_gift_displays(user_id text,gift_id text);`);
 for(const gift of gifts)await db.query(`insert into catalog_items(stable_id,title,asset,metadata,tags) values($1,'Old Seed',$2,$3,array['adventure_v2_gift'])`,
  [gift.id,{url:'https://old.example/seed.webp'},{friendId:gift.friendId,giftCategory:'Mystery Seeds',giftCategoryCode:'C15',sourceId:gift.sourceId,other:'preserved'}]);
 await db.exec(`insert into catalog_items(stable_id,title,asset,metadata,tags) values('unrelated','Untouched','{}','{}','{}');
 insert into user_inventory values('me','adventure_gift_465','2026-01-01');
 insert into adventure_gift_displays values('me','adventure_gift_465');
 insert into adventure_encounter_plans select n,'adventure_gift_465',state,jsonb_build_object('giftSnapshot',to_jsonb(c),'dialogue',jsonb_build_object('choice','unchanged'),'treasureSnapshot',jsonb_build_object('stable_id','lamp'))
 from catalog_items c cross join (values(1,'reserved'),(2,'bound'),(3,'completed')) x(n,state) where stable_id='adventure_gift_465';
 insert into adventure_results select id,case when id=3 then 'claimed' else 'pending' end,snapshot from adventure_encounter_plans;`);
 return db;
}
test('252 updates presentation only, including frozen plans/results; repeat is safe and ownership/display/claims survive',async()=>{
 const db=await fixture();try{
  const inventory=(await db.query('select * from user_inventory')).rows,displays=(await db.query('select * from adventure_gift_displays')).rows;
  const before=(await db.query('select stable_id,price,status,metadata from catalog_items')).rows;
  await db.exec(source);await db.exec(source);
  const rows=(await db.query('select * from catalog_items order by stable_id')).rows;
  assert.equal(rows.filter(c=>c.metadata.giftCategory==='Vinyl').length,32);
  for(const gift of gifts){const c=rows.find(c=>c.stable_id===gift.id),old=before.find(c=>c.stable_id===gift.id);
   assert.equal(c.title,gift.name);assert.equal(c.asset.url,'https://media.novameapp.com/'+gift.key);
   assert.equal(c.asset.width,600);assert.equal(c.asset.height,600);
   assert.deepEqual(c.metadata,{...old.metadata,giftCategory:'Vinyl'});assert.equal(c.price,old.price);assert.equal(c.status,old.status);
  }
  assert.equal(rows.find(c=>c.stable_id==='unrelated').title,'Untouched');
  for(const p of (await db.query('select * from adventure_encounter_plans order by id')).rows){
   assert.equal(p.snapshot.giftSnapshot.title,'Tropical Muse');assert.equal(p.snapshot.giftSnapshot.metadata.giftCategory,'Vinyl');
   assert.deepEqual(p.snapshot.dialogue,{choice:'unchanged'});assert.deepEqual(p.snapshot.treasureSnapshot,{stable_id:'lamp'});
   assert.equal(p.status,['reserved','bound','completed'][p.id-1]);
  }
  for(const r of (await db.query('select * from adventure_results')).rows){assert.equal(r.metadata.giftSnapshot.title,'Tropical Muse');assert.equal(r.claim_status,r.id===3?'claimed':'pending');}
  assert.deepEqual((await db.query('select * from user_inventory')).rows,inventory);assert.deepEqual((await db.query('select * from adventure_gift_displays')).rows,displays);
 }finally{await db.close();}
});
test('252 fails closed on a missing/mismatched gift and rolls back every row',async()=>{
 const db=await fixture();try{
  await db.exec("update catalog_items set metadata='{}' where stable_id='adventure_gift_496'");
  await assert.rejects(db.exec(source),/Hazel gift catalog mismatch/);await db.exec('rollback');
  assert.equal((await db.query("select count(*)::int n from catalog_items where title='Old Seed'")).rows[0].n,32);
  assert.equal((await db.query("select snapshot->'giftSnapshot'->>'title' title from adventure_encounter_plans limit 1")).rows[0].title,'Old Seed');
 }finally{await db.close();}
});
