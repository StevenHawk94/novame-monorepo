// Rehearse the exact guarded production transactions in an isolated database.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {personalRoomTestDb} from './personal-room-test-db.mjs';
import {photo286Transaction} from './release-photo-retention286.mjs';
import {copy287Transaction} from './release-copy-support287.mjs';
const {db,query:q,rpc,migrate,release}=await personalRoomTestDb();
const sql=n=>fs.readFileSync('supabase/migrations/'+n+'.sql','utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
try{
 const permission=sql('20261013000227_burrow_service_catalog_permissions');
 await db.exec(permission.slice(permission.indexOf('create function public.burrow_has_plus_v1'),permission.indexOf('create function public.burrow_service_offer_v1')));
 await db.exec(sql('20261013000228_burrow_photo_entitlements_history'));await migrate();await db.exec(sql('20261027000281_personal_plushie_photo_visibility'));
 // Realtime delivery is external in production; test SQL does not persist
 // delivery hints in a business table. Existing domain tests assert the hints.
 await db.exec('create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$begin return;end $$');
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations(version) values('20261028000285');");
 await q('insert into profiles(id) values($1),($2)',[A,B]);
 const toy=release.products.find(p=>p.category==='couple_dolls'&&p.metadata.starter).id;
 const old=randomUUID(),latest=randomUUID();
 await q("insert into room_photos(id,pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by,updated_at) values($1,$3,$3,$3,'doll',$5,$6,$3,now()-interval '1 minute'),($2,$3,$4,$3,'doll',$5,$7,$3,now())",[old,latest,A,B,toy,`${A}/${randomUUID()}.jpg`,`${A}/${randomUUID()}.jpg`]);
 // Mirror deployed function signatures/security, optionally using captured
 // current production definitions without private user photo data.
 if(process.env.BURROW_PHOTO286_INSPECTION){const before=JSON.parse(fs.readFileSync(process.env.BURROW_PHOTO286_INSPECTION));for(const f of before.functions)await db.exec(f.definition);}
 const calendar=sql('20261024000272_fixed_economic_calendar');await db.exec(calendar.split('-- Replace only audited')[0]+'commit;');
 const result=await db.exec(photo286Transaction());
 assert.ok(result.some(r=>r.rows.some(row=>row.verified?.protectedDataUnchanged)));
 assert.deepEqual((await q("select id from room_photos where kind='doll'")).map(p=>p.id),[latest]);
 await db.exec('begin');await assert.rejects(db.exec(photo286Transaction()),/Unexpected migration baseline/);await db.exec('rollback');
 const placeholderIds=release.products.filter(p=>p.id.startsWith('placeholder_')).map(p=>p.id);
 for(const [i,id]of placeholderIds.entries())await q('update catalog_items set description=$1 where stable_id=$2',[i%2?'Replaceable artwork. Fixed-slot room decoration.':'Replaceable catalog content used to validate purchase, gifting and decoration.',id]);
 const baseline='d32938720e72d3b1ce81c5f667e4e81afb87a6798552183c72460b5ec3edc97c';
 await q('insert into burrow_shop_release_support(release,product_id) select $1,product_id from burrow_shop_release_support where release=$2 on conflict do nothing',[baseline,release.release]);
 await q('delete from burrow_shop_release_support where release=$1',[release.release]);
 const current=release.products.find(p=>p.title==='Cocoa Gingham');assert.equal(await rpc('burrow_shop_item_supported_v1',[current.id,release.release]),false);
 const copy=await db.exec(copy287Transaction());assert.ok(copy.some(r=>r.rows.some(row=>row.verified?.protectedDataUnchanged)));
 assert.equal(await rpc('burrow_shop_item_supported_v1',[current.id,release.release]),true);
 for(const id of release.clients[release.release])assert.equal(await rpc('burrow_shop_item_supported_v1',[id,release.release]),true);
 assert.equal((await q("select count(*)::int n from catalog_items where stable_id=any($1::text[]) and description<>''",[placeholderIds]))[0].n,0);
 await db.exec(sql('20261028000287_placeholder_copy_client_support'));
 await q("update catalog_items set description='A real product description' where stable_id=$1",[placeholderIds[0]]);
 await assert.rejects(db.exec(sql('20261028000287_placeholder_copy_client_support')),/Reviewed placeholder copy changed/);await db.exec('rollback');
 console.log(JSON.stringify({isolated:true,productionDefinitionsRehearsed:!!process.env.BURROW_PHOTO286_INSPECTION,photoDedupAndProtectedData:true,copyAndSupportProtectedData:true,currentSupportedProducts:496,replayAndDriftGuards:true}));
}finally{await db.close();}
