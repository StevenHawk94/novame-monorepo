const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('music migration: free Lofi, authoritative shared Plus, no purchase/ownership, inventory unaffected',
  {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const me='00000000-0000-0000-0000-000000000001',partner='00000000-0000-0000-0000-000000000002';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table profiles(id uuid primary key,subscription_tier text);
      create table pairings(user_id uuid primary key,partner_user_id uuid);
      create function lock_burrow_pair(p_user uuid) returns uuid language sql as $$
        select p.partner_user_id from pairings p join pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id where p.user_id=p_user;
      $$;
      create table content_revisions(id text primary key,status text);
      create table catalog_items(stable_id text primary key,item_type text,title text,description text,price int,plus_only boolean,status text,asset jsonb,is_placeholder boolean,revision_id text);
      create table user_inventory(owner_id uuid,item_id text references catalog_items(stable_id));
      create table room_music(owner_id uuid primary key,track_id text references catalog_items(stable_id),updated_at timestamptz default now());
      create table wallets(user_id uuid primary key,carrot_balance int);
      insert into content_revisions values('v1','published');
      insert into catalog_items values
      ('placeholder_music_calm','music','old','old',0,false,'active','{"bundleKey":"calm"}',true,'v1'),
      ('placeholder_music_dream','music','old','old',777,false,'active','{"bundleKey":"dream"}',true,'v1'),
      ('placeholder_music_02','music','old','old',300,false,'active','{"renderer":"native"}',true,'v1'),
      ('music_quiet_cave_01','music','Quiet Cave','silent',0,false,'active','{"renderer":"none"}',true,'v1'),
      ('not_music','toy','Toy','toy',100,false,'active','{}',false,'v1');
      insert into profiles values('${me}','free'),('${partner}','plus');
      insert into wallets values('${me}',99);
      insert into user_inventory values('${me}','placeholder_music_dream');
      insert into room_music values('${me}','placeholder_music_dream');`);
    const sql=fs.readFileSync('supabase/migrations/20261009000210_burrow_bundled_music.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    const {rows}=await db.query("select * from catalog_items where item_type='music' order by stable_id");
    assert.equal(rows.length,4);assert.equal(rows.find(row=>row.stable_id==='music_quiet_cave_01').title,'Quiet Cave');
    assert.equal(rows.find(row=>row.stable_id==='placeholder_music_calm').plus_only,false);
    for(const [id,key]of [['placeholder_music_dream','lullaby'],['placeholder_music_02','jazz']]){
      const row=rows.find(row=>row.stable_id===id);assert.equal(row.price,0);assert.equal(row.plus_only,true);assert.equal(row.asset.bundleKey,key);
    }
    assert.equal((await db.query('select item_id from user_inventory')).rows[0].item_id,'placeholder_music_dream');
    assert.equal((await db.query('select track_id from room_music')).rows[0].track_id,'placeholder_music_dream');
    const select=async(id,user=me)=>(await db.query('select select_room_music_v1($1,$2) as value',[user,id])).rows[0].value;
    assert.equal((await select('placeholder_music_calm')).error,null,'free track without inventory');
    assert.equal((await select('placeholder_music_dream')).error,'plus_required','old ownership does not bypass entitlement');
    assert.equal((await select('placeholder_music_02')).error,'plus_required');
    assert.equal((await select(null)).error,null,'None always works');
    assert.equal((await select('missing')).error,'not_found');assert.equal((await select('not_music')).error,'not_found');
    assert.equal((await select(null,'00000000-0000-0000-0000-000000000003')).error,'profile_not_found');
    await db.exec(`insert into pairings values('${me}','${partner}');`);
    assert.equal((await select('placeholder_music_02')).error,'plus_required','one-way or stale partner cannot lend Plus');
    await db.exec(`insert into pairings values('${partner}','${me}');`);
    assert.equal((await select('placeholder_music_02')).error,null,'reciprocal partner Plus without purchase');
    await db.exec(`delete from pairings;update profiles set subscription_tier='plus' where id='${me}';`);
    assert.equal((await select('placeholder_music_dream')).error,null,'solo own Plus');
    await db.exec(`update profiles set subscription_tier='free' where id='${me}';`);
    assert.equal((await select('placeholder_music_dream')).error,'plus_required','expired Plus stops new selection');
    await db.exec("update content_revisions set status='draft';");
    assert.equal((await select('placeholder_music_calm')).error,'not_found','unpublished songs inaccessible');
    assert.equal((await select(null)).error,null,'can stop even with unpublished content');
    assert.equal((await db.query('select carrot_balance from wallets')).rows[0].carrot_balance,99);
    const acl=(await db.query(`select has_function_privilege('service_role','select_room_music_v1(uuid,text)','execute') as service,
      has_function_privilege('authenticated','select_room_music_v1(uuid,text)','execute') as client,
      has_function_privilege('anon','select_room_music_v1(uuid,text)','execute') as anon`)).rows[0];
    assert.deepEqual(acl,{service:true,client:false,anon:false});
  }finally{await db.close();}
});
