// Approved, scoped release stages. No real-user claims/purchases or asset deletion.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-shop260-release.'));
assert.equal(fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const files=['20261022000259_bundled_shop_catalog','20261022000260_duchess_gift_art_refresh'];
const md5=s=>createHash('md5').update(s).digest('hex');
const sources=files.map(n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8'));
const changed=['prepare_adventure_encounters_v2','save_room_loadout_v1','solo_burrow_loadout_v1','save_bunny_outfit_v1','solo_burrow_outfit_v1','burrow_toy_photo_target_allowed_v1'];
const json=(name,value)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
function query(sql){
 const input=dir+'/request.sql';fs.writeFileSync(input,sql,{mode:0o600});
 const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',input],{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));
 return Array.isArray(r)?r:r.rows;
}
const sqlQuote=s=>"'"+s.replaceAll("'","''")+"'";
const tableNames=['user_inventory','adventure_gift_display','wallets','currency_ledger','burrow_command_receipts','adventures','daily_quest_assignments','quest_progress_vnext','moment_events'];
const snapshot=tableNames.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
function state(){return query(`select jsonb_build_object(
 'migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version in('20261022000258','20261022000259','20261022000260')),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'),
 'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.burrow_surprises'::regclass and conname='burrow_surprises_frame_check'),
 'gifts',(select jsonb_agg(jsonb_build_object('id',stable_id,'asset',asset)) from catalog_items where metadata->>'friendId'='adventure_friend_dc' and metadata->>'giftCategoryCode'='C11'),
 'catalog',(select jsonb_agg(to_jsonb(c) order by stable_id) from catalog_items c where category in('outfits','wallpapers','couple_dolls','cushions','tables','rugs','vases','lamps','windows','cabinets','music_players','frames','dresser_plants','light_strings','ladders','shelves','games','surprises') and revision_id=(select value from app_config where key='app_major_update_content_revision')),
 'active',(select value from app_config where key='burrow_shop_active_release')
 ) state;`)[0].state;}
function checkFunctions(before,after){for(const [oid,old]of Object.entries(before.functions)){
 const current=after.functions[oid];assert.ok(current,'Existing function removed: '+old.name);
 assert.deepEqual(current.grants,old.grants,'Function grants changed: '+old.name);
 if(!changed.includes(old.name))assert.equal(current.definition,old.definition,'Unrelated function changed: '+old.name);
}}
function register(index){const version=files[index].split('_')[0],name=files[index].slice(15),source=sources[index];
 return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${sqlQuote(source)}]);`;
}
function body(index){return sources[index].replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');}
const beforeRows=`create temporary table release260_before on commit drop as ${snapshot};`;
const assertRows=`create temporary table release260_after on commit drop as ${snapshot};do $row_guard$ begin if exists(select * from release260_before except select * from release260_after) or exists(select * from release260_after except select * from release260_before) then raise exception 'Protected business rows changed';end if;end $row_guard$;`;
function run(name,sql){fs.writeFileSync(dir+'/'+name+'.sql',sql,{mode:0o600});return query(sql);}
if(mode==='inspect'){
 const before=state();assert.ok(before.migrations['20261022000258']);assert.ok(!before.migrations['20261022000259']);assert.equal(before.gifts.length,32);json('before',before);
 fs.writeFileSync(dir+'/restore-original-functions.sql','begin;\n'+Object.values(before.functions).filter(f=>changed.includes(f.name)).map(f=>f.definition+';').join('\n')+'\ncommit;',{mode:0o600});
 console.log(JSON.stringify({preflight:true,functionsBackedUp:Object.keys(before.functions).length,products:before.catalog.length,gifts:before.gifts.length}));
}else if(mode==='migrate'){
 const before=JSON.parse(fs.readFileSync(dir+'/before.json'));const current=state();checkFunctions(before,current);assert.ok(!current.migrations['20261022000259']);
 run('apply259',`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';${beforeRows}${body(0)}${assertRows}${register(0)}commit;`);
 const after=state();checkFunctions(before,after);assert.equal(after.migrations['20261022000259'],md5(sources[0]));assert.equal(after.active,null);json('after259',after);
 console.log(JSON.stringify({migration:259,registered:true,protectedRowsUnchanged:true,unrelatedFunctionsUnchanged:true,catalogNotPublishedYet:true}));
}else if(mode==='publish'){
 const before=JSON.parse(fs.readFileSync(dir+'/before.json')),current=state();assert.equal(current.migrations['20261022000259'],md5(sources[0]));assert.ok(!current.migrations['20261022000260']);checkFunctions(before,current);
 const baseline=JSON.parse(fs.readFileSync(dir+'/baseline-publication.json')),latest=JSON.parse(fs.readFileSync('catalog/generated/shop-catalog-release.json'));
 assert.equal(baseline.products.length,before.catalog.length);assert.equal(latest.legacyRelease,baseline.legacyRelease);
 const existingIds=JSON.stringify(before.catalog.map(c=>({product_id:c.stable_id})));
 // A previous validated release is registered in the same transaction as the
 // final catalog, so consumers never observe an intermediate state.
 const receipts=run('publish260',`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';${beforeRows}
 create temporary table retained_prices on commit drop as select stable_id,price,plus_only,tradable,shop_price_version from catalog_items where stable_id in(select product_id from jsonb_to_recordset(${sqlQuote(existingIds)}::jsonb) as ids(product_id text));
 select publish_burrow_shop_catalog_v1(${sqlQuote(JSON.stringify(baseline))}::jsonb);
 select publish_burrow_shop_catalog_v1(${sqlQuote(JSON.stringify(latest))}::jsonb);
 ${body(1)}${register(1)}${assertRows}
 do $prices$ begin if exists(select p.* from retained_prices p except select c.stable_id,c.price,c.plus_only,c.tradable,c.shop_price_version from catalog_items c join retained_prices p on p.stable_id=c.stable_id) then raise exception 'Admin prices/Plus changed';end if;end $prices$;
 commit;`);
 const after=state();checkFunctions(before,after);assert.equal(after.active,latest.release);assert.equal(after.migrations['20261022000260'],md5(sources[1]));json('verified',after);json('receipts',receipts);
 // Roll back presentation using the saved catalog and old immutable gift URLs.
 const giftUpdates=JSON.parse(sources[1].split('$gift_art260$')[1]);
 const restoreGifts=before.gifts.map(g=>{
  const update=giftUpdates.find(u=>u.id===g.id);assert.ok(update);
  const asset=sqlQuote(JSON.stringify(g.asset))+'::jsonb',id=sqlQuote(g.id),key=sqlQuote(update.asset.key);
  return `update catalog_items set asset=${asset} where stable_id=${id} and asset->>'key'=${key};
update adventure_encounter_plans set snapshot=jsonb_set(snapshot,'{giftSnapshot,asset}',${asset}) where gift_id=${id} and snapshot->'giftSnapshot'->>'stable_id'=${id} and snapshot->'giftSnapshot'->'asset'->>'key'=${key};
update adventure_results set metadata=jsonb_set(metadata,'{giftSnapshot,asset}',${asset}) where metadata->'giftSnapshot'->>'stable_id'=${id} and metadata->'giftSnapshot'->'asset'->>'key'=${key};
update adventure_results set metadata=jsonb_set(metadata,'{itemSnapshot,asset}',${asset}) where metadata->'itemSnapshot'->>'stable_id'=${id} and metadata->'itemSnapshot'->'asset'->>'key'=${key};`;
 }).join('\n');
 fs.writeFileSync(dir+'/rollback-presentation.sql',`begin;select rollback_burrow_shop_catalog_v1('${baseline.release}');\n${restoreGifts}\ncommit;`,{mode:0o600});
 console.log(JSON.stringify({migration:260,published:after.active,products:after.catalog.length,protectedRowsUnchanged:true,adminPricesPreserved:true,unrelatedFunctionsUnchanged:true}));
}else throw Error('Use inspect, migrate or publish');
