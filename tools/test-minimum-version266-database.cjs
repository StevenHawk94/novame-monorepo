const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
test('minimum-version replacement is atomic, audit-preserving, idempotent and service-only; failed replacement retains prior active rule',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table force_updates(id uuid primary key default gen_random_uuid(),version text not null,min_version text,message text not null,platform text,is_active boolean default true,created_at timestamptz default clock_timestamp());insert into force_updates(version,min_version,message,platform) values('1.0.25','1.0.25','Old message','ios');");
  const source=fs.readFileSync('supabase/migrations/20261023000266_minimum_supported_version_policy.sql','utf8');await db.exec(source);
  const save=(v='1.0.26',message='Update',platform='ios',enabled=true)=>db.query('select save_minimum_app_version_v1($1,$2,$3,$4) result',[v,message,platform,enabled]);
  await save();assert.equal((await db.query('select count(*) n from force_updates where is_active')).rows[0].n,1);
  assert.equal((await db.query('select count(*) n from force_updates')).rows[0].n,2);await save();assert.equal((await db.query('select count(*) n from force_updates')).rows[0].n,2);
  await db.exec("create function reject_policy() returns trigger language plpgsql as $$begin raise exception 'insert failed';end$$;create trigger reject_policy before insert on force_updates for each row execute function reject_policy();");
  await assert.rejects(save('1.0.27'),/insert failed/);const active=(await db.query('select min_version from force_updates where is_active')).rows;assert.deepEqual(active,[{min_version:'1.0.26'}]);
  await assert.rejects(save('bad'),/invalid_policy/);assert.equal((await db.query('select count(*) n from force_updates')).rows[0].n,2);
  await save(null,null,null,false);assert.equal((await db.query('select count(*) n from force_updates where is_active')).rows[0].n,0);assert.equal((await db.query('select count(*) n from force_updates')).rows[0].n,2);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query(`select has_function_privilege('${role}','save_minimum_app_version_v1(text,text,text,boolean)','execute') allowed`)).rows[0].allowed,role==='service_role');
 }finally{await db.close();}
});
