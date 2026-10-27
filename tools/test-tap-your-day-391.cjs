const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
const {rows,assetFor}=require('./tap-day-test-data.cjs');
const groups=require('../packages/engine/src/items/tap-your-day-local.json');
const v4=require('../packages/engine/src/items/tap-your-day-v4.json');
const engine=load('packages/engine/src/items/tap-your-day.ts',{
 './tap-your-day-v1.json':require('../packages/engine/src/items/tap-your-day-v1.json'),
 './tap-your-day-v2.json':require('../packages/engine/src/items/tap-your-day-v2.json'),
 './tap-your-day-v4.json':v4,'./tap-your-day-local.json':groups,
});
const plain=x=>JSON.parse(JSON.stringify(x));
test('all 391 workbook names, classifications, default flags and supplied bytes match exactly',()=>{
 assert.equal(engine.TAP_YOUR_DAY_VERSION,'tap-your-day-v5');
 assert.equal(groups.length,14);assert.equal(rows.length,391);
 assert.deepEqual(plain(groups.flatMap(group=>['defaults','optional'].flatMap(key=>group[key].map(x=>({itemId:x.itemId,label:x.label,group:group.title,display:key==='defaults'?'默认':'可选添加'}))))),rows.map(({itemId,label,group,display})=>({itemId,label,group,display})));
 for(const row of rows)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(assetFor(row.itemId))).digest('hex'),row.sha256);
});
test('v4 meanings remain frozen; retired broad choices cannot be submitted as v5',async()=>{
 const noNetwork=()=>{throw Error('Manual selection must not use remote matching');};
 const resolve=load('apps/api/src/lib/reflect-draft.js',{'@novame/engine':{...engine,ITEM_DISPLAY_CATALOG:{}},'@supabase/supabase-js':{},'@/lib/remote-items':{getMergedDictionary:noNetwork},'@/lib/reflect-ai':{},'@/lib/connection-insight-v8':{}}).resolveDraftInput;
 assert.equal(v4.flatMap(g=>[...g.defaults,...g.optional]).length,187);
 for(const [id,label] of [['memory.0455_ice_cream','Dessert'],['memory.0557_beer','Alcohol'],['memory.4042_claw_hammer','DIY']]){
  assert.equal(engine.tapYourDayChoice(id),undefined);
  const old=await resolve(null,{mode:'prompt',selectionVersion:'tap-your-day-v4',selectedItems:[{itemId:id}],body:''});assert.equal(old.matches[0].label,label);
  assert.equal((await resolve(null,{mode:'prompt',selectionVersion:'tap-your-day-v5',selectedItems:[{itemId:id}]})).error,'invalid_selection_item');
 }
 assert.equal(engine.tapYourDayChoice('memory.new_driving','tap-your-day-v4'),undefined);
 assert.equal(engine.tapYourDayChoice('memory.1442_litter_box','tap-your-day-v4').label,'Caring for My Cat');
 assert.equal(engine.tapYourDayChoice('memory.1442_litter_box').label,'Cleaning the Litter Box');
});
test('migration 242 registers all 207 new IDs idempotently without changing historical rows or records',async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec('create table items(id text primary key,sheet_id text,row smallint,col smallint,display_name text,rarity text,category text);create table history(item_id text references items(id),label text);');
  await db.query('insert into items values($1,$2,0,0,$3,$4,$5)',['memory.0455_ice_cream','historical','Original name','rare','Food & Drink']);
  await db.exec("insert into history values('memory.0455_ice_cream','Dessert');");
  const migration=fs.readFileSync('supabase/migrations/20261016000242_tap_your_day_391_items.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from items')).rows[0].n,208);
  for(const [id,item] of Object.entries(require('../packages/engine/src/items/tap-your-day-display.json'))){const result=(await db.query('select display_name,rarity from items where id=$1',[id])).rows[0];assert.deepEqual(result,{display_name:item.displayName,rarity:'common'});await db.query('insert into history values($1,$2)',[id,item.displayName]);}
  assert.equal((await db.query("select display_name from items where id='memory.0455_ice_cream'")).rows[0].display_name,'Original name');
  assert.equal((await db.query("select label from history where item_id='memory.0455_ice_cream'")).rows[0].label,'Dessert');
 }finally{await db.close();}
});
