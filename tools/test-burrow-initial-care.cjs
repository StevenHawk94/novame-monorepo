// Executes the real default migration locally; never connects to Supabase.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const migration=sql('20261018000247_burrow_initial_care_needs.sql');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
test('migration 247 starts new solo and paired rooms at zero, without resetting any existing needs or timestamps',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create table profiles(id uuid primary key,subscription_tier text default 'free',timezone_name text default 'UTC');
      create table wallets(user_id uuid primary key,carrot_balance integer default 0);
      create table app_config(key text,value text);insert into app_config values('app_major_update_content_revision','live');
      create table content_revisions(id text,status text);insert into content_revisions values('live','published');
      create table catalog_items(stable_id text,revision_id text,status text,metadata jsonb);
      create table user_inventory(owner_id uuid,item_id text,source text,unique(owner_id,item_id));
      create function lock_burrow_pair(uuid) returns uuid language sql as $$select null::uuid$$;`);
    const foundation=sql('20260920000116_app_major_update_foundation.sql');
    await db.exec(foundation.match(/create table if not exists public\.room_needs \([\s\S]*?\n\);/)[0]);
    await db.query('insert into profiles(id) values($1),($2),($3)',[A,B,C]);
    await db.query("insert into room_needs(owner_id,food_value,water_value,food_updated_at,water_updated_at) values($1,73,100,'2026-10-17T12:00:00Z','2026-10-18T00:00:00Z')",[A]);
    await db.query('insert into wallets values($1,12345)',[A]);
    const before=(await db.query('select * from room_needs')).rows;
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual((await db.query('select * from room_needs')).rows,before,'migration is non-destructive and repeatable');
    assert.equal((await db.query('select carrot_balance from wallets')).rows[0].carrot_balance,12345);
    const solo=sql('20260920000147_burrow_solo_core.sql').match(/create or replace function public.solo_burrow_initialize_v1\(p_user_id uuid\)[\s\S]*?end \$\$;/)[0];
    await db.exec(solo);
    assert.equal((await db.query('select solo_burrow_initialize_v1($1) result',[B])).rows[0].result.initialized,true);
    // Same owner-only insertion as paired bootstrap: a returning existing
    // partner keeps their values while a newly initialized partner starts empty.
    const paired=sql('20260920000121_burrow_interactive_screens.sql').match(/insert into room_needs\(owner_id\) values\(p_user_id\),\(partner\) on conflict do nothing;/)[0];
    await db.query(paired.replace('p_user_id','$1').replace('(partner)','($2)'),[A,C]);
    const rows=(await db.query('select * from room_needs order by owner_id')).rows;
    assert.deepEqual(rows[0],before[0]);
    for(const row of rows.slice(1)){
      assert.equal(row.food_value,0);assert.equal(row.water_value,0);
      assert.ok(row.food_updated_at);assert.ok(row.water_updated_at);
    }
    await db.query('update room_needs set food_value=100,water_value=100 where owner_id=$1',[B]);
    await db.query('select solo_burrow_initialize_v1($1)',[B]);
    await db.exec(migration);
    assert.equal((await db.query('select food_value from room_needs where owner_id=$1',[B])).rows[0].food_value,100,'relaunch/migration cannot undo completed care');
  }finally{await db.close();}
});

test('fresh zero-percent rooms permit both interactions for either owner; successful care still blocks repeat entry',()=>{
  const care=load('apps/mobile/src/lib/burrow-care-cooldown.ts'),now=Date.now();
  const empty={food:0,water:0,foodValue:0,waterValue:0,foodUpdatedAt:new Date(now).toISOString(),waterUpdatedAt:new Date(now).toISOString()};
  const data={profile:{id:A},partner:{id:B},pairVersion:'one',serverNow:new Date(now).toISOString(),roomNeeds:{...empty},partnerNeeds:{...empty},moments:[]};
  for(const owner of [A,B])for(const need of ['food','water'])assert.equal(care.careCoolingDown(data,need,now,owner),false);
  care.markCareCompleted(A,'food',now);
  assert.equal(care.careCoolingDown(data,'food',now,A),true);
  assert.equal(care.careCoolingDown(data,'water',now,A),false);
  assert.equal(care.careCoolingDown(data,'food',now,B),false);
});

test('watering completion uses the approved copy and heart, keeping the shared title/body typography and Done exit',()=>{
  const h=hooks(),jsx=(type,props)=>({type,props}),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  const {CareQuestCelebration}=load('apps/mobile/src/components/burrow/care-quest-celebration.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:{addEventListener:()=>({remove(){}})},BackHandler:{addEventListener:()=>({remove(){}})},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}}},
    'react-native-reanimated':{...require('./motion-test-utils.cjs').motionHarness(h).reanimated,withSpring:value=>value},
  });
  let closed=0;
  const tree=nodes(h.render(()=>CareQuestCelebration({title:'Ahh!',message:'Your flower is fresh and growing.',icon:'heart',onClose:()=>closed++})));
  assert.equal(tree.find(n=>n.props?.children==='Ahh!').props.style.fontSize,22);
  assert.equal(tree.find(n=>n.props?.children==='Your flower is fresh and growing.').props.style.fontSize,15);
  assert.equal(tree.find(n=>n.props?.children==='❤️').props.style.fontSize,48);
  tree.find(n=>n.type==='Pressable').props.onPress();assert.equal(closed,1);h.unmount();
});
