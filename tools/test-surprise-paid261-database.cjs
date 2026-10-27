const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',KEY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',VERSION='a'.repeat(32);let db;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const rpc=async(n,p=[])=>(await q(`select ${n}(${p.map((_,i)=>'$'+(i+1)).join(',')}) r`,p))[0].r;
const args=(patch={})=>Object.values({user:A,partner:B,version:VERSION,key:KEY,frame:'santa',duration:12000,digest:'b'.repeat(64),price:300,...patch});
const pay=(patch={})=>rpc('pay_burrow_surprise_v1',args(patch));
const balance=async()=>(await q('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance;
const upload=async item=>{await q("insert into storage.objects(bucket_id,name) values('burrow-surprises',$1),('burrow-surprises',$2)",[item.photoPath,item.audioPath]);};
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,created_at timestamptz default now(),unique(bucket_id,name));
 create table profiles(id uuid primary key,timezone_name text default 'UTC');insert into profiles(id) values('${A}'),('${B}'),('${C}');
 create table pairings(user_id uuid primary key,partner_user_id uuid);insert into pairings values('${A}','${B}'),('${B}','${A}');
 create table versions(version text);insert into versions values('${VERSION}');
 create function lock_burrow_pair(uuid) returns uuid language sql as $$select p.partner_user_id from pairings p join pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id where p.user_id=$1$$;
 create function burrow_pair_version_v1(uuid,uuid) returns text language sql as $$select version from versions$$;
 create table wallets(user_id uuid primary key,carrot_balance integer,version integer default 0,updated_at timestamptz default now());insert into wallets(user_id,carrot_balance) values('${A}',1000),('${B}',1000);
 create table currency_ledger(user_id uuid,requested_delta integer,delta integer,balance_after integer,reason text,reference_type text,reference_id text,idempotency_key text,created_at timestamptz default now(),unique(user_id,idempotency_key));
 create table offer(price integer,denied text);insert into offer values(300,null);
 create function burrow_service_offer_v1(uuid,text,text) returns jsonb language sql as $$select case when denied is null then jsonb_build_object('price',price,'version',0) else jsonb_build_object('error',denied) end from offer$$;`);
 const wallet=fs.readFileSync('supabase/migrations/20260920000139_burrow_coin_purchases.sql','utf8').split('create or replace function public.change_carrot_balance_v1')[1];
 await db.exec('create or replace function public.change_carrot_balance_v1'+wallet.slice(0,wallet.indexOf('end;\n$$;')+9));
 for(const f of ['20261008000204_burrow_surprise_room','20261009000206_burrow_surprise_frames_history','20261017000243_surprise_delivery_recovery']){
  if(f.includes('243'))await db.exec("create schema realtime;create table realtime.notifications(payload jsonb,event text,topic text,private boolean);create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$insert into realtime.notifications values($1,$2,$3,$4)$$;");
  await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
 }
 await db.exec('alter table burrow_surprises add column price_paid integer not null default 300;');
 const pricing=fs.readFileSync('supabase/migrations/20261013000227_burrow_service_catalog_permissions.sql','utf8');
 const start=pricing.indexOf('create function public.prepare_burrow_surprise_v2');
 await db.exec(pricing.slice(start,pricing.indexOf('end $$;',start)+7));
 await db.exec(fs.readFileSync('supabase/migrations/20261022000261_surprise_paid_delivery.sql','utf8'));
 // Actual economic-domain resolver and transfer trigger, not a boolean mock.
 await db.exec('create table burrow_coin_transactions(user_id uuid,environment text);create table subscriptions(user_id uuid,store_environment text);');
 const domains=fs.readFileSync('supabase/migrations/20261024000271_economic_domains.sql','utf8');
 await db.exec(domains.slice(domains.indexOf('create table public.account_economic_domains'),domains.indexOf('create function public.lock_economic_account_v1')));
 await db.exec(domains.slice(domains.indexOf('create function public.enforce_economic_transfer_v1'),domains.indexOf('create trigger security_gift_domain')));
 await db.exec('create trigger security_surprise_domain before insert or update of sender_id,recipient_id,paid_at on burrow_surprises for each row execute function enforce_economic_transfer_v1();');
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('pay debits exactly once before upload, creates no recipient gift or notification, and status survives lost acknowledgement',async()=>{
 const ticket=await pay();assert.equal(ticket.paid,true);assert.equal(await balance(),700);await pay();assert.equal(await balance(),700);
 assert.equal((await q('select * from currency_ledger')).length,1);assert.equal((await q('select * from realtime.notifications')).length,0);
 assert.equal((await q('select * from burrow_surprises where sent_at is not null')).length,0);
 const status=await rpc('burrow_surprise_send_status_v1',[A,KEY,B,VERSION]);assert.equal(status.paid,true);assert.equal(status.committed,false);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).error,'media_incomplete');assert.equal(await balance(),700);
});
test('Sandbox partners pay/send/receive normally; cross-domain send rolls back with no debit or delivery',async()=>{
 await q("insert into account_economic_domains(user_id,domain) values($1,'sandbox'),($2,'sandbox')",[A,B]);
 const ticket=await pay();assert.equal(ticket.paid,true);await upload(ticket);assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).applied,true);
 const received=await rpc('read_burrow_surprises_v1',[B,ticket.id,false]);assert.ok(!received.error);assert.equal(await balance(),700);
 await q("update account_economic_domains set domain='production' where user_id=$1",[B]);
 await q('savepoint cross_domain');
 await assert.rejects(pay({key:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),/economic_domain_mismatch/);
 await q('rollback to cross_domain');assert.equal(await balance(),700);assert.equal((await q('select * from burrow_surprises')).length,1);
});
test('paid upload publishes once and never debits again even if other spending consumes all coins or Plus/price changes',async()=>{
 const ticket=await pay();await upload(ticket);await db.exec("update offer set price=800,denied='plus_required';update wallets set carrot_balance=0 where user_id='"+A+"'");
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).applied,true);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).applied,false);assert.equal(await balance(),0);
 assert.equal((await q('select * from currency_ledger')).length,1);assert.equal((await q('select * from realtime.notifications')).length,2);
 assert.equal((await rpc('cancel_paid_burrow_surprise_v1',[A,KEY])).committed,true);assert.equal(await balance(),0);
});
test('rejected balance, stale price, Plus, stranger, changed pairing and changed payload cannot debit',async()=>{
 assert.equal((await pay({price:200})).error,'price_changed');await db.exec("update offer set denied='plus_required'");assert.equal((await pay()).error,'plus_required');
 await db.exec('update offer set denied=null;update wallets set carrot_balance=100');assert.equal((await pay()).error,'insufficient_balance');
 assert.equal((await pay({partner:C})).error,'pair_changed');assert.equal(await balance(),100);assert.equal((await q('select * from currency_ledger')).length,0);
 await db.exec('update wallets set carrot_balance=1000');await pay();assert.equal((await pay({digest:'c'.repeat(64)})).error,'idempotency_conflict');assert.equal(await balance(),700);
});
test('refund is exact, idempotent, above reward cap, and cannot be spent/delivered again; stranger cannot cancel',async()=>{
 const ticket=await pay();assert.equal((await rpc('cancel_paid_burrow_surprise_v1',[B,KEY])).refunded,false);assert.equal(await balance(),700);
 await db.exec("update wallets set carrot_balance=120000 where user_id='"+A+"'");
 const cancelled=await rpc('cancel_paid_burrow_surprise_v1',[A,KEY]);assert.equal(cancelled.refunded,true);assert.equal(await balance(),120300);
 await rpc('cancel_paid_burrow_surprise_v1',[A,KEY]);assert.equal(await balance(),120300);assert.equal((await pay()).error,'draft_expired');
 await upload(ticket);assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).error,'draft_expired');
 assert.equal((await q('select * from currency_ledger')).length,2);
});
test('wallet read identifies the debit in the same snapshot, without exposing another user order keys',async()=>{
 await pay();const state=await rpc('burrow_reward_wallet_state_v1',[A]);assert.equal(state.wallet.balance,700);assert.deepEqual(state.spends,['surprise-send:'+KEY]);
 assert.deepEqual((await rpc('burrow_reward_wallet_state_v1',[B])).spends,[]);
 await rpc('cancel_paid_burrow_surprise_v1',[A,KEY]);assert.deepEqual((await rpc('burrow_reward_wallet_state_v1',[A])).spends,[]);
});
test('recovery completes uploaded orders even after seven days; overdue incomplete paid drafts refund before expiry',async()=>{
 const waiting=await pay(),ready=await pay({key:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});await upload(ready);
 await db.exec("update burrow_surprises set created_at=now()-interval '30 days'");
 assert.deepEqual(await rpc('collect_surprise_garbage_v1'),[]);assert.equal((await rpc('recover_paid_burrow_surprises_v1')).completed,1);
 assert.ok((await q('select expired_at from burrow_surprises where id=$1',[waiting.id]))[0].expired_at);
 assert.equal(await balance(),700);
});
test('unpair recovery refunds undelivered paid order without notifying or publishing it',async()=>{
 await pay();await db.exec("delete from pairings;update versions set version=repeat('c',32)");await rpc('recover_paid_burrow_surprises_v1');assert.equal(await balance(),1000);
 assert.equal((await q('select * from realtime.notifications')).length,0);assert.equal((await q('select * from burrow_surprises where sent_at is not null')).length,0);
});
test('legacy upload-then-pay remains supported; incomplete legacy tickets do not debit',async()=>{
 const ticket=await rpc('prepare_burrow_surprise_v2',args());assert.equal(await balance(),1000);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).error,'media_incomplete');await upload(ticket);
 assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).applied,true);await rpc('complete_burrow_surprise_v1',[A,ticket.id]);assert.equal(await balance(),700);
});
test('new financial and recovery RPCs remain service-only',async()=>{
 for(const fn of ['pay_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text,integer)','cancel_paid_burrow_surprise_v1(uuid,uuid)','recover_paid_burrow_surprises_v1()'])
  for(const role of ['anon','authenticated'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn]))[0].allowed,false);
});
test('every active Surprise frame pays, completes and reads with real catalog offers and no duplicate debit',async()=>{
 const products=require('../catalog/generated/shop-catalog-release.json').products.filter(p=>p.status==='active'&&p.type==='surprise');
 assert.equal(products.length,36);
 await db.exec(`alter table profiles add column subscription_tier text default 'free';
 create table content_revisions(id text primary key,status text);
 insert into content_revisions values('frame-test','published');
 create table app_config(key text primary key,value text);insert into app_config values('app_major_update_content_revision','frame-test');
 create table catalog_items(stable_id text primary key,revision_id text,item_type text,status text,price integer,plus_only boolean,shop_price_version bigint default 0,metadata jsonb);
 update profiles set subscription_tier='plus' where id='${A}';update wallets set carrot_balance=100000 where user_id='${A}';`);
 const source=fs.readFileSync('supabase/migrations/20261013000227_burrow_service_catalog_permissions.sql','utf8');
 await db.exec(source.slice(source.indexOf('create function public.burrow_has_plus_v1'),source.indexOf('-- Fail closed')).replace('create function public.burrow_service_offer_v1','create or replace function public.burrow_service_offer_v1'));
 // Include production's catalog-backed frame constraint, not the fixture's
 // older fixed-name list. No protection is removed or replaced with true.
 const catalogMigration=fs.readFileSync('supabase/migrations/20261022000259_bundled_shop_catalog.sql','utf8');
 await db.exec(catalogMigration.slice(catalogMigration.indexOf('create function public.burrow_shop_frame_storage_v1'),catalogMigration.indexOf('create function public.publish_burrow_shop_catalog_v1')));
 for(const p of products){
  await q("insert into catalog_items(stable_id,revision_id,item_type,status,price,plus_only,metadata) values($1,'frame-test','surprise','active',$2,$3,$4)",[p.id,p.seed.price,p.seed.plusOnly,{frameId:p.metadata.frameId}]);
  const patch={frame:p.metadata.frameId,key:require('node:crypto').randomUUID(),price:p.seed.price};
  const before=await balance(),ticket=await pay(patch);assert.equal(ticket.paid,true,JSON.stringify({frame:p.id,ticket}));
  await pay(patch);assert.equal(await balance(),before-p.seed.price);
  await upload(ticket);assert.equal((await rpc('complete_burrow_surprise_v1',[A,ticket.id])).applied,true);
  assert.ok(!(await rpc('read_burrow_surprises_v1',[B,ticket.id,false])).error);
  assert.equal(await balance(),before-p.seed.price);
 }
});
