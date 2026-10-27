const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const fields=load('apps/admin/src/lib/announcement-fields.js',{}, {URL});
const valid={title:'News',content:'New outfits',image_url:'https://img.example.com/news.webp',button_text:'See more',action_url:'https://example.com/news'};
function admin(authorized=true){
 const writes=[];const db={from:()=>({insert(row){writes.push(row);return this;},update(row){writes.push(row);return this;},eq(){return this;},select(){return this;},single:async()=>({data:writes.at(-1)})})};
 const api=load('apps/admin/src/app/api/admin/announcements/route.js',{
  '@/lib/announcement-fields':fields,'@/lib/auth/require-admin':{requireAdmin:async()=>authorized?{}:{error:Response.json({error:'Unauthorized'},{status:401})}},
  '@supabase/supabase-js':{createClient:()=>db},
 },{Response,URL,process:{env:{}}});return {api,writes};
}
test('Admin persists button/link and permits information-only no-link announcements; legacy defaults remain compatible',async()=>{
 for(const url of [valid.action_url,'']){
  const h=admin(),response=await h.api.POST({json:async()=>({...valid,action_url:url})});assert.equal(response.status,200);
  assert.equal(h.writes[0].button_text,'See more');assert.equal(h.writes[0].action_url,url||null);
 }
 assert.equal(fields.announcementFields({...valid,button_text:undefined}).button_text,'Continue');
});
test('Admin rejects executable URLs, oversized/missing content and unauthenticated publishing without a write',async()=>{
 for(const patch of [{action_url:'javascript:alert(1)'},{action_url:'file:///private/x'},{action_url:'http://example.com'},
  {action_url:'https://user:pass@example.com'},{image_url:''},{button_text:''},{button_text:'x'.repeat(61)},{title:'x'.repeat(121)}]){
  const h=admin();assert.equal((await h.api.POST({json:async()=>({...valid,...patch})})).status,400);assert.equal(h.writes.length,0);
 }
 const h=admin(false);assert.equal((await h.api.POST({json:async()=>valid})).status,401);assert.equal(h.writes.length,0);
});
test('Admin partial update allowlists content; activation does not erase button or URL',async()=>{
 const h=admin();assert.equal((await h.api.PATCH({json:async()=>({id:'one',is_active:false,created_at:'attacker',priority:99})})).status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])),{is_active:false});
});
test('public announcement API keeps auth, targeting, read receipt exclusion and returns action metadata',async()=>{
 let user='A';const notices=[{...valid,id:'one',is_active:true,target_users:'all',start_at:'2026-01-01'}];
 const query=table=>{const q={select(){return q;},eq(){return q;},not(){return q;},lte(){return q;},order(){return q;},
  single:async()=>({data:{subscription_tier:'free'}}),then:resolve=>resolve({data:table==='app_announcements'?notices:[]})};return q;};
 const api=load('apps/api/src/app/api/announcements/route.js',{'@supabase/supabase-js':{createClient:()=>({from:query,rpc:async()=>({data:false})})},
  '@/lib/auth-guard':{verifyToken:async()=>({id:user})}},{URL,Response,process:{env:{}}});
 const req=token=>({url:'https://api.invalid/api/announcements?userId=A',headers:{get:()=>token}});
 assert.equal((await api.GET(req(''))).status,401);user='B';assert.equal((await api.GET(req('Bearer x'))).status,401);
 user='A';const result=await (await api.GET(req('Bearer x'))).json();assert.equal(result.announcement.action_url,valid.action_url);assert.equal(result.announcement.button_text,'See more');
});
