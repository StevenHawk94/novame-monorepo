import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {before,after,beforeEach,afterEach,test} from 'node:test';import assert from 'node:assert/strict';
import {securityTestDb} from './security-test-db.mjs';
let h,db,q,rpc;const A=randomUUID(),B=randomUUID(),C=randomUUID();let toy,photo;
const src=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
function definition(sql,name){const start=new RegExp('create(?: or replace)? function public\\.'+name+'\\s*\\(','i').exec(sql);
 const tail=sql.slice(start.index),d=/\bas\s+(\$[\w]*\$)/i.exec(tail),end=tail.indexOf(d[1],d.index+d[0].length);return tail.slice(0,end+d[1].length)+';';}
before(async()=>{
 h=await securityTestDb();({db,query:q,rpc}=h);
 await db.exec(`create table friendships(id uuid primary key default gen_random_uuid(),user_a uuid,user_b uuid,status text,requested_by uuid,relationship text,relationship_since date,accepted_at timestamptz,created_at timestamptz default now(),unique(user_a,user_b));
 alter table pairings add column relationship text;alter table pairings add column relationship_since date;
 create table device_push_tokens(id uuid,user_id uuid);alter table notification_outbox add column expires_at timestamptz;`);
 await db.exec(src('20260920000098_instant_pairing_and_onboarding_profiles'));
 await db.exec(definition(src('20260724000028_pairing_relationship_insights'),'set_pairing'));
 await db.exec(definition(src('20261020000254_system_notification_policy'),'system_notification_context_v1'));
 await db.exec(src('20261021000257_adventure_production_duration'));
 for(const n of ['20261025000273_bunny_identity','20261025000274_cooperative_adventure','20261025000275_bind_unpaired_adventure'])await db.exec(src(n));
 const deploy=JSON.parse(execFileSync(process.execPath,['tools/release-plushie-touch276.mjs','sql','/private/tmp/burrow-touch276-release.isolated'],{encoding:'utf8'}));
 for(const table of deploy.tables)if(!(await q('select to_regclass($1) id',[table]))[0].id)await db.exec(`create table public.${table}(guard_marker int);insert into public.${table} values(276);`);
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
 const guardUser=randomUUID();await assert.rejects(db.exec(deploy.sql.replace('create temporary table guard_rows_after',
  `insert into auth.users(id) values('${guardUser}');insert into profiles(id) values('${guardUser}');create temporary table guard_rows_after`)),/Protected user rows changed/);
 await db.exec('rollback');assert.equal((await q("select to_regclass('plushie_touch_messages') id"))[0].id,null);
 const result=await db.exec(deploy.sql);assert.ok(result.some(r=>r.rows?.some(v=>v.verified?.protectedRowsUnchanged)));
 const v2=JSON.parse(execFileSync(process.execPath,['tools/release-touch-note277.mjs','sql','/private/tmp/burrow-touch277-release.isolated'],{encoding:'utf8'}));
 await assert.rejects(db.exec(v2.sql.replace('create temporary table guard_rows_after',
  `update profiles set display_name='unexpected release mutation';create temporary table guard_rows_after`)),/Protected user rows changed/);
 await db.exec('rollback');assert.equal((await q("select to_regprocedure('plushie_touch_state_v2(uuid,text)') id"))[0].id,null);
 const migrated=await db.exec(v2.sql);assert.ok(migrated.some(r=>r.rows?.some(v=>v.verified?.protectedRowsUnchanged)));
});after(()=>db?.close());
beforeEach(async()=>{
 await db.exec('begin');await q('insert into auth.users(id) values($1),($2),($3)',[A,B,C]);
 await q('insert into profiles(id) values($1),($2),($3)',[A,B,C]);await q('insert into wallets(user_id,carrot_balance) values($1,500),($2,500),($3,500)',[A,B,C]);
 await rpc('pair_immediately',[A,B,'Partner',null]);
 toy=(await q("select stable_id from catalog_items where category='couple_dolls' and status='active' order by stable_id limit 1"))[0].stable_id;
 await q("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase')",[A,toy]);photo=randomUUID();
 await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by) values($1,least($2::uuid,$4::uuid),greatest($2::uuid,$4::uuid),$2,'doll',$3,'private/fixture.jpg',$2)",[photo,A,toy,B]);
});afterEach(()=>db.exec('rollback'));
const clip=()=>({version:1,durationMs:60000,touches:2,events:[[0,0,0,500,500],[34,1,0,600,600],[100,2,0,600,600],[500,4,0,0,0]]});
const pairVersion=()=>rpc('burrow_pair_version_v1',[A,B]);
async function args(patch={}){return Object.values({user:A,partner:B,pair:await pairVersion(),day:(await rpc('economic_calendar_v1',[A])).localDate,key:randomUUID(),toy,photo,clip:clip(),...patch});}
const plus=()=>rpc('reconcile_store_subscription_v3',[A,{store:'apple',environment:'production',credential:'touch-'+randomUUID(),transactionId:randomUUID(),productId:'novame.plus.monthly',state:'active',periodEnd:new Date(Date.now()+86400000*10).toISOString(),observedAt:new Date().toISOString(),eventAt:new Date().toISOString()}]);

