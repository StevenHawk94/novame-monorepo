// Aggregate checks and public asset HEADs only; never creates users or grants rewards.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error:console.error});
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const assertCount=async(table,count,filter)=>{const result=await filter(db.from(table).select('*',{count:'exact',head:true}));if(result.error)throw Error(`${table}: ${result.error.message}`);assert.equal(result.count,count);return result.count;};
const dialogs=await assertCount('adventure_dialogues_v2',450,q=>q.eq('status','active'));
const friends=await assertCount('friend_definitions',15,q=>q.eq('status','active').contains('metadata',{adventureV2:true}));
const gifts=await assertCount('catalog_items',483,q=>q.eq('status','active').contains('tags',['adventure_v2_gift']));
const kettles=await assertCount('catalog_items',42,q=>q.eq('status','active').eq('price',200).contains('metadata',{collection:'kettles',starter:false}));
await assertCount('catalog_items',1,q=>q.eq('status','active').eq('price',0).contains('metadata',{collection:'kettles',starter:true}));
const flag=await db.from('app_config').select('value').eq('key','adventure_friends_v2_enabled').single();
if(flag.error)throw Error(flag.error.message);
if(process.argv.includes('--expect-enabled'))assert.equal(flag.data.value,'true');
const chars=fs.readdirSync(path.join(root,'apps/api/src/data/adventure-friends')).map(file=>JSON.parse(fs.readFileSync(path.join(root,'apps/api/src/data/adventure-friends',file))));
for(const c of chars) {
  const gift=c.gifts[0],response=await fetch(`https://media.novameapp.com/${gift.key}`,{method:'HEAD',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,`CDN ${c.code}`);assert.equal(Number(response.headers.get('content-length')),gift.bytes);assert.match(response.headers.get('content-type')??'',/image\/webp/);
}
console.log(JSON.stringify({dialogs,friends,gifts,kettles,freeKettles:1,enabled:flag.data.value==='true',publicGiftCategoriesVerified:chars.length}));
