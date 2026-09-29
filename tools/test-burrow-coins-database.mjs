export async function testCoins({db,query,rpc,check}) {
  await db.exec('begin');
  const a='00000000-0000-0000-0000-000000000991',b='00000000-0000-0000-0000-000000000992';
  const apply=(user,credential,refunded=0,date='2026-09-01T00:00:00Z',store='apple')=>rpc('apply_burrow_coin_purchase_v1',[user,store,'sandbox',credential,'burrow.coin.200',1,refunded,date]);
  try {
    await db.query('insert into profiles(id) values($1),($2)',[a,b]);
    check((await apply(a,'paid')).balance===200,'verified purchase credits 200');
    check((await apply(a,'paid')).delta===0,'replay cannot double credit');
    check((await apply(b,'paid')).error==='purchase_account_conflict','receipt cannot move accounts');
    await rpc('change_carrot_balance_v1',[a,-180,'spend',null,null,'spend']);
    check((await apply(a,'paid',1,'2026-09-02T00:00:00Z')).balance===-180,'refund spent currency records debt');
    check((await apply(a,'paid')).applied===false,'older signed receipt cannot undo refund');
    check((await rpc('change_carrot_balance_v1',[a,10,'earn',null,null,'earn'])).balance===-170,'earned currency offsets debt');
    check((await rpc('change_carrot_balance_v1',[a,-1,'spend',null,null,'debt-spend'])).error==='insufficient_balance','ordinary spend cannot increase debt');
    check((await apply(a,'paid',0,'2026-09-03T00:00:00Z')).balance===30,'verified Apple refund reversal restores once');
    check((await apply(a,'refund-first',1)).delta===0,'refund before first grant grants zero');
    check((await apply(a,'refund-first')).applied===false,'equal time refund wins');
    await apply(a,'google',1,'2026-09-03T00:00:00Z','google');
    check((await apply(a,'google',0,'2026-09-04T00:00:00Z','google')).applied===false,'stale Google fetch cannot undo refund with later local time');
    await db.query('update wallets set carrot_balance=99990 where user_id=$1',[a]);
    check((await apply(a,'over-cap')).balance===100190,'paid carrots are never clipped to earned currency cap');
    check((await rpc('change_carrot_balance_v1',[a,10,'earn',null,null,'cap'])).balance===100190,'daily reward cannot decrease purchased balance');
    await db.query('delete from profiles where id=$1',[a]);
    check((await apply(b,'paid')).error==='purchase_account_conflict','deleted account receipt remains reserved');
    check(!(await query("select has_function_privilege('authenticated','apply_burrow_coin_purchase_v1(uuid,text,text,text,text,integer,integer,timestamptz)','EXECUTE') ok"))[0].ok,'coin grant is service-only');
  } finally {await db.exec('rollback');}
}
