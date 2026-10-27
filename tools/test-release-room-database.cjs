const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const sql=name=>fs.readFileSync(`supabase/migrations/${name}.sql`,'utf8');
let db;
const query=async(text,args=[]) => (await db.query(text,args)).rows;
const rpc=async(name,args)=>(await query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const version=()=>rpc('burrow_pair_version_v1',[A,B]);
const submit=async(key,extra={})=>rpc('submit_release_room_v1',[extra.user??A,extra.monster??'overthinking',extra.dialogue??'r01',extra.choice??0,key,
 Object.hasOwn(extra,'partner')?extra.partner:B,Object.hasOwn(extra,'version')?extra.version:await version()]);
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(id uuid primary key,timezone_name text default 'UTC',subscription_tier text default 'free');
 create table pairings(user_id uuid primary key,partner_user_id uuid,created_at timestamptz default now());
 create table app_config(key text primary key,value text);
 insert into app_config values('app_major_update_enabled','true');
 create table kit_completions(id uuid primary key default gen_random_uuid(),user_id uuid,kit text,period_key text,payload jsonb,local_date date,created_at timestamptz default now(),unique(user_id,kit,period_key));
 create table monster_battle_progress(user_id uuid,monster_id text,points bigint,updated_at timestamptz default now(),primary key(user_id,monster_id));
 create table burrow_command_receipts(actor_id uuid,command_key text,request jsonb,response jsonb,created_at timestamptz default now(),primary key(actor_id,command_key));
 create table wallets(user_id uuid primary key,carrot_balance int default 0,version bigint default 0,updated_at timestamptz default now());
 create table currency_ledger(user_id uuid,requested_delta int,delta int,balance_after int,reason text,reference_type text,reference_id text,idempotency_key text,created_at timestamptz default now(),unique(user_id,idempotency_key));
 create function lock_burrow_inventory(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
 create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql as $$select md5(string_agg(user_id::text||created_at::text,',' order by user_id)) from pairings where user_id in(a,b) having count(*)=2$$;
 create function burrow_relation_started_at_v1(a uuid,b uuid) returns timestamptz language sql as $$select max(created_at) from pairings where user_id in(a,b)$$;`);
 const foundation=sql('20260920000116_app_major_update_foundation');
 await db.exec(foundation.slice(foundation.indexOf('create or replace function public.lock_burrow_pair'),foundation.indexOf('revoke all on function public.lock_burrow_pair')));
 const entitlements=sql('20261013000227_burrow_service_catalog_permissions');
 await db.exec(entitlements.slice(entitlements.indexOf('create function public.burrow_has_plus_v1'),entitlements.indexOf('create function public.burrow_service_offer_v1')));
 const wallet=sql('20260920000139_burrow_coin_purchases');
 await db.exec(wallet.slice(wallet.indexOf('create or replace function public.change_carrot_balance_v1'),wallet.indexOf("notify pgrst,'reload schema'")));
 await db.exec(sql('20261014000237_release_room'));
 await query('insert into profiles(id)values($1),($2),($3)',[A,B,C]);
 await query('insert into pairings(user_id,partner_user_id)values($1,$2),($2,$1)',[A,B]);
});
beforeEach(()=>db.exec('begin;'));afterEach(()=>db.exec('rollback;'));after(()=>db.close());
test('both partners read mirrored monster counts and distinct last-tamed timestamps',async()=>{
 await submit('a');await query("update kit_completions set created_at=created_at-interval '1 minute' where user_id=$1",[A]);await submit('b',{user:B,partner:A});
 const as=await rpc('release_room_status_v1',[A]),bs=await rpc('release_room_status_v1',[B]);
 const a=as.monsters.find(m=>m.id==='overthinking'),b=bs.monsters.find(m=>m.id==='overthinking');
 assert.equal(a.tamedCount,1);assert.equal(b.tamedCount,1);
 assert.equal(a.partnerTamedCount,b.tamedCount);assert.equal(b.partnerTamedCount,a.tamedCount);
 assert.notEqual(a.lastTamedAt,b.lastTamedAt);
 assert.equal(a.lastTamedAt,b.partnerLastTamedAt);assert.equal(b.lastTamedAt,a.partnerLastTamedAt);
});
test('Plus cap is across monsters; a downgrade never creates another allowance',async()=>{
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 await submit('one');await submit('two',{monster:'the_fog'});
 assert.equal((await submit('three',{monster:'the_wall'})).error,'daily_limit_reached');
 await query("update profiles set subscription_tier='free' where id=$1",[A]);
 const s=await rpc('release_room_status_v1',[A]);assert.equal(s.dailyLimit,1);assert.equal(s.tamesToday,2);
 assert.equal((await submit('downgrade')).error,'daily_limit_reached');
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,20);
});
test('previous local-day completions contribute history, not the next day quota',async()=>{
 await query("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[A]);
 await query("insert into kit_completions(user_id,kit,period_key,payload,local_date,created_at)values($1,'tame_enemy','previous-day','{\"monster_id\":\"overthinking\"}',(now() at time zone 'Pacific/Kiritimati')::date-1,now()-interval '1 day')",[A]);
 const s=await rpc('release_room_status_v1',[A]);assert.equal(s.tamesToday,0);
 assert.equal(s.monsters.find(m=>m.id==='overthinking').tamedCount,1);
 const done=await submit('today',{dialogue:'r02'});assert.equal(done.carrotsAwarded,10);assert.equal(done.status.tamesToday,1);
 assert.equal((await submit('too-many')).error,'daily_limit_reached');
});
test('Free has one completion, exactly 10 coins; next attempt cannot mutate history or wallet',async()=>{
 const first=await submit('first');assert.equal(first.carrotsAwarded,10);assert.equal(first.dailyLimit,1);assert.equal(first.status.tamesToday,1);
 assert.equal((await submit('second',{monster:'the_fog'})).error,'daily_limit_reached');
 assert.equal((await query('select * from kit_completions')).length,1);assert.equal((await query('select * from currency_ledger')).length,1);
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,10);
});
test('Plus inherited from current partner permits two tames of the SAME monster, both rewarded',async()=>{
 await query("update profiles set subscription_tier='plus' where id=$1",[B]);
 const first=await submit('one'),second=await submit('two',{dialogue:'r02'}),third=await submit('three');
 assert.equal(first.dailyLimit,2);assert.equal(second.carrotsAwarded,10);assert.equal(second.tamedCount,2);assert.equal(second.battleTotalPoints,100);
 assert.equal(first.victoryIndex,0);assert.equal(second.victoryIndex,1);assert.equal(third.error,'daily_limit_reached');
 assert.equal((await query('select carrot_balance from wallets where user_id=$1',[A]))[0].carrot_balance,20);
 const partner=await submit('partner',{user:B,partner:A});assert.equal(partner.carrotsAwarded,10,'partners have separate daily limits');
});
test('upgrading after Free completion opens exactly one additional rewarded run',async()=>{
 await submit('free');await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await submit('plus')).carrotsAwarded,10);assert.equal((await submit('extra')).error,'daily_limit_reached');
});
test('same-key retry is a receipt, including after daily quota is exhausted; changed choice conflicts',async()=>{
 const first=await submit('safe'),retry=await submit('safe');
 assert.equal(retry.applied,false);assert.equal(retry.completionId,first.completionId);assert.equal(retry.carrotsAwarded,0);
 assert.equal(retry.coinReward.amount,0);assert.equal(retry.victoryIndex,first.victoryIndex);
 assert.equal((await submit('safe',{choice:1})).error,'idempotency_conflict');assert.equal((await query('select * from kit_completions')).length,1);
});
test('history has no monster lifetime ceiling, loop index survives day rollover and counts use server day',async()=>{
 for(let i=0;i<51;i++)await query("insert into kit_completions(user_id,kit,period_key,payload,local_date,created_at)values($1,'tame_enemy',$2,'{\"monster_id\":\"overthinking\"}',current_date-1,now()-interval '1 day')",[A,'history-'+i]);
 const result=await submit('new',{dialogue:'r02'});assert.equal(result.tamedCount,52);assert.equal(result.victoryIndex,1);assert.equal(result.status.tamesToday,1);
 await query("update profiles set timezone_name='Pacific/Kiritimati' where id=$1",[A]);
 const status=await rpc('release_room_status_v1',[A]);assert.equal(status.localDate,(await query("select (now() at time zone 'Pacific/Kiritimati')::date::text as local_day"))[0].local_day);
});
test('stats expose current reciprocal partner only; unpaired users can tame without a partner',async()=>{
 const oldVersion=await version();await submit('my-history');
 await query('delete from pairings');
 const solo=await rpc('release_room_status_v1',[A]);assert.equal(solo.partnerId,null);assert.equal(solo.monsters[0].partnerTamedCount,null);
 const own=await submit('solo',{user:C,partner:null,version:null});assert.equal(own.carrotsAwarded,10);
 assert.equal((await submit('stale',{version:oldVersion})).error,'pair_changed');
});
test('repairing even the same couple invalidates a prior attempt and its receipt',async()=>{
 const oldVersion=await version();await submit('old');
 await query("update pairings set created_at=created_at+interval '1 second'");
 assert.equal((await submit('old',{version:oldVersion})).error,'pair_changed');
 assert.equal((await submit('old')).error,'idempotency_conflict');
});
test('invalid dialogue, monster, or choice never charges quota or awards a wallet',async()=>{
 for(const extra of [{dialogue:'r00'},{dialogue:'r51'},{choice:4},{monster:'not-a-monster'}])assert.equal((await submit('bad',extra)).error,'invalid_request');
 assert.equal((await query('select * from kit_completions')).length,0);
});
test('legacy wrapper cannot bypass Free entitlement and old first-reward keys do not suppress new rewards',async()=>{
 const today=(await rpc('release_room_status_v1',[A])).localDate;
 await rpc('change_carrot_balance_v1',[A,5,'first_daily_rage','local_date',today,'rage-first:'+today]);
 const args=[A,'overthinking',20,JSON.stringify(['overthinking-final-original-1']),'legacy'];
 const first=await rpc('submit_burrow_rage_v1',args);assert.equal(first.carrotsAwarded,10);
 assert.equal((await rpc('submit_burrow_rage_v1',args)).applied,false);
 assert.equal((await rpc('submit_burrow_rage_v1',[...args.slice(0,4),'other'])).error,'daily_limit_reached');
 await query("update profiles set subscription_tier='plus' where id=$1",[A]);
 assert.equal((await submit('second')).carrotsAwarded,10);
});
test('wallet error rolls back the completion and all accounting; no public RPC grants',async()=>{
 await db.exec("alter table currency_ledger add constraint reject_reward check(reason<>'release_room_completed')");
 await assert.rejects(submit('fail'));
 // Error aborts this disposable transaction, then inspect from a fresh one.
 await db.exec('rollback;begin;');assert.equal((await query('select * from kit_completions')).length,0);
 assert.equal((await query('select * from currency_ledger')).length,0);
 const privileges=await query("select has_function_privilege('authenticated','submit_release_room_v1(uuid,text,text,integer,text,uuid,text)','execute') allowed");
 assert.equal(privileges[0].allowed,false);
});
