// Executes migration 253 against isolated PostgreSQL/WASM, never production.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let db;const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,args=[]) => (await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;
const url=path=>'https://example.test/storage/v1/object/public/avatars/'+path;
const prepare=(key=randomUUID(),owner=A)=>rpc('prepare_profile_avatar_v1',[owner,key]);
const complete=(path,owner=A)=>rpc('complete_profile_avatar_v1',[owner,path,url(path)]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid,encrypted_password text);
 create schema storage;create table storage.objects(bucket_id text,name text,created_at timestamptz default now());
 create table profiles(id uuid primary key,display_name text,birthday date,avatar_url text,is_default_avatar boolean default true,updated_at timestamptz);
 insert into profiles(id,display_name) values('${A}','Alex'),('${B}','Sam');
 insert into auth.users values('${A}',''),('${B}','not-a-real-hash');`);
 await db.exec(readFileSync('supabase/migrations/20261020000253_profile_avatar_lifecycle.sql','utf8'));
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());
test('account read returns password presence only, and is service-only',async()=>{
 assert.equal((await rpc('read_account_profile_v1',[A])).has_password,false);
 const profile=await rpc('read_account_profile_v1',[B]);assert.equal(profile.has_password,true);assert.equal(profile.encrypted_password,undefined);
 await db.exec('set local role authenticated');await assert.rejects(()=>rpc('read_account_profile_v1',[A]),/permission denied/);
});
test('retry key is stable; newest intent wins even when old completion arrives first',async()=>{
 const key=randomUUID(),first=await prepare(key);assert.deepEqual(await prepare(key),first);
 const second=await prepare();assert.notEqual(second.path,first.path);
 assert.equal((await complete(first.path)).superseded,true);assert.equal((await complete(second.path)).superseded,false);
 assert.equal((await complete(first.path)).avatarUrl,url(second.path));
 assert.equal((await q('select count(*)::int n from profile_avatar_uploads'))[0].n,2);
});
test('lost commit response is idempotent and old replay cannot restore an old image',async()=>{
 const first=await prepare();await complete(first.path);assert.equal((await complete(first.path)).superseded,false);
 const second=await prepare();await complete(second.path);
 assert.equal((await complete(first.path)).superseded,true);
 assert.equal((await q('select avatar_url from profiles where id=$1',[A]))[0].avatar_url,url(second.path));
 assert.ok((await q('select path from profile_avatar_garbage')).some(r=>r.path===first.path));
});
test('legacy pre-rollout paths work, retired tombstones prevent resurrection after deletion',async()=>{
 const path=A+'/123456789.jpg';assert.equal((await complete(path)).superseded,false);
 const next=await prepare();await complete(next.path);
 await q("update profile_avatar_garbage set deleted_at=now() where path=$1",[path]);
 assert.equal((await complete(path)).superseded,true);
 assert.equal((await rpc('collect_profile_avatar_garbage_v1')).includes(path),false);
});
test('cleanup excludes current images and live pending tickets, queues only strict owned orphan paths',async()=>{
 const current=await prepare();await complete(current.path);const pending=await prepare();
 const orphan=A+'/deadbeef.jpg';
 for(const path of [current.path,pending.path,orphan,'shared/logo.png'])await q("insert into storage.objects values('avatars',$1,now()-interval '2 days')",[path]);
 await rpc('collect_profile_avatar_garbage_v1');await db.exec("update profile_avatar_garbage set not_before=now()-interval '1 second'");
 assert.deepEqual(await rpc('collect_profile_avatar_garbage_v1'),[orphan]);
});
test('expired uploads cannot become current and cross-owner paths are rejected',async()=>{
 const pending=await prepare();await q("update profile_avatar_uploads set created_at=now()-interval '2 days'");
 assert.equal((await complete(pending.path)).superseded,true);
 assert.equal((await complete(B+'/deadbeef.jpg')).error,'invalid_path');
});
test('offline pending job can renew an expired ticket with same key, never reviving its retired path',async()=>{
 const key=randomUUID(),old=await prepare(key);await q("update profile_avatar_uploads set created_at=now()-interval '2 days'");
 const renewed=await prepare(key);assert.notEqual(renewed.path,old.path);
 assert.equal((await complete(old.path)).superseded,true);assert.equal((await complete(renewed.path)).superseded,false);
 assert.equal((await q('select count(*)::int n from profile_avatar_uploads'))[0].n,1);
});
test('expired old-device intent cannot renew past a newer selection on another device',async()=>{
 const key=randomUUID(),old=await prepare(key);await q("update profile_avatar_uploads set created_at=now()-interval '2 days'");
 const latest=await prepare();await complete(latest.path);assert.equal((await prepare(key)).path,old.path);
 assert.equal((await complete(old.path)).superseded,true);assert.equal((await q('select avatar_url from profiles where id=$1',[A]))[0].avatar_url,url(latest.path));
});
test('profile deletion queues own latest image, retains unrelated owner image and removes upload tickets',async()=>{
 const a=await prepare(),b=await prepare(randomUUID(),B);await complete(a.path);await complete(b.path,B);
 await q('delete from profiles where id=$1',[A]);assert.deepEqual((await q('select path from profile_avatar_garbage')).map(r=>r.path),[a.path]);
 assert.equal((await q('select count(*)::int n from profile_avatar_uploads where user_id=$1',[A]))[0].n,0);
 assert.equal((await q('select avatar_url from profiles where id=$1',[B]))[0].avatar_url,url(b.path));
});
test('transaction failure rolls back both profile change and cleanup queue',async()=>{
 const first=await prepare();await complete(first.path);const next=await prepare();
 await db.exec('savepoint failed_write');await complete(next.path);await db.exec('rollback to failed_write');
 assert.equal((await q('select avatar_url from profiles where id=$1',[A]))[0].avatar_url,url(first.path));
 assert.equal((await q('select count(*)::int n from profile_avatar_garbage'))[0].n,0);
});
