const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
test('migration 265 preserves existing announcements/read IDs, adds compatible defaults and rejects unsafe action values',async()=>{
 const db=new PGlite();try{
  await db.exec("create table app_announcements(id text primary key,title text,image_url text);create table user_read_announcements(user_id text,announcement_id text);insert into app_announcements values('one','Old news','https://example.com/a');insert into user_read_announcements values('A','one');");
  await db.exec(fs.readFileSync('supabase/migrations/20261023000265_announcement_launch_actions.sql','utf8'));
  const row=(await db.query('select * from app_announcements')).rows[0];assert.equal(row.button_text,'Continue');assert.equal(row.action_url,null);assert.equal(row.title,'Old news');
  assert.equal((await db.query('select count(*) n from user_read_announcements')).rows[0].n,1);
  for(const sql of ["update app_announcements set button_text=''","update app_announcements set action_url='javascript:alert(1)'", "update app_announcements set action_url='http://example.com'"]){await assert.rejects(db.exec(sql),/check constraint/);}
  await db.exec("update app_announcements set button_text='See news',action_url='https://example.com/news'");
 }finally{await db.close();}
});
