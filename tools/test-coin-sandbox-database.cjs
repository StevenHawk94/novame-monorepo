const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let db;
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const purchase=async(id,patch={})=>{
  const p={user:A,store:'apple',env:'sandbox',id,product:'burrow.coin.200',quantity:1,refunded:0,date:'2026-10-09T00:00:00Z',...patch};
  return (await query('select apply_burrow_coin_purchase_v1($1,$2,$3,$4,$5,$6,$7,$8) result',Object.values(p)))[0].result;
};
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);
    insert into profiles values('${A}'),('${B}');
    create table wallets(user_id uuid primary key references profiles on delete cascade,carrot_balance integer not null default 0 constraint wallets_carrot_balance_check check(carrot_balance>=0),version integer default 0,updated_at timestamptz default now());
    insert into wallets(user_id,carrot_balance) values('${A}',123),('${B}',456);
    create table currency_ledger(user_id uuid references profiles on delete cascade,requested_delta integer,delta integer,balance_after integer constraint currency_ledger_balance_after_check check(balance_after>=0),reason text,reference_type text,reference_id text,idempotency_key text,unique(user_id,idempotency_key));`);
  await db.exec(readFileSync('supabase/migrations/20260920000139_burrow_coin_purchases.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009000207_burrow_coin_sandbox_wallet.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009000208_burrow_coin_sandbox_testers.sql','utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('different transactions for the same price are unlimited; identical transaction credits only once',async()=>{
  for(let i=0;i<25;i++)assert.equal((await purchase(`repeat-${i}`)).balance,(i+1)*200);
  assert.equal((await purchase('repeat-24')).delta,0);
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,123);
  assert.equal((await query('select count(*) n from currency_ledger'))[0].n,0);
  assert.equal((await query('select count(*) n from burrow_coin_transactions'))[0].n,0);
});
test('all three sandbox packs use authoritative amounts and never create a production wallet',async()=>{
  await query('delete from wallets where user_id=$1',[A]);
  for(const [id,product,expected] of [['200','burrow.coin.200',200],['400','burrow.coin.400',600],['1000','burrow.coin.1000',1600]])assert.equal((await purchase(id,{product})).balance,expected);
  assert.equal((await query('select * from wallets where user_id=$1',[A])).length,0);
});
test('sandbox refunds and reversals affect only test coins; stale receipts cannot restore refunds',async()=>{
  await purchase('paid');assert.equal((await purchase('paid',{refunded:1,date:'2026-10-10T00:00:00Z'})).balance,0);
  assert.equal((await purchase('paid')).applied,false);
  assert.equal((await purchase('paid',{date:'2026-10-11T00:00:00Z'})).balance,200);
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,123);
});
test('production purchase/refund implementation remains unchanged and separate even for same credential',async()=>{
  await purchase('same');assert.equal((await purchase('same',{env:'production'})).balance,323);
  assert.equal((await purchase('same',{env:'production'})).delta,0);
  assert.equal((await purchase('same',{env:'production',refunded:1,date:'2026-10-10T00:00:00Z'})).balance,123);
  assert.equal((await query('select balance from burrow_sandbox_coin_wallets where user_id=$1',[A]))[0].balance,200);
  assert.equal((await query('select count(*) n from currency_ledger'))[0].n,2);
});
test('transactions cannot move accounts or products and survive deletion as ownership tombstones',async()=>{
  await purchase('paid');assert.equal((await purchase('paid',{user:B})).error,'purchase_account_conflict');
  assert.equal((await purchase('paid',{product:'burrow.coin.400'})).error,'purchase_account_conflict');
  await query('delete from profiles where id=$1',[A]);
  assert.equal((await query('select * from burrow_sandbox_coin_wallets')).length,0);
  assert.equal((await purchase('paid',{user:B})).error,'purchase_account_conflict');
});
test('only service role can grant coins; production helper is not callable through public RPC',async()=>{
  const rows=await query(`select
    has_function_privilege('authenticated','apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)','execute') client,
    has_function_privilege('service_role','apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)','execute') server,
    has_function_privilege('service_role','apply_burrow_coin_purchase_production_v1(uuid,text,text,text,text,integer,integer,timestamptz)','execute') helper,
    has_table_privilege('authenticated','burrow_sandbox_coin_wallets','select') balance`);
  assert.deepEqual(rows[0],{client:false,server:true,helper:false,balance:false});
});
test('explicit enrollment backfills already verified receipts once; repeated purchases credit Home',async()=>{
  await purchase('before-enrollment');
  const enroll=async()=> (await query('select set_burrow_coin_sandbox_tester_v1($1,true) result',[A]))[0].result;
  assert.equal((await enroll()).delta,200);
  assert.equal((await enroll()).delta,0);
  assert.equal((await purchase('before-enrollment')).delta,0);
  for(let i=0;i<5;i++) {
    const result=await purchase(`new-${i}`);
    assert.equal(result.wallet,'room');assert.equal(result.environment,'sandbox');assert.equal(result.balance,523+i*200);
  }
  assert.equal((await purchase('someone-else',{user:B})).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance,456);
});
test('disabling testers keeps historic refund ordering but isolates NEW purchases',async()=>{
  await query('select set_burrow_coin_sandbox_tester_v1($1,true)',[A]);await purchase('approved');
  await query('select set_burrow_coin_sandbox_tester_v1($1,false)',[A]);
  assert.equal((await purchase('approved',{refunded:1,date:'2026-10-10T00:00:00Z'})).balance,123);
  assert.equal((await purchase('approved')).applied,false);
  assert.equal((await purchase('new-after-disable')).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,123);
});
test('approved tester cannot take someone else\'s isolated receipt and clients cannot self-enroll',async()=>{
  await purchase('owned-by-B',{user:B});
  await query('select set_burrow_coin_sandbox_tester_v1($1,true)',[A]);
  assert.equal((await purchase('owned-by-B')).error,'purchase_account_conflict');
  const [privileges]=await query(`select
    has_function_privilege('authenticated','set_burrow_coin_sandbox_tester_v1(uuid,boolean)','execute') enroll,
    has_table_privilege('authenticated','burrow_coin_sandbox_testers','insert') add,
    has_function_privilege('service_role','apply_burrow_coin_purchase_isolated_v1(uuid,text,text,text,text,integer,integer,timestamptz)','execute') helper`);
  assert.deepEqual(privileges,{enroll:false,add:false,helper:false});
});
test('enrollment of a refunded isolated transaction never resurrects its coins',async()=>{
  await purchase('refunded-before-enrollment');
  await purchase('refunded-before-enrollment',{refunded:1,date:'2026-10-10T00:00:00Z'});
  const [result]=await query('select set_burrow_coin_sandbox_tester_v1($1,true) result',[A]);
  assert.equal(result.result.delta,0);
  await purchase('refunded-before-enrollment');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,123);
});
