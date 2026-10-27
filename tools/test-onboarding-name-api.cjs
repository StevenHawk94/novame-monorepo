const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
function harness(file,{missing=false,owner='me'}={}){
  const writes=[];let inserts=0;
  const query={update(value){writes.push(value);return this;},upsert(value){writes.push(value);return this;},insert(value){writes.push(value);inserts++;return this;},eq(){return this;},select(){return this;},
    async single(){return missing&&!inserts?{data:null,error:{code:'PGRST116'}}:{data:writes.at(-1),error:null};}};
  const api=load(file,{'@supabase/supabase-js':{createClient:()=>({from:()=>query})},'@/lib/auth-guard':{verifyToken:async()=>({id:owner})}},
    {Response,process:{env:{}},Date});
  return {api,writes,post:body=>api.POST({json:async()=>body,headers:{get:()=> 'Bearer valid'}})};
}
for(const file of ['apps/api/src/app/api/update-profile/route.js','apps/api/src/app/api/user-sync/route.js']){
  test(`${file}: keeps all 20 onboarding name characters and caps longer requests`,async()=>{
    const h=harness(file),name='ABCDEFGHIJKLMNOPQRST';
    assert.equal((await h.post({userId:'me',displayName:name})).status,200);assert.equal(h.writes.at(-1).display_name,name);
    assert.equal((await h.post({userId:'me',displayName:name+'extra'})).status,200);assert.equal(h.writes.at(-1).display_name,name);
  });
  test(`${file}: still rejects writes to another account`,async()=>{
    const h=harness(file,{owner:'not-me'});assert.equal((await h.post({userId:'me',displayName:'Alex'})).status,401);assert.equal(h.writes.length,0);
  });
}
test('missing profile creation also keeps the 20-character name',async()=>{
  const h=harness('apps/api/src/app/api/update-profile/route.js',{missing:true}),name='ABCDEFGHIJKLMNOPQRST';
  assert.equal((await h.post({userId:'me',displayName:name})).status,200);assert.equal(h.writes[1].display_name,name);
});
