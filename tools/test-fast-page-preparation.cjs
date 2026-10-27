const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,clock,deferred,flush,hooks}=require('./lifecycle-test-utils.cjs');
const base='apps/mobile/src/lib/';
const history={mergeHistory:(a,b)=>[...new Map([...a,...b].map(row=>[row.id,row])).values()]};
const model=load(base+'moments-cache-state.ts',{'./burrow-history':history});
const row=id=>({id,created_at:'2026-10-18T12:00:00Z',localDate:'2026-10-18',event_type:'affection_sent',actor_id:'me',payload:{}});
const page=(ids,more=false)=>({rows:ids.map(row),hasMore:more,next:more?{at:'2026-10-17',id:'cursor'}:null,timezone:'UTC'});
function cacheHarness(){
 let epoch=1,authorized=true,data={profile:{id:'me',timezone_name:'UTC'},partner:{id:'you'},pairVersion:'one',moments:[row('one')]};
 const reads=[];let fetch=async()=>page(['one']);
 const cache=model.createMomentsCache({epoch:()=>epoch,valid:d=>authorized&&d.profile.id===data.profile.id&&d.partner?.id===data.partner?.id&&d.pairVersion===data.pairVersion,
  fetch:async(...args)=>{reads.push(args);return fetch(...args);},defer:async()=>{}});
 return{cache,reads,get data(){return data;},set data(next){data=next;},set fetch(fn){fetch=fn;},revoke(){authorized=false;},switchAccount(){epoch++;data={...data,profile:{id:'other',timezone_name:'UTC'}};cache.reset();}};
}
test('Moments prepares without a mounted/focused screen; entering the same version makes no request',async()=>{
 const h=cacheHarness();await h.cache.prepare(h.data);assert.equal(h.reads.length,1);assert.equal(h.cache.read(h.data).page.rows[0].id,'one');
 await h.cache.prepare({...h.data,wallet:{balance:2}});assert.equal(h.reads.length,1);
 const old=h.cache.read(h.data).page.rows[0];h.data={...h.data,moments:[row('two'),...h.data.moments]};h.fetch=async()=>page(['two','one']);
 await h.cache.prepare(h.data);assert.equal(h.reads.length,2);assert.equal(h.cache.read(h.data).page.rows[1],old,'unchanged cards keep identity');
});
test('notification-only updates refresh full Moments content even when bootstrap event summaries keep the same identity',async()=>{
 const h=cacheHarness();await h.cache.prepare(h.data);const summaries=h.data.moments;
 h.data={...h.data,attention:{scope:'me:you:one',moments:[{id:'two:2026-10-18T12:00:00Z',at:'now'}]}};
 h.fetch=async()=>page(['two','one']);await h.cache.prepare(h.data);
 assert.equal(h.data.moments,summaries);assert.equal(h.reads.length,2);assert.equal(h.cache.read(h.data).page.rows[0].id,'two');
});
test('repeated warmups coalesce and a burst of new events causes one follow-up, never an older-head overwrite',async()=>{
 const h=cacheHarness(),first=deferred(),second=deferred();let count=0;h.fetch=()=>++count===1?first.promise:second.promise;
 const initial=h.cache.prepare(h.data);h.cache.prepare(h.data);await flush();assert.equal(h.reads.length,1);
 h.data={...h.data,moments:[row('two')]};h.cache.prepare(h.data);h.data={...h.data,moments:[row('three')]};h.cache.prepare(h.data);
 first.resolve(page(['one']));await flush();assert.equal(h.reads.length,2);assert.equal(h.cache.read(h.data).page,null,'obsolete version not committed');
 second.resolve(page(['three']));await initial;assert.equal(h.cache.read(h.data).page.rows[0].id,'three');assert.equal(h.cache.read(h.data).refreshing,false);
});
test('an old account, revoked authorization or previous pair cannot commit a late private timeline',async()=>{
 for(const change of ['account','pair','revoke']){
  const h=cacheHarness(),read=deferred();h.fetch=()=>read.promise;const pending=h.cache.prepare(h.data);await flush();
  if(change==='account')h.switchAccount();else if(change==='pair')h.data={...h.data,partner:{id:'new'},pairVersion:'two'};else h.revoke();
  read.resolve(page(['private-old']));await pending;assert.equal(h.cache.read(h.data).page,null);
 }
});
test('offline refresh keeps the authorized cache; foreground/manual retry recovers without navigation',async()=>{
 const h=cacheHarness();await h.cache.prepare(h.data);h.fetch=async()=>{throw Error('offline');};
 h.data={...h.data,moments:[row('two')]};await h.cache.prepare(h.data);assert.equal(h.cache.read(h.data).error,true);assert.equal(h.cache.read(h.data).page.rows[0].id,'one');
 await h.cache.prepare(h.data);assert.equal(h.reads.length,2,'unchanged failed version does not spin');
 h.fetch=async()=>page(['two']);await h.cache.retry(h.data);assert.equal(h.cache.read(h.data).error,false);assert.equal(h.cache.read(h.data).page.rows[0].id,'two');
});
test('More requests serialize; an event arriving during pagination refreshes the head instead of appending stale pages',async()=>{
 const h=cacheHarness();h.fetch=async()=>page(['one'],true);await h.cache.prepare(h.data);
 const more=deferred();h.fetch=()=>more.promise;const pending=h.cache.more(h.data);h.cache.more(h.data);await flush();assert.equal(h.reads.length,2);
 h.data={...h.data,moments:[row('new')]};h.cache.prepare(h.data);h.fetch=async()=>page(['new','one']);more.resolve(page(['old']));await pending;
 assert.equal(h.reads.length,3);assert.deepEqual(Array.from(h.cache.read(h.data).page.rows,r=>r.id),['new','one']);
});
test('synchronous fetch failures are handled, and a pair replacement starts with no old page/cursor',async()=>{
 const h=cacheHarness();h.fetch=()=>{throw Error('offline');};await h.cache.prepare(h.data);assert.equal(h.cache.read(h.data).error,true);
 h.data={...h.data,partner:{id:'new'},pairVersion:'two'};h.fetch=async()=>page(['new']);await h.cache.prepare(h.data);
 assert.equal(h.cache.read(h.data).page.rows[0].id,'new');assert.equal(h.reads.at(-1)[1],null);
});
test('UI priority is scheduling-only, handles held touches, and recovers interrupted native transitions',()=>{
 let now=1000;const api=load(base+'ui-work-priority.ts').createUiWorkPriority(()=>now);
 api.touch(1);now+=1000;assert.ok(api.delay()>0);api.touch(0);assert.equal(api.delay(),140);now+=140;assert.equal(api.delay(),0);
 api.action();assert.equal(api.delay(),240);now+=240;api.transition('stack',true);assert.ok(api.delay()>0);now+=1500;assert.equal(api.delay(),0);
 api.touch(1);api.reset();assert.equal(api.delay(),0);api.touch(1);now+=10001;assert.equal(api.delay(),0,'missing touch end cannot block forever');
});
test('idle jobs re-check touch/transition priority at execution, run serially, and cancellation prevents subsequent work',async()=>{
 const time=clock(),priority=load(base+'ui-work-priority.ts',{},time.globals).uiWorkPriority,events=[],active={currentState:'active'};
 const idle=load(base+'ui-idle.ts',{'react-native':{AppState:active,InteractionManager:{runAfterInteractions(fn){fn();return{cancel(){}};}}},'./ui-work-priority':{uiWorkPriority:priority}},time.globals);
 const first=deferred(),cancel=idle.stageForegroundJobs([{delayMs:10,run:()=>{events.push('first');return first.promise;}},{delayMs:20,run:()=>events.push('second')}]);
 priority.touch(1);time.advance(500);await flush();assert.deepEqual(events,[]);
 priority.touch(0);time.advance(240);await flush();assert.deepEqual(events,['first']);time.advance(1000);assert.equal(events.length,1);
 priority.touch(1);first.resolve();await flush();time.advance(300);assert.equal(events.length,1);cancel();priority.reset();time.advance(1000);await flush();assert.equal(events.length,1);
 const again=idle.stageForegroundJobs([{delayMs:0,run:()=>events.push('hidden')}]);active.currentState='background';time.advance(100);await flush();assert.equal(events.length,1);again();
});
test('hidden primary models ignore unrelated events, but prepare their own domain and discard changed identities',()=>{
 const {retainedPageChanged:changed}=load(base+'retained-page-model.ts');const data={profile:{id:'me'},partner:{id:'you'},pairVersion:'one',moments:[],catalog:[],loadouts:[],inventory:[],quests:{},wallet:{balance:1}};
 assert.equal(changed(data,{...data,serverNow:'later'},'shop'),false);
 assert.equal(changed(data,{...data,moments:[row('new')]},'moments'),true);assert.equal(changed(data,{...data,moments:[row('new')]},'shop'),false);
 assert.equal(changed(data,{...data,quests:{}},'quests'),true);assert.equal(changed(data,{...data,wallet:{balance:2}},'home'),true);
 for(const kind of ['home','burrow','quests','shop','moments','collection'])assert.equal(changed(data,{...data,partner:{id:'new'}},kind),true);
});
test('prepared Home handoff resolves on the actual commit, without waiting for fallback frames',async()=>{
 const frames=new Map();let sequence=0;const time=clock();const api=load(base+'home-design-handoff.ts',{}, {...time.globals,requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id)});
 const release=api.retainHomeDesignHost(),key=api.homeDesignKey('me','you','one',{lamp:'new',outfit:'default'});let done=false;
 const pending=api.waitForHomeDesignCommit(key).then(()=>done=true);await flush();assert.equal(done,false);api.markHomeDesignCommitted(key);await pending;
 assert.equal(done,true);assert.equal(frames.size,0);assert.equal(time.timers.size,0);release();await api.waitForHomeDesignCommit('cold-home');
});
test('no synchronous shared-value reads remain in Home tap guard, and Moments focus does not fetch history',()=>{
 const source=fs.readFileSync(base+'use-home-pull-preview.ts','utf8'),guard=source.slice(source.indexOf('const guard='));assert.doesNotMatch(guard,/\.value/);
 const timeline=fs.readFileSync('apps/mobile/src/components/burrow/moments-timeline.tsx','utf8');assert.doesNotMatch(timeline,/fetchBurrowHistory|focused &&.*load\(/);
 assert.match(timeline,/if\(focused&&page\)markBurrowUpdatesSeen/);
 // The legacy app switch was removed previously. Current tab speculation is
 // idle-only and yields at real user intent, not a legacy feature flag.
 const tabs=fs.readFileSync('apps/mobile/src/components/main/bottom-tab-bar.tsx','utf8');
 assert.match(tabs,/stageForegroundJobs/);assert.match(tabs,/stopPreloading\.current\?\.\(\)/);
});
test('hidden lists stay frozen while caches prepare content; focus consumes the latest model and revocation stays synchronous',()=>{
 const ts=require('typescript'),vm=require('node:vm'),source=fs.readFileSync(base+'burrow-store.ts','utf8');
 const ast=ts.createSourceFile('store.ts',source,ts.ScriptTarget.Latest,true);let fn;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='useBurrow')fn=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 const h=hooks(),deferredWork=[],listeners=new Set(),stats={notifications:0};let focused=false;
 const current={state:{data:{profile:{id:'me'},partner:{id:'you'},pairVersion:'one',moments:[]},receivedAt:0}};
 const react={...h.react,useSyncExternalStore(subscribe,get){h.react.useMemo(()=>subscribe(()=>stats.notifications++),[subscribe]);return get();}};
 const globals={...react,useIsFocused:()=>focused,useCoinBalance:()=>null,walletSnapshot:x=>x,
  useFocusEffect(){},refreshBurrowIfStale(){throw Error('cached focus must not start a request');},
  retainedPageChanged:load(base+'retained-page-model.ts').retainedPageChanged,
  afterUiSettles(task){const ticket={task,live:true};deferredWork.push(ticket);return()=>{ticket.live=false;};},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},exports:{}};
 Object.defineProperty(globals,'state',{get:()=>current.state});
 vm.runInNewContext(ts.transpileModule(fn+';exports.useBurrow=useBurrow;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,globals);
 const render=()=>h.render(()=>globals.exports.useBurrow(false,'moments'));
 const before=render();current.state={...current.state,data:{...current.state.data,moments:[row('new')]}};listeners.forEach(fn=>fn());
 assert.equal(render(),before,'hidden screen does not synchronously repaint during an action');assert.equal(stats.notifications,0);
 assert.equal(deferredWork.length,0,'hidden list drawing is not content preparation');assert.equal(stats.notifications,0);assert.equal(render(),before);
 focused=true;assert.equal(render().data.moments[0].id,'new');
 const selected=render(),count=stats.notifications;
 current.state={...current.state,receivedAt:100,data:{...current.state.data,serverNow:'later',attention:{games:[{id:'round:result'}]}}};listeners.forEach(fn=>fn());
 assert.equal(stats.notifications,count,'focused Moments ignores Game/clock-only updates');assert.equal(render(),selected,'parent renders also preserve the selected snapshot');
 current.state={...current.state,data:{...current.state.data,moments:[row('newer')]}};listeners.forEach(fn=>fn());
 assert.equal(stats.notifications,count+1);assert.equal(render().data.moments[0].id,'newer');
 focused=false;render();
 current.state={...current.state,data:null};listeners.forEach(fn=>fn());assert.equal(render().data,null,'revocation is immediate, never deferred');h.unmount();
});
test('background reconciliation yields to active touch/transition, while its I/O may finish first',async()=>{
 const time=clock(),priority=load(base+'ui-work-priority.ts',{},time.globals).uiWorkPriority;
 const idle=load(base+'ui-idle.ts',{'react-native':{AppState:{currentState:'active'},InteractionManager:{runAfterInteractions(fn){fn();return{cancel(){}};}}},'./ui-work-priority':{uiWorkPriority:priority}},time.globals);
 let committed=false;priority.touch(1);const pending=idle.yieldToUi().then(()=>committed=true);
 time.advance(500);await flush();assert.equal(committed,false);
 priority.touch(0);priority.transition('page',true);time.advance(500);await flush();assert.equal(committed,false);
 priority.transition('page',false);time.advance(240);await pending;assert.equal(committed,true);
});
