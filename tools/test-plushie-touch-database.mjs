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
test('send is atomic, ready on commit, receiver may view unowned toy without inventory/economy changes; replay and seen are idempotent',async()=>{
 const before=await q('select * from wallets order by user_id'),input=await args(),r=await rpc('send_plushie_touch_v1',input);assert.equal(r.success,true);
 assert.deepEqual(await rpc('send_plushie_touch_v1',input),r);assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,1);
 const state=await rpc('plushie_touch_state_v1',[B,await pairVersion()]);assert.equal(state.items.length,1);assert.equal(state.items[0].read_at,null);
 const detail=await rpc('read_plushie_touch_v1',[B,await pairVersion(),r.messageId,false]);assert.deepEqual(detail.message.clip,clip());assert.equal(detail.message.toy.stable_id,toy);
 assert.equal(detail.message.photo.ownerId,A);assert.ok(!JSON.stringify(detail).includes('private/fixture'));
 assert.equal((await rpc('read_plushie_touch_v1',[A,await pairVersion(),r.messageId,false])).error,'not_found');
 assert.equal((await rpc('read_plushie_touch_v1',[C,await pairVersion(),r.messageId,false])).error,'pair_changed');
 assert.deepEqual(await q('select * from wallets order by user_id'),before);assert.equal((await q('select count(*)::int n from currency_ledger'))[0].n,0);
 assert.equal((await q('select count(*)::int n from user_inventory where owner_id=$1',[B]))[0].n,0);
 await rpc('read_plushie_touch_v1',[B,await pairVersion(),r.messageId,true]);const read=(await q('select read_at from plushie_touch_messages'))[0].read_at;
 await rpc('read_plushie_touch_v1',[B,await pairVersion(),r.messageId,true]);assert.deepEqual((await q('select read_at from plushie_touch_messages'))[0].read_at,read);
});
test('monthly/day limits independent of message deletion; same-key-different-clip, stale day, foreign photo and fake payload rejected',async()=>{
 assert.equal((await rpc('send_plushie_touch_v1',await args({day:'2000-01-01'}))).error,'touch_period_expired');
 assert.equal((await rpc('send_plushie_touch_v1',await args({photo:randomUUID()}))).error,'touch_toy_unavailable');
 for(const invalid of [{...clip(),touches:999},{...clip(),durationMs:59999},{...clip(),version:undefined},{...clip(),events:[[0,2,0,0,0]]}])assert.equal((await rpc('send_plushie_touch_v1',await args({clip:invalid}))).error,'invalid_request');
 const input=await args();await rpc('send_plushie_touch_v1',input);const altered=[...input];altered[7]={version:1,durationMs:60000,touches:1,events:[[0,4,0,0,0]]};
 assert.equal((await rpc('send_plushie_touch_v1',altered)).error,'idempotency_conflict');
 await q('delete from plushie_touch_messages');assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'touch_quota_used');
});
test('Free keeps newest ONE including unread replacement, Plus keeps 30 days; replay of replaced record cannot resurrect it',async()=>{
 const input=await args(),first=await rpc('send_plushie_touch_v1',input);
 await q("update plushie_touch_sends set local_date=(date_trunc('month',now())-interval '1 day')::date");
 const second=await rpc('send_plushie_touch_v1',await args());assert.equal(second.success,true);
 const rows=await q('select id,read_at from plushie_touch_messages');assert.equal(rows.length,1);assert.equal(rows[0].id,second.messageId);assert.equal(rows[0].read_at,null);
 assert.deepEqual(await rpc('send_plushie_touch_v1',input),first);assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,1);
 await plus();await q("update plushie_touch_sends set local_date=current_date-1");await rpc('send_plushie_touch_v1',await args());
 assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,2);
 await q("update plushie_touch_messages set created_at=now()-interval '31 days' where id=$1",[second.messageId]);
 assert.equal((await rpc('plushie_touch_state_v1',[B,await pairVersion()])).items.length,1);
});
test('Plus one/day and upgrade same day not additive; downgrade cannot recover a monthly free send',async()=>{
 await rpc('send_plushie_touch_v1',await args());await plus();assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'touch_quota_used');
 await q('update plushie_touch_sends set local_date=current_date-1');assert.equal((await rpc('send_plushie_touch_v1',await args())).success,true);
 assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'touch_quota_used');
});
test('unlink deletes message data and pending notifications, retains non-content quota, old pair and third party never regain access',async()=>{
 const input=await args();await rpc('send_plushie_touch_v1',input);await q('delete from pairings where user_id in($1,$2)',[A,B]);
 assert.equal((await q('select count(*)::int n from plushie_touch_messages'))[0].n,0);
 assert.equal((await q("select count(*)::int n from notification_outbox where event_type='plushie_touch'"))[0].n,0);
 assert.equal((await q('select count(*)::int n from plushie_touch_sends'))[0].n,1);assert.equal((await rpc('send_plushie_touch_v1',input)).error,'pair_changed');
 await rpc('pair_immediately',[A,C,'Partner',null]);assert.equal((await rpc('send_plushie_touch_v1',input)).error,'pair_changed');
});
test('send-time Push recheck suppresses read/replaced/expired payload and cross economic domain; sensitive tables/RPC deny clients',async()=>{
 const r=await rpc('send_plushie_touch_v1',await args()),payload=(await q("select payload from notification_outbox where event_type='plushie_touch'"))[0].payload;
 assert.equal((await rpc('system_notification_context_v1',[B,'plushie_touch',payload])).allowed,true);
 await rpc('read_plushie_touch_v1',[B,await pairVersion(),r.messageId,true]);assert.equal((await rpc('system_notification_context_v1',[B,'plushie_touch',payload])).allowed,false);
 await rpc('admit_store_economic_domain_v1',[B,'sandbox']);assert.equal((await rpc('send_plushie_touch_v1',await args())).error,'economic_domain_conflict');
 for(const role of ['anon','authenticated']){
  for(const table of ['plushie_touch_messages','plushie_touch_sends'])for(const action of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('select has_table_privilege($1,$2,$3) yes',[role,table,action]))[0].yes,false);
  for(const sig of ['send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb)','read_plushie_touch_v1(uuid,text,uuid,boolean)','prune_plushie_touch_v1(uuid)','cleanup_plushie_touch_v1()'])assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') yes",[role,sig]))[0].yes,false);
 }
});
test('message-only photo access supports a face created solo, never grants unrelated history, and expires immediately on unlink',async()=>{
 await q('update room_photos set pair_low=$1,pair_high=$1 where id=$2',[A,photo]);
 assert.equal((await rpc('read_plushie_touch_photo_v1',[B,photo])).error,'not_found');
 await rpc('send_plushie_touch_v1',await args());assert.equal((await rpc('read_plushie_touch_photo_v1',[B,photo])).path,'private/fixture.jpg');
 assert.equal((await rpc('read_plushie_touch_photo_v1',[C,photo])).error,'not_found');
 assert.equal((await rpc('read_plushie_touch_photo_v1',[B,randomUUID()])).error,'not_found');
 await q('delete from pairings where user_id in($1,$2)',[A,B]);assert.equal((await rpc('read_plushie_touch_photo_v1',[B,photo])).error,'not_found');
});
test('clip validators agree on null/extra fields and byte boundaries; deleted photos do not break stored toy playback',async()=>{
 for(const bad of [null,{},[],{...clip(),version:null},{...clip(),touches:null},{...clip(),extra:1},{...clip(),events:[[0,4,0,null,0]]}])assert.equal(await rpc('valid_plushie_touch_clip_v1',[bad]),false);
 const r=await rpc('send_plushie_touch_v1',await args());await q('delete from room_photos where id=$1',[photo]);
 const m=(await rpc('read_plushie_touch_v1',[B,await pairVersion(),r.messageId,false])).message;assert.equal(m.photo,null);assert.deepEqual(m.clip,clip());
});
