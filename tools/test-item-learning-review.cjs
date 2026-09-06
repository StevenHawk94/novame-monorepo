/* Offline matching/review regressions. No live AI, credentials or remote database. */
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
const engine = {...load('packages/engine/src/items/item-matcher.ts'),...load('packages/engine/src/items/dictionary.ts'),...load('packages/engine/src/items/item-rules.ts'),...load('packages/engine/src/items/remote-manifest.ts')};
const evidence = load('apps/api/src/lib/item-learning-evidence.js',{'@novame/engine':engine});
const plain = x => JSON.parse(JSON.stringify(x));
test('evidence must be a real short source span and existing valid matches are excluded',()=>{
  const empty={...engine.ITEM_DICTIONARY,synonyms:{}};
  const signal={phrase:'running on the track',concept:'Running',literal:true,privacySafe:true};
  assert.equal(evidence.cleanLearningSignals([signal],'Went running on the track.',empty).length,1);
  assert.equal(evidence.cleanLearningSignals([signal],'I ran a company.',empty).length,0);
  assert.equal(evidence.cleanLearningSignals([signal],"Didn't go running on the track.",empty).length,0);
  assert.equal(evidence.cleanLearningSignals([{...signal,privacySafe:false}],signal.phrase,empty).length,0);
  const coffee={phrase:'coffee',concept:'Coffee',literal:true,privacySafe:true};
  assert.equal(evidence.cleanLearningSignals([coffee],'Made coffee.').length,0);
  assert.ok(evidence.itemLearningHints('running a business').some(h=>h.word==='running'));
  assert.ok(evidence.learningShortlist('Basketball',empty).some(i=>i.name==='Basketball'));
  const alias={items:{a:{displayName:'Cooling Unit',keywords:['air conditioner'],visualConcept:'A wall mounted air conditioning unit.'}},synonyms:{}};
  assert.equal(evidence.learningShortlist('Air Conditioner',alias)[0].id,'a');
});
test('one small AI batch; semantic rejection and verified missing keyword/icon; repeats cost zero calls',async()=>{
  const dict={items:{run:{displayName:'Running',category:'Activity'},ball:{displayName:'Basketball',category:'Activity'}},synonyms:{}};
  const decisions=new Map(), evidenceRows=[]; let aiCalls=0;
  const db={from(){let key;return {select(){return this},eq(name,value){if(name==='signal_key')key=value;return this},maybeSingle:async()=>({data:decisions.has(key)?{decision:decisions.get(key)}:null}),upsert:async row=>{decisions.set(row.signal_key,row.decision);return {error:null}}}},rpc:async(name,args)=>{evidenceRows.push(args);return {error:null}}};
  const mod=load('apps/api/src/lib/item-learning.js',{'@novame/engine':engine,'./item-learning-evidence':evidence,'./ai-usage':{recordAIUsage:async()=>{}},'./ai':{parseAIJson:JSON.parse,callAI:async input=>{
    aiCalls++;assert.equal(JSON.parse(input.userText).length,3);assert.equal(input.generationConfig.maxOutputTokens,650);
    return {text:JSON.stringify({decisions:[{index:0,kind:'skip',confidence:1},{index:1,kind:'missing_keyword',itemId:'ball',confidence:.96},{index:2,kind:'missing_icon',confidence:.96}]})};
  }}});
  const signals=[{phrase:'running a business',concept:'Running'},{phrase:'hooping on the court',concept:'Basketball'},{phrase:'air conditioner',concept:'Air Conditioner'}];
  await mod.recordItemLearningConcepts(db,signals,dict,[],{reflectId:'one',userId:'u'});
  assert.equal(aiCalls,1);assert.equal(evidenceRows.length,2);assert.equal(evidenceRows[0].p_item,'ball');assert.equal(evidenceRows[1].p_kind,'missing_icon');
  await mod.recordItemLearningConcepts(db,signals,dict,[],{reflectId:'two',userId:'u'});
  assert.equal(aiCalls,1);assert.equal(evidenceRows.length,4);
});
test('rule revision mismatch fails closed; legacy clients still use base rules',async()=>{
  const store=load('apps/api/src/lib/item-rule-store.js',{'@novame/engine':engine});
  assert.equal(await store.dictionaryForRevision({},null),engine.ITEM_DICTIONARY);
  await assert.rejects(store.dictionaryForRevision({}, {catalog:'wrong',revision:0}),/invalid_rule_version/);
});
test('admin approval is exact, requires fresh revision, and cannot enable ambiguous bare words',async()=>{
  const id=Object.keys(engine.ITEM_DICTIONARY.items).find(id=>engine.ITEM_DICTIONARY.items[id].displayName==='Running');
  let row={id:'candidate',kind:'missing_keyword',evidence_version:2,source_phrase:'running on a freshly painted track',status:'pending',suggested_item_id:id};
  const writes=[];
  const db={from:()=>({select(){return this},eq(){return this},single:async()=>({data:row})}),rpc:async(name,args)=>{
    if(name==='item_rule_snapshot')return {data:{catalog:engine.ITEM_CATALOG_VERSION,revision:0,rules:[]}};
    writes.push(args);return {data:1};
  }};
  const admin=load('apps/admin/src/lib/item-review.js',{
    '@novame/engine':engine,
    './item-manifest':{loadCurrentItemManifest:async()=>({version:'0',manifest:null})},
  });
  await assert.rejects(admin.publishReview(db,{action:'publish',id:row.id,revision:4},'admin'),/Rules changed/);
  assert.equal(writes.length,0);
  await admin.publishReview(db,{action:'publish',id:row.id,revision:0},'admin');
  assert.equal(writes[0].p_keyword,row.source_phrase);assert.equal(writes[0].p_action,'enable');
  row={...row,source_phrase:'running'};
  await assert.rejects(admin.publishReview(db,{action:'publish',id:row.id,revision:0},'admin'),/contextual multi-word phrase/);
  assert.equal(writes.length,1);
});

