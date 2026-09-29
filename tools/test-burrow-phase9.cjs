const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const response={json:(body,options={})=>({body,status:options.status??200,headers:options.headers})};
test('daily rollover uses profile timezone and handles daylight-saving dates',()=>{
  const {burrowLocalDay}=load('apps/mobile/src/lib/burrow-local-day.ts',{});
  assert.equal(burrowLocalDay(Date.parse('2026-09-28T06:59:59Z'),'America/Los_Angeles'),'2026-09-27');
  assert.equal(burrowLocalDay(Date.parse('2026-09-28T07:00:00Z'),'America/Los_Angeles'),'2026-09-28');
  assert.equal(burrowLocalDay(Date.parse('2026-11-01T09:00:00Z'),'America/Los_Angeles'),'2026-11-01');
  assert.equal(burrowLocalDay(Date.parse('2026-09-28T00:00:00Z'),null),'2026-09-28');
});
test('private photo drafts survive reload, stay pair scoped, are bounded and remove only matching receipts',()=>{
  const values=new Map();const imports={'./storage':{storage:{getString:k=>values.get(k),set:(k,v)=>values.set(k,v)}},'../shared/storage/keys':{kBurrowPhotoDrafts:{prefix:'photo:'}}};
  let drafts=load('apps/mobile/src/lib/burrow-photo-drafts.ts',imports);
  const scope={userId:'a',partnerId:'b'},draft={base64:'bytes',key:'one',expectedPhotoId:null,savedAt:123};
  drafts.persistPhotoDraft(scope,'frame:a',draft);
  drafts=load('apps/mobile/src/lib/burrow-photo-drafts.ts',imports);
  assert.equal(drafts.readPhotoDraft(scope,'frame:a').key,'one');
  assert.equal(drafts.readPhotoDraft({userId:'a',partnerId:'c'},'frame:a'),null);
  drafts.removePhotoDraft(scope,'frame:a','another');assert.ok(drafts.readPhotoDraft(scope,'frame:a'));
  for(let i=0;i<4;i++)drafts.persistPhotoDraft(scope,`photo:${i}`,draft);
  assert.throws(()=>drafts.persistPhotoDraft(scope,'sixth',draft),/photo_drafts_full/);
  drafts.removePhotoDraft(scope,'frame:a','one');assert.equal(drafts.readPhotoDraft(scope,'frame:a'),null);
  values.set('photo:a:b','bad json');assert.throws(()=>drafts.readPhotoDraft(scope,'frame:a'),/photo_draft_unavailable/);
  assert.equal(values.get('photo:a:b'),'bad json');
});
test('content writes require admin and same origin before database access',async()=>{
  let allowed=false,calls=0;
  const route=load('apps/admin/src/app/api/admin/burrow-content/route.js',{
    'next/server':{NextResponse:response},'@/lib/auth/require-admin':{requireAdmin:async()=>allowed?{user:{id:'admin'}}:{error:{status:401}}},
    '@/lib/supabase/admin':{createAdminClient:()=>{calls++;throw Error('unexpected');}},
  },{URL});
  assert.equal((await route.POST(new Request('https://test.invalid',{method:'POST'}))).status,401);
  allowed=true;assert.equal((await route.POST(new Request('https://test.invalid',{method:'POST',headers:{origin:'https://else.invalid'}}))).status,403);
  assert.equal(calls,0);
});
test('record status authenticates before policy and never returns old quota in Burrow mode',async()=>{
  let calls=0;
  const route=load('apps/api/src/app/api/reflect/status/route.js',{
    'next/server':{NextResponse:response},'@/lib/auth-guard':{verifyToken:async t=>t==='valid'?{id:'me'}:null},
    '@/lib/reflect-draft':{serviceClient:()=>({rpc:async()=>{calls++;return {data:{mode:'burrow',localDate:'2026-09-28',canRecord:true,reflectsToday:6}};}})},
    '@/lib/user-local-date':{resolveUserLocalDate(){throw Error('legacy');}},'@/lib/app-major-update':{majorUpdateEnabled:async()=>true},
  },{URL});
  assert.equal((await route.GET(new Request('https://test.invalid?userId=me'))).status,401);assert.equal(calls,0);
  const r=await route.GET(new Request('https://test.invalid?userId=me',{headers:{authorization:'Bearer valid'}}));
  assert.equal(r.body.reflectsRemaining,null);assert.equal(r.body.plusAiRemaining,null);assert.equal(r.body.entries.tap_your_day,'available');
  assert.equal(r.headers['Cache-Control'],'no-store');
});
test('history auth, cursor and date validation run before private RPC',async()=>{
  let calls=0;
  const route=load('apps/api/src/app/api/vnext/history/route.js',{
    'next/server':{NextResponse:response},'@/lib/app-major-update':{authenticatedUserId:async r=>r.headers.get('authorization')?'me':null,commandStatus:()=>200,
      appMajorUpdateServiceClient:()=>({rpc:async()=>{calls++;return {data:{rows:[],hasMore:false}};}})},
  },{URL});
  const base='https://test.invalid?kind=moments&partner=00000000-0000-0000-0000-000000000001';
  assert.equal((await route.GET(new Request(base))).status,401);
  for(const suffix of ['&before=2026-01-01T00:00:00Z','&id=wrong','&date=2026-02-30','&date=oops'])
    assert.equal((await route.GET(new Request(base+suffix,{headers:{authorization:'valid'}}))).status,400);
  assert.equal(calls,0);
  const result=await route.GET(new Request(base,{headers:{authorization:'valid'}}));
  assert.equal(calls,1);assert.equal(result.headers['Cache-Control'],'no-store');
});
test('trail progress is clamped, replayable, and never claims reward discoveries',()=>{
  const {adventureTrail}=load('apps/mobile/src/lib/adventure-trail.ts',{});
  const start='2026-09-27T00:00:00Z',end='2026-09-27T08:00:00Z';
  assert.equal(adventureTrail(start,end,Date.parse(start)-10000).meters,0);
  assert.equal(adventureTrail(start,end,Date.parse(start)+4*3600000).meters,500);
  assert.equal(adventureTrail(start,end,Date.parse(end)+10000).meters,1000);
  assert.equal(adventureTrail('bad',end,Date.now()).meters,0);
  assert.equal(adventureTrail(start,end,Date.parse(start)+4*3600000).logs.length,3);
});
test('history merging deduplicates pages and date headings use server date',()=>{
  const {mergeHistory,historyDayLabel}=load('apps/mobile/src/lib/burrow-history.ts',{'./api':{},'./async-lifecycle':{},'./session-lifecycle':{}});
  const a={id:'a',created_at:'2026-09-27T01:00:00Z'},b={id:'b',created_at:a.created_at};
  assert.equal(mergeHistory([a],[b,{...a,body:'updated'}]).length,2);
  assert.equal(mergeHistory([a],[b])[0].id,'b');
  assert.equal(historyDayLabel('2026-09-27','2026-09-28'),'Yesterday');
  assert.equal(historyDayLabel('2026-09-28','2026-09-28'),'Today');
});
