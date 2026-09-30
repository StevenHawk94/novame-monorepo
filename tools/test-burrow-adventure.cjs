const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, flush } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : tree == null || tree === false ? [] : [tree];
const text = tree => nodes(tree).filter(n => typeof n === 'string').join(' ');
function card(kind, acceptedAt) {
  const calls=[],routes=[],done=[],alerts=[];
  let result={ feedback:'Frozen feedback' }, ok=true;
  const { AdventureFriendCard }=load('apps/mobile/src/components/burrow/adventure-friend-card.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Alert:{alert:(...args)=>alerts.push(args)},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    'expo-image':{Image:'Image'},
    '@/lib/burrow-ui-assets':{burrowFriendArt:()=>null},
    'expo-router':{router:{push:r=>routes.push(r)}},
    '@/lib/app-major-update-api':{completeFriendInteraction:async(...args)=>{calls.push(args);return result;}},
    '@/lib/burrow-store':{runBurrowAction:async(_key,fn)=>{if(!ok)return false;await fn();return true;}},
  });
  const data={activeAdventure:{id:'adventure'},adventureResult:{metadata:{acceptedAt,friendSnapshot:{name:'Frozen friend'},
    friendContent:kind ? {content_type:kind,prompt:'Frozen prompt',choices:[{id:'a',label:'Choice A'},{id:'b',label:'Choice B'}],rage_monster_id:'the_fog'}:null}}};
  const render=(busy=false)=>AdventureFriendCard({data,busy,onComplete:v=>done.push(v)});
  const press=label=>{const button=nodes(render()).find(n=>n.type==='Pressable'&&text(n)===label);assert.ok(button,label);button.props.onPress();};
  return {calls,routes,done,alerts,render,press,setResult:r=>result=r,setOk:v=>ok=v};
}
test('adventure question uses frozen content and returned feedback',async()=>{
  const h=card('question');assert.match(text(h.render()),/Frozen friend.*Frozen prompt/);
  h.press('Choice B');await flush();assert.equal(h.calls[0][1].choiceId,'b');assert.deepEqual(h.done,['Frozen feedback']);
});
test('adventure insight acknowledges without inventing an answer',async()=>{
  const h=card('insight');h.press('A little thought to keep');await flush();assert.equal(h.calls[0][1].acknowledged,true);
});
test('adventure emotional help routes only after server acceptance and includes its own return context',async()=>{
  const h=card('emotional_help');h.setResult({battleRequired:true});h.press('Yes, let’s help');await flush();
  assert.equal(h.routes[0].params.friendAdventureId,'adventure');assert.equal(h.routes[0].params.monsterId,'the_fog');assert.equal(h.done.length,0);
  const failed=card('emotional_help');failed.setOk(false);failed.press('Yes, let’s help');await flush();assert.equal(failed.routes.length,0);
});
test('accepted help resumes battle and completes through the server, No needs confirmation',async()=>{
  const h=card('emotional_help','2026-09-27');h.press('Continue helping in the Rage Room');assert.equal(h.calls.length,0);
  h.press('I’ve finished · Return home');await flush();assert.equal(h.calls[0][1].choiceId,'yes');
  h.press('Not now');assert.equal(h.calls.length,1);h.alerts[0][2][1].onPress();await flush();assert.equal(h.calls[1][1].choiceId,'not_now');
});
test('missing snapshot fails visibly without using current library; busy disables every answer',()=>{
  assert.match(text(card(null).render()),/could not be loaded/);
  const buttons=nodes(card('question').render(true)).filter(n=>n.type==='Pressable');
  assert.equal(buttons.length,2);assert.ok(buttons.every(n=>n.props.disabled));
});

