/* Retirement, preserved manual data and historical migration regressions. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const mod = { exports:{} };
  const src = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,allowJs:true}}).outputText;
  vm.runInNewContext(src,{ module:mod,exports:mod.exports,console,...globals,require: name => {
    if (name in imports) return imports[name];
    const local = path.join(path.dirname(file),name);
    if (name.startsWith('.')) {
      if (local.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root,local),'utf8'));
      for (const extension of ['.js','.ts']) {
        if (fs.existsSync(path.join(root,local+extension))) return load(local+extension,imports);
      }
    }
    throw Error('Unexpected dependency '+name);
  }});
  return mod.exports;
}
const engine = { ...load('packages/engine/src/items/tap-your-day.ts'), ITEM_DISPLAY_CATALOG: {
  ...require('../packages/engine/src/items/display-catalog.json'), ...load('packages/engine/src/items/tap-person-items.ts').TAP_PERSON_ITEMS,
} };
const plain = x => JSON.parse(JSON.stringify(x));
test('custom choices persist by account, and a stale save cannot cross an auth change',async()=>{
  const values=new Map(), slots=[], effects=[];let cursor=0,auth;
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=next}]},useRef(value){const i=cursor++;return slots[i]??=( {current:value} )},useEffect(fn){effects.push(fn)}};
  const mod=load('apps/mobile/src/lib/custom-tap-items.ts',{
    '../shared/storage/keys': { kCustomTapItems: { keyFor: id => `custom-tap-items:v1:${id}` },
      kLocalTapItems: { keyFor: id => `local-tap-items:v1:${id}` } },
    react,'@novame/engine':{...engine,...load('packages/engine/src/items/custom-tap-items.ts')},
    './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value)}},
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'a'}}}}),onAuthStateChange(fn){auth=fn;return{data:{subscription:{unsubscribe(){}}}}}}}},
    './remote-items':{mergedItemDictionary:()=>({ items: engine.ITEM_DISPLAY_CATALOG })},
  });
  const render=()=>{cursor=0;return mod.useCustomTapItems()};
  render();effects.shift()();await Promise.resolve();let hook=render();
  const optional=engine.TAP_YOUR_DAY_OPTIONAL_CHOICES[0];
  const item={...optional,label:'Morning cup',custom:true};
  hook.save(item);hook=render();assert.equal(hook.items[0].label,optional.label,'labels follow the approved local catalogue');
  auth('SIGNED_IN',{user:{id:'b'}});
  assert.throws(()=>hook.save(item),/account is still loading/);
  hook=render();assert.equal(hook.items.length,0);
  hook.save({...item,label:'Evening cup'});
  assert.equal(JSON.parse(values.get('local-tap-items:v1:a'))[0].label,optional.label);
  assert.equal(JSON.parse(values.get('local-tap-items:v1:b'))[0].label,optional.label);
  auth('SIGNED_IN',{user:{id:'a'}});hook=render();assert.equal(hook.items[0].itemId,item.itemId);
});

test('automatic rating waits outside modal transitions and never renders a blocking UI',async()=>{
  function gate({route=['(main)','(tabs)','home'],transition=false,dialog=false}={}){
    const effects=[],timers=new Map();let state=0,calls=0,resolveAction;
    const mod=load('apps/mobile/src/components/rating/official-rating-gate.tsx',{
      ...require('./rating-test-mocks.cjs'),
      '@/lib/coin-reward-store':{useCoinRewardBusy:()=>false},
      '@/lib/adventure-paywall':{peekAdventurePaywall:()=>null,subscribeAdventurePaywall:()=>()=>{},consumeAdventurePaywall(){}},
      '@/lib/partner-reflect-paywall':{peekPartnerReflectPaywall:()=>null,subscribePartnerReflectPaywallRequest:()=>()=>{},syncPartnerReflectPaywallRequests:async()=>{}},
      react:{useMemo:fn=>fn(),useRef:current=>({current}),useState:initial=>[state++===0?true:(typeof initial==='function'?initial():initial),()=>{}],useEffect:fn=>effects.push(fn)},
      'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
      'expo-router':{useSegments:()=>route},
      'expo-store-review':{hasAction:()=>new Promise(resolve=>{resolveAction=resolve}),requestReview:async()=>{calls++}},
      '@/lib/official-rating-prompt':{subscribeOfficialRatingRequest:()=>()=>{}},
      '@/lib/reflection-paywall-count':{subscribeReflectionPaywallRequest:()=>()=>{}},
      '@/lib/rating-navigation':{useRatingTransitionBusy:()=>transition,isNavigationTransitionBusy:()=>transition},
      '@/components/ui/app-dialog':{useAppDialogVisible:()=>dialog},
      '@/lib/use-subscription-tier':{useSubscriptionTierState:()=> 'free'},
      '@/lib/use-home-entry':{useHomeEntry:()=>({pending:false,resumeRequired:false})},
      '@/lib/modal-coordinator':{useActiveModalSlot:()=>undefined},
      '@/lib/overlay-presence':{useOverlayPresent:()=>false,isOverlayPresent:()=>false},
      '@/lib/async-lifecycle':{withDeadline:work=>work},
    },{requestAnimationFrame:fn=>{timers.set(1,fn);return 1},cancelAnimationFrame:id=>timers.delete(id),
      clearTimeout(){},setTimeout(){assert.fail('No fixed rating delay');}});
    assert.equal(mod.OfficialRatingGate(),null);
    const cleanups=effects.map(fn=>fn());
    return{timers,cleanups,resolve:()=>resolveAction(true),calls:()=>calls};
  }
  assert.equal(gate({route:['(main)','reflect-guided']}).timers.size,0);
  assert.equal(gate({transition:true}).timers.size,0);
  assert.equal(gate({dialog:true}).timers.size,0);
  const active=gate();assert.equal(active.timers.size,1);
  assert.equal(active.timers.get(1)(),undefined);assert.equal(active.calls(),0);
  active.resolve();await new Promise(setImmediate);assert.equal(active.calls(),1);
  const moved=gate();moved.cleanups.forEach(fn=>fn?.());assert.equal(moved.timers.size,0);
});

// Exercise the actual migration/functions, including retries, RLS and stale-job claims.
const { PGlite }=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
let pg;
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
before(async()=>{
  pg=new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role; create table reflects(id uuid primary key default gen_random_uuid());');
  await pg.exec(read('20260816000043_item_learning_candidates.sql'));
  const old=read('20260817000045_reflect_ai_pipeline.sql');
  await pg.exec(old.slice(old.indexOf('create table if not exists public.item_learning_jobs'),old.indexOf('create table if not exists public.weekly_recaps')));
  const migration=read('20260827000069_item_learning_review.sql');
  await pg.exec(migration);await pg.exec(migration);
  await pg.exec(read('20260905000077_admin_word_and_never_auto_rules.sql'));
  await pg.exec(read('20260914000087_batch_admin_item_auto_rules.sql'));
});
after(async()=>{await pg?.close()});
test('migration records one occurrence per reflection and keeps source phrases',async()=>{
  const id=(await pg.query('insert into reflects default values returning id')).rows[0].id;
  for(let i=0;i<2;i++)await pg.query("select record_item_learning_evidence($1,'missing_keyword','hooping on the court','ball','Basketball',0.96,false)",[id]);
  const row=(await pg.query('select * from item_learning_candidates')).rows[0];
  assert.equal(row.occurrence_count,1);assert.equal(row.evidence_version,2);assert.equal(row.source_phrase,'hooping on the court');
});
test('rule events support exact historical snapshots and optimistic concurrency',async()=>{
  const publish=(action,revision)=>pg.query("select publish_item_rule('test','hooping on the court','ball',$1,$2,'00000000-0000-0000-0000-000000000001') as revision",[action,revision]);
  const one=(await publish('enable',0)).rows[0].revision;
  await assert.rejects(publish('disable',0),/rule_version_conflict/);
  const two=(await publish('disable',one)).rows[0].revision;
  const historical=(await pg.query("select item_rule_snapshot('test',$1) as snapshot",[one])).rows[0].snapshot;
  assert.equal(historical.rules[0].action,'enable');
  const current=(await pg.query("select item_rule_snapshot('test') as snapshot")).rows[0].snapshot;
  assert.equal(current.rules[0].action,'disable');assert.equal(current.revision,two);
  await assert.rejects(pg.query("select item_rule_snapshot('test',999999)"),/unknown_rule_revision/);
  const privileges=(await pg.query("select has_function_privilege('authenticated','publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)','execute') as allowed")).rows[0];
  assert.equal(privileges.allowed,false);
});
test('batch rule publishing is atomic, ordered, and revision-safe',async()=>{
  const admin='00000000-0000-0000-0000-000000000001';
  const current=(await pg.query("select item_rule_snapshot('test') as snapshot")).rows[0].snapshot.revision;
  const rules=JSON.stringify([
    {keyword:'fresh brew',item_id:'coffee'},
    {keyword:"today's tennis",item_id:'tennis'},
  ]);
  const result=(await pg.query("select publish_item_rules_batch('test',$1::jsonb,$2,$3::uuid) as result",[rules,current,admin])).rows[0].result;
  assert.equal(result.count,2);
  const rows=(await pg.query("select keyword,item_id from item_keyword_rule_events where revision>$1 order by revision",[current])).rows;
  assert.deepEqual(rows.map(row=>[row.keyword,row.item_id]),[['fresh brew','coffee'],["today's tennis",'tennis']]);
  const before=(await pg.query('select count(*)::int as count from item_keyword_rule_events')).rows[0].count;
  await assert.rejects(pg.query("select publish_item_rules_batch('test',$1::jsonb,$2,$3::uuid)",[JSON.stringify([{keyword:'later brew',item_id:'coffee'}]),current,admin]),/rule_version_conflict/);
  const after=(await pg.query('select count(*)::int as count from item_keyword_rule_events')).rows[0].count;
  assert.equal(after,before);
});
test('claim is exclusive, legacy jobs excluded and retries capped at two',async()=>{
  const ids=(await pg.query('insert into reflects select gen_random_uuid() from generate_series(1,2) returning id')).rows;
  await pg.query("insert into item_learning_jobs(reflect_id,evidence_version) values($1,1),($2,2)",[ids[0].id,ids[1].id]);
  assert.equal((await pg.query('select * from claim_item_learning_jobs()')).rows.length,1);
  assert.equal((await pg.query('select * from claim_item_learning_jobs()')).rows.length,0);
  await pg.exec("update item_learning_jobs set claimed_at=now()-interval '20 minutes' where evidence_version=2");
  const retry=(await pg.query('select * from claim_item_learning_jobs()')).rows;assert.equal(retry[0].attempts,2);
  await pg.exec("update item_learning_jobs set status='failed' where evidence_version=2");
  assert.equal((await pg.query('select * from claim_item_learning_jobs()')).rows.length,0);
});

test('retirement preserves all history and rejects worker/publisher access for every API role', async()=>{
 const tables=['item_learning_candidates','item_learning_jobs','item_learning_occurrences','item_learning_decisions','item_match_removals','item_keyword_rule_events'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pg.query('select * from '+table)).rows])));
 const before=await snapshot();
 const sql=read('20261015000241_retire_keyword_matching.sql');
 assert.doesNotMatch(sql,/\b(drop|delete|truncate)\s+(table|from)/i);
 await pg.exec(sql);await pg.exec(sql);
 assert.deepEqual(await snapshot(),before);
 const functions=['item_rule_snapshot(text,bigint)','publish_item_rule(text,text,text,text,bigint,uuid,uuid,uuid)',
 'publish_item_rules_batch(text,jsonb,bigint,uuid)','claim_item_learning_jobs()',
 'record_item_learning_evidence(uuid,text,text,text,text,numeric,boolean)'];
 for(const role of ['anon','authenticated','service_role']) {
  for(const f of functions)assert.equal((await pg.query("select has_function_privilege($1,$2,'execute') as allowed",[role,f])).rows[0].allowed,false,role+':'+f);
  for(const table of tables)for(const action of ['INSERT','UPDATE','DELETE','TRUNCATE'])
   assert.equal((await pg.query('select has_table_privilege($1,$2,$3) as allowed',[role,table,action])).rows[0].allowed,false,role+':'+table+':'+action);
 }
 await pg.exec('set role service_role');
 try {
  await assert.rejects(pg.query('select * from claim_item_learning_jobs()'),/permission denied/);
  await assert.rejects(pg.query("insert into item_learning_decisions values('x','x','{}',now())"),/permission denied/);
  for(const table of tables)await pg.query('select * from '+table);
 }finally{await pg.exec('reset role');}
 assert.deepEqual(await snapshot(),before);
});
test('API tombstones authenticate and never run a worker or expose rules', async()=>{
 const json=(body,options={})=>({body,status:options.status||200});
 for(const valid of [false,true]) {
  const endpoint=load('apps/api/src/app/api/item-rules/route.js',{
   'next/server':{NextResponse:{json}},'@/lib/auth-guard':{verifyToken:async()=>valid?{id:'u'}:null},
  });
  const result=await endpoint.GET({headers:new Headers({authorization:'Bearer token'})});
  assert.equal(result.status,valid?410:401);
 }
 const worker=load('apps/api/src/app/api/cron/item-learning/route.js',{'next/server':{NextResponse:{json}}},{process:{env:{CRON_SECRET:'test'}}});
 assert.equal((await worker.GET({headers:new Headers()})).status,401);
 assert.equal((await worker.GET({headers:new Headers({authorization:'Bearer test'})})).status,410);
 const config=require('../apps/api/vercel.json');
 assert.ok(!config.crons.some(x=>x.path==='/api/cron/item-learning'));
 assert.equal(config.crons.length,7);
 for(const file of ['reflect-analysis-store.js','reflect-analysis-jobs.js','reflect-ai.js','connection-ai.js'])
  assert.doesNotMatch(fs.readFileSync(path.join(root,'apps/api/src/lib',file),'utf8'),/item_learning_jobs|itemLearningHints|learningCandidates|cleanLearningSignals/);
});
