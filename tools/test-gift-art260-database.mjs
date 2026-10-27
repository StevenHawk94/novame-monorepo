import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.BURROW_PGLITE_PATH).href),db=new PGlite();
const sql=fs.readFileSync('supabase/migrations/20261022000260_duchess_gift_art_refresh.sql','utf8');
const updates=JSON.parse(sql.match(/\$gift_art260\$([\s\S]+?)\$gift_art260\$/)[1]);
const query=async(s,p=[])=> (await db.query(s,p)).rows;let checks=0;
try{
 await db.exec(`create table catalog_items(stable_id text primary key,asset jsonb,metadata jsonb,tags text[],title text,price int,status text,updated_at timestamptz default now());
 create table adventure_encounter_plans(id int,gift_id text,status text,snapshot jsonb);
 create table adventure_results(id int,claim_status text,metadata jsonb);
 create table user_inventory(owner_id text,item_id text);create table adventure_gift_displays(user_id text,gift_id text);`);
 for(const u of updates)await query("insert into catalog_items values($1,$2,$3,array['adventure_v2_gift'],'unchanged',null,'active',now())",[u.id,{renderer:'r2',key:u.old_key,url:'https://media.novameapp.com/'+u.old_key,width:600,height:600},{friendId:u.friend_id,giftCategory:'Mushroom Domes',giftCategoryCode:u.category_code,other:'retained'}]);
 await query("insert into user_inventory values('me',$1)",[updates[0].id]);await query("insert into adventure_gift_displays values('me',$1)",[updates[0].id]);
 await query(`insert into adventure_encounter_plans select n,c.stable_id,state,jsonb_build_object('giftSnapshot',to_jsonb(c),'dialogue','keep','treasureCoins',100) from catalog_items c cross join(values(1,'reserved'),(2,'bound'),(3,'completed')) t(n,state) where c.stable_id=$1`,[updates[0].id]);
 await query("insert into adventure_results select id,case when id=3 then 'claimed' else 'pending' end,snapshot from adventure_encounter_plans");
 const before=await query('select stable_id,title,price,status,metadata from catalog_items order by stable_id'),owned=await query('select * from user_inventory'),display=await query('select * from adventure_gift_displays');
 await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await query('select stable_id,title,price,status,metadata from catalog_items order by stable_id'),before);checks++;
 for(const u of updates){assert.deepEqual((await query('select asset from catalog_items where stable_id=$1',[u.id]))[0].asset,u.asset);checks++;}
 for(const row of await query('select * from adventure_encounter_plans')){assert.equal(row.snapshot.giftSnapshot.asset.key,updates[0].asset.key);assert.equal(row.snapshot.dialogue,'keep');assert.equal(row.snapshot.treasureCoins,100);checks++;}
 for(const row of await query('select * from adventure_results')){assert.equal(row.metadata.giftSnapshot.asset.key,updates[0].asset.key);assert.equal(row.claim_status,row.id===3?'claimed':'pending');checks++;}
 assert.deepEqual(await query('select * from user_inventory'),owned);assert.deepEqual(await query('select * from adventure_gift_displays'),display);checks++;
 await query("update catalog_items set asset='{}' where stable_id=$1",[updates.at(-1).id]);
 await assert.rejects(db.exec(sql),/identity\/version mismatch/);await db.exec('rollback');checks++;
 console.log(JSON.stringify({checks,isolated:true,productionWrites:false}));
}finally{await db.close();}
