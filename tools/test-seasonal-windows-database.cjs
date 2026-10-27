const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const source=fs.readFileSync('supabase/migrations/20261018000246_burrow_seasonal_window_frames.sql','utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const gift='aaaaaaaa-1111-4111-8111-111111111111',purchase='bbbbbbbb-1111-4111-8111-111111111111',adventure='cccccccc-1111-4111-8111-111111111111';
async function fixture(){const db=new PGlite();await db.exec(`
 create table profiles(id uuid primary key);
 create table content_revisions(id text primary key,status text);
 create table app_config(key text primary key,value text);
 insert into content_revisions values('live','published');insert into app_config values('app_major_update_content_revision','live');
 insert into profiles values('${A}'),('${B}');
 create table wallets(user_id uuid primary key,carrot_balance integer,version integer);
 insert into wallets values('${A}',1234,9),('${B}',5678,12);
 create table catalog_items(stable_id text primary key,revision_id text,item_type text,category text,title text,
  description text,price integer,plus_only boolean,tradable boolean,tags text[],drop_weight integer,asset jsonb default '{}',
  metadata jsonb default '{}',is_placeholder boolean,status text default 'active',updated_at timestamptz default now());
 insert into catalog_items(stable_id,revision_id,item_type,category,title,price,metadata) values
 ('window_sunny_01','live','decor','windows','Old default',0,'{"starter":true,"slot":"window","artOrdinal":1}'),
 ('burrow_art_windows_03','live','decor','windows','Old view',150,'{"slot":"window","artOrdinal":3}'),
 ('table','live','decor','tables','Untouched table',777,'{"slot":"table"}');
 create table user_inventory(owner_id uuid,item_id text references catalog_items(stable_id),source text,unique(owner_id,item_id));
 insert into user_inventory values('${A}','window_sunny_01','starter'),('${A}','table','purchase');
 create table room_loadouts(owner_id uuid,item_id text references catalog_items(stable_id),slot text);
 insert into room_loadouts values('${A}','burrow_art_windows_03','window'),('${A}','table','table');
 create table catalog_purchases(id uuid primary key,item_id text references catalog_items(stable_id));
 insert into catalog_purchases values('${purchase}','burrow_art_windows_03'),(gen_random_uuid(),'table');
 create table gifts(id uuid primary key,item_id text references catalog_items(stable_id));
 insert into gifts values('${gift}','burrow_art_windows_03'),(gen_random_uuid(),'table');
 create table adventures(id uuid primary key,result_type text,result_id text,status text,updated_at timestamptz);
 insert into adventures values('${adventure}','item','burrow_art_windows_03','result_ready',now()),(gen_random_uuid(),'item','table','completed',now());
 create table adventure_results(adventure_id uuid,item_id text references catalog_items(stable_id),gift_id uuid references gifts(id));
 insert into adventure_results values('${adventure}','burrow_art_windows_03','${gift}');
 create table friend_visits(reward_item_id text references catalog_items(stable_id),gift_id uuid references gifts(id),content_snapshot jsonb);
 insert into friend_visits values('burrow_art_windows_03','${gift}','{"giftSnapshot":{"stable_id":"burrow_art_windows_03"},"friendSnapshot":{"name":"Keep story"}}');
 create table moment_events(reference_type text,reference_id text,payload jsonb);
 insert into moment_events values('gift','${gift}','{}'),('room_loadout','room','{"slots":{"window":"window_sunny_01"}}'),('catalog_item','table','{"itemId":"table"}');
 create table burrow_command_receipts(request jsonb,response jsonb);
 insert into burrow_command_receipts values('{"itemId":"burrow_art_windows_03"}','{}'),('{"itemId":"table"}','{}');
 create table adventure_logs(payload jsonb);insert into adventure_logs values('{"itemId":"window_sunny_01"}'),('{"itemId":"table"}');
 create table adventure_gift_display(gift_id text references catalog_items(stable_id));insert into adventure_gift_display values('window_sunny_01');
 create table adventure_encounter_plans(gift_id text references catalog_items(stable_id));insert into adventure_encounter_plans values('window_sunny_01');
 create table room_music(track_id text references catalog_items(stable_id));insert into room_music values('window_sunny_01');
 create table burrow_shop_price_audit(item_id text references catalog_items(stable_id));insert into burrow_shop_price_audit values('burrow_art_windows_03'),('table');
 create table currency_ledger(reference_type text,reference_id text,delta integer);insert into currency_ledger values('catalog_item','burrow_art_windows_03',-150),('catalog_item','table',-777);
 `);return db;}
const rows=async(db,sql)=>(await db.query(sql)).rows;
test('migration 246 deletes exactly old-window records, seeds 39 named 200-coin frames and grants the selected default',async()=>{
 const db=await fixture();try{
  const balances=await rows(db,'select * from wallets order by user_id'),table=await rows(db,"select * from catalog_items where stable_id='table'");
  await db.exec(source);
  const frames=await rows(db,"select * from catalog_items where category='windows' order by (metadata->>'artOrdinal')::integer");
  assert.equal(frames.length,39);assert.ok(frames.every(f=>f.price===200&&f.status==='active'&&f.item_type==='decor'&&!f.plus_only));
  assert.equal(frames[0].stable_id,'window_frame_cross_dark_wood');assert.equal(frames[0].metadata.starter,true);
  for(const f of frames){assert.equal(f.title,f.metadata.windowFrameKey.replaceAll('_',' '));assert.equal(f.asset.file.split('/').at(-1),f.metadata.windowFrameKey+'.webp');}
  assert.equal((await rows(db,"select * from catalog_items where stable_id in('window_sunny_01','burrow_art_windows_03')")).length,0);
  const inventory=await rows(db,'select * from user_inventory');assert.equal(inventory.length,3);
  assert.equal(inventory.filter(r=>r.item_id==='window_frame_cross_dark_wood').length,2);assert.ok(inventory.some(r=>r.item_id==='table'));
  assert.deepEqual(await rows(db,'select * from wallets order by user_id'),balances,'cleanup neither refunds nor spends money');
  assert.deepEqual(await rows(db,"select * from catalog_items where stable_id='table'"),table,'other catalogue rows are byte-for-byte unchanged');
  for(const name of ['catalog_purchases','gifts','room_loadouts','burrow_shop_price_audit']){
   const remaining=await rows(db,`select * from ${name}`);assert.equal(remaining.length,1,name);assert.equal(remaining[0].item_id,'table');
  }
  for(const name of ['adventure_results','room_music','adventure_gift_display','adventure_encounter_plans'])assert.equal((await rows(db,`select * from ${name}`)).length,0,name);
  assert.equal((await rows(db,`select status from adventures where id='${adventure}'`))[0].status,'cancelled');
  const visit=(await rows(db,'select * from friend_visits'))[0];assert.equal(visit.reward_item_id,null);assert.equal(visit.gift_id,null);assert.deepEqual(visit.content_snapshot,{friendSnapshot:{name:'Keep story'}});
  assert.equal((await rows(db,'select * from moment_events')).length,1);assert.equal((await rows(db,'select * from currency_ledger'))[0].reference_id,'table');
  assert.equal((await rows(db,'select * from burrow_command_receipts')).length,1);assert.equal((await rows(db,'select * from adventure_logs')).length,1);
 }finally{await db.close();}
});
test('reapplying cannot delete new-window purchases, revoke ownership or reset a later Admin price',async()=>{
 const db=await fixture();try{
  await db.exec(source);await db.exec(`update catalog_items set price=350 where stable_id='window_frame_cross_white';
   insert into catalog_purchases values(gen_random_uuid(),'window_frame_cross_white');
   insert into user_inventory values('${A}','window_frame_cross_white','purchase');`);
  await db.exec(source);
  assert.equal((await rows(db,"select price from catalog_items where stable_id='window_frame_cross_white'"))[0].price,350);
  assert.equal((await rows(db,"select * from catalog_purchases where item_id='window_frame_cross_white'")).length,1);
  assert.equal((await rows(db,"select * from user_inventory where item_id='window_frame_cross_white'")).length,1);
 }finally{await db.close();}
});
test('missing revision and conflicting new identity abort atomically before any old data is removed',async()=>{
 for(const mode of ['revision','collision']){const db=await fixture();try{
  if(mode==='revision')await db.exec("delete from app_config");
  else await db.exec("insert into catalog_items(stable_id,item_type,category,metadata) values('window_frame_cross_dark_wood','decor','lamps','{}')");
  await assert.rejects(db.exec(source),mode==='revision'?/Published Burrow revision/:/Window ID collision/);await db.exec('rollback');
  assert.equal((await rows(db,"select * from catalog_items where stable_id='window_sunny_01'")).length,1);
  assert.equal((await rows(db,'select * from user_inventory')).length,2);
 }finally{await db.close();}}
});
