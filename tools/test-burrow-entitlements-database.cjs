// Real migrations, isolated PostgreSQL/WASM; never connects to production.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
let db;const query=async(s,args=[]) => (await db.query(s,args)).rows;
const rpc=async(name,args=[]) => (await query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;
const toy=()=>rpc('prepare_toy_photo_v1',[A,A,'toy-B',null,randomUUID(),'a'.repeat(64)]);
const frame=()=>rpc('solo_burrow_prepare_photo_v1',[A,A,'frame',randomUUID(),'a'.repeat(64)]);
const commit=(t,kind='frame')=>rpc(kind==='doll'?'complete_toy_photo_v1':'solo_burrow_complete_photo_v1',[A,t.ticketId]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,created_at timestamptz default now());
 create table profiles(id uuid primary key,timezone_name text default 'UTC',subscription_tier text default 'free');
 create table pairings(user_id uuid primary key,partner_user_id uuid);
 create table app_config(key text primary key,value text);insert into app_config values('app_major_update_content_revision','live');
 create table content_revisions(id text primary key,status text);insert into content_revisions values('live','published');
 create table catalog_items(stable_id text primary key,revision_id text,item_type text,category text,title text,description text,
 price integer,plus_only boolean default false,tradable boolean,tags text[],drop_weight integer,asset jsonb,metadata jsonb default '{}',is_placeholder boolean,
 status text default 'active',shop_price_version bigint default 0,updated_at timestamptz default now());
 create table burrow_shop_price_audit(id uuid primary key default gen_random_uuid(),batch_id uuid,item_id text,old_price integer,new_price integer,
 version bigint,admin_id uuid,admin_email text,reason text);
 create table user_inventory(owner_id uuid,item_id text);create table room_loadouts(room_type text,owner_id uuid,pair_low uuid,pair_high uuid,slot text,item_id text);
 create table moment_events(pair_low uuid,pair_high uuid,actor_id uuid,target_id uuid,event_type text,reference_type text,reference_id text,payload jsonb,idempotency_key text,created_at timestamptz default now());
 create table notification_outbox(recipient_user_id uuid,event_key text,event_type text,payload jsonb,unique(recipient_user_id,event_key));
 create function can_read_burrow_pair(uuid,uuid) returns boolean language sql as $$select false$$;
 create function burrow_bootstrap_v1(p_user uuid) returns jsonb language sql as $$select jsonb_build_object('partner',jsonb_build_object('id',(select partner_user_id from pairings where user_id=p_user)),'localDate',current_date::text)$$;
 create function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select 'pair-v1'::text$$;
 create table wallets(user_id uuid primary key,carrot_balance integer);create table currency_ledger(user_id uuid,idempotency_key text,delta integer,unique(user_id,idempotency_key));
 create function change_carrot_balance_v1(p_user uuid,p_delta integer,p_reason text,p_type text,p_id text,p_key text) returns jsonb language plpgsql as $$
 declare prior integer;total integer;begin
 select delta into prior from currency_ledger where user_id=p_user and idempotency_key=p_key;
 if found then if prior<>p_delta then return '{"error":"idempotency_conflict"}'::jsonb;end if;return '{"applied":false}'::jsonb;end if;
 select carrot_balance+p_delta into total from wallets where user_id=p_user for update;
 if total<0 then return '{"error":"insufficient_balance"}'::jsonb;end if;
 update wallets set carrot_balance=total where user_id=p_user;insert into currency_ledger values(p_user,p_key,p_delta);
 return jsonb_build_object('balance',total,'applied',true);end$$;
 insert into profiles(id) values('${A}'),('${B}');insert into wallets values('${A}',10000),('${B}',10000);
 insert into catalog_items(stable_id,revision_id,item_type,category,metadata) values('toy-B','live','decor','couple_dolls','{"slot":"couple_doll","starter":true}'),('toy-C','live','decor','couple_dolls','{"slot":"couple_doll","starter":true}');
 `);
 const base=sql('20260920000116_app_major_update_foundation.sql');
 await db.exec(base.slice(base.indexOf('create or replace function public.lock_burrow_pair'),base.indexOf('create table public.burrow_command_receipts')));
 const photos=sql('20260920000125_burrow_personalization.sql');await db.exec(photos.slice(photos.indexOf('create table public.room_photos'),photos.indexOf('create function public.select_room_music_v1')));
 for(const name of ['20260920000130_burrow_room_photo_cleanup.sql','20260920000149_burrow_solo_photos.sql','20261008000205_burrow_per_toy_photos.sql','20261009000212_burrow_partner_room_care.sql',
  '20260920000142_burrow_game_room.sql','20261008000204_burrow_surprise_room.sql','20261009000206_burrow_surprise_frames_history.sql','20261012000224_burrow_shop_plus_toggle.sql',
  '20261013000226_burrow_games_surprises_catalog.sql','20261013000227_burrow_service_catalog_permissions.sql','20261013000228_burrow_photo_entitlements_history.sql'])await db.exec(sql(name));
 await db.exec('create trigger prices before update on catalog_items for each row execute function audit_burrow_shop_price_v1()');
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db?.close());
const freeGames=()=>db.exec(sql('20261015000238_burrow_free_games.sql').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,''));
const setGame=(price,version=0,plus_only=false)=>rpc('set_burrow_shop_prices_v1',[A,'admin@example.com',[{id:'game:after_dark_01',price,version,plus_only}],null]);
const pair=()=>query('insert into pairings values($1,$2),($2,$1)',[A,B]);
const questions=Array.from({length:6},()=>({self:'Me',partner:'Them',options:['A','B','C','D']}));
test('Free to paid preserves BOTH unlocked partners; an untouched pair must confirm and pay the new price exactly once',async()=>{
 await freeGames();await pair();await setGame(0);await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),0]);await setGame(300,1);
 await query('update wallets set carrot_balance=0');
 for(const user of [A,B]){
  assert.equal((await rpc('burrow_game_unlock_v2',[user,'after_dark_01',randomUUID(),0])).charged,false);
  assert.ok((await rpc('burrow_game_start_v1',[user,'after_dark_01',questions])).sessionId);
 }
 const C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444';
 await query('insert into profiles(id) values($1),($2)',[C,D]);await query('insert into wallets values($1,1000),($2,1000)',[C,D]);
 await query('insert into pairings values($1,$2),($2,$1)',[C,D]);
 assert.equal((await rpc('burrow_game_unlock_v2',[C,'after_dark_01',randomUUID(),0])).error,'price_changed');
 assert.equal((await query('select * from currency_ledger')).length,0);
 const key=randomUUID();assert.equal((await rpc('burrow_game_unlock_v2',[C,'after_dark_01',key,300])).charged,true);
 assert.equal((await rpc('burrow_game_unlock_v2',[D,'after_dark_01',randomUUID(),300])).charged,false);
 assert.equal((await rpc('burrow_game_unlock_v2',[C,'after_dark_01',key,300])).charged,false);
 assert.equal((await query('select * from currency_ledger')).length,1);
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[C]))[0].carrot_balance,700);
});
test('239 appends exactly four 300-coin toys, preserves old settings/inventory and is replay-safe after Admin repricing',async()=>{
 const apply=()=>db.exec(sql('20261015000239_burrow_dresser_toys.sql').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,''));
 const before=await query('select * from catalog_items order by stable_id');await query('insert into user_inventory values($1,$2)',[A,'toy-B']);
 await apply();const rows=await query("select * from catalog_items where stable_id like 'burrow_art_couple_dolls_%' order by stable_id");
 assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>r.price),[300,300,300,300]);
 assert.deepEqual(rows.map(r=>r.metadata.artOrdinal),[30,31,32,33]);assert.ok(rows.every(r=>r.status==='active'&&!r.plus_only));
 assert.deepEqual(await query("select * from catalog_items where stable_id not like 'burrow_art_couple_dolls_%' order by stable_id"),before);
 await query("update catalog_items set price=410,plus_only=true where stable_id='burrow_art_couple_dolls_30'");await apply();
 const preserved=(await query("select * from catalog_items where stable_id='burrow_art_couple_dolls_30'"))[0];assert.equal(preserved.price,410);assert.equal(preserved.plus_only,true);
 assert.equal((await query('select * from user_inventory')).length,1);
});
test('238 is replay-safe, preserves all Admin prices, and makes zero-game price edits audited/reversible',async()=>{
 const before=await query('select stable_id,price,plus_only,shop_price_version from catalog_items order by stable_id');
 await freeGames();await freeGames();
 assert.deepEqual(await query('select stable_id,price,plus_only,shop_price_version from catalog_items order by stable_id'),before);
 assert.equal((await setGame(0)).error,null);assert.equal((await setGame(240,1)).error,null);
 const audit=await query("select old_price,new_price,version from burrow_shop_price_audit where item_id='game:after_dark_01' order by version");
 assert.deepEqual(audit.map(r=>[r.old_price,r.new_price,Number(r.version)]),[[150,0,1],[0,240,2]]);
 assert.equal((await setGame(0,0)).error,'price_conflict');
});
test('free game unlock with zero wallet balance is durable/shared and never calls the wallet or currency ledger',async()=>{
 await freeGames();await pair();await setGame(0);await query('update wallets set carrot_balance=0');
 const key=randomUUID(),args=[A,'after_dark_01',key,0];
 assert.deepEqual(await rpc('burrow_game_unlock_v2',args),{error:null,unlocked:true,charged:false});
 assert.equal((await rpc('burrow_game_unlock_v2',args)).charged,false);
 assert.equal((await rpc('burrow_game_unlock_v2',[B,'after_dark_01',randomUUID(),0])).charged,false);
 assert.equal((await query('select * from burrow_game_unlocks')).length,1);
 assert.equal((await query('select price_paid from burrow_game_unlocks'))[0].price_paid,0);
 assert.equal((await query('select price from burrow_game_purchase_receipts'))[0].price,0);
 assert.equal((await query('select * from currency_ledger')).length,0);
 assert.deepEqual((await query('select carrot_balance from wallets')).map(r=>r.carrot_balance),[0,0]);
 assert.ok((await rpc('burrow_game_start_v1',[B,'after_dark_01',questions])).sessionId);
 assert.equal((await rpc('burrow_game_unlock_v2',[A,'after_dark_02',key,150])).error,'idempotency_conflict');
});
test('free games keep pair/Plus permissions, including shared Plus from the other partner',async()=>{
 await freeGames();await setGame(0,0,true);
 assert.equal((await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),0])).error,'not_paired');
 await pair();assert.equal((await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),0])).error,'plus_required');
 await query("update profiles set subscription_tier='plus' where id=$1",[B]);
 assert.equal((await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),0])).unlocked,true);
 assert.ok((await rpc('burrow_game_start_v1',[A,'after_dark_01',questions])).sessionId);
 assert.equal((await query('select * from currency_ledger')).length,0);
});
test('stale Free to paid quotes cannot charge, while existing shared free ownership survives repricing',async()=>{
 await freeGames();await pair();await setGame(0);await setGame(210,1);
 for(const expected of [0,null])assert.equal((await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),expected])).error,expected===0?'price_changed':'price_confirmation_required');
 assert.equal((await query('select * from currency_ledger')).length,0);
 await setGame(0,2);await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),0]);await setGame(210,3);
 assert.equal((await rpc('burrow_game_unlock_v2',[B,'after_dark_01',randomUUID(),0])).unlocked,true);
 assert.ok((await rpc('burrow_game_start_v1',[B,'after_dark_01',questions])).sessionId);
 assert.equal((await query('select * from currency_ledger')).length,0);
});
test('238 retains paid purchase, old-client quote protection and existing ownership',async()=>{
 await freeGames();await pair();
 const result=await rpc('burrow_game_unlock_v2',[A,'after_dark_01',randomUUID(),150]);assert.equal(result.charged,true);
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,9850);
 assert.equal((await rpc('burrow_game_unlock_v2',[B,'after_dark_01',randomUUID(),null])).charged,false);
 assert.equal((await query('select * from currency_ledger')).length,1);
 await setGame(0);assert.ok((await rpc('burrow_game_start_v1',[A,'after_dark_01',questions])).sessionId);
 assert.equal((await query('select price_paid from burrow_game_unlocks'))[0].price_paid,150);
});
test('zero-price permission is game-only; mixed batches cannot partially mutate or audit',async()=>{
 await freeGames();
 for(const row of [{id:'surprise:santa',price:0},{id:'game:after_dark_01',price:-1},{id:'game:after_dark_01',price:1.5},{id:'game:after_dark_01',price:100000}]){
  const result=await rpc('set_burrow_shop_prices_v1',[A,'admin@example.com',[{id:'game:after_dark_02',price:0,version:0},{...row,version:0}],null]);
  assert.ok(result.error);
 }
 assert.equal((await query("select price from catalog_items where stable_id='game:after_dark_02'"))[0].price,150);
 assert.equal((await query('select * from burrow_shop_price_audit')).length,0);
 await query("update catalog_items set price=0 where stable_id='surprise:santa'");
 assert.equal((await rpc('burrow_service_offer_v1',[A,'surprise:santa','surprise'])).error,'not_for_sale');
 for(const name of ['set_burrow_shop_prices_v1(uuid,text,jsonb,text)','burrow_service_offer_v1(uuid,text,text)','burrow_game_unlock_v2(uuid,text,uuid,integer)'])
  for(const role of ['anon','authenticated'])assert.equal((await query('select has_function_privilege($1,$2,\'EXECUTE\') ok',[role,name]))[0].ok,false);
});
test('migration 231 refreshes all 38 frames without changing Admin price/Plus/version or historical messages',async()=>{
 const refresh=()=>db.exec(sql('20261013000231_surprise_frame_refresh.sql').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,''));
 await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 const historical=await rpc('prepare_burrow_surprise_v2',[A,B,'pair-v1',randomUUID(),'halloween',1000,'b'.repeat(64),300]);
 await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['burrow-surprises',historical.photoPath,historical.audioPath]);
 await rpc('complete_burrow_surprise_v1',[A,historical.id]);
 await query("update catalog_items set price=415,plus_only=true,shop_price_version=8 where stable_id='surprise:santa'");
 await query("update catalog_items set price=590,plus_only=true,shop_price_version=4 where stable_id='surprise:halloween'");
 const before=await query("select stable_id,price,plus_only,shop_price_version from catalog_items where item_type='surprise' order by stable_id");
 await refresh();
 assert.deepEqual(await query("select stable_id,price,plus_only,shop_price_version from catalog_items where stable_id=any($1) order by stable_id",[before.map(r=>r.stable_id)]),before);
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='surprise' and status='active'"))[0].n,38);
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='surprise' and status='retired'"))[0].n,14);
 const wreath=(await query("select * from catalog_items where stable_id='surprise:christmas_wreath'"))[0];
 assert.equal(wreath.title,'Christmas Wreath');assert.equal(wreath.price,300);assert.equal(wreath.plus_only,false);
 assert.equal(wreath.metadata.sourceFile,'09_Christmas_Wreath.webp');
 assert.equal((await rpc('burrow_service_offer_v1',[A,'surprise:halloween','surprise'])).error,'not_for_sale');
 assert.equal((await rpc('burrow_service_offer_v1',[A,'surprise:santa','surprise'])).error,'plus_required');
 const prepared=await rpc('prepare_burrow_surprise_v2',[A,B,'pair-v1',randomUUID(),'christmas_wreath',1000,'a'.repeat(64),300]);
 assert.ok(prepared.id);await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['burrow-surprises',prepared.photoPath,prepared.audioPath]);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,prepared.id])).spent,300);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,prepared.id])).applied,false);
 await refresh();
 assert.equal((await query('select count(*)::int n from burrow_surprises'))[0].n,2);
 assert.ok((await rpc('read_burrow_surprises_v1',[B,historical.id,false])).audioPath,'retired styles remain replayable');
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='surprise' and status='active'"))[0].n,38);
});
test('Admin has 70 games/20 frames, editable atomic price/Plus settings and private RPCs',async()=>{
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='game'"))[0].n,70);
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='surprise'"))[0].n,20);
 const result=await rpc('set_burrow_shop_prices_v1',[A,'admin@example.com',[{id:'game:after_dark_01',version:0,price:210,plus_only:true},{id:'surprise:santa',version:0,price:450,plus_only:true}],null]);
 assert.equal(result.error,null);assert.equal(result.updated.length,2);assert.equal(result.updated[0].version,1);
 assert.equal((await query('select count(*)::int n from burrow_shop_price_audit'))[0].n,2);
 assert.equal((await rpc('set_burrow_shop_prices_v1',[A,'admin@example.com',[{id:'surprise:santa',version:0,price:460}],null])).error,'price_conflict');
 assert.equal((await rpc('set_burrow_shop_prices_v1',[A,'admin@example.com',[{id:'surprise:santa',version:1,price:100000}],null])).error,'price_out_of_range');
 for(const name of ['burrow_game_unlock_v2(uuid,text,uuid,integer)','read_burrow_frame_history_v1(uuid,timestamptz,uuid)','burrow_photo_usage_v1(uuid)'])
  assert.equal((await query("select has_function_privilege('authenticated',$1,'EXECUTE') ok",[name]))[0].ok,false);
});
test('migration 232 retires exactly the two removed frames while preserving billing settings and their paid history',async()=>{
 const apply=name=>db.exec(sql(name).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,''));
 await apply('20261013000231_surprise_frame_refresh.sql');
 await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 const sent=await rpc('prepare_burrow_surprise_v2',[A,B,'pair-v1',randomUUID(),'autumn_pumpkin',1000,'b'.repeat(64),300]);
 await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['burrow-surprises',sent.photoPath,sent.audioPath]);
 await rpc('complete_burrow_surprise_v1',[A,sent.id]);
 await query("update catalog_items set price=499,plus_only=true where stable_id='surprise:birthday_cake'");
 const before=await query("select stable_id,price,plus_only,shop_price_version from catalog_items where item_type='surprise' order by stable_id");
 await apply('20261013000232_surprise_frame_removals.sql');
 assert.deepEqual(await query("select stable_id,price,plus_only,shop_price_version from catalog_items where item_type='surprise' order by stable_id"),before);
 assert.equal((await query("select count(*)::int n from catalog_items where item_type='surprise' and status='active'"))[0].n,36);
 for(const id of ['autumn_pumpkin','birthday_cake'])assert.equal((await rpc('burrow_service_offer_v1',[A,'surprise:'+id,'surprise'])).error,'not_for_sale');
 assert.ok((await rpc('read_burrow_surprises_v1',[B,sent.id,false])).audioPath);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,sent.id])).applied,false);
});
test('Games pay once, quote validation, key binding, shared Plus and new-round gating',async()=>{
 await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 const key=randomUUID(),unlock=(id='after_dark_01',price=150,k=key)=>rpc('burrow_game_unlock_v2',[A,id,k,price]);
 assert.equal((await unlock('after_dark_01',149)).error,'price_changed');
 assert.equal((await unlock()).charged,true);assert.equal((await unlock()).charged,false);
 assert.equal((await unlock('after_dark_02')).error,'idempotency_conflict');
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,9850);
 assert.equal((await query('select price_paid from burrow_game_unlocks'))[0].price_paid,150);
 await query("update catalog_items set plus_only=true where stable_id='game:after_dark_01'");
 const questions=Array.from({length:6},()=>({self:'Me',partner:'Them',options:['A','B','C','D']}));
 assert.equal((await rpc('burrow_game_start_v1',[A,'after_dark_01',questions])).error,'plus_required');
 await query("update profiles set subscription_tier='plus' where id=$1",[B]);
 assert.ok((await rpc('burrow_game_start_v1',[A,'after_dark_01',questions])).sessionId);
 await query("update catalog_items set price=210 where stable_id='game:after_dark_02'");
 assert.equal((await rpc('burrow_game_unlock_v1',[A,'after_dark_02',randomUUID()])).error,'price_confirmation_required');
 assert.equal((await unlock('after_dark_02',210,randomUUID())).charged,true);
});
test('Surprise charges every send, never preview/replay/retry; accepted upload quote is frozen',async()=>{
 await query('insert into pairings values($1,$2),($2,$1)',[A,B]);
 const prepare=(key=randomUUID(),price=300)=>rpc('prepare_burrow_surprise_v2',[A,B,'pair-v1',key,'santa',1000,'a'.repeat(64),price]);
 assert.equal((await prepare(randomUUID(),299)).error,'price_changed');
 const first=await prepare();assert.ok(first.id);
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,10000);
 await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['burrow-surprises',first.photoPath,first.audioPath]);
 await query("update catalog_items set price=410 where stable_id='surprise:santa'");
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,first.id])).spent,300);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,first.id])).applied,false);
 const second=await prepare(randomUUID(),410);await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['burrow-surprises',second.photoPath,second.audioPath]);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,second.id])).spent,410);
 await query("update catalog_items set plus_only=true where stable_id='surprise:santa'");
 assert.equal((await prepare(randomUUID(),410)).error,'plus_required');
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,first.id])).applied,false);
});
test('Free frame 1/day; Plus 2/day; prepared tickets cannot race past commit quota',async()=>{
 const first=await frame(),race=await frame();assert.equal((await commit(first)).applied,true);
 await db.exec('savepoint photo_race');await assert.rejects(()=>commit(race),/daily_limit_reached/);await db.exec('rollback to photo_race');
 await assert.rejects(()=>frame(),/daily_limit_reached/);await db.exec('rollback to photo_race');
 assert.equal((await commit(first)).applied,false);
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await commit(race)).applied,true);
 await db.exec('savepoint photo_plus');await assert.rejects(()=>frame(),/daily_limit_reached/);await db.exec('rollback to photo_plus');
 assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,2);
 assert.equal((await rpc('read_burrow_frame_history_v1',[B])).items.length,0);
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).frame.remaining,0);
});
test('Doll Free 1 / Plus 3 per target, only latest crop, no archived face photos',async()=>{
 const first=await toy();assert.equal((await commit(first,'doll')).applied,true);
 assert.equal((await toy()).error,'daily_limit_reached');
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 for(let i=0;i<2;i++)assert.equal((await commit(await toy(),'doll')).applied,true);
 assert.equal((await toy()).error,'daily_limit_reached');
 assert.equal((await query("select count(*)::int n from room_photos where kind='doll'"))[0].n,1);
 assert.equal((await query('select count(*)::int n from burrow_frame_photo_history'))[0].n,0);
 const another=await rpc('prepare_toy_photo_v1',[A,A,'toy-C',null,randomUUID(),'a'.repeat(64)]);assert.equal((await commit(another,'doll')).applied,true);
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).doll.targets.find(t=>t.toyId==='toy-B').used,3);
});

test('every retired Plushie crop queues cleanup; grace/active references protect the current crop, retries preserve quota',async()=>{
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 const first=await toy();await commit(first,'doll');const second=await toy();await commit(second,'doll');
 const third=await toy();await commit(third,'doll');
 assert.equal((await query("select * from room_photos where kind='doll'"))[0].private_path,third.path);
 const queued=await query('select private_path from room_photo_garbage order by private_path');
 assert.deepEqual(queued.map(r=>r.private_path).sort(),[first.path,second.path].sort());
 assert.deepEqual(await rpc('collect_room_photo_garbage_v1'),[],'one-hour safety grace is respected');
 await query("update room_photo_garbage set not_before=now()-interval '1 second'");
 assert.deepEqual((await rpc('collect_room_photo_garbage_v1')).sort(),[first.path,second.path].sort());
 assert.equal((await commit(first,'doll')).applied,false,'lost-response retry cannot resurrect retired bytes');
 assert.equal((await rpc('burrow_photo_usage_v1',[A])).doll.targets.find(t=>t.toyId==='toy-B').used,3);
 assert.equal((await query("select count(*)::int n from room_photos where kind='doll'"))[0].n,1);
 assert.equal((await query('select count(*)::int n from burrow_frame_photo_history'))[0].n,0);
});
test('Free hides 7-day history, deletes 30-day photos; Plus retains all and protected paths never enter garbage',async()=>{
 const t=await frame();await commit(t);
 await query("update burrow_frame_photo_history set created_at=now()-interval '8 days'");
 assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,0);
 assert.deepEqual(await rpc('collect_room_photo_garbage_v1'),[]);
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,1);
 await query("update burrow_frame_photo_history set created_at=now()-interval '31 days'");
 assert.deepEqual(await rpc('collect_room_photo_garbage_v1'),[]);
 await query("update profiles set subscription_tier='free' where id=$1",[A]);
 assert.deepEqual(await rpc('collect_room_photo_garbage_v1'),[t.path]);
 assert.equal((await query('select * from room_photos')).length,0);
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await rpc('read_burrow_frame_history_v1',[A])).items.length,0,'tombstone cannot resurrect queued deletion');
});