// Empty mocks satisfy unused imports only; any data/AI/HTTP action before the
// rollout gate throws and fails the asserted status. No external connections.
function importsFor(file) {
  const source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
  return Object.fromEntries([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>[m[1],{}]));
}
const request=(body={})=>({headers:{get:()=> 'Bearer token'},url:'https://local.test/?userId=me&id=visit',json:async()=>({userId:'me',...body})});
const response={json:(body,options={})=>({body,status:options.status??200})};
const forbidden=()=>{throw Error('Unexpected legacy side effect');};
for (const [route,method,body] of [
  ['reflect','POST',{promptId:1,body:'A little day'}],['quests/rewards','GET',{}],['quests/check','POST',{taskIndex:0}],
  ['master/ask','POST',{question:'A question'}],['master/visit','GET',{}],['friends/good-vibes','GET',{}],
  ['friends/good-vibes','POST',{action:'read'}],['cosmetics/purchase','POST',{cosmeticType:'outfit',cosmeticId:'test'}],
]) test(`new rollout retires ${method} ${route} before effects and still authenticates first`,async()=>{
  const file=`apps/api/src/app/api/${route}/route.js`;
  let authenticated=true,checked=0;
  const api=load(file,{...importsFor(file),
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>({from:forbidden,rpc:forbidden})},
    '@/lib/auth-guard':{verifyToken:async()=>authenticated?{id:'me'}:null},
    '@/lib/app-major-update':{majorUpdateEnabled:async()=>{checked++;return true;}},
  },{process:{env:{}},URL,fetch:forbidden});
  assert.equal((await api[method](request(body))).status,410);assert.equal(checked,1);
  authenticated=false;assert.equal((await api[method](request(body))).status,401);assert.equal(checked,1);
});
test('new durable journal keeps Memory AI but passes zero old XP; legacy rollout keeps original XP',async()=>{
  for(const enabled of [true,false]) {
    const calls=[];let memory=0;
    const draft={id:'draft',saved_reflect_id:'reflect',local_date:'2026-09-27',matches:[]};
    const db={from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{subscription_tier:'plus'}})}),
      rpc:async(name,args)=>{calls.push({name,args});return {data:name==='begin_saved_reflect'?{draft}:{eligible:true}};}};
    const file='apps/api/src/app/api/reflect/prepare/route.js';
    const route=load(file,{...importsFor(file),'next/server':{NextResponse:response,after:forbidden},
      '@/lib/auth-guard':{verifyToken:async()=>({id:'me'})},'@novame/engine':{XP_RULES:{reflect:{award:30}}},
      '@/lib/app-major-update':{majorUpdateEnabled:async()=>enabled},
      '@/lib/reflect-draft':{serviceClient:()=>db,isoWeek:()=> '2026-W39',journalKindForInput:()=> 'write_freely',resolveDraftInput:async()=>({body:'Today',matches:[],mode:'typing'})},
      '@/lib/user-local-date':{resolveUserLocalDate:async()=> '2026-09-27'},
      '@/lib/reflect-settlement':{generateSavedReflectCopy:async(_db,d)=>{memory++;return d;}},
    });
    const saved=await route.POST(request({promptId:1,idempotencyKey:'test-key-1'}));
    assert.equal(saved.status,200);assert.equal(calls.find(c=>c.name==='begin_saved_reflect').args.p_xp,enabled?0:30);assert.equal(memory,1);
  }
});
test('legacy draft finalization passes zero XP in new mode and original XP in old mode',async()=>{
  for(const enabled of [true,false]) {
    const calls=[];const file='apps/api/src/app/api/reflect/finalize/route.js';
    const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'draft',local_date:'2026-09-27'}})}),
      rpc:async(name,args)=>{calls.push({name,args});return {data:{already_finalized:true}};}};
    const api=load(file,{...importsFor(file),'next/server':{NextResponse:response,after:forbidden},
      '@/lib/auth-guard':{verifyToken:async()=>({id:'me'})},'@novame/engine':{MAX_REFLECT_ITEMS:100,XP_RULES:{reflect:{award:30}}},
      '@/lib/app-major-update':{majorUpdateEnabled:async()=>enabled},
      '@/lib/reflect-draft':{serviceClient:()=>db,isoWeek:()=> '2026-W39'},
      '@/lib/reflect-settlement':{sanitizeSettlementMemories:x=>x},
    });
    const saved=await api.POST(request({draftId:'draft',useSaved:true}));
    assert.equal(saved.status,200);assert.equal(calls[0].args.p_xp_amount,enabled?0:30);
  }
});
test('Connection queue and fallback stop before database or AI; old queue remains available',async()=>{
  let enabled=true,queued=0;
  const db={from:()=>({upsert:async()=>{queued++;return {};}}),rpc:async()=>({data:[]})};
  const file='apps/api/src/lib/reflect-analysis-jobs.js';
  const api=load(file,{...importsFor(file),'./app-major-update':{majorUpdateEnabled:async()=>enabled}});
  assert.equal(await api.enqueueReflectAnalysisJob(db,{reflectId:'r',userId:'me'}),false);
  assert.equal((await api.processReflectAnalysisJobs({supabase:{rpc:forbidden,from:forbidden}})).length,0);
  assert.equal(queued,0);enabled=false;
  assert.equal(await api.enqueueReflectAnalysisJob(db,{reflectId:'r',userId:'me'}),true);assert.equal(queued,1);
  const fallback='apps/api/src/lib/reflect-completion.js';
  await load(fallback,{...importsFor(fallback),'./reflect-draft':{serviceClient:()=>({from:forbidden})},
    './app-major-update':{majorUpdateEnabled:async()=>true}}).analyzeFinalizedReflect({userId:'me',draft:null,result:null});
});
test('Connection cron is paused without sending alerts, after secret validation',async()=>{
  const file='apps/api/src/app/api/cron/connection-analysis/route.js';
  const api=load(file,{...importsFor(file),'next/server':{NextResponse:response},
    '@/lib/app-major-update':{majorUpdateEnabled:async()=>true},'@/lib/reflect-draft':{serviceClient:()=>({})},
    '@/lib/reflect-analysis-jobs':{processReflectAnalysisJobs:forbidden},
    '@/lib/connection-output-monitor':{sendPendingConnectionOutputAlert:forbidden},
  },{process:{env:{CRON_SECRET:'token'}}});
  assert.equal((await api.GET(request())).body.paused,true);
  assert.equal((await api.GET({headers:{get:()=>''}})).status,401);
});
test('flag lookup failure cannot enqueue Connection jobs or invoke fallback failure writes',async()=>{
  const flag={majorUpdateEnabled:async()=>{throw Error('config_unavailable');}};
  const db={from:forbidden,rpc:forbidden};
  const queue='apps/api/src/lib/reflect-analysis-jobs.js';
  const jobs=load(queue,{...importsFor(queue),'./app-major-update':flag});
  await assert.rejects(()=>jobs.enqueueReflectAnalysisJob(db,{reflectId:'r'}),/config_unavailable/);
  await assert.rejects(()=>jobs.processReflectAnalysisJobs({supabase:db}),/config_unavailable/);
  const file='apps/api/src/lib/reflect-completion.js';
  const fallback=load(file,{...importsFor(file),'./app-major-update':flag,'./reflect-draft':{serviceClient:()=>db}});
  await assert.rejects(()=>fallback.analyzeFinalizedReflect({userId:'me'}),/config_unavailable/);
});
