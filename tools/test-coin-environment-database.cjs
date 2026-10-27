const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
let db;
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const purchase=async(id,patch={})=>{
  const p={user:A,store:'apple',env:'sandbox',id,product:'burrow.coin.200',quantity:1,refunded:0,
    date:new Date(Date.now()+60_000).toISOString(),automatic:true,...patch};
  return (await query('select apply_burrow_coin_purchase_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) result',Object.values(p)))[0].result;
};
const scope=async(user=A)=>(await query('select burrow_coin_wallet_mode_v1($1) as mode',[user]))[0].mode;
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);insert into profiles values('${A}'),('${B}'),('${C}');
    create table wallets(user_id uuid primary key references profiles on delete cascade,carrot_balance integer not null default 0 constraint wallets_carrot_balance_check check(carrot_balance>=0),version integer default 0,updated_at timestamptz default now());
    insert into wallets(user_id,carrot_balance) values('${A}',0),('${B}',0),('${C}',0);
    create table currency_ledger(user_id uuid references profiles on delete cascade,requested_delta integer,delta integer,balance_after integer constraint currency_ledger_balance_after_check check(balance_after>=0),reason text,reference_type text,reference_id text,idempotency_key text,unique(user_id,idempotency_key));`);
  for(const file of ['20260920000139_burrow_coin_purchases.sql','20261009000207_burrow_coin_sandbox_wallet.sql',
    '20261009000208_burrow_coin_sandbox_testers.sql','20261009000209_burrow_coin_prospective_testing.sql',
    '20261009000211_burrow_coin_environment_testing.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('every fresh App identity gets Home coins from new sandbox receipts without an allowlist',async()=>{
  for(const user of [A,B,C]){
    assert.equal(await scope(user),'none');
    for(let i=0;i<3;i++){
      const result=await purchase(`${user}-${i}`,{user});
      assert.equal(result.wallet,'room');assert.equal(result.environment,'sandbox');
      assert.deepEqual(result.roomWallet,{balance:200*(i+1),version:i+1});
    }
    assert.equal(await scope(user),'sandbox');
  }
  assert.equal((await query('select count(*) n from burrow_coin_sandbox_testers'))[0].n,0);
});
test('same receipt never grants twice or transfers ownership; independent same-price orders still grant',async()=>{
  await purchase('one');assert.equal((await purchase('one')).delta,0);
  assert.equal((await purchase('one',{user:B})).error,'purchase_account_conflict');
  assert.equal((await purchase('two')).roomWallet.balance,400);
  assert.equal((await purchase('two',{automatic:false})).delta,0,'mode switch cannot duplicate old Home credit');
});
test('isolated historical purchases and pre-activation late receipts never backfill',async()=>{
  await purchase('old-isolated',{automatic:false});
  assert.equal((await purchase('old-isolated')).wallet,'sandbox');
  assert.equal((await purchase('late-old',{date:new Date(Date.now()-60_000).toISOString()})).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,0);
  assert.equal((await query('select balance from burrow_sandbox_coin_wallets where user_id=$1',[A]))[0].balance,400);
  assert.equal((await purchase('new')).roomWallet.balance,200);
});
test('production rejects sandbox flag and test Home accounts; live accounts cannot get new test Home grants',async()=>{
  assert.equal((await purchase('bad-env',{env:'production'})).error,'invalid_request');
  await purchase('test');
  assert.equal((await purchase('live-on-test',{env:'production',automatic:false})).error,'sandbox_account_conflict');
  assert.equal((await purchase('live',{user:B,env:'production',automatic:false})).roomWallet.balance,200);
  assert.equal(await scope(B),'production');
  assert.equal((await purchase('test-on-live',{user:B})).error,'production_account_conflict');
  // Explicitly isolated tests remain harmless to the live Home wallet.
  assert.equal((await purchase('isolated-on-live',{user:B,automatic:false})).wallet,'sandbox');
  assert.equal((await query('select carrot_balance from wallets where user_id=$1',[B]))[0].carrot_balance,200);
});
test('refund, stale replay and reversal retain wallet ownership even after automatic mode is disabled',async()=>{
  const date=new Date(Date.now()+60_000).toISOString();await purchase('paid',{date});
  const refund=await purchase('paid',{automatic:false,refunded:1,date:new Date(Date.now()+120_000).toISOString()});
  assert.equal(refund.roomWallet.balance,0);assert.equal(refund.wallet,'room');
  assert.equal((await purchase('paid',{date})).applied,false);
  assert.equal((await purchase('paid',{automatic:false,date:new Date(Date.now()+180_000).toISOString()})).roomWallet.balance,200);
  assert.equal((await purchase('next-off',{automatic:false})).wallet,'sandbox');
});
test('validation and account deletion tombstones remain fail-closed',async()=>{
  for(const patch of [{quantity:0},{refunded:2},{store:null},{product:'bogus'},{date:null},{automatic:null},{id:''}])
    assert.equal((await purchase('bad',patch)).error,'invalid_request');
  await purchase('owned');await db.exec(`delete from profiles where id='${A}';`);
  assert.equal((await purchase('owned',{user:B})).error,'purchase_account_conflict');
  assert.equal((await purchase('new')).error,'profile_not_found');
});
test('only the service role may choose automatic test mode; internal settlement and cutoff are protected',async()=>{
  const [acl]=await query(`select
    has_function_privilege('service_role','apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean)','execute') service,
    has_function_privilege('authenticated','apply_burrow_coin_purchase_v2(uuid,text,text,text,text,integer,integer,timestamptz,boolean)','execute') client,
    has_function_privilege('anon','burrow_coin_wallet_mode_v1(uuid)','execute') anon,
    has_function_privilege('service_role','apply_burrow_coin_purchase_legacy_v1(uuid,text,text,text,text,integer,integer,timestamptz)','execute') legacy,
    has_table_privilege('authenticated','burrow_coin_test_policy','update') policy_write`);
  assert.deepEqual(acl,{service:true,client:false,anon:false,legacy:false,policy_write:false});
  const source=(await query("select prosrc from pg_proc where proname='apply_burrow_coin_purchase_v2'"))[0].prosrc;
  assert.ok(source.indexOf("'sandbox-coin:'")<source.indexOf('prior_room:='),'both routing modes share receipt lock before deciding');
});