const clip2=()=>({version:2,durationMs:60000,touches:5,events:[[0,0,0,500,500],[1700,1,0,800,500],[1999,2,0,800,500],[3000,5,0,0,0]]});
async function senderPhoto(user){await q("insert into user_inventory(owner_id,item_id,source) values($1,$2,'purchase') on conflict do nothing",[user,toy]);const id=randomUUID();await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by) values($1,least($2::uuid,$4::uuid),greatest($2::uuid,$4::uuid),$2,'doll',$3,'private/other.jpg',$2)",[id,user,toy,user===A?B:A]);return id;}
async function send2(user=A,photoId=photo){await q("update plushie_touch_sends set local_date=current_date-40 where user_id=$1",[user]);return rpc('send_plushie_touch_v1',await args({user,partner:user===A?B:A,photo:photoId,clip:clip2()}));}
test('v2 SQL validates hold count, two-finger shared ticks, cap, deadline and malformed schema; legacy remains readable',async()=>{
 for(const c of [clip2(),{version:2,durationMs:60000,touches:120,events:[[0,0,0,500,500],[100,0,1,500,500],[59999,2,0,500,500],[60000,3,1,500,500]]},clip()])assert.equal(await rpc('valid_plushie_touch_clip_v2',[c]),true);
 for(const c of [null,{}, {...clip2(),touches:4},{...clip2(),extra:1},{...clip2(),events:[[0,2,0,500,500]]},{version:2,durationMs:60000,touches:2,events:[[0,4,0,0,0],[60000,5,0,0,0]]}])assert.equal(await rpc('valid_plushie_touch_clip_v2',[c]),false);
 const old=await rpc('send_plushie_touch_v1',await args());assert.equal((await rpc('read_plushie_touch_v1',[B,await pairVersion(),old.messageId,false])).message.clip.version,1);
});
test('Free keeps latest incoming for EACH partner including unread; v2 hidden from old clients, quotas and economy unchanged',async()=>{
 const before=await q('select * from wallets order by user_id'),bp=await senderPhoto(B);
 const one=await send2(),other=await send2(B,bp),two=await send2();
 assert.equal(one.success,true);assert.equal(other.success,true);assert.equal(two.success,true);
 const a=await rpc('plushie_touch_state_v2',[A,await pairVersion()]),b=await rpc('plushie_touch_state_v2',[B,await pairVersion()]);
 assert.deepEqual(a.items.map(m=>m.id),[other.messageId]);assert.deepEqual(b.items.map(m=>m.id),[two.messageId]);assert.equal(b.items[0].read_at,null);assert.equal(b.items[0].touches,5);
 assert.equal((await rpc('read_plushie_touch_v2',[B,await pairVersion(),one.messageId,false])).error,'not_found');
 assert.equal((await rpc('plushie_touch_state_v1',[B,await pairVersion()])).items.length,0);
 assert.equal((await rpc('read_plushie_touch_v1',[B,await pairVersion(),two.messageId,true])).error,'not_found');
 assert.equal((await rpc('send_plushie_touch_v1',await args({clip:clip2()}))).error,'touch_quota_used');
 assert.deepEqual(await q('select * from wallets order by user_id'),before);assert.equal((await q('select count(*)::int n from currency_ledger'))[0].n,0);
});
test('Plus shared latest 10 includes both directions, has no 30-day TTL, sender replay cannot read recipient; lapse prunes irreversibly',async()=>{
 await plus();const bp=await senderPhoto(B),ids=[];
 for(let i=0;i<12;i++){const r=await send2(i%2?B:A,i%2?bp:photo);assert.equal(r.success,true);ids.push(r.messageId);}
 const pv=await pairVersion(),a=await rpc('plushie_touch_state_v2',[A,pv]),b=await rpc('plushie_touch_state_v2',[B,pv]);
 assert.equal(a.items.length,10);assert.deepEqual(a.items.map(m=>m.id),b.items.map(m=>m.id));assert.ok(!a.items.some(m=>ids.slice(0,2).includes(m.id)));
 await q("update plushie_touch_messages set created_at=now()-interval '60 days' where id=$1",[ids[2]]);
 assert.equal((await rpc('plushie_touch_state_v2',[A,pv])).items.length,10);assert.ok((await q('select expires_at from plushie_touch_messages')).every(m=>m.expires_at===null));
 const own=a.items.find(m=>m.sender_id===A);await rpc('read_plushie_touch_v2',[A,pv,own.id,true]);assert.equal((await q('select read_at from plushie_touch_messages where id=$1',[own.id]))[0].read_at,null);
 await rpc('read_plushie_touch_v2',[B,pv,own.id,true]);assert.notEqual((await q('select read_at from plushie_touch_messages where id=$1',[own.id]))[0].read_at,null);
 const store=(await q('select snapshot from store_subscription_states where user_id=$1',[A]))[0].snapshot;
 await rpc('reconcile_store_subscription_v3',[A,{...store,state:'expired',observedAt:new Date(Date.now()+1000).toISOString(),eventAt:new Date(Date.now()+1000).toISOString()}]);
 assert.equal(await rpc('burrow_has_plus_v1',[A]),false,JSON.stringify({profiles:await q('select id,subscription_tier from profiles where id in($1,$2)',[A,B]),subs:await q('select user_id,status,plan,current_period_end from subscriptions')}));
 assert.equal((await rpc('plushie_touch_state_v2',[A,pv])).items.length,1);assert.equal((await rpc('plushie_touch_state_v2',[B,pv])).items.length,1);
 assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,2);
 await plus();assert.equal((await rpc('plushie_touch_state_v2',[A,pv])).items.length,2);
});
test('send commits once, no extra quota on same-day upgrade, Push version is authoritative; unlink/re-pair revokes all content',async()=>{
 const input=await args({clip:clip2()}),r=await rpc('send_plushie_touch_v1',input);
 assert.deepEqual(await rpc('send_plushie_touch_v1',input),r);
 const payload=(await q("select payload from notification_outbox where event_type='plushie_touch'"))[0].payload;
 assert.equal((await rpc('system_notification_context_v1',[B,'plushie_touch',payload])).touchVersion,2);
 await plus();assert.equal((await rpc('plushie_touch_state_v2',[A,await pairVersion()])).remaining,0);
 assert.equal((await rpc('send_plushie_touch_v1',await args({clip:clip2()}))).error,'touch_quota_used');
 const pv=await pairVersion();await q('delete from pairings where user_id in($1,$2)',[A,B]);
 assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,0);
 assert.equal((await q("select count(*)::int n from notification_outbox where event_type='plushie_touch'"))[0].n,0);
 assert.equal((await q('select count(*)::int n from plushie_touch_sends'))[0].n,1);
 await rpc('pair_immediately',[A,C,'Partner',null]);assert.equal((await rpc('read_plushie_touch_v2',[B,pv,r.messageId,false])).error,'pair_changed');
});
test('v2 content and validators remain service-only, outsiders cannot read',async()=>{
 const r=await send2();assert.equal((await rpc('read_plushie_touch_v2',[C,await pairVersion(),r.messageId,false])).error,'pair_changed');
 for(const role of ['anon','authenticated'])for(const sig of ['valid_plushie_touch_clip_v2(jsonb)','plushie_touch_state_v2(uuid,text)','read_plushie_touch_v2(uuid,text,uuid,boolean)','system_notification_context_before_touch_v2(uuid,text,jsonb)'])assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') yes",[role,sig]))[0].yes,false);
});
