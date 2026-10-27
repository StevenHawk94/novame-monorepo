const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let db;
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const purchase=async(id,patch={})=>{
  const p={user:A,store:'apple',env:'sandbox',id,product:'burrow.coin.200',quantity:1,refunded:0,
    date:new Date(Date.now()+60_000).toISOString(),...patch};
  return (await query('select apply_burrow_coin_purchase_v1($1,$2,$3,$4,$5,$6,$7,$8) result',Object.values(p)))[0].result;
};
const enroll=async(enabled=true)=>(await query('select set_burrow_coin_sandbox_tester_v1($1,$2) result',[A,enabled]))[0].result;
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);insert into profiles values('${A}'),('${B}');
    create table wallets(user_id uuid primary key references profiles on delete cascade,carrot_balance integer not null default 0 constraint wallets_carrot_balance_check check(carrot_balance>=0),version integer default 0,updated_at timestamptz default now());
    insert into wallets(user_id,carrot_balance) values('${A}',0),('${B}',0);
    create table currency_ledger(user_id uuid references profiles on delete cascade,requested_delta integer,delta integer,balance_after integer constraint currency_ledger_balance_after_check check(balance_after>=0),reason text,reference_type text,reference_id text,idempotency_key text,unique(user_id,idempotency_key));`);
  for(const file of ['20260920000139_burrow_coin_purchases.sql','20261009000207_burrow_coin_sandbox_wallet.sql',
    '20261009000208_burrow_coin_sandbox_testers.sql','20261009000209_burrow_coin_prospective_testing.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  }
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('no backfill: enrollment and old receipt replay never move isolated purchases to Home',async()=>{
  await purchase('old-one');await purchase('old-two');
  assert.equal((await enroll()).delta,0);
  assert.equal((await purchase('old-one')).wallet,'sandbox');
  assert.equal((await purchase('old-two')).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,0);
  assert.equal((await query('select balance from burrow_sandbox_coin_wallets where user_id=$1',[A]))[0].balance,400);
});
test('fresh receipts update Home and return versioned wallet; same price can be purchased repeatedly',async()=>{
  await enroll();
  for(let i=0;i<5;i++) {
    const result=await purchase(`new-${i}`);
    assert.equal(result.wallet,'room');assert.equal(result.environment,'sandbox');
    assert.deepEqual(result.roomWallet,{balance:200*(i+1),version:i+1});
  }
  assert.equal((await purchase('new-4')).delta,0);
  assert.equal((await purchase('unapproved',{user:B})).wallet,'sandbox');
});
test('previously unreceived purchases signed before enrollment stay isolated',async()=>{
  await enroll();
  assert.equal((await purchase('late-old',{date:new Date(Date.now()-60_000).toISOString()})).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,0);
});
test('disabling test mode keeps refunds on original Home wallet; stale replay cannot restore refunded coins',async()=>{
  await enroll();const originalDate=new Date(Date.now()+60_000).toISOString();
  await purchase('paid',{date:originalDate});await enroll(false);
  const refunded=await purchase('paid',{refunded:1,date:new Date(Date.now()+120_000).toISOString()});
  assert.equal(refunded.roomWallet.balance,0);
  assert.equal((await purchase('paid',{date:originalDate})).applied,false);
  assert.equal((await purchase('after-disable')).wallet,'sandbox');
});
test('enrollment is idempotent, service-only, and cannot transfer receipt ownership',async()=>{
  await purchase('owned',{user:B});await enroll();
  const initial=(await query('select updated_at from burrow_coin_sandbox_testers where user_id=$1',[A]))[0].updated_at;
  await enroll();assert.equal(String((await query('select updated_at from burrow_coin_sandbox_testers where user_id=$1',[A]))[0].updated_at),String(initial));
  assert.equal((await purchase('owned')).error,'purchase_account_conflict');
  const [row]=await query(`select has_function_privilege('authenticated','set_burrow_coin_sandbox_tester_v1(uuid,boolean)','execute') client`);
  assert.equal(row.client,false);
});
