// Production smoke checks: reads only and deliberately invalid submissions.
// Never creates accounts, completes battles, consumes quota, or awards coins.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error:console.error});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref=fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim();
assert.equal(new URL(url).hostname,`${ref}.supabase.co`,'Local credentials must target the linked project');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const flag=await db.from('app_config').select('value').eq('key','app_major_update_enabled').single();
assert.ifError(flag.error);assert.ok(['true','1'].includes(flag.data.value));
// Read one ID only; do not print identity or personal statistics.
const profiles=await db.from('profiles').select('id').limit(1);
assert.ifError(profiles.error);assert.equal(profiles.data.length,1);
const result=await db.rpc('release_room_status_v1',{p_user_id:profiles.data[0].id});
assert.ifError(result.error);assert.equal(result.data.error,null);
const status=result.data;
assert.equal(status.monsters.length,8);assert.equal(status.dailyLimit,status.hasPlus?2:1);
assert.ok(Number.isInteger(status.tamesToday));assert.ok(Number.isFinite(Date.parse(status.serverNow)));
for(const monster of status.monsters){assert.ok(Number.isInteger(monster.tamedCount));assert.ok(monster.partnerTamedCount===null||Number.isInteger(monster.partnerTamedCount));}
const invalid={p_user_id:profiles.data[0].id,p_monster_id:'__invalid_smoke_check__',p_dialogue_id:'r01',p_choice:0,p_key:'__invalid_smoke_check__',p_partner_id:null,p_pair_version:null};
const rejected=await db.rpc('submit_release_room_v1',invalid);
assert.ifError(rejected.error);assert.equal(rejected.data.error,'invalid_request');
const old=await db.rpc('submit_burrow_rage_v1',{p_user_id:profiles.data[0].id,p_monster_id:'overthinking',p_hits:0,p_skills:[],p_key:'__invalid_smoke_check__'});
assert.ifError(old.error);assert.equal(old.data.error,'invalid_request');
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(anonKey,'Anon key is required to verify RPC grants');
const anon=createClient(url,anonKey,options);
for(const [name,args] of [['release_room_status_v1',{p_user_id:profiles.data[0].id}],['submit_release_room_v1',invalid]]){
 const denied=await anon.rpc(name,args);assert.equal(denied.error?.code,'42501',`${name} must not be public`);
}
console.log(JSON.stringify({linkedProjectVerified:true,rolloutEnabled:true,statusMonsters:8,serviceRpcValidated:true,invalidSubmissionsRejected:true,anonymousRpcDenied:true,productionUserWrites:0}));
if(process.argv.includes('--api')){
 const api='https://api.soulsayit.com/api/vnext/release-room';
 for(const method of ['GET','POST']){
  const response=await fetch(api,{method,signal:AbortSignal.timeout(20000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  assert.equal(response.status,401,`${method} must require authentication`);
  assert.equal((await response.json()).error,'Unauthorized');
  assert.match(response.headers.get('cache-control')??'',/no-store/);
 }
 console.log(JSON.stringify({api,methods:['GET','POST'],authenticationRequired:true,cache:'no-store'}));
}