test('custom choices persist by account, and a stale save cannot cross an auth change',async()=>{
  const values=new Map(), slots=[], effects=[];let cursor=0,auth;
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=next}]},useRef(value){const i=cursor++;return slots[i]??=( {current:value} )},useEffect(fn){effects.push(fn)}};
  const mod=load('apps/mobile/src/lib/custom-tap-items.ts',{
    '../shared/storage/keys': { kCustomTapItems: { keyFor: id => `custom-tap-items:v1:${id}` } },
    react,'@novame/engine':{...engine,...load('packages/engine/src/items/custom-tap-items.ts')},
    './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value)}},
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'a'}}}}),onAuthStateChange(fn){auth=fn;return{data:{subscription:{unsubscribe(){}}}}}}}},
    './remote-items':{mergedItemDictionary:()=>engine.ITEM_DICTIONARY},
  });
  const render=()=>{cursor=0;return mod.useCustomTapItems()};
  render();effects.shift()();await Promise.resolve();let hook=render();
  const item={itemId:'memory.0002_coffee',label:'Morning cup',kind:'food',group:'DRINKS',custom:true};
  hook.save(item);hook=render();assert.equal(hook.items[0].label,'Morning cup');
  auth('SIGNED_IN',{user:{id:'b'}});
  assert.throws(()=>hook.save(item),/account is still loading/);
  hook=render();assert.equal(hook.items.length,0);
  hook.save({...item,label:'Evening cup'});
  assert.equal(JSON.parse(values.get('custom-tap-items:v1:a'))[0].label,'Morning cup');
  auth('SIGNED_IN',{user:{id:'a'}});hook=render();assert.equal(hook.items[0].label,'Morning cup');
});

test('automatic rating waits outside modal transitions and never renders a blocking UI',async()=>{
  function gate({route=['(main)','(tabs)','home'],transition=false,dialog=false}={}){
    const effects=[],timers=new Map();let state=0,calls=0,resolveAction;
    const mod=load('apps/mobile/src/components/rating/official-rating-gate.tsx',{
      react:{useMemo:fn=>fn(),useRef:current=>({current}),useState:initial=>[state++===0?true:initial,()=>{}],useEffect:fn=>effects.push(fn)},
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
