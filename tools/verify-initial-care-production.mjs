// Public read-only checks by default. --fixtures creates exactly two disposable
// QA identities, touches only their rows, and removes them in finally.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'apps/api/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/api'),false,{info(){},error(){}});
const {createClient}=require('@supabase/supabase-js');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(new URL(url).hostname,'qleeohkhbrdvznbwgqad.supabase.co');
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal??AbortSignal.timeout(25000)})}};
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const origin='https://api.soulsayit.com',runId=randomUUID(),purpose='codex-initial-care-247-verification';
const users=[],report={origin,runId,startedAt:new Date().toISOString(),checks:[],realUserWrites:0,cleanup:{complete:false}};
let failure;
const check=name=>{report.checks.push(name);console.log(JSON.stringify({passed:name}));};
async function api(route,user,{method='GET',body}={}){
  const response=await fetch(origin+route,{method,headers:{...(user?{Authorization:`Bearer ${user.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  assert.equal(response.status,user?200:401,`${route}: ${response.status} ${data.error??''}`);
  return data;
}
async function needs(user){
  assert.ok(users.includes(user));
  const result=await db.from('room_needs').select('*').eq('owner_id',user.id).single();assert.ifError(result.error);return result.data;
}
async function home(user,partnerId=null,food=0,water=0){
  const data=await api('/api/vnext/bootstrap?friendVisits=2',user);
  assert.equal(data.success,true);assert.equal(data.profile.id,user.id);assert.equal(data.partner?.id??null,partnerId);
  assert.equal(data.roomNeeds.foodValue,food);assert.equal(data.roomNeeds.waterValue,water);
  if(food===0)assert.equal(data.roomNeeds.food,0);
  if(water===0)assert.equal(data.roomNeeds.water,0);
  return data;
}
try{
  await api('/api/vnext/bootstrap?friendVisits=2');check('production bootstrap still rejects unauthenticated access');
  if(process.argv.includes('--fixtures')){
    for(let index=0;index<2;index++){
      const email=`codex-care247-${runId}-${index}@example.invalid`,password=randomBytes(32).toString('base64url');
      const created=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{purpose,verificationRun:runId},user_metadata:{display_name:`Care 247 QA ${index}`}});
      assert.ifError(created.error);
      const user={id:created.data.user.id,email,password};users.push(user);
      const client=createClient(url,key,options);
      const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
      user.token=signed.data.session.access_token;
      await api('/api/user-sync?userId='+user.id,user);
    }
    const [a,b]=users;
    await home(a);const initial=await needs(a);
    assert.equal(initial.food_value,0);assert.equal(initial.water_value,0);
    await home(a);assert.deepEqual(await needs(a),initial);
    check('new solo user starts hungry/thirsty at 0%; repeated production API reads do not reset timestamps');
    // Modify only our disposable fixture to represent an existing cared-for
    // room, then confirm pairing and a fresh login preserve its stored state.
    const stamp=new Date().toISOString();
    const updated=await db.from('room_needs').update({food_value:73,water_value:41,food_updated_at:stamp,water_updated_at:stamp}).eq('owner_id',a.id);
    assert.ifError(updated.error);const existing=await needs(a);
    await home(a,null,73,41);assert.deepEqual(await needs(a),existing);
    const status=await api('/api/friends/status?userId='+b.id,b);assert.ok(status.inviteCode);
    const paired=await api('/api/friends/add',a,{method:'POST',body:{userId:a.id,code:status.inviteCode,relationship:'Partner'}});
    assert.equal(paired.success,true);
    const ah=await home(a,b.id,73,41),bh=await home(b,a.id);
    assert.equal(ah.partnerNeeds.foodValue,0);assert.equal(ah.partnerNeeds.waterValue,0);
    assert.equal(bh.partnerNeeds.foodValue,73);assert.equal(bh.partnerNeeds.waterValue,41);
    assert.deepEqual(await needs(a),existing);const freshPartner=await needs(b);
    assert.equal(freshPartner.food_value,0);assert.equal(freshPartner.water_value,0);
    check('paired bootstrap gives the new partner 0% while preserving the existing room values and timestamps');
    for(const user of users){
      const client=createClient(url,key,options);
      const signed=await client.auth.signInWithPassword({email:user.email,password:user.password});assert.ifError(signed.error);
      user.token=signed.data.session.access_token;
    }
    await home(a,b.id,73,41);await home(b,a.id);
    assert.deepEqual(await needs(a),existing);assert.deepEqual(await needs(b),freshPartner);
    check('fresh sessions/relaunch-equivalent bootstrap reads retain each room state without reinitializing');
  }
}catch(error){failure=error;report.failure=error.message;}
finally{
  const cleanup=[];
  for(const user of users){
    try{
      const auth=await db.auth.admin.getUserById(user.id);assert.ifError(auth.error);
      assert.equal(auth.data.user.app_metadata?.purpose,purpose);assert.equal(auth.data.user.app_metadata?.verificationRun,runId);
      const removedProfile=await db.from('profiles').delete().eq('id',user.id);assert.ifError(removedProfile.error);
      const removed=await db.auth.admin.deleteUser(user.id);assert.ifError(removed.error);
      const remaining=await db.from('room_needs').select('owner_id').eq('owner_id',user.id);assert.ifError(remaining.error);assert.equal(remaining.data.length,0);
      const authAfter=await db.auth.admin.getUserById(user.id);assert.equal(authAfter.data.user,null);
      cleanup.push({id:user.id,removed:true});
    }catch(error){cleanup.push({id:user.id,removed:false,error:error.message});}
  }
  report.cleanup={complete:cleanup.every(row=>row.removed),identities:cleanup};
  report.passed=!failure&&report.cleanup.complete;report.completedAt=new Date().toISOString();
  const target=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);
  if(target)fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report));
}
if(!report.passed)process.exitCode=1;
